/**
 * 知识点标签工具函数
 * 
 * 注意：课程数据已迁移到数据库，通过 seed scripts 导入。
 * 此文件仅保留通用工具函数。
 */

/**
 * 根据教育阶段和入学年份计算当前年级数字
 * @param educationStage 教育阶段 ('junior_high' | 'senior_high')
 * @param enrollmentYear 入学年份
 * @returns 年级 (7-12) 或 null
 */
export function calculateGradeNumber(
    educationStage: string | null,
    enrollmentYear: number | null
): 7 | 8 | 9 | 10 | 11 | 12 | null {
    if (!enrollmentYear) {
        return null;
    }

    // 只处理初中和高中
    if (educationStage !== 'junior_high' && educationStage !== 'senior_high') {
        return null;
    }

    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1; // 1-12

    // 计算入学后的年数
    let yearsInSchool = currentYear - enrollmentYear;

    // 如果当前月份在9月之前,说明还没开学,年级要减1
    if (currentMonth < 9) {
        yearsInSchool -= 1;
    }

    if (educationStage === 'junior_high') {
        // 初中: 入学第1年=7年级, 第2年=8年级, 第3年=9年级
        const grade = 7 + yearsInSchool;
        if (grade >= 7 && grade <= 9) {
            return grade as 7 | 8 | 9;
        }
    } else if (educationStage === 'senior_high') {
        // 高中: 入学第1年=10年级(高一), 第2年=11年级(高二), 第3年=12年级(高三)
        const grade = 10 + yearsInSchool;
        if (grade >= 10 && grade <= 12) {
            return grade as 10 | 11 | 12;
        }
    }

    return null;
}

export type SubjectEnum =
    | 'math'
    | 'physics'
    | 'chemistry'
    | 'biology'
    | 'english'
    | 'chinese'
    | 'history'
    | 'geography'
    | 'politics';

// 顺序即 inferSubjectFromName 的判定优先级（同名命中多个时取靠前者）
const SUBJECT_KEYWORDS: Array<[SubjectEnum, string[]]> = [
    ['math', ['math', '数学']],
    ['physics', ['physics', '物理']],
    ['chemistry', ['chemistry', '化学']],
    ['biology', ['biology', '生物']],
    ['english', ['english', '英语']],
    ['chinese', ['chinese', '语文']],
    ['history', ['history', '历史']],
    ['geography', ['geography', '地理']],
    ['politics', ['politics', '政治']],
];

export function countOccurrences(haystack: string, needle: string): number {
    if (!haystack || !needle) return 0;
    let count = 0;
    let idx = haystack.indexOf(needle);
    while (idx !== -1) {
        count += 1;
        idx = haystack.indexOf(needle, idx + needle.length);
    }
    return count;
}

/**
 * 从错题本名称推断学科
 * @param subjectName 错题本名称
 * @returns 学科标识
 */
export function inferSubjectFromName(subjectName: string | null): SubjectEnum | null {
    if (!subjectName) return null;

    const lowerName = subjectName.toLowerCase();

    for (const [subject, keywords] of SUBJECT_KEYWORDS) {
        if (keywords.some((kw) => lowerName.includes(kw))) {
            return subject;
        }
    }

    return null;
}

/**
 * 统计文本中各学科关键词的出现次数（文件名/正文证据强度用）
 */
export function countSubjectEnumMentions(text: string): Record<SubjectEnum, number> {
    const lower = (text || '').toLowerCase();
    const counts = {} as Record<SubjectEnum, number>;
    for (const [subject, keywords] of SUBJECT_KEYWORDS) {
        counts[subject] = keywords.reduce((sum, kw) => sum + countOccurrences(lower, kw), 0);
    }
    return counts;
}
