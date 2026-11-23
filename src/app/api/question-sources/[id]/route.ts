import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth";
import { badRequest, unauthorized, internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";

const logger = createLogger('api:question-sources:[id]');

// PATCH /api/question-sources/[id] - 重命名自定义题目来源（级联更新该用户错题的 paperLevel）
export async function PATCH(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
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

        const body = await req.json().catch(() => ({}));
        const newName = String(body?.name ?? "").trim();
        if (!newName) {
            return badRequest("Name is required and must be a non-empty string");
        }

        const source = await prisma.questionSource.findUnique({
            where: { id },
        });

        if (!source) {
            return badRequest("Question source not found");
        }

        if (source.userId !== user.id) {
            return unauthorized("Not authorized to rename this source");
        }

        // 同名早退：无需改名和级联
        if (newName === source.name) {
            return NextResponse.json(source);
        }

        const duplicate = await prisma.questionSource.findFirst({
            where: { userId: user.id, name: newName, NOT: { id } },
        });
        if (duplicate) {
            return badRequest("该名称已存在");
        }

        // paperLevel 按名称引用来源（无外键），改名须级联更新该用户的错题文本
        const [updated, cascade] = await prisma.$transaction([
            prisma.questionSource.update({
                where: { id },
                data: { name: newName },
            }),
            prisma.errorItem.updateMany({
                where: { userId: user.id, paperLevel: source.name },
                data: { paperLevel: newName },
            }),
        ]);

        logger.info({ sourceId: id, renamedFrom: source.name, renamedTo: newName, errorItemsAffected: cascade.count }, 'Question source renamed');
        return NextResponse.json(updated);
    } catch (error) {
        logger.error({ error }, 'Error renaming question source');
        return internalError("Failed to rename question source");
    }
}

// DELETE /api/question-sources/[id] - 删除自定义题目来源
export async function DELETE(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
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

        const source = await prisma.questionSource.findUnique({
            where: { id },
        });

        if (!source) {
            return badRequest("Question source not found");
        }

        if (source.userId !== user.id) {
            return unauthorized("Not authorized to delete this source");
        }

        await prisma.questionSource.delete({
            where: { id },
        });

        logger.info({ sourceId: id }, 'Question source deleted');
        return NextResponse.json({ message: "Deleted successfully" });
    } catch (error) {
        logger.error({ error }, 'Error deleting question source');
        return internalError("Failed to delete question source");
    }
}
