// AI 助手（/api/chat）的技能定义
// 技能在系统设置 → AI 服务商 → 「AI 助手技能」中可查看/开关（AppConfig.chatAssistant.skills）

export interface QueryErrorItemsArgs {
    subject?: string;
    paperLevel?: string;
    keyword?: string;
    minPrintCount?: number;
    maxPrintCount?: number;
    mastered?: boolean;
    limit?: number;
}

export const QUERY_ERROR_ITEMS_TOOL = {
    name: 'query_error_items',
    description:
        '查询当前用户错题本中的真实错题数据。支持按学科（错题本名称）、题目来源（试卷名）、' +
        '打印次数范围、掌握程度、关键词筛选。当用户询问错题数量、列表或按条件筛选错题时，' +
        '必须调用此工具获取真实数据，不要凭记忆或猜测回答。',
    input_schema: {
        type: 'object',
        properties: {
            subject: {
                type: 'string',
                description: '学科/错题本名称，如 "数学"、"物理"，支持模糊匹配。不传=查全部错题本',
            },
            paperLevel: {
                type: 'string',
                description: '题目来源（试卷/练习名称），如 "周末练习2"，支持模糊匹配',
            },
            keyword: {
                type: 'string',
                description: '关键词，在题目、解析、错因分析、知识点文本中模糊搜索',
            },
            minPrintCount: {
                type: 'integer',
                description: '打印次数下限（打印次数 ≥ 此值）',
            },
            maxPrintCount: {
                type: 'integer',
                description: '打印次数上限（打印次数 ≤ 此值）',
            },
            mastered: {
                type: 'boolean',
                description: '掌握程度筛选：true=只查已掌握的错题，false=只查未掌握的错题',
            },
            limit: {
                type: 'integer',
                description: '返回条数上限，默认 10，最大 20',
            },
        },
    },
} as const;

const asFiniteInt = (value: unknown): number | undefined => {
    const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    return Number.isFinite(n) ? Math.trunc(n) : undefined;
};

const asTrimmedString = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed || undefined;
};

// 容错地归一化模型生成的工具入参（模型可能传字符串数字或多余字段）
export function normalizeQueryErrorItemsArgs(raw: unknown): QueryErrorItemsArgs {
    const args: QueryErrorItemsArgs = {};
    if (!raw || typeof raw !== 'object') return args;
    const obj = raw as Record<string, unknown>;

    const subject = asTrimmedString(obj.subject);
    if (subject) args.subject = subject;
    const paperLevel = asTrimmedString(obj.paperLevel);
    if (paperLevel) args.paperLevel = paperLevel;
    const keyword = asTrimmedString(obj.keyword);
    if (keyword) args.keyword = keyword;

    const min = asFiniteInt(obj.minPrintCount);
    if (min !== undefined) args.minPrintCount = min;
    const max = asFiniteInt(obj.maxPrintCount);
    if (max !== undefined) args.maxPrintCount = max;

    if (typeof obj.mastered === 'boolean') args.mastered = obj.mastered;

    const limit = asFiniteInt(obj.limit);
    if (limit !== undefined && limit > 0) args.limit = limit;

    return args;
}

export function parseToolInput(input: string): Record<string, unknown> {
    if (!input) return {};
    try {
        const parsed = JSON.parse(input);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : {};
    } catch {
        return {};
    }
}
