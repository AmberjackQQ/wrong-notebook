export type MistakeStatus = 'not_attempted' | 'wrong_attempt' | 'partially_wrong' | 'not_yet_ready' | 'unknown' | 'focus' | 'small_mistake' | 'new_method';

// 系统内置作答状态枚举值（此外的 mistakeStatus 视为旧数据异常值；
// 用户自定义状态文字存在 customMistakeStatus 字段，不入此列）
export const MISTAKE_STATUS_OPTIONS: MistakeStatus[] = [
    'not_attempted',
    'wrong_attempt',
    'partially_wrong',
    'not_yet_ready',
    'unknown',
    'focus',
    'small_mistake',
    'new_method',
];

export const isKnownMistakeStatus = (status?: unknown): status is MistakeStatus =>
    typeof status === 'string' && (MISTAKE_STATUS_OPTIONS as string[]).includes(status);

export function normalizeMistakeStatus(status?: unknown): MistakeStatus {
    if (status === 'not_attempted' || status === 'wrong_attempt' || status === 'partially_wrong' || status === 'not_yet_ready' || status === 'unknown' || status === 'focus' || status === 'small_mistake' || status === 'new_method') {
        return status;
    }
    return 'unknown';
}

export function normalizeMistakeStatusForSave(
    status?: unknown,
    wrongAnswerText?: string | null
): MistakeStatus {
    if ((wrongAnswerText || '').trim()) {
        return 'wrong_attempt';
    }
    return normalizeMistakeStatus(status);
}

export function getMistakeStatusLabel(status?: string | null, language: 'zh' | 'en' = 'zh') {
    const normalized = normalizeMistakeStatus(status);

    const labels = language === 'en'
        ? {
            not_attempted: 'Not attempted',
            wrong_attempt: 'Wrong attempt',
            partially_wrong: 'Partially wrong',
            not_yet_ready: 'Not yet ready',
            unknown: 'Unknown',
            focus: 'Priority focus',
            small_mistake: 'Small mistake',
            new_method: 'New method',
        }
        : {
            not_attempted: '不会做',
            wrong_attempt: '做错了',
            partially_wrong: '部分做错',
            not_yet_ready: '来不急做',
            unknown: '未判断',
            focus: '重点关注',
            small_mistake: '小错误',
            new_method: '新方法',
        };

    return labels[normalized];
}

// 展示用：优先显示用户自定义状态文字，否则按枚举取标签
export function getMistakeStatusDisplayLabel(
    status?: string | null,
    customStatus?: string | null,
    language: 'zh' | 'en' = 'zh'
) {
    const custom = (customStatus || '').trim();
    if (custom) return custom;
    return getMistakeStatusLabel(status, language);
}
