import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth";
import { badRequest, unauthorized, internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";

const logger = createLogger('api:question-sources:[id]');

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
