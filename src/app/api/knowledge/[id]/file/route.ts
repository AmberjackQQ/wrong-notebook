import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth";
import { unauthorized, notFound, internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { openPdfStream, pdfExists } from "@/lib/knowledge-storage";

const logger = createLogger('api:knowledge');

/**
 * GET /api/knowledge/[id]/file[?download=1]
 * 流式返回 PDF 文件内容（inline 浏览 / attachment 下载）
 * v1 不支持 Range（不返回 Accept-Ranges），浏览器全量下载后渲染
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

        const doc = await prisma.knowledgeDoc.findFirst({
            where: { id, userId: user.id },
            select: { displayName: true, storageName: true, size: true },
        });
        if (!doc) {
            return notFound("Document not found");
        }

        if (!pdfExists(user.id, doc.storageName)) {
            return notFound("File missing on disk");
        }

        const download = new URL(req.url).searchParams.get("download") === "1";
        const encodedName = encodeURIComponent(`${doc.displayName}.pdf`);
        const disposition = download ? "attachment" : "inline";

        return new NextResponse(openPdfStream(user.id, doc.storageName), {
            headers: {
                "Content-Type": "application/pdf",
                "Content-Length": String(doc.size),
                "Content-Disposition": `${disposition}; filename*=UTF-8''${encodedName}`,
                "Cache-Control": "private, max-age=3600",
            },
        });
    } catch (error) {
        logger.error({ error }, 'Error serving knowledge doc file');
        return internalError("Failed to serve knowledge doc file");
    }
}
