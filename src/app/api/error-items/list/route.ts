import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth";
import { unauthorized, internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, MIN_PAGE_SIZE } from "@/lib/constants/pagination";

const logger = createLogger('api:error-items:list');

export async function GET(req: Request) {
    const session = await getServerSession(authOptions);

    const { searchParams } = new URL(req.url);
    const subjectId = searchParams.get("subjectId");
    const query = searchParams.get("query");
    const mastery = searchParams.get("mastery");
    const timeRange = searchParams.get("timeRange");
    const tag = searchParams.get("tag");
    const sortBy = searchParams.get("sortBy") || "createdAt";
    const sortOrder = searchParams.get("sortOrder") || "desc";

    // 分页参数
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, parseInt(searchParams.get("pageSize") || String(DEFAULT_PAGE_SIZE), 10)));

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

        const whereClause: Prisma.ErrorItemWhereInput = {
            userId: user.id,
        };

        if (subjectId) {
            whereClause.subjectId = subjectId;
        }

        // 搜索条件需要使用 AND 包装，避免与其他 OR 条件冲突
        // 最终的 whereClause.AND 会包含所有需要同时满足的条件
        const andConditions: Prisma.ErrorItemWhereInput[] = [];

        if (query) {
            // 搜索条件：在题目、解析、知识点中任一匹配即可
            andConditions.push({
                OR: [
                    { questionText: { contains: query } },
                    { analysis: { contains: query } },
                    { wrongAnswerText: { contains: query } },
                    { mistakeAnalysis: { contains: query } },
                    { knowledgePoints: { contains: query } },
                ]
            });
        }

        // Mastery filter
        if (mastery !== null) {
            whereClause.masteryLevel = mastery === "1" ? { gt: 0 } : 0;
        }

        // Time range filter
        if (timeRange && timeRange !== "all") {
            const now = new Date();
            const startDate = new Date();

            if (timeRange === "week") {
                startDate.setDate(now.getDate() - 7);
            } else if (timeRange === "month") {
                startDate.setMonth(now.getMonth() - 1);
            }

            whereClause.createdAt = {
                gte: startDate,
            };
        }

        // Tag filter (具体知识点)
        const tags = searchParams.get("tags");
        if (tags) {
            // 支持多选标签：逗号分隔的标签列表
            const tagList = tags.split(",").filter(t => t.trim());

            if (tagList.length > 0) {
                // 使用 OR 条件：只要匹配任意一个标签即可
                whereClause.tags = {
                    some: {
                        name: {
                            in: tagList
                        }
                    }
                };
            }
        }

        // Grade/Semester filter
        const gradeSemester = searchParams.get("gradeSemester");
        if (gradeSemester) {
            const gradeFilter = buildGradeFilter(gradeSemester);
            if (gradeFilter) {
                // Merge into main whereClause
                Object.assign(whereClause, gradeFilter);
            }
        }

        // Paper Level filter
        const paperLevel = searchParams.get("paperLevel");
        if (paperLevel && paperLevel !== "all") {
            whereClause.paperLevel = paperLevel;
        }

        // Print count filter (只显示打印次数小于 N 的题目)
        const printCountLt = searchParams.get("printCountLt");
        if (printCountLt) {
            const limit = parseInt(printCountLt, 10);
            if (!Number.isNaN(limit)) {
                whereClause.printCount = { lt: limit };
            }
        }

        // 将所有 AND 条件合并到 whereClause
        if (andConditions.length > 0) {
            whereClause.AND = andConditions;
        }

        // 获取总数
        const total = await prisma.errorItem.count({
            where: whereClause,
        });

        // 分页查询
        const errorItems = await prisma.errorItem.findMany({
            where: whereClause,
            orderBy: {
                [sortBy]: sortOrder as "asc" | "desc",
            },
            include: {
                subject: true,
                tags: true,
            },
            skip: (page - 1) * pageSize,
            take: pageSize,
        });

        // questionText 可能内联 OCR 识别出的 base64 图片（单个 data URL 可达数百 KB），
        // wrongAnswerText 同理（编辑时可粘贴/截图图片，以 Markdown 图片行内联存储）。
        // 列表页只用它们做非空判断/搜索（搜索走数据库端 contains），默认截断避免分页响应体膨胀；
        // 打印预览等需要渲染完整题目的调用方传 full=1
        const wantFull = searchParams.get("full") === "1";
        const items = wantFull
            ? errorItems
            : errorItems.map((item) => ({
                  ...item,
                  questionText: (item.questionText || '').slice(0, 200),
                  wrongAnswerText: (item.wrongAnswerText || '').slice(0, 200),
              }));

        const totalPages = Math.ceil(total / pageSize);

        return NextResponse.json({
            items,
            total,
            page,
            pageSize,
            totalPages,
        });
    } catch (error) {
        logger.error({ error }, 'Error fetching items');
        return internalError("Failed to fetch error items");
    }
}

