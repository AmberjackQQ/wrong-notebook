import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth";
import { unauthorized, badRequest, notFound, conflict, internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { lookupWord } from "@/lib/vocab/dictionary";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, MIN_PAGE_SIZE } from "@/lib/constants/pagination";

const logger = createLogger('api:vocab');

/**
 * GET /api/vocab?subjectId=xxx&query=yyy&page=1&pageSize=20
 * 分页获取词汇列表（搜索范围：单词 / 中文释义）
 */
export async function GET(req: Request) {
    const session = await getServerSession(authOptions);

    const { searchParams } = new URL(req.url);
    const subjectId = searchParams.get("subjectId");
    const query = searchParams.get("query");
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, parseInt(searchParams.get("pageSize") || String(DEFAULT_PAGE_SIZE), 10)));

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

        const whereClause: Prisma.VocabularyEntryWhereInput = {
            userId: user.id,
        };

        if (subjectId) {
            whereClause.subjectId = subjectId;
        }

        if (query) {
            whereClause.OR = [
                { word: { contains: query } },
                { translation: { contains: query } },
            ];
        }

        const [total, items] = await Promise.all([
            prisma.vocabularyEntry.count({ where: whereClause }),
            prisma.vocabularyEntry.findMany({
                where: whereClause,
                orderBy: { createdAt: 'desc' },
                skip: (page - 1) * pageSize,
                take: pageSize,
            }),
        ]);

        const totalPages = Math.ceil(total / pageSize);

        return NextResponse.json({
            items,
            total,
            page,
            pageSize,
            totalPages,
        });
    } catch (error) {
        logger.error({ error }, 'Error fetching vocab entries');
        return internalError("Failed to fetch vocab entries");
    }
}

/**
 * POST /api/vocab
 * 添加词汇：word 归一小写存储，唯一冲突返回 409；
 * 服务端查 ECDICT 词典回填解析字段（未命中时词条仍保存）
 */
export async function POST(req: Request) {
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

        const body = await req.json();
        const { subjectId, word, sentence, note } = body;

        if (!subjectId || !word || !String(word).trim()) {
            return badRequest("subjectId and word are required");
        }

        const subject = await prisma.subject.findUnique({
            where: { id: subjectId },
        });

        if (!subject) {
            return notFound("Notebook not found");
        }

        if (subject.userId !== user.id) {
            return unauthorized("Not authorized to add to this notebook");
        }

        if (subject.type !== 'vocab') {
            return badRequest("This notebook is not a vocabulary notebook");
        }

        // 归一小写存储（@@unique([subjectId, word]) 防同本重复）
        const normalizedWord = String(word).trim().toLowerCase();

        const existing = await prisma.vocabularyEntry.findUnique({
            where: { subjectId_word: { subjectId, word: normalizedWord } },
        });

        if (existing) {
            return conflict(`"${normalizedWord}" already exists in this notebook`);
        }

        // 词典查询缺失时优雅降级（返回 null），词条仍保存
        const dict = lookupWord(normalizedWord);

        const entry = await prisma.vocabularyEntry.create({
            data: {
                userId: user.id,
                subjectId,
                word: normalizedWord,
                phonetic: dict?.phonetic ?? null,
                translation: dict?.translation ?? null,
                definition: dict?.definition ?? null,
                pos: dict?.pos ?? null,
                collins: dict?.collins ?? null,
                oxford: dict?.oxford ?? null,
                tags: dict?.tags ?? null,
                exchange: dict?.exchange ?? null,
                sentence: sentence?.trim() || null,
                note: note?.trim() || null,
            },
        });

        return NextResponse.json(entry, { status: 201 });
    } catch (error) {
        logger.error({ error }, 'Error creating vocab entry');
        return internalError("Failed to create vocab entry");
    }
}
