import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth";
import { unauthorized } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";

const logger = createLogger('api:chat');

interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
}

const MAX_MESSAGES = 16;
const MAX_CONTENT_LENGTH = 4000;

const buildSystemPrompt = (subjects: { id: string; name: string }[]) => {
    const notebookLines = subjects.length > 0
        ? subjects.map((s) => `- ${s.name} → /notebooks/${s.id}`).join('\n')
        : '-（暂无错题本，可建议用户先在「错题本」页创建）';

    return `你是「AI智能错题本」应用内的助手，帮助用户浏览和管理错题。请用简体中文、简洁的 Markdown 回复（一般不超过 5 行）。

当前用户的错题本列表：
${notebookLines}

可用页面：
- /upload 拍照/文字录入新错题
- /notebooks 全部错题本
- /notebooks/{id} 某个错题本的错题列表
- /error-items 全部错题列表
- /error-items/{id} 单道错题详情
- /stats 学习统计

回答规则：
1. 用户想查看某类错题时，从上面的错题本列表中找到对应科目，给出 Markdown 链接，例如 [查看物理错题](/notebooks/xxx)。
2. 当用户明确表达"打开 / 前往 / 跳转 / 进入"意愿时，在回复最后另起一行输出 [[JUMP:/notebooks/xxx]]（前端会显示"立即前往"按钮）。链接只能来自上面列出的页面。
3. 找不到对应科目时如实说明，并建议用户先在错题本页创建。
4. 不要编造数据（错题数量、成绩等）；涉及具体数据时引导用户到对应页面查看。
5. 链接必须使用方括号格式 [文字](路径)，不要输出裸 URL。`;
};

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
    const messages: ChatMessage[] = raw
        .filter((m): m is ChatMessage =>
            !!m && typeof m === 'object' &&
            ((m as ChatMessage).role === 'user' || (m as ChatMessage).role === 'assistant') &&
            typeof (m as ChatMessage).content === 'string')
        .slice(-MAX_MESSAGES)
        .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CONTENT_LENGTH) }));

    if (messages.length === 0) {
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

    const subjects = await prisma.subject.findMany({
        where: { userId: user.id },
        select: { id: true, name: true },
        orderBy: { createdAt: 'asc' },
    });

    let upstream: Response;
    try {
        upstream = await fetch(`${baseUrl}/v1/messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model,
                max_tokens: 1024,
                stream: true,
                system: buildSystemPrompt(subjects),
                messages,
            }),
            signal: AbortSignal.timeout(120000),
        });
    } catch (error) {
        logger.error({ error }, 'chat upstream request failed');
        return NextResponse.json({ error: "AI 服务连接失败，请稍后重试" }, { status: 502 });
    }

    if (!upstream.ok || !upstream.body) {
        const detail = await upstream.text().catch(() => '');
        logger.error({ status: upstream.status, detail: detail.slice(0, 300) }, 'chat upstream error');
        return NextResponse.json({ error: `AI 服务暂时不可用（${upstream.status}），请稍后重试` }, { status: 502 });
    }

    // 上游 SSE → 只转发 text_delta 的轻量 SSE（thinking 块、事件元数据不下发）
    const source = upstream.body;
    const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
            const reader = source.getReader();
            const decoder = new TextDecoder();
            const encoder = new TextEncoder();
            let buffer = '';
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
                            if (evt?.type === 'content_block_delta' && evt.delta?.type === 'text_delta' && typeof evt.delta.text === 'string') {
                                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: evt.delta.text })}\n\n`));
                            }
                        } catch {
                            // 忽略无法解析的行（注释、心跳等）
                        }
                    }
                }
                controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            } catch (error) {
                logger.error({ error }, 'chat stream relay error');
                try {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: "AI 响应中断，请重试" })}\n\n`));
                } catch {
                    // 流已关闭
                }
            } finally {
                controller.close();
                reader.releaseLock();
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
