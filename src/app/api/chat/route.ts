import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth";
import { unauthorized } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { getAppConfig } from "@/lib/config";
import type { Prisma } from "@prisma/client";
import {
    QUERY_ERROR_ITEMS_TOOL,
    normalizeQueryErrorItemsArgs,
    parseToolInput,
} from "@/lib/chat/skills";

const logger = createLogger('api:chat');

interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
}

// 工具轮次后的消息内容可以是字符串或内容块数组（assistant 的 tool_use、user 的 tool_result）
type UpstreamMessage = { role: 'user' | 'assistant'; content: unknown };

const MAX_MESSAGES = 16;
const MAX_CONTENT_LENGTH = 4000;
const MAX_TOOL_ROUNDS = 3;

const buildSystemPrompt = (subjects: { id: string; name: string }[], skillEnabled: boolean) => {
    const notebookLines = subjects.length > 0
        ? subjects.map((s) => `- ${s.name} → /notebooks/${s.id}`).join('\n')
        : '-（暂无错题本，可建议用户先在「错题本」页创建）';

    const dataRule = skillEnabled
        ? '4. 涉及具体错题数据（数量、列表、按来源/打印次数等筛选）时，必须先调用 query_error_items 工具查询真实数据，再依据查询结果回答，禁止编造数据。'
        : '4. 不要编造数据（错题数量、成绩等）；涉及具体数据时引导用户到对应页面查看。';

    const skillSection = skillEnabled
        ? `

你拥有「错题查询」技能：调用 query_error_items 工具可查询用户错题的真实数据，支持按学科（错题本名称）、题目来源、打印次数范围、掌握程度、关键词筛选。查询结果中每条错题带 url 字段，回答列表时用 [文字](路径) 格式给出对应链接。`
        : '';

    return `你是「AI智能错题本」应用内的助手，帮助用户浏览和管理错题。请用简体中文、简洁的 Markdown 回复（一般不超过 5 行）。

当前用户的错题本列表：
${notebookLines}

可用页面：
- /upload 拍照/文字录入新错题
- /notebooks 全部错题本
- /notebooks/{id} 某个错题本的错题列表
- /error-items 全部错题列表
- /error-items/{id} 单道错题详情
- /stats 学习统计${skillSection}

回答规则：
1. 用户想查看某类错题时，从上面的错题本列表中找到对应科目，给出 Markdown 链接，例如 [查看物理错题](/notebooks/xxx)。
2. 当用户明确表达"打开 / 前往 / 跳转 / 进入"意愿时，在回复最后另起一行输出 [[JUMP:/notebooks/xxx]]（前端会显示"立即前往"按钮）。链接只能来自上面列出的页面。
3. 找不到对应科目时如实说明，并建议用户先在错题本页创建。
${dataRule}
5. 链接必须使用方括号格式 [文字](路径)，不要输出裸 URL。`;
};

