import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth";
import { unauthorized, notFound, internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";

const logger = createLogger('api:vocab:id');

/**
 * GET /api/vocab/[id]
 * 获取单个词条
 */
export async function GET(
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
            return unauthorized("Not authorized to access this entry");
        }

        return NextResponse.json(entry);
    } catch (error) {
        logger.error({ error }, 'Error fetching vocab entry');
        return internalError("Failed to fetch vocab entry");
    }
}

/**
 * PUT /api/vocab/[id]
 * 更新词条的用户字段（例句 / 笔记）
 */
export async function PUT(
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

        const body = await req.json();
        const { sentence, note } = body;

        const updated = await prisma.vocabularyEntry.update({
            where: { id },
            data: {
                sentence: sentence?.trim() || null,
                note: note?.trim() || null,
            },
        });

        return NextResponse.json(updated);
    } catch (error) {
        logger.error({ error }, 'Error updating vocab entry');
        return internalError("Failed to update vocab entry");
    }
}

/**
 * DELETE /api/vocab/[id]
 * 删除词条
 */
export async function DELETE(
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
            return unauthorized("Not authorized to delete this entry");
        }

        await prisma.vocabularyEntry.delete({
            where: { id },
        });

        return NextResponse.json({ message: "Vocabulary entry deleted successfully" });
    } catch (error) {
        logger.error({ error }, 'Error deleting vocab entry');
        return internalError("Failed to delete vocab entry");
    }
}
