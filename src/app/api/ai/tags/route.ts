import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { unauthorized } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { getAIService } from "@/lib/ai";
import { getAppConfig } from "@/lib/config";
import { generateKnowledgeTagsPrompt, getSubjectLabel } from "@/lib/ai/prompts";
import { getTagsFromDB } from "@/lib/ai/tag-service";

const logger = createLogger('api:ai-tags');

const MAX_QUESTION_LENGTH = 8000;

/**
 * 知识点标签自动生成端点。
 * 供「添加错题」知识点框的 AI 生成按钮调用：题目文本 → AI 知识点标签列表。
 * 优先走已配置的 AI provider；provider 未配置或鉴权失败时，
 * 回退到 Anthropic 兼容端点（与 /api/chat 相同的 ANTHROPIC_* 环境变量）。
 */

interface TagsRequestBody {
    questionText?: unknown;
    answerText?: unknown;
    analysis?: unknown;
    subject?: unknown;
    gradeSemester?: unknown;
}

const buildTagsPrompt = async (
    questionText: string,
    body: TagsRequestBody
): Promise<string> => {
    const subjectKey = typeof body.subject === 'string' ? body.subject : '';
    const prefetchedTags = subjectKey ? await getTagsFromDB(subjectKey) : [];
    return generateKnowledgeTagsPrompt(questionText, {
        answerText: typeof body.answerText === 'string' ? body.answerText : undefined,
        analysis: typeof body.analysis === 'string' ? body.analysis : undefined,
        subject: getSubjectLabel(subjectKey),
        gradeSemester: typeof body.gradeSemester === 'string' ? body.gradeSemester : undefined,
        prefetchedTags,
        customTemplate: getAppConfig().prompts?.knowledgeTags,
    });
};

const parseTagsFromText = (text: string): string[] => {
    const match = text.match(/<knowledge_points>([\s\S]*?)<\/knowledge_points>/);
    const raw = match?.[1] || '';
    const tags = Array.from(new Set(
        raw.split(/[,，\n]/).map((tag) => tag.trim()).filter(Boolean)
    ));
    return tags.slice(0, 8);
};

const suggestTagsViaAnthropic = async (prompt: string): Promise<string[]> => {
    const baseUrl = (process.env.ANTHROPIC_BASE_URL || '').replace(/\/+$/, '');
    const token = process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY || '';
    if (!baseUrl || !token) {
        throw new Error('AI_AUTH_ERROR');
    }

    const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
    const upstream = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
            model,
            max_tokens: 1024,
            messages: [{
                role: 'user',
                content: `${prompt}\n\n请为上述题目标注知识点，只输出 <knowledge_points> 标签内容。`,
            }],
        }),
        signal: AbortSignal.timeout(60000),
    });

    if (!upstream.ok) {
        const detail = await upstream.text().catch(() => '');
        logger.error({ status: upstream.status, detail: detail.slice(0, 300) }, 'knowledge tags anthropic fallback error');
        throw new Error(`AI 服务暂时不可用（${upstream.status}）`);
    }

    const data = await upstream.json();
    const text = Array.isArray(data?.content)
        ? data.content
            .filter((block: { type?: string }) => block?.type === 'text')
            .map((block: { text?: string }) => block?.text || '')
            .join('')
        : '';
    return parseTagsFromText(text);
};

export async function POST(req: Request) {
    const session = await getServerSession(authOptions);

    try {
        if (!session?.user?.email) {
            return unauthorized("Authentication required");
        }

        const body: TagsRequestBody = await req.json();
        const questionText = typeof body.questionText === 'string' ? body.questionText.trim() : '';

        if (!questionText) {
            return NextResponse.json(
                { message: "题目文本为空，无法生成知识点" },
                { status: 400 }
            );
        }

        const options = {
            answerText: typeof body.answerText === 'string' ? body.answerText : undefined,
            analysis: typeof body.analysis === 'string' ? body.analysis : undefined,
            subject: typeof body.subject === 'string' ? body.subject : undefined,
            gradeSemester: typeof body.gradeSemester === 'string' ? body.gradeSemester : undefined,
        };

        let knowledgePoints: string[] = [];
        let providerError: string | null = null;
        try {
            knowledgePoints = await getAIService().suggestKnowledgeTags(
                questionText.slice(0, MAX_QUESTION_LENGTH),
                options
            );
        } catch (error) {
            providerError = error instanceof Error ? error.message : String(error);
            logger.warn({ providerError }, 'provider tags failed, trying anthropic fallback');
        }

        if (knowledgePoints.length === 0) {
            // provider 未配置或鉴权失败 → 回退 Anthropic 兼容端点
            const prompt = await buildTagsPrompt(questionText.slice(0, MAX_QUESTION_LENGTH), body);
            knowledgePoints = await suggestTagsViaAnthropic(prompt);
        }

        logger.info({ count: knowledgePoints.length, subject: options.subject }, 'Knowledge tags generated');

        return NextResponse.json({ knowledgePoints });
    } catch (error) {
        logger.error({ error }, 'Error during knowledge tags generation');

        const errorMsg = error instanceof Error ? error.message : String(error);

        if (errorMsg.startsWith("AI_")) {
            return NextResponse.json(
                { message: errorMsg === 'AI_AUTH_ERROR'
                    ? "AI 服务未配置：请在系统设置中配置 AI 提供商，或设置 ANTHROPIC 环境变量"
                    : errorMsg },
                { status: 502 }
            );
        }

        return NextResponse.json(
            { message: "知识点生成失败，请稍后重试" },
            { status: 500 }
        );
    }
}
