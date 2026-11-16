// 知识库文档自动分类：AI（文件名 + PDF 正文）→ 文件名启发式 → textbook/未分类
// 任何失败都不抛错，保证上传流程不被分类阻断
import { getAIService } from "./ai";
import { KNOWLEDGE_DOC_TYPES, type KnowledgeDocType } from "./knowledge-storage";
import { inferSubjectFromName } from "./knowledge-tags";
import { createLogger } from "./logger";

const logger = createLogger('knowledge-classifier');

const AI_TIMEOUT_MS = 15000;

export interface UserSubjectRef {
    id: string;
    name: string;
}

export interface KnowledgeClassification {
    docType: KnowledgeDocType;
    subjectId: string | null;
    method: 'ai' | 'heuristic' | 'fallback';
}

/**
 * 提取 PDF 前 N 页文字（unpdf 纯 JS，无原生二进制）。
 * 加密/扫描版/损坏一律返回空串，由调用方退化为仅文件名判断。
 */
export async function extractPdfText(buffer: Buffer, maxPages = 3, maxChars = 6000): Promise<string> {
    try {
        const { extractText } = await import('unpdf');
        const result = await extractText(new Uint8Array(buffer), { mergePages: false });
        const pages = Array.isArray(result.text) ? result.text : [result.text];
        return pages.slice(0, maxPages).join('\n').slice(0, maxChars);
    } catch (error) {
        logger.warn({ error }, 'PDF text extraction failed, heuristics will use filename only');
        return "";
    }
}

// docType 关键词，按优先级排列：试卷类词最具体（"期末试卷"同时含"试卷"），先判 exam
const DOC_TYPE_KEYWORDS: [KnowledgeDocType, string[]][] = [
    ['exam', ['试卷', '真题', '考卷', '期中', '期末', '月考', '联考', '模考', '模拟考', 'exam', 'test paper']],
    ['exercise', ['练习', '习题', '作业', '刷题', '口算', 'exercise', 'workbook']],
    ['guide', ['教辅', '辅导', '总复习', '考点', '讲义', '解读', 'guide']],
    ['textbook', ['教材', '课本', '必修', '选修', '教科书', '电子课本', 'textbook']],
];

export function inferDocTypeFromText(text: string): KnowledgeDocType | null {
    const lower = text.toLowerCase();
    for (const [docType, keywords] of DOC_TYPE_KEYWORDS) {
        if (keywords.some((kw) => lower.includes(kw.toLowerCase()))) {
            return docType;
        }
    }
    return null;
}

/**
 * 从文本（文件名/正文）中匹配用户的学科。
 * 两级：1) 文本包含某学科名整词（"数学" 匹配学科 "数学"）；
 *      2) 经 inferSubjectFromName 枚举归一（"Math" / "英语" → 'english' 等）后比对
 */
export function matchSubjectId(text: string, subjects: UserSubjectRef[]): string | null {
    if (!text || subjects.length === 0) return null;
    const lower = text.toLowerCase();

    // 1. 直接包含学科名（长名优先，避免"科学"抢匹配"计算机科学"）
    const sorted = [...subjects].sort((a, b) => b.name.length - a.name.length);
    for (const s of sorted) {
        if (s.name && lower.includes(s.name.toLowerCase())) {
            return s.id;
        }
    }

    // 2. 枚举归一比对：文本能推断出学科枚举，且某学科名也能推断出同一枚举
    const textEnum = inferSubjectFromName(text);
    if (textEnum) {
        for (const s of sorted) {
            if (inferSubjectFromName(s.name) === textEnum) {
                return s.id;
            }
        }
    }

    return null;
}

/**
 * AI 分类：构造 provider 可能同步抛 AI_AUTH_ERROR（未配 key），调用可能超时/失败，
 * 一律转 null 由上层走启发式
 */
async function tryClassifyWithAI(
    filename: string,
    textExcerpt: string,
    subjects: UserSubjectRef[]
): Promise<{ docType: KnowledgeDocType; subjectId: string | null } | null> {
    try {
        const service = getAIService();
        const aiCall = service.classifyDocument(filename, textExcerpt, subjects.map((s) => s.name));
        const timeout = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('AI_TIMEOUT_ERROR')), AI_TIMEOUT_MS)
        );
        const result = await Promise.race([aiCall, timeout]);

        if (!(KNOWLEDGE_DOC_TYPES as readonly string[]).includes(result.docType)) return null;
        // subject 须逐字匹配候选学科，防止 AI 乱编
        const subjectId = result.subject
            ? (subjects.find((s) => s.name === result.subject)?.id ?? null)
            : null;
        return { docType: result.docType, subjectId };
    } catch (error) {
        logger.info({ error, filename }, 'AI classification unavailable, falling back to heuristics');
        return null;
    }
}

/**
 * 主入口：AI → 文件名+正文启发式 → textbook/未分类。永不抛错。
 */
export async function classifyKnowledgeDoc(
    filename: string,
    pdfBuffer: Buffer,
    subjects: UserSubjectRef[]
): Promise<KnowledgeClassification> {
    let docType: KnowledgeDocType | null = null;
    let subjectId: string | null = null;
    let method: KnowledgeClassification['method'] = 'fallback';

    const text = await extractPdfText(pdfBuffer);

    const aiResult = await tryClassifyWithAI(filename, text, subjects);
    if (aiResult) {
        docType = aiResult.docType;
        subjectId = aiResult.subjectId;
        method = 'ai';
    } else {
        const combined = `${filename}\n${text}`;
        docType = inferDocTypeFromText(combined);
        subjectId = matchSubjectId(combined, subjects);
        if (docType || subjectId) method = 'heuristic';
    }

    if (!docType && !subjectId) {
        return { docType: 'textbook', subjectId: null, method: 'fallback' };
    }
    return {
        docType: docType ?? 'textbook',
        subjectId,
        method,
    };
}
