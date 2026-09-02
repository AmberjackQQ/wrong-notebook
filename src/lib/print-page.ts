// A4 打印页面常量，与 globals.css 中 @page { size: A4; margin: 2cm } 对应
// 换算：1mm ≈ 96/25.4 px
export const PRINT_PAGE_CONTENT_WIDTH_PX = 643; // 210mm - 2×20mm 可打印宽度
export const PRINT_PAGE_CONTENT_HEIGHT_PX = 971; // 297mm - 2×20mm 可打印高度
export const PRINT_FOOTER_HEIGHT_PX = 24;
// 题干块在打印时的最小盒高，留 8px 余量防止边框/外边距溢出产生空白页
// 对应 page.tsx 中的 print:min-h-[963px]
export const PRINT_CHUNK_MIN_HEIGHT_PX = PRINT_PAGE_CONTENT_HEIGHT_PX - 8;

// 估算一段内容占据的打印页数
export function estimatePageCount(heightPx: number): number {
    if (!Number.isFinite(heightPx) || heightPx <= 0) return 1;
    return Math.max(1, Math.ceil(heightPx / PRINT_PAGE_CONTENT_HEIGHT_PX));
}

// 计算每页页码脚标的 top 值：位于每页底部，最后一页贴内容底部，
// 并保证脚标不超出内容盒（minBoxHeightPx 用于打印时被 min-height 撑满的块）
export function getFooterTops(heightPx: number, pages: number, minBoxHeightPx = 0): number[] {
    const boxHeight = Math.max(heightPx, minBoxHeightPx);
    return Array.from({ length: pages }, (_, i) => {
        const pageBottom = Math.min((i + 1) * PRINT_PAGE_CONTENT_HEIGHT_PX, boxHeight);
        return Math.max(0, pageBottom - PRINT_FOOTER_HEIGHT_PX);
    });
}
