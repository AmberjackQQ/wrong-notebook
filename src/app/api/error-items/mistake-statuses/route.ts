import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth";
import { unauthorized, internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { MISTAKE_STATUS_OPTIONS } from "@/lib/mistake-status";

const logger = createLogger('api:error-items:mistake-statuses');

// GET /api/error-items/mistake-statuses - 获取用户已使用过的自定义作答状态文字
// （用于详情页“作答状态”下拉框聚合展示历史自定义项）
export async function GET() {
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

        const rows = await prisma.errorItem.findMany({
            where: {
                userId: user.id,
                customMistakeStatus: { not: null },
            },
            distinct: ['customMistakeStatus'],
            select: { customMistakeStatus: true },
            orderBy: { customMistakeStatus: 'asc' },
        });

        // 兜底过滤：枚举值/空白不应作为自定义项出现（历史数据防御）
        const known = new Set<string>(MISTAKE_STATUS_OPTIONS);
        const statuses = rows
            .map((r) => (r.customMistakeStatus || '').trim())
            .filter((s) => s && !known.has(s));

        return NextResponse.json({ statuses: Array.from(new Set(statuses)) });
    } catch (error) {
        logger.error({ error }, 'Error fetching custom mistake statuses');
        return internalError("Failed to fetch custom mistake statuses");
    }
}