// 执行「错题查询」技能：仅查询当前用户自己的错题，供模型回答数据类问题
async function executeQueryErrorItems(userId: string, rawArgs: unknown) {
    const args = normalizeQueryErrorItemsArgs(rawArgs);

    const whereClause: Prisma.ErrorItemWhereInput = { userId };

    if (args.subject) {
        const matchedSubjects = await prisma.subject.findMany({
            where: { userId, name: { contains: args.subject } },
            select: { id: true, name: true },
        });
        if (matchedSubjects.length === 0) {
            return { total: 0, returned: 0, note: `未找到名称包含「${args.subject}」的错题本`, items: [] };
        }
        whereClause.subjectId = { in: matchedSubjects.map((s) => s.id) };
    }

    if (args.paperLevel) {
        whereClause.paperLevel = { contains: args.paperLevel };
    }

    if (args.keyword) {
        whereClause.AND = [{
            OR: [
                { questionText: { contains: args.keyword } },
                { analysis: { contains: args.keyword } },
                { wrongAnswerText: { contains: args.keyword } },
                { mistakeAnalysis: { contains: args.keyword } },
                { knowledgePoints: { contains: args.keyword } },
            ],
        }];
    }

    if (args.minPrintCount !== undefined || args.maxPrintCount !== undefined) {
        whereClause.printCount = {
            ...(args.minPrintCount !== undefined ? { gte: args.minPrintCount } : {}),
            ...(args.maxPrintCount !== undefined ? { lte: args.maxPrintCount } : {}),
        };
    }

    if (args.mastered !== undefined) {
        whereClause.masteryLevel = args.mastered ? { gt: 0 } : 0;
    }

    const limit = Math.min(20, Math.max(1, args.limit ?? 10));

    const [total, errorItems] = await Promise.all([
        prisma.errorItem.count({ where: whereClause }),
        prisma.errorItem.findMany({
            where: whereClause,
            orderBy: { createdAt: 'desc' },
            include: { subject: { select: { name: true } } },
            take: limit,
        }),
    ]);

    return {
        total,
        returned: errorItems.length,
        items: errorItems.map((item) => ({
            id: item.id,
            url: `/error-items/${item.id}`,
            subject: item.subject?.name ?? null,
            paperLevel: item.paperLevel ?? null,
            questionNumber: item.questionNumber ?? null,
            questionPreview: (item.questionText || item.ocrText || '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').slice(0, 120),
            knowledgePoints: item.knowledgePoints ?? null,
            printCount: item.printCount ?? 0,
            mastered: item.masteryLevel > 0,
            createdAt: item.createdAt.toISOString().slice(0, 10),
        })),
    };
}

interface ToolUseBlock {
    index: number;
    id: string;
    name: string;
    input: string;
}

interface StreamResult {
    stopReason: string | null;
    assistantContent: unknown[];
    toolUses: ToolUseBlock[];
}

// 消费上游 SSE：text_delta 实时转发给前端，tool_use 块累积返回（不下发其 JSON）
async function pumpUpstreamStream(
    source: ReadableStream<Uint8Array>,
    onText: (text: string) => void,
): Promise<StreamResult> {
    const reader = source.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let stopReason: string | null = null;
    const toolUses: ToolUseBlock[] = [];
    const textBlocks: { index: number; text: string }[] = [];

    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let newlineIndex: number;
            while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, newlineIndex).trim();
                buffer = buffer.slice(newlineIndex + 1);
                if (!line.startsWith('data:')) continue;
                const payload = line.slice(5).trim();
                if (!payload || payload === '[DONE]') continue;
                try {
                    const evt = JSON.parse(payload);
                    if (evt?.type === 'content_block_start') {
                        if (evt.content_block?.type === 'tool_use') {
                            toolUses.push({
                                index: evt.index,
                                id: evt.content_block.id,
                                name: evt.content_block.name,
                                input: '',
                            });
                        } else if (evt.content_block?.type === 'text') {
                            textBlocks.push({ index: evt.index, text: '' });
                        }
                    } else if (evt?.type === 'content_block_delta') {
                        if (evt.delta?.type === 'text_delta' && typeof evt.delta.text === 'string') {
                            const block = textBlocks.find((b) => b.index === evt.index);
                            if (block) block.text += evt.delta.text;
                            onText(evt.delta.text);
                        } else if (evt.delta?.type === 'input_json_delta' && typeof evt.delta.partial_json === 'string') {
                            const tool = toolUses.find((t) => t.index === evt.index);
                            if (tool) tool.input += evt.delta.partial_json;
                        }
                    } else if (evt?.type === 'message_delta' && evt.delta?.stop_reason) {
                        stopReason = evt.delta.stop_reason;
                    }
                } catch {
                    // 忽略无法解析的行（注释、心跳等）
                }
            }
        }
    } finally {
        reader.releaseLock();
    }

    const assistantContent: unknown[] = [];
    const text = textBlocks.map((b) => b.text).join('');
    if (text) assistantContent.push({ type: 'text', text });
    for (const tool of toolUses) {
        assistantContent.push({ type: 'tool_use', id: tool.id, name: tool.name, input: parseToolInput(tool.input) });
    }

    return { stopReason, assistantContent, toolUses };
}

