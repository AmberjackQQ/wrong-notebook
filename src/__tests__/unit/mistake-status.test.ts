import { describe, expect, it } from 'vitest';
import {
    getMistakeStatusDisplayLabel,
    getMistakeStatusLabel,
    isKnownMistakeStatus,
    normalizeMistakeStatus,
    normalizeMistakeStatusForSave,
} from '@/lib/mistake-status';

describe('mistake status helpers', () => {
    it('应该只接受合法作答状态', () => {
        expect(normalizeMistakeStatus('wrong_attempt')).toBe('wrong_attempt');
        expect(normalizeMistakeStatus('partially_wrong')).toBe('partially_wrong');
        expect(normalizeMistakeStatus('not_attempted')).toBe('not_attempted');
        expect(normalizeMistakeStatus('unknown')).toBe('unknown');
        expect(normalizeMistakeStatus('invalid')).toBe('unknown');
        expect(normalizeMistakeStatus(null)).toBe('unknown');
    });

    it('保存时有错误解答应自动归为做错了', () => {
        expect(normalizeMistakeStatusForSave('unknown', 'x = 4')).toBe('wrong_attempt');
    });

    it('保存时不应仅因为错因分析有内容就覆盖作答状态', () => {
        expect(normalizeMistakeStatusForSave('not_attempted', '')).toBe('not_attempted');
        expect(normalizeMistakeStatusForSave('unknown', '')).toBe('unknown');
    });

    it('保存时缺省或非法状态应保持未判断而不是误判为不会做', () => {
        expect(normalizeMistakeStatusForSave(undefined, '')).toBe('unknown');
        expect(normalizeMistakeStatusForSave('bad-value', '')).toBe('unknown');
    });

    it('应该按语言显示状态标签', () => {
        expect(getMistakeStatusLabel('wrong_attempt', 'zh')).toBe('做错了');
        expect(getMistakeStatusLabel('partially_wrong', 'zh')).toBe('部分做错');
        expect(getMistakeStatusLabel('partially_wrong', 'en')).toBe('Partially wrong');
        expect(getMistakeStatusLabel('not_attempted', 'en')).toBe('Not attempted');
        expect(getMistakeStatusLabel('bad-value', 'zh')).toBe('未判断');
    });

    it('isKnownMistakeStatus 应识别枚举值', () => {
        expect(isKnownMistakeStatus('wrong_attempt')).toBe(true);
        expect(isKnownMistakeStatus('focus')).toBe(true);
        expect(isKnownMistakeStatus('粗心看错条件')).toBe(false);
        expect(isKnownMistakeStatus(null)).toBe(false);
    });

    it('展示标签应优先自定义文字，回退枚举标签', () => {
        expect(getMistakeStatusDisplayLabel('wrong_attempt', '粗心看错条件', 'zh')).toBe('粗心看错条件');
        expect(getMistakeStatusDisplayLabel('wrong_attempt', '  ', 'zh')).toBe('做错了');
        expect(getMistakeStatusDisplayLabel('wrong_attempt', null, 'zh')).toBe('做错了');
        expect(getMistakeStatusDisplayLabel('unknown', null, 'en')).toBe('Unknown');
    });
});
