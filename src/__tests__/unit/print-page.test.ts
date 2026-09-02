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
    it('单页内容贴内容盒底部（考虑最小盒高）', () => {
        const tops = getFooterTops(500, 1, 963);
        expect(tops).toEqual([963 - PRINT_FOOTER_HEIGHT_PX]);
    });

    it('多页时各页脚标位于每页底部，最后一页贴内容底部', () => {
        const h = PRINT_PAGE_CONTENT_HEIGHT_PX * 2 + 100;
        const tops = getFooterTops(h, 3);
        expect(tops[0]).toBe(PRINT_PAGE_CONTENT_HEIGHT_PX - PRINT_FOOTER_HEIGHT_PX);
        expect(tops[1]).toBe(PRINT_PAGE_CONTENT_HEIGHT_PX * 2 - PRINT_FOOTER_HEIGHT_PX);
        expect(tops[2]).toBe(h - PRINT_FOOTER_HEIGHT_PX);
    });

    it('内容盒很小时不产生负值', () => {
        expect(getFooterTops(10, 1)).toEqual([0]);
    });
});
