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

// 计算每页页码脚标的 top 值（相对块顶的绝对偏移）：每一页的脚标都固定在该页纸张底部，
// 前提是打印块被撑满到末页页底（page.tsx 通过 --print-min-h 实现撑满）。
// 例外：答案块与题干块合并排版（不另起页）时，答案块的原点不在页网格上，
// 调用方传入 lastPageTopPx 显式指定其末页脚标位置。
export function getFooterTops(pages: number, lastPageTopPx?: number): number[] {
    const pageBottom = PRINT_PAGE_CONTENT_HEIGHT_PX - PRINT_FOOTER_HEIGHT_PX;
    return Array.from({ length: Math.max(0, pages) }, (_, i) =>
        i === pages - 1 && lastPageTopPx !== undefined
            ? lastPageTopPx
            : i * PRINT_PAGE_CONTENT_HEIGHT_PX + pageBottom
    );
}
