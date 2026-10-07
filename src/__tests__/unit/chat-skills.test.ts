import { describe, it, expect } from 'vitest';
import {
    QUERY_ERROR_ITEMS_TOOL,
    normalizeQueryErrorItemsArgs,
    parseToolInput,
} from '@/lib/chat/skills';

describe('QUERY_ERROR_ITEMS_TOOL', () => {
    it('定义了名称、描述与 object 入参 schema', () => {
        expect(QUERY_ERROR_ITEMS_TOOL.name).toBe('query_error_items');
        expect(QUERY_ERROR_ITEMS_TOOL.description.length).toBeGreaterThan(0);
        expect(QUERY_ERROR_ITEMS_TOOL.input_schema.type).toBe('object');
        expect(Object.keys(QUERY_ERROR_ITEMS_TOOL.input_schema.properties)).toEqual(
            expect.arrayContaining(['subject', 'paperLevel', 'minPrintCount', 'maxPrintCount', 'mastered', 'limit'])
        );
    });
});

describe('normalizeQueryErrorItemsArgs', () => {
    it('透传合法字符串与布尔参数', () => {
        const args = normalizeQueryErrorItemsArgs({
            subject: '数学',
            paperLevel: '周末练习2',
            keyword: '函数',
            mastered: true,
        });
        expect(args).toEqual({ subject: '数学', paperLevel: '周末练习2', keyword: '函数', mastered: true });
    });

    it('把字符串数字归一化为整数（模型可能传字符串）', () => {
        const args = normalizeQueryErrorItemsArgs({ minPrintCount: '2', maxPrintCount: '5', limit: '20' });
        expect(args.minPrintCount).toBe(2);
        expect(args.maxPrintCount).toBe(5);
        expect(args.limit).toBe(20);
    });

    it('丢弃空字符串、非有限数字与无效类型', () => {
        const args = normalizeQueryErrorItemsArgs({
            subject: '   ',
            paperLevel: 123,
            minPrintCount: 'abc',
            maxPrintCount: Number.NaN,
            mastered: 'yes',
            limit: -1,
            extra: 'ignored',
        });
        expect(args).toEqual({});
    });

    it('非对象入参返回空对象', () => {
        expect(normalizeQueryErrorItemsArgs(null)).toEqual({});
        expect(normalizeQueryErrorItemsArgs('数学')).toEqual({});
        expect(normalizeQueryErrorItemsArgs(undefined)).toEqual({});
    });
});

describe('parseToolInput', () => {
    it('解析合法 JSON 对象', () => {
        expect(parseToolInput('{"subject":"数学"}')).toEqual({ subject: '数学' });
    });

    it('空串/非法 JSON/非对象返回空对象', () => {
        expect(parseToolInput('')).toEqual({});
        expect(parseToolInput('not json')).toEqual({});
        expect(parseToolInput('[1,2]')).toEqual({});
    });
});