function buildGradeFilter(gradeSemester: string): Prisma.ErrorItemWhereInput {
    // 1. 恢复别名映射表 (Support aliases like 初一 for 七年级)
    const gradeMap: Record<string, string[]> = {
        "七年级": ["七年级", "初一", "7年级", "七"],
        "八年级": ["八年级", "初二", "8年级", "八"],
        "九年级": ["九年级", "初三", "9年级", "九"],
        "高一": ["高一", "10年级"],
        "高二": ["高二", "11年级"],
        "高三": ["高三", "12年级"],
    };

    // 2. 解析输入
    let targetGrades: string[] = [gradeSemester]; // Default fallback
    let targetSemester = "";

    // 提取年级关键字
    let foundKey = "";
    if (gradeSemester.includes("七年级") || gradeSemester.includes("初一")) foundKey = "七年级";
    else if (gradeSemester.includes("八年级") || gradeSemester.includes("初二")) foundKey = "八年级";
    else if (gradeSemester.includes("九年级") || gradeSemester.includes("初三")) foundKey = "九年级";
    else if (gradeSemester.includes("高一")) foundKey = "高一";
    else if (gradeSemester.includes("高二")) foundKey = "高二";
    else if (gradeSemester.includes("高三")) foundKey = "高三";
    else {
        // 如果无法识别标准年级，尝试直接解析前缀 (e.g. "一年级")
        const match = gradeSemester.match(/^(.+?)[上下]/);
        if (match) {
            targetGrades = [match[1]]; // e.g. "一年级"
        } else {
            // 完全完全无法解析，直接模糊匹配原字符串
            return { gradeSemester: { contains: gradeSemester } };
        }
    }

    if (foundKey) {
        targetGrades = gradeMap[foundKey];
    }

    // 提取学期
    if (gradeSemester.includes("上")) targetSemester = "上";
    else if (gradeSemester.includes("下")) targetSemester = "下";

    // 3. 构建多重组合查询条件
    // 对每一个可能的别名，生成多种格式变体
    const orConditions: Prisma.ErrorItemWhereInput[] = [];

    targetGrades.forEach(grade => {
        // 变体 1: 仅年级 (如果没有学期限制)
        if (!targetSemester) {
            orConditions.push({ gradeSemester: { contains: grade } });
        } else {
            // 变体 2: 年级 + 学期 (包含多种连接符)
            // 紧凑型: "初一上"
            orConditions.push({ gradeSemester: { contains: `${grade}${targetSemester}` } });
            // 逗号型: "初一，上" 或 "初一，上期"
            // 由于 contains 的特性，我们不需要穷举 "上期"/"上学期"，只要包含 "grade" 和 "学期关键字" 即可
            // 但 Prisma 的 AND 逻辑更适合处理这种情况
            // Let's use specific composed strings for precision if possible, or broad AND

            // 下面的逻辑能匹配 "初一，上期" (因为包含 "初一" 和 "，"?? 不，contains 是子串)
            // 这种组合 "grade + 任意字符 + semester" 很难用一个 contains 表达。
            // 简单粗暴点：
            orConditions.push({ gradeSemester: { contains: `${grade}，${targetSemester}` } }); // 中文逗号
            orConditions.push({ gradeSemester: { contains: `${grade},${targetSemester}` } }); // 英文逗号
            orConditions.push({ gradeSemester: { contains: `${grade} ${targetSemester}` } }); // 空格

            // 针对 "上期" 的特殊处理 (旧数据的 "高一，上期")
            const semesterTerm = targetSemester === '上' ? '上期' : '下期';
            orConditions.push({ gradeSemester: { contains: `${grade}，${semesterTerm}` } });
        }
    });

    if (orConditions.length === 0) {
        return { gradeSemester: { contains: gradeSemester } };
    }

    return { OR: orConditions };
}
