import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth";
import { badRequest, unauthorized, internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";

const logger = createLogger('api:question-sources');

// GET /api/question-sources - 获取用户自定义题目来源
// 可选参数 subjectId：只返回该笔记本内错题实际使用过的来源（用于按科目过滤下拉选项）
export async function GET(req: Request) {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
        return unauthorized("Authentication required");
    }

    try {
        const user = await prisma.user.findUnique({
            where: { email: session.user.email },
        });

        if (!user) {
            return unauthorized("User not found");
        }

        const sources = await prisma.questionSource.findMany({
            where: { userId: user.id },
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        });

        const subjectId = new URL(req.url).searchParams.get("subjectId");
        if (subjectId) {
            const usedLevels = await prisma.errorItem.findMany({
                where: { userId: user.id, subjectId },
                distinct: ['paperLevel'],
                select: { paperLevel: true },
            });
            const usedNames = new Set(usedLevels.map(i => i.paperLevel));
            return NextResponse.json(sources.filter(s => usedNames.has(s.name)));
        }

        return NextResponse.json(sources);
    } catch (error) {
        logger.error({ error }, 'Error fetching question sources');
        return internalError("Failed to fetch question sources");
    }
}

// POST /api/question-sources - 添加自定义题目来源
export async function POST(req: Request) {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
        return unauthorized("Authentication required");
    }

    try {
        const user = await prisma.user.findUnique({
            where: { email: session.user.email },
        });

        if (!user) {
            return unauthorized("User not found");
        }

        const body = await req.json();
        const { name } = body;

        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            return badRequest("Name is required and must be a non-empty string");
        }

        // 检查是否已存在同名来源
        const existing = await prisma.questionSource.findFirst({
            where: {
                userId: user.id,
                name: name.trim(),
            },
        });

        if (existing) {
            return badRequest("Question source with this name already exists");
        }

        // 获取当前最大排序值
        const maxSort = await prisma.questionSource.findFirst({
            where: { userId: user.id },
            orderBy: { sortOrder: 'desc' },
            select: { sortOrder: true },
        });

        const nextSortOrder = (maxSort?.sortOrder ?? -1) + 1;

        const newSource = await prisma.questionSource.create({
            data: {
                name: name.trim(),
                userId: user.id,
                sortOrder: nextSortOrder,
            },
        });

        logger.info({ sourceId: newSource.id, name: newSource.name }, 'Question source created');
        return NextResponse.json(newSource, { status: 201 });
    } catch (error) {
        logger.error({ error }, 'Error creating question source');
        return internalError("Failed to create question source");
    }
}