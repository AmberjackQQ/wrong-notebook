import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth";
import { unauthorized, badRequest, conflict, internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";

const logger = createLogger('api:notebooks');

/**
 * GET /api/notebooks
 * 获取用户所有错题本（Subjects），附每本的 待复习/已掌握 题数
 */
export async function GET() {
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

        // 待复习（masteryLevel=0）/ 已掌握（masteryLevel>0）口径与错题列表页一致
        const attachMasteryCounts = async <T extends { id: string }>(rows: T[]) =>
            Promise.all(rows.map(async (n) => {
                const [reviewCount, masteredCount] = await Promise.all([
                    prisma.errorItem.count({ where: { userId: user!.id, subjectId: n.id, masteryLevel: 0 } }),
                    prisma.errorItem.count({ where: { userId: user!.id, subjectId: n.id, masteryLevel: { gt: 0 } } }),
                ]);
                return { ...n, reviewCount, masteredCount };
            }));

        let notebooks = await prisma.subject.findMany({
            where: {
                userId: user.id,
            },
            include: {
                _count: {
                    select: {
                        errorItems: true,
                        vocabEntries: true,
                    },
                },
            },
            orderBy: {
                createdAt: 'desc',
            },
        });

        // If no notebooks exist, create default ones
        if (notebooks.length === 0) {
            const defaultSubjects = ["数学", "英语"];

            await Promise.all(defaultSubjects.map(name =>
                prisma.subject.create({
                    data: {
                        name,
                        userId: user!.id,
                    }
                })
            ));

            // Fetch again
            notebooks = await prisma.subject.findMany({
                where: {
                    userId: user.id,
                },
                include: {
                    _count: {
                        select: {
                            errorItems: true,
                            vocabEntries: true,
                        },
                    },
                },
                orderBy: {
                    createdAt: 'desc',
                },
            });
        }

        // 幂等补建「英语词汇」本：默认创建仅在新用户 0 本时触发，老用户需在此补齐。
        // 已有同名普通本时转为词汇本，避免唯一约束冲突导致 GET 500
        if (!notebooks.some((n) => n.type === 'vocab')) {
            const sameNamed = notebooks.find((n) => n.name === '英语词汇');
            if (sameNamed) {
                await prisma.subject.update({
                    where: { id: sameNamed.id },
                    data: { type: 'vocab' },
                });
                sameNamed.type = 'vocab';
            } else {
                await prisma.subject.create({
                    data: { name: '英语词汇', userId: user.id, type: 'vocab' },
                });
                notebooks = await prisma.subject.findMany({
                    where: { userId: user.id },
                    include: {
                        _count: {
                            select: {
                                errorItems: true,
                                vocabEntries: true,
                            },
                        },
                    },
                    orderBy: { createdAt: 'desc' },
                });
            }
        }

        return NextResponse.json(await attachMasteryCounts(notebooks));
    } catch (error) {
        logger.error({ error }, 'Error fetching notebooks');
        return internalError("Failed to fetch notebooks");
    }
}

/**
 * POST /api/notebooks
 * 创建新错题本
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
        const { name } = body;

        if (!name || !name.trim()) {
            return badRequest("Notebook name is required");
        }

        // 检查是否已存在同名错题本
        const existing = await prisma.subject.findUnique({
            where: {
                name_userId: {
                    name: name.trim(),
                    userId: user.id,
                },
            },
        });

        if (existing) {
            return conflict("Notebook with this name already exists");
        }

        const notebook = await prisma.subject.create({
            data: {
                name: name.trim(),
                userId: user.id,
            },
            include: {
                _count: {
                    select: {
                        errorItems: true,
                        vocabEntries: true,
                    },
                },
            },
        });

        return NextResponse.json({ ...notebook, reviewCount: 0, masteredCount: 0 }, { status: 201 });
    } catch (error) {
        logger.error({ error }, 'Error creating notebook');
        return internalError("Failed to create notebook");
    }
}
