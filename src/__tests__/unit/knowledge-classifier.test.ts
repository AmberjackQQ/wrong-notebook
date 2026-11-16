/**
 * 知识库文档自动分类器单元测试
 * @/lib/ai 整体 mock（构造函数未配 key 会同步抛 AI_AUTH_ERROR，验证启发式兜底链）
 * unpdf mock 为抛错桩，覆盖"PDF 提取失败退化仅文件名判断"路径，避免加载真实 pdf.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    mockGetAIService: vi.fn(),
}));

vi.mock('@/lib/ai', () => ({
    getAIService: mocks.mockGetAIService,
}));

vi.mock('unpdf', () => ({
    extractText: vi.fn(async () => {
        throw new Error('unpdf unavailable in unit tests');
    }),
}));

import {
    inferDocTypeFromText,
    matchSubjectId,
    classifyKnowledgeDoc,
} from '@/lib/knowledge-classifier';

const SUBJECTS = [
    { id: 'sub-math', name: '数学' },
    { id: 'sub-cs', name: '计算机科学' },
    { id: 'sub-eng', name: 'English' },
];

describe('inferDocTypeFromText', () => {
    it('试卷类关键词（含复合词"期末试卷"）优先判 exam', () => {
        expect(inferDocTypeFromText('初三数学期末试卷.pdf')).toBe('exam');
        expect(inferDocTypeFromText('2026 中考真题.pdf')).toBe('exam');
        expect(inferDocTypeFromText('期末试卷')).toBe('exam');
        expect(inferDocTypeFromText('Final Exam Paper')).toBe('exam');
    });

    it('练习类关键词', () => {
        expect(inferDocTypeFromText('寒假作业练习册')).toBe('exercise');
        expect(inferDocTypeFromText('Workbook Chapter 3')).toBe('exercise');
    });

    it('教辅类关键词', () => {
        expect(inferDocTypeFromText('中考考点全解')).toBe('guide');
        expect(inferDocTypeFromText('总复习讲义')).toBe('guide');
    });

    it('教材类关键词', () => {
        expect(inferDocTypeFromText('人教版数学必修一电子课本')).toBe('textbook');
        expect(inferDocTypeFromText('高中教科书')).toBe('textbook');
    });

    it('exam 优先于 exercise（"试卷"比"练习"更具体）', () => {
        expect(inferDocTypeFromText('期末试卷与练习合集')).toBe('exam');
    });

    it('无关键词返回 null', () => {
        expect(inferDocTypeFromText('我的文档')).toBeNull();
        expect(inferDocTypeFromText('')).toBeNull();
    });
});

describe('matchSubjectId', () => {
    it('文本包含学科名直接命中', () => {
        expect(matchSubjectId('八年级数学期末试卷', SUBJECTS)).toBe('sub-math');
    });

    it('长学科名优先（"计算机科学"不被"科学"类短名抢占——此处验证完整包含）', () => {
        const subjects = [
            { id: 'sub-sci', name: '科学' },
            { id: 'sub-cs', name: '计算机科学' },
        ];
        expect(matchSubjectId('计算机科学竞赛讲义', subjects)).toBe('sub-cs');
    });

    it('二级匹配：英文文本经枚举归一后命中中文学科', () => {
        expect(matchSubjectId('Math final exam paper', [{ id: 's1', name: '数学' }])).toBe('s1');
    });

    it('二级匹配：学科名与文本推断出同一学科枚举（English 本子命中 English 学科）', () => {
        expect(matchSubjectId('english vocabulary', SUBJECTS)).toBe('sub-eng');
    });

    it('无法匹配返回 null', () => {
        expect(matchSubjectId('烹饪菜谱大全', SUBJECTS)).toBeNull();
        expect(matchSubjectId('数学', [])).toBeNull();
        expect(matchSubjectId('', SUBJECTS)).toBeNull();
    });

    it('证据强度：文件名「化学」胜过正文多次提及「物理」（物理性质类常见词）', () => {
        const subjects = [
            { id: 's-phys', name: '物理' },
            { id: 's-chem', name: '化学' },
        ];
        const text = '第一章 物理变化与物理性质。物质的物理性质包括颜色、气味。物理变化没有生成新物质。';
        expect(matchSubjectId(text, subjects, '化学必修第一册.pdf')).toBe('s-chem');
    });

    it('证据强度：正文同时提到物理与化学、均不在文件名时，按正文出现次数定胜负', () => {
        const subjects = [
            { id: 's-phys', name: '物理' },
            { id: 's-chem', name: '化学' },
        ];
        const text = '本册探讨化学反应原理，化学实验安全须知，化学方程式配平方法。';
        expect(matchSubjectId(text, subjects, '讲义.pdf')).toBe('s-chem');
    });

    it('证据强度：枚举归一按关键词出现强度取最强枚举（英文正文命中中文学科）', () => {
        const subjects = [
            { id: 's-phys', name: '物理' },
            { id: 's-chem', name: '化学' },
        ];
        const text = 'chemistry basics: chemistry lab safety and chemistry bonding';
        expect(matchSubjectId(text, subjects, '')).toBe('s-chem');
    });
});

describe('classifyKnowledgeDoc', () => {
    const BUFFER = Buffer.from('%PDF-fake');

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('AI 可用且返回合法结果：method=ai，subject 逐字命中转 id', async () => {
        mocks.mockGetAIService.mockReturnValue({
            classifyDocument: vi.fn().mockResolvedValue({ docType: 'exam', subject: '数学' }),
        });

        const result = await classifyKnowledgeDoc('a.pdf', BUFFER, SUBJECTS);

        expect(result).toEqual({ docType: 'exam', subjectId: 'sub-math', method: 'ai' });
    });

    it('AI 返回候选列表外的学科名：忽略该 subject，仅采用 docType', async () => {
        mocks.mockGetAIService.mockReturnValue({
            classifyDocument: vi.fn().mockResolvedValue({ docType: 'guide', subject: '天文学' }),
        });

        const result = await classifyKnowledgeDoc('教辅讲义.pdf', BUFFER, SUBJECTS);

        expect(result).toEqual({ docType: 'guide', subjectId: null, method: 'ai' });
    });

    it('AI 不可用（getAIService 抛 AI_AUTH_ERROR）：走启发式，文件名+正文命中', async () => {
        mocks.mockGetAIService.mockImplementation(() => {
            throw new Error('AI_AUTH_ERROR: no api key');
        });

        const result = await classifyKnowledgeDoc('初三数学期末试卷.pdf', BUFFER, SUBJECTS);

        expect(result).toEqual({ docType: 'exam', subjectId: 'sub-math', method: 'heuristic' });
    });

    it('AI classifyDocument 调用失败：同样退启发式', async () => {
        mocks.mockGetAIService.mockReturnValue({
            classifyDocument: vi.fn().mockRejectedValue(new Error('network down')),
        });

        const result = await classifyKnowledgeDoc('数学课本.pdf', BUFFER, SUBJECTS);

        expect(result).toEqual({ docType: 'textbook', subjectId: 'sub-math', method: 'heuristic' });
    });

    it('启发式也无命中：fallback textbook/未分类，永不抛错', async () => {
        mocks.mockGetAIService.mockImplementation(() => {
            throw new Error('AI_AUTH_ERROR');
        });

        const result = await classifyKnowledgeDoc('随便什么.pdf', BUFFER, SUBJECTS);

        expect(result).toEqual({ docType: 'textbook', subjectId: null, method: 'fallback' });
    });
});