export async function POST(req: Request) {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
        return unauthorized("Authentication required");
    }

    const user = await prisma.user.findUnique({
        where: { email: session.user.email },
    });

    if (!user) {
        return unauthorized("User not found");
    }

    let body: { messages?: unknown };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
    }

    const raw = Array.isArray(body.messages) ? body.messages : [];
    const history: UpstreamMessage[] = raw
        .filter((m): m is ChatMessage =>
            !!m && typeof m === 'object' &&
            ((m as ChatMessage).role === 'user' || (m as ChatMessage).role === 'assistant') &&
            typeof (m as ChatMessage).content === 'string')
        .slice(-MAX_MESSAGES)
        .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CONTENT_LENGTH) }));

    if (history.length === 0) {
        return NextResponse.json({ error: "messages 不能为空" }, { status: 400 });
    }

    const baseUrl = (process.env.ANTHROPIC_BASE_URL || '').replace(/\/+$/, '');
    const token = process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY || '';
    if (!baseUrl || !token) {
        return NextResponse.json(
            { error: "聊天助手未配置：缺少 ANTHROPIC_BASE_URL 或 ANTHROPIC_AUTH_TOKEN 环境变量" },
            { status: 503 }
        );
    }
    const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

    // 「错题查询」技能开关：系统设置 → AI 服务商 → AI 助手技能
    const skillEnabled = getAppConfig().chatAssistant?.skills?.queryErrorItems !== false;

    const subjects = await prisma.subject.findMany({
        where: { userId: user.id },
        select: { id: true, name: true },
        orderBy: { createdAt: 'asc' },
    });

    const system = buildSystemPrompt(subjects, skillEnabled);

    const callUpstream = () => fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
            model,
            max_tokens: 2048,
            stream: true,
            system,
            messages: history,
            ...(skillEnabled ? { tools: [QUERY_ERROR_ITEMS_TOOL] } : {}),
        }),
        signal: AbortSignal.timeout(120000),
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
            const send = (data: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

            try {
                for (let round = 0; ; round++) {
                    let upstream: Response;
                    try {
                        upstream = await callUpstream();
                    } catch (error) {
                        logger.error({ error }, 'chat upstream request failed');
                        send({ error: "AI 服务连接失败，请稍后重试" });
                        return;
                    }

                    if (!upstream.ok || !upstream.body) {
                        const detail = await upstream.text().catch(() => '');
                        logger.error({ status: upstream.status, detail: detail.slice(0, 300) }, 'chat upstream error');
                        send({ error: `AI 服务暂时不可用（${upstream.status}），请稍后重试` });
                        return;
                    }

                    const result = await pumpUpstreamStream(upstream.body, (text) => send({ text }));

                    const toolUses = skillEnabled
                        ? result.toolUses.filter((t) => t.name === QUERY_ERROR_ITEMS_TOOL.name)
                        : [];

                    if (toolUses.length === 0 || round >= MAX_TOOL_ROUNDS) break;

                    // 把工具调用与结果追加进对话历史，继续下一轮请求
                    history.push({ role: 'assistant', content: result.assistantContent });
                    const toolResults = await Promise.all(toolUses.map(async (tool) => {
                        let content: unknown;
                        try {
                            content = await executeQueryErrorItems(user.id, parseToolInput(tool.input));
                        } catch (error) {
                            logger.error({ error }, 'query_error_items execution failed');
                            content = { error: "查询错题数据失败，请稍后重试或引导用户到错题列表页查看" };
                        }
                        return { type: 'tool_result', tool_use_id: tool.id, content: JSON.stringify(content) };
                    }));
                    history.push({ role: 'user', content: toolResults });
                }
                // 结束标记保持原始格式（非 JSON），与前端解析兼容
                controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            } catch (error) {
                logger.error({ error }, 'chat stream relay error');
                try {
                    send({ error: "AI 响应中断，请重试" });
                } catch {
                    // 流已关闭
                }
            } finally {
                controller.close();
            }
        },
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
        },
    });
}
