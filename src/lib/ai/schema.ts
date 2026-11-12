import { z } from 'zod';

/**
 * Zod schema for validating AI-parsed questions
 * Ensures type safety and business rule compliance
 */
export const ParsedQuestionSchema = z.object({
    questionText: z.string().min(1, "题目文本不能为空"),
    answerText: z.string().min(1, "答案不能为空"),
    analysis: z.string().min(1, "解析不能为空"),
    wrongAnswerText: z.string().optional().default(""),
    mistakeAnalysis: z.string().optional().default(""),
    mistakeStatus: z.enum(["not_attempted", "wrong_attempt", "partially_wrong", "not_yet_ready", "unknown", "focus"]).optional().default("unknown"),
    subject: z.enum([
        "数学", "物理", "化学", "生物",
        "英语", "语文", "历史", "地理",
        "政治", "其他"
    ]),
    knowledgePoints: z.array(z.string()).max(5, "知识点最多 5 个"),
    requiresImage: z.boolean().optional().default(false), // 题目是否依赖图片（如几何题）
});

/**
 * Type inference from Zod schema
 * Use this type instead of manually defining ParsedQuestion
 */
export type ParsedQuestionFromSchema = z.infer<typeof ParsedQuestionSchema>;

/**
 * 知识点标签建议结果（suggestKnowledgeTags）
 */
export const SuggestTagsSchema = z.object({
    knowledgePoints: z.array(z.string().min(1)).min(1).max(8),
});

export type SuggestTagsResult = z.infer<typeof SuggestTagsSchema>;

/**
 * 词汇 AI 例句生成结果（generateVocabExamples）
 */
export const VocabExamplesSchema = z.object({
    examples: z
        .array(
            z.object({
                en: z.string().min(1),
                zh: z.string().min(1),
            })
        )
        .min(1)
        .max(5),
});

export type VocabExamplesFromSchema = z.infer<typeof VocabExamplesSchema>;

/**
 * 解析并校验 AI 返回的词汇例句 XML（<examples><example><en/><zh/></example></examples>）
 * 兼容 AI 漏掉外层 <examples> 标签的情况；无有效例句时抛错
 */
export function parseVocabExamplesXml(text: string): VocabExamplesFromSchema {
    const examplesBlock =
        text.match(/<examples>([\s\S]*?)<\/examples>/)?.[1] ?? text;
    const examples: { en: string; zh: string }[] = [];
    const exampleRe =
        /<example>\s*<en>([\s\S]*?)<\/en>\s*<zh>([\s\S]*?)<\/zh>\s*<\/example>/g;
    let match: RegExpExecArray | null;
    while ((match = exampleRe.exec(examplesBlock)) !== null) {
        const en = match[1].trim();
        const zh = match[2].trim();
        if (en && zh) examples.push({ en, zh });
    }
    if (examples.length === 0) {
        throw new Error("AI 未返回有效的例句");
    }
    return VocabExamplesSchema.parse({ examples });
}

/**
 * Validates and parses AI response JSON
 * @param data - Raw JSON data from AI
 * @returns Validated ParsedQuestion object
 * @throws ZodError if validation fails
 */
export function validateParsedQuestion(data: unknown): ParsedQuestionFromSchema {
    return ParsedQuestionSchema.parse(data);
}

/**
 * Safe validation that returns success/error object
 * @param data - Raw JSON data from AI
 */
export function safeParseParsedQuestion(data: unknown) {
    return ParsedQuestionSchema.safeParse(data);
}
