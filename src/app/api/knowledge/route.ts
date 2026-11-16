import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth";
import { unauthorized, badRequest, notFound, internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, MIN_PAGE_SIZE } from "@/lib/constants/pagination";
import { isValidPdfFilename, savePdf, deletePdf, KNOWLEDGE_DOC_TYPES } from "@/lib/knowledge-storage";
import { classifyKnowledgeDoc } from "@/lib/knowledge-classifier";

const logger = createLogger('api:knowledge');

const DOC_TYPES = KNOWLEDGE_DOC_TYPES;
const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200MB

/**
 * GET /api/knowledge?subjectId=xxx|none&docType=yyy&query=zzz&page=1&pageSize=20
 * 分页获取知识库文档列表（搜索范围：原始文件名 / 显示名）
 */
export async function GET(req: Request) {
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

        const { searchParams } = new URL(req.url);
        const subjectId = searchParams.get("subjectId");
        const docType = searchParams.get("docType");
        const query = searchParams.get("query");
        const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
        const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, parseInt(searchParams.get("pageSize") || String(DEFAULT_PAGE_SIZE), 10)));

        const whereClause: Record<string, unknown> = { userId: user.id };

        if (subjectId === "none") {
            whereClause.subjectId = null;
        } else if (subjectId) {
            whereClause.subjectId = subjectId;
        }

        if (docType && (DOC_TYPES as readonly string[]).includes(docType)) {
            whereClause.docType = docType;
        }

        if (query) {
            whereClause.OR = [
                { filename: { contains: query } },
                { displayName: { contains: query } },
            ];
        }

        const [total, items] = await Promise.all([
            prisma.knowledgeDoc.count({ where: whereClause }),
            prisma.knowledgeDoc.findMany({
                where: whereClause,
                orderBy: { createdAt: 'desc' },
                select: {
                    id: true,
                    filename: true,
                    displayName: true,
                    docType: true,
                    size: true,
                    subjectId: true,
                    createdAt: true,
                    updatedAt: true,
                    subject: { select: { id: true, name: true } },
                },
                skip: (page - 1) * pageSize,
                take: pageSize,
            }),
        ]);

        return NextResponse.json({
            items,
            total,
            page,
            pageSize,
            totalPages: Math.ceil(total / pageSize),
        });
    } catch (error) {
        logger.error({ error }, 'Error fetching knowledge docs');
        return internalError("Failed to fetch knowledge docs");
    }
}

/**
 * POST /api/knowledge
 * 上传 PDF 文档（multipart/form-data）：file 必填，subjectId/docType/displayName 可选
 * 文件先落盘再建库行；建库失败时回滚删除文件
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

        const form = await req.formData();
        const file = form.get("file");

        if (!(file instanceof File) || file.size === 0) {
            return badRequest("file is required");
        }

        if (file.size > MAX_FILE_SIZE) {
            return badRequest("File too large (max 200MB)");
        }

        if (!isValidPdfFilename(file.name)) {
            return badRequest("Only PDF files are supported");
        }

        const docTypeRaw = String(form.get("docType") || "textbook");
        // "auto" = 由 AI/启发式自动分类；其余须在白名单内
        const wantsAutoDocType = docTypeRaw === "auto";
        if (!wantsAutoDocType && !(DOC_TYPES as readonly string[]).includes(docTypeRaw)) {
            return badRequest("Invalid docType");
        }

        const subjectIdRaw = form.get("subjectId");
        // "auto" = 自动匹配用户学科；"" = 显式未分类；具体 id = 手动指定
        const subjectIdStr = subjectIdRaw ? String(subjectIdRaw).trim() : "";
        const wantsAutoSubject = subjectIdStr === "auto";
        let subjectId: string | null = null;
        if (!wantsAutoSubject && subjectIdStr) {
            const subject = await prisma.subject.findFirst({
                where: { id: subjectIdStr, userId: user.id },
            });
            if (!subject) {
                return notFound("Subject not found");
            }
            subjectId = subject.id;
        }

        const displayNameRaw = form.get("displayName");
        const displayName = String(displayNameRaw || "").trim() || file.name;

        // 先落盘再建库；建库失败回滚删文件（best-effort）
        const data = Buffer.from(await file.arrayBuffer());
        const storageName = await savePdf(user.id, data);

        try {
            let finalDocType: string = docTypeRaw;
            let finalSubjectId: string | null = subjectId;
            let classificationMethod: string | undefined;

            if (wantsAutoDocType || wantsAutoSubject) {
                try {
                    const subjects = await prisma.subject.findMany({
                        where: { userId: user.id },
                        select: { id: true, name: true },
                    });
                    const result = await classifyKnowledgeDoc(file.name, data, subjects);
                    if (wantsAutoDocType) finalDocType = result.docType;
                    if (wantsAutoSubject) finalSubjectId = result.subjectId;
                    classificationMethod = result.method;
                } catch (classifyError) {
                    // 分类失败不阻断上传：auto 退默认值
                    logger.warn({ error: classifyError }, 'Auto classification failed, using defaults');
                    if (wantsAutoDocType) finalDocType = "textbook";
                    if (wantsAutoSubject) finalSubjectId = null;
                    classificationMethod = 'fallback';
                }
            }

            const doc = await prisma.knowledgeDoc.create({
                data: {
                    userId: user.id,
                    subjectId: finalSubjectId,
                    filename: file.name,
                    storageName,
                    displayName,
                    docType: finalDocType,
                    size: file.size,
                },
                select: {
                    id: true,
                    filename: true,
                    displayName: true,
                    docType: true,
                    size: true,
                    subjectId: true,
                    createdAt: true,
                    updatedAt: true,
                    subject: { select: { id: true, name: true } },
                },
            });
            return NextResponse.json({ ...doc, classification: classificationMethod ? { method: classificationMethod } : undefined }, { status: 201 });
        } catch (dbError) {
            await deletePdf(user.id, storageName).catch((e) => {
                logger.warn({ error: e }, 'Failed to cleanup orphan pdf after create failure');
            });
            throw dbError;
        }
    } catch (error) {
        logger.error({ error }, 'Error uploading knowledge doc');
        return internalError("Failed to upload knowledge doc");
    }
}
