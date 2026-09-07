import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth";
import { notFound, unauthorized, forbidden, internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";

const logger = createLogger('api:error-items:print');

// POST /api/error-items/[id]/print - 扫码使用：打印次数原子 +1
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
        return unauthorized("Authentication required");
    }

    try {
        const { id } = await params;
        const user = await prisma.user.findUnique({
            where: { email: session.user.email },
        });

        if (!user) {
            return unauthorized("User not found");
        }

        const item = await prisma.errorItem.findUnique({
            where: { id },
        });

        if (!item) {
            return notFound("Item not found");
        }

        if (item.userId !== user.id) {
            return forbidden("Not authorized to update this item");
        }

        const updated = await prisma.errorItem.update({
            where: { id },
            data: { printCount: { increment: 1 } },
            select: { id: true, printCount: true },
        });

        logger.info({ itemId: id, printCount: updated.printCount }, 'Print count incremented via QR scan');
        return NextResponse.json(updated);
    } catch (error) {
        logger.error({ error }, 'Error incrementing print count');
        return internalError("Failed to increment print count");
    }
}
