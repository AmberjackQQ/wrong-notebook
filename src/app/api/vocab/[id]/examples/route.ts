import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth";
import { unauthorized, notFound, internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { getAIService } from "@/lib/ai";

const logger = createLogger('api:vocab:examples');

/**
 * POST /api/vocab/[id]/examples
 * AI 生成例句并落库到 aiExamples 字段（JSON [{en, zh}]）；
 * 失败返回 502，不影响已有词条
 */
export async function POST(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const session = await getServerSession(authOptions);

    try {
        let user;
        if (session?.user?.email) {
            user = await prisma.user.findUnique({
                where: { email: session.user.email },
            });
        }

        if (!user) {
            return unauthorized("Authentication required");
        }

        const entry = await prisma.vocabularyEntry.findUnique({
            where: { id },
        });

        if (!entry) {
            return notFound("Vocabulary entry not found");
        }

        if (entry.userId !== user.id) {
            return unauthorized("Not authorized to update this entry");
        }

        const result = await getAIService().generateVocabExamples(
            entry.word,
            entry.sentence || undefined
        );

        const updated = await prisma.vocabularyEntry.update({
            where: { id },
            data: { aiExamples: JSON.stringify(result.examples) },
        });

        logger.info({ word: entry.word, count: result.examples.length }, 'Vocab examples generated');

        return NextResponse.json(updated);
    } catch (error) {
        logger.error({ error }, 'Error generating vocab examples');

        const errorMsg = error instanceof Error ? error.message : String(error);

        if (errorMsg.startsWith("AI_")) {
            return NextResponse.json(
                {
                    message: errorMsg === 'AI_AUTH_ERROR'
                        ? "AI 服务未配置：请在系统设置中配置 AI 提供商"
                        : errorMsg
                },
                { status: 502 }
            );
        }

        return internalError("Failed to generate vocab examples");
    }
}
