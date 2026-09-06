import { describe, expect, it } from 'vitest';
import {
    PRINT_PAGE_CONTENT_HEIGHT_PX,
    PRINT_FOOTER_HEIGHT_PX,
    estimatePageCount,
    getFooterTops,
} from '@/lib/print-page';

describe('estimatePageCount', () => {
    it('不足一页按一页计', () => {
        expect(estimatePageCount(0)).toBe(1);
        expect(estimatePageCount(-5)).toBe(1);
        expect(estimatePageCount(500)).toBe(1);
        expect(estimatePageCount(PRINT_PAGE_CONTENT_HEIGHT_PX)).toBe(1);
    });

    it('超出按页高向上取整', () => {
        expect(estimatePageCount(PRINT_PAGE_CONTENT_HEIGHT_PX + 1)).toBe(2);
        expect(estimatePageCount(PRINT_PAGE_CONTENT_HEIGHT_PX * 2 + 10)).toBe(3);
    });
});

describe('getFooterTops', () => {
    it('每一页的脚标都固定在该页纸张底部', () => {
        expect(getFooterTops(1)).toEqual([PRINT_PAGE_CONTENT_HEIGHT_PX - PRINT_FOOTER_HEIGHT_PX]);
        expect(getFooterTops(3)).toEqual([
            PRINT_PAGE_CONTENT_HEIGHT_PX - PRINT_FOOTER_HEIGHT_PX,
            PRINT_PAGE_CONTENT_HEIGHT_PX * 2 - PRINT_FOOTER_HEIGHT_PX,
            PRINT_PAGE_CONTENT_HEIGHT_PX * 3 - PRINT_FOOTER_HEIGHT_PX,
        ]);
    });

    it('合并排版（答案块原点不在页网格）时末页脚标由调用方显式指定', () => {
        // 题干盒撑满一页（963px），合并后共 2 页：答案块末页脚标 = 全局第2页纸底 − 题干盒高
        const lastTop = PRINT_PAGE_CONTENT_HEIGHT_PX * 2 - PRINT_FOOTER_HEIGHT_PX - 963;
        expect(getFooterTops(1, lastTop)).toEqual([lastTop]);
    });

    it('页数为 0 时返回空数组', () => {
        expect(getFooterTops(0)).toEqual([]);
    });
});
