import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth";
import { unauthorized, badRequest, notFound, internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { KNOWLEDGE_DOC_TYPES, deletePdf } from "@/lib/knowledge-storage";

const logger = createLogger('api:knowledge');

const DOC_SELECT = {
    id: true,
    filename: true,
    displayName: true,
    docType: true,
    size: true,
    subjectId: true,
    createdAt: true,
    updatedAt: true,
    subject: { select: { id: true, name: true } },
} as const;

async function getOwnedDoc(id: string, userId: string) {
    return prisma.knowledgeDoc.findFirst({
        where: { id, userId },
        select: { ...DOC_SELECT, storageName: true },
    });
}

/**
 * GET /api/knowledge/[id]
 * 获取单个文档元数据（浏览页头部信息用）
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getServerSession(authOptions);

    try {
        const { id } = await params;
        let user;
        if (session?.user?.email) {
            user = await prisma.user.findUnique({
                where: { email: session.user.email },
            });
        }

        if (!user) {
            return unauthorized("Authentication required");
        }

        const doc = await getOwnedDoc(id, user.id);
        if (!doc) {
            return notFound("Document not found");
        }
        const { storageName: _storageName, ...safe } = doc;
        return NextResponse.json(safe);
    } catch (error) {
        logger.error({ error }, 'Error fetching knowledge doc');
        return internalError("Failed to fetch knowledge doc");
    }
}

/**
 * PATCH /api/knowledge/[id]
 * 修改显示名 / 文档类型 / 所属学科（subjectId 传 null 转未分类）
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getServerSession(authOptions);

    try {
        const { id } = await params;
        let user;
        if (session?.user?.email) {
            user = await prisma.user.findUnique({
                where: { email: session.user.email },
            });
        }

        if (!user) {
            return unauthorized("Authentication required");
        }

        const existing = await getOwnedDoc(id, user.id);
        if (!existing) {
            return notFound("Document not found");
        }

        const body = await req.json();
        const data: { displayName?: string; docType?: string; subjectId?: string | null } = {};

        if (body.displayName !== undefined) {
            const displayName = String(body.displayName).trim();
            if (!displayName || displayName.length > 200) {
                return badRequest("displayName must be 1-200 characters");
            }
            data.displayName = displayName;
        }

        if (body.docType !== undefined) {
            if (!(KNOWLEDGE_DOC_TYPES as readonly string[]).includes(body.docType)) {
                return badRequest("Invalid docType");
            }
            data.docType = body.docType;
        }

        if (body.subjectId !== undefined) {
            if (body.subjectId === null) {
                data.subjectId = null;
            } else {
                const subject = await prisma.subject.findFirst({
                    where: { id: String(body.subjectId), userId: user.id },
                });
                if (!subject) {
                    return notFound("Subject not found");
                }
                data.subjectId = subject.id;
            }
        }

        if (Object.keys(data).length === 0) {
            return badRequest("No fields to update");
        }

        const doc = await prisma.knowledgeDoc.update({
            where: { id },
            data,
            select: DOC_SELECT,
        });
        return NextResponse.json(doc);
    } catch (error) {
        logger.error({ error }, 'Error updating knowledge doc');
        return internalError("Failed to update knowledge doc");
    }
}

/**
 * DELETE /api/knowledge/[id]
 * 删除文档：先删库行，再 best-effort 删磁盘文件
 * （Windows 下文件可能被 viewer/杀软占用，删除失败不回滚，响应带 fileDeleteFailed）
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getServerSession(authOptions);

    try {
        const { id } = await params;
        let user;
        if (session?.user?.email) {
            user = await prisma.user.findUnique({
                where: { email: session.user.email },
            });
        }

        if (!user) {
            return unauthorized("Authentication required");
        }

        const existing = await getOwnedDoc(id, user.id);
        if (!existing) {
            return notFound("Document not found");
        }

        await prisma.knowledgeDoc.delete({ where: { id } });

        let fileDeleteFailed = false;
        try {
            await deletePdf(user.id, existing.storageName);
        } catch (e) {
            fileDeleteFailed = true;
            logger.warn({ error: e, docId: id }, 'Failed to delete pdf file (db row removed)');
        }

        return NextResponse.json({ success: true, fileDeleteFailed });
    } catch (error) {
        logger.error({ error }, 'Error deleting knowledge doc');
        return internalError("Failed to delete knowledge doc");
    }
}
