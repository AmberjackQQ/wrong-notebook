// 知识库文档自动分类：AI（文件名 + PDF 正文）→ 文件名启发式 → textbook/未分类
// 任何失败都不抛错，保证上传流程不被分类阻断
import { getAIService } from "./ai";
import { KNOWLEDGE_DOC_TYPES, type KnowledgeDocType } from "./knowledge-storage";
import { countOccurrences, countSubjectEnumMentions, inferSubjectFromName, type SubjectEnum } from "./knowledge-tags";
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
 * 从文本（正文 + 文件名）中匹配用户的学科。
 * 两级，均按证据强度打分（文件名 ×10 + 正文 ×1），而非遍历顺序：
 *  1) 学科名出现次数直接计分（"化学必修一" 文件名命中「化学」远比正文顺带提到「物理」有说服力）
 *  2) 经 inferSubjectFromName 枚举归一（"Math" / "英语" → 'english' 等）后比对，
 *     取关键词出现强度最高的枚举，避免"物理性质"抢走化学教材
 * 平手时更长的学科名优先（"计算机科学" 胜过 "科学"）
 */
export function matchSubjectId(text: string, subjects: UserSubjectRef[], filename = ''): string | null {
    if ((!text && !filename) || subjects.length === 0) return null;
    const lowerText = (text || '').toLowerCase();
    const lowerFilename = (filename || '').toLowerCase();

    // 1. 学科名出现次数计分
    const named = subjects
        .filter((s) => s.name)
        .map((s) => {
            const kw = s.name.toLowerCase();
            return {
                id: s.id,
                score: 10 * countOccurrences(lowerFilename, kw) + countOccurrences(lowerText, kw),
                length: s.name.length,
            };
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score || b.length - a.length);
    if (named.length > 0) {
        return named[0].id;
    }

    // 2. 枚举归一比对：文本关键词强度最高的学科枚举，对应用户学科名可推断出同一枚举者
    const textCounts = countSubjectEnumMentions(lowerText);
    const filenameCounts = countSubjectEnumMentions(lowerFilename);
    const bestEnum = (Object.keys(textCounts) as SubjectEnum[])
        .map((e) => ({ e, score: 10 * filenameCounts[e] + textCounts[e] }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)[0]?.e;
    if (bestEnum) {
        const withEnum = subjects
            .filter((s) => s.name && inferSubjectFromName(s.name) === bestEnum)
            .sort((a, b) => b.name.length - a.name.length);
        if (withEnum.length > 0) {
            return withEnum[0].id;
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
        subjectId = matchSubjectId(text, subjects, filename);
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
