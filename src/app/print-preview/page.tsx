"use client";

import { useEffect, useState, Suspense, type CSSProperties } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { BackButton } from "@/components/ui/back-button";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { apiClient } from "@/lib/api-client";
import { ErrorItem, PaginatedResponse } from "@/types/api";
import { useLanguage } from "@/contexts/LanguageContext";
import { PRINT_PREVIEW_PAGE_SIZE } from "@/lib/constants/pagination";
import {
    getPrintPreviewCountLabel,
    getPrintPreviewEmptyState,
    getSelectedPrintItems,
    shouldReserveAnswerSpace,
} from "@/lib/print-preview";
import {
    PRINT_CHUNK_MIN_HEIGHT_PX,
    PRINT_FOOTER_HEIGHT_PX,
    PRINT_PAGE_CONTENT_HEIGHT_PX,
    PRINT_PAGE_CONTENT_WIDTH_PX,
    estimatePageCount,
    getFooterTops,
} from "@/lib/print-page";
import { ArrowUpDown, ChevronDown, ChevronUp } from "lucide-react";
import { QRCodeDisplay } from "@/components/qr-code-display";

// CSSProperties 转内联 style 字符串（用于屏外克隆节点还原自然样式）
const styleTextOf = (style: CSSProperties) =>
    Object.entries(style)
        .map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}:${v}`)
        .join(";");

function PrintPreviewContent() {
    const searchParams = useSearchParams();
    const { t } = useLanguage();
    const [items, setItems] = useState<ErrorItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [showAnswers, setShowAnswers] = useState(true);
    const [showAnalysis, setShowAnalysis] = useState(true);
    const [showTags, setShowTags] = useState(true);
    const [imageScale, setImageScale] = useState(70);
    const [answerImageScale, setAnswerImageScale] = useState(70);
    const [analysisImageScale, setAnalysisImageScale] = useState(70);
    const [showQuestionText, setShowQuestionText] = useState(true);
    // 显示题目图片（含原始问题图片，默认开启），与“题目文字”开关相互独立
    const [showQuestionImages, setShowQuestionImages] = useState(true);
    // 每道题补足偶数页（奇数页时末尾加空白页），双面打印时每道题独占整张纸
    const [padToEvenPages, setPadToEvenPages] = useState(true);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [sortBy, setSortBy] = useState<string>("createdAt");
    const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
    const [showQuestionHeader, setShowQuestionHeader] = useState(true);
    const [showQuestionNumber, setShowQuestionNumber] = useState(true);
    const [isSelectionBoxCollapsed, setIsSelectionBoxCollapsed] = useState(false);
    const [showQRCodes, setShowQRCodes] = useState(true);
    // 图片自动缩放至打印页宽（默认开启）
    const [fitImagesToPage, setFitImagesToPage] = useState(true);
    // 答案图片增强对比（默认开启）：文字加深、浅灰背景推为纯白，打印更清晰
    const [enhanceAnswerImages, setEnhanceAnswerImages] = useState(true);
    // 将同一增强滤镜也应用到题目图片（含原始问题图片，默认开启）
    const [enhanceQuestionImages, setEnhanceQuestionImages] = useState(true);
    // 将同一增强滤镜也应用到解析图片（默认开启）
    const [enhanceAnalysisImages, setEnhanceAnalysisImages] = useState(true);
    // 勾选后点击“打印 / 保存 PDF”时，把本次所选题目的打印次数各 +1
    const [incrementPrintCount, setIncrementPrintCount] = useState(false);

    const [showAnswerTime, setShowAnswerTime] = useState(true);
    // 增强强度参数，界面滑杆实时调整（contrast 0~5，brightness 0~3，即 CSS filter 全范围）
    const [enhanceContrast, setEnhanceContrast] = useState(0.8);
    const [enhanceBrightness, setEnhanceBrightness] = useState(0.82);
    // 每个打印块（题干/答案）在打印页宽下的高度与页数估算，key 为 `${itemId}:stem` | `${itemId}:answer`
    const [chunkPages, setChunkPages] = useState<Record<string, { pages: number; height: number }>>({});
    // 解析图片的自然宽度（onLoad 时记录），用于按图片大小决定缩放
    const [analysisNaturalWidths, setAnalysisNaturalWidths] = useState<Record<string, number>>({});
    // 解析段防孤行修复方案（按题）：shrink=缩小首图塞进标题所在页；push=整段另起一页
    const [analysisFixes, setAnalysisFixes] = useState<Record<string, { type: "shrink"; avail: number } | { type: "push" }>>({});

    useEffect(() => {
        fetchItems();
    }, []);

    const toggleSortOrder = () => {
        const newOrder = sortOrder === "desc" ? "asc" : "desc";
        setSortOrder(newOrder);
        // 重新获取数据
        fetchItemsWithSort(newOrder);
    };

    // 指定 selectedIds 时（如从错题详情页进入）仅加载这些题目，按创建时间排序
    const sortItemsByCreatedAt = (list: ErrorItem[], order: "asc" | "desc") =>
        [...list].sort((a, b) =>
            order === "asc"
                ? new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
                : new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );

    const fetchSelectedItems = async (order: "asc" | "desc") => {
        const selectedIdsParam = searchParams.get("selectedIds");
        if (!selectedIdsParam) return false;
        const ids = selectedIdsParam.split(",").filter(Boolean);
        const fetched = await Promise.all(
            ids.map((id) => apiClient.get<ErrorItem>(`/api/error-items/${id}`).catch(() => null))
        );
        const fetchedItems = sortItemsByCreatedAt(
            fetched.filter((it): it is ErrorItem => it !== null),
            order
        );
        setItems(fetchedItems);
        setSelectedIds(new Set(fetchedItems.map((item) => item.id)));
        return true;
    };

    const fetchItemsWithSort = async (order: "asc" | "desc") => {
        setLoading(true);
        try {
            if (await fetchSelectedItems(order)) return;
            const params = new URLSearchParams(searchParams.toString());
            // 打印预览需要所有符合条件的数据，设置较大的 pageSize
            params.set("pageSize", String(PRINT_PREVIEW_PAGE_SIZE));
            // 打印需渲染完整题目（含 OCR 内联图片），list 接口默认截断 questionText
            params.set("full", "1");
            // 添加排序参数
            params.set("sortBy", sortBy);
            params.set("sortOrder", order);
            const response = await apiClient.get<PaginatedResponse<ErrorItem>>(`/api/error-items/list?${params.toString()}`);
            setItems(response.items);
            // 保留用户当前勾选，不重置（渲染时会通过 getSelectedPrintItems 与 items 取交集）
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    const fetchItems = async () => {
        setLoading(true);
        try {
            if (await fetchSelectedItems(sortOrder)) return;
            const params = new URLSearchParams(searchParams.toString());
            // 打印预览需要所有符合条件的数据，设置较大的 pageSize
            params.set("pageSize", String(PRINT_PREVIEW_PAGE_SIZE));
            // 打印需渲染完整题目（含 OCR 内联图片），list 接口默认截断 questionText
            params.set("full", "1");
            // 添加排序参数
            params.set("sortBy", sortBy);
            params.set("sortOrder", sortOrder);
            const response = await apiClient.get<PaginatedResponse<ErrorItem>>(`/api/error-items/list?${params.toString()}`);
            setItems(response.items);
            // 如果没有指定selectedIds，默认全选
            setSelectedIds(new Set(response.items.map((item) => item.id)));
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    const handlePrint = () => {
        if (incrementPrintCount) {
            // 勾选“打印次数加一”：为本次所选题目把打印次数各 +1
            // 不阻塞打印流程，单条失败仅记录日志
            selectedItems.forEach((item) => {
                apiClient.post(`/api/error-items/${item.id}/print`, {}).catch((err: unknown) => {
                    console.error(`Failed to increment print count for ${item.id}:`, err);
                });
            });
        }
        window.print();
    };

    // 测量各打印块在打印页宽下的高度，估算每题占用的页数（用于页码脚标）
    useEffect(() => {
        if (loading) return;
        let cancelled = false;
        const waitImage = (img: HTMLImageElement) =>
            img.complete
                ? Promise.resolve()
                : new Promise<void>((resolve) => {
                      img.onload = () => resolve();
                      img.onerror = () => resolve();
                  });
        const measure = async () => {
            const imgs = Array.from(document.querySelectorAll<HTMLImageElement>(".max-w-4xl img"));
            await Promise.all(imgs.map(waitImage));
            await new Promise((resolve) => requestAnimationFrame(resolve));
            if (cancelled) return;
            const chunks = Array.from(document.querySelectorAll<HTMLElement>("[data-print-chunk]"));
            if (chunks.length === 0) {
                setChunkPages({});
                return;
            }
            // 屏幕预览宽度与打印页宽不同，用屏外克隆按打印页宽测量
            const host = document.createElement("div");
            host.style.cssText = `position:absolute;left:-10000px;top:0;width:${PRINT_PAGE_CONTENT_WIDTH_PX}px;visibility:hidden;`;
            document.body.appendChild(host);
            const result: Record<string, { pages: number; height: number }> = {};
            const fixes: Record<string, { type: "shrink"; avail: number } | { type: "push" }> = {};
            try {
                for (const chunk of chunks) {
                    const key = chunk.getAttribute("data-print-chunk");
                    if (!key) continue;
                    const clone = chunk.cloneNode(true) as HTMLElement;
                    clone.querySelectorAll("[data-print-footer]").forEach((f) => f.remove());
                    // 把上一轮“防孤行”缩小过的首图还原为自然尺寸：测量与决策必须基于未修复布局才能稳定收敛
                    clone.querySelectorAll<HTMLImageElement>("img[data-print-shrink]").forEach((img) => {
                        img.setAttribute("style", styleTextOf(getAnalysisImageStyle(analysisImageScale, img.naturalWidth || undefined)));
                    });
                    host.appendChild(clone);
                    await Promise.all(Array.from(clone.querySelectorAll("img")).map(waitImage));
                    const height = clone.offsetHeight;
                    let pages = estimatePageCount(height);

                    // 解析段防孤行：按不可拆分单元（标题/图片容器）模拟打印分页，
                    // 若“解析：”标题与第一张解析图被分到不同页，则缩小首图塞进标题所在页
                    //（剩余空间太小缩图不可读时，改为整段另起一页）
                    if (key.endsWith(":answer")) {
                        const PAGE_H = PRINT_PAGE_CONTENT_HEIGHT_PX;
                        const units = Array.from(clone.querySelectorAll<HTMLElement>("[data-frag]")).map((el) => ({
                            kind: el.getAttribute("data-frag") || "",
                            idx: Number(el.getAttribute("data-frag-index") || "0"),
                            top: el.offsetTop,
                            height: el.offsetHeight,
                        }));
                        const simulate = (list: typeof units, mode: { type: "none" } | { type: "shrink"; avail: number } | { type: "push" }) => {
                            let y = 0;
                            const placed: { kind: string; idx: number; top: number; height: number; page: number }[] = [];
                            for (const u of list) {
                                let top = Math.max(u.top, y);
                                let h = u.height;
                                if (mode.type === "push" && u.kind === "analysis-heading") {
                                    top = (Math.floor(top / PAGE_H) + 1) * PAGE_H;
                                } else if (mode.type === "shrink" && u.kind === "analysis-image" && u.idx === 0) {
                                    h = mode.avail + 2; // 容器高 = 图片高 + 上下边框
                                }
                                const pageTop = Math.floor(top / PAGE_H) * PAGE_H;
                                if (top + h > pageTop + PAGE_H) top = pageTop + PAGE_H;
                                y = top + h;
                                placed.push({ kind: u.kind, idx: u.idx, top, height: h, page: Math.floor(top / PAGE_H) });
                            }
                            return placed;
                        };
                        const pass1 = simulate(units, { type: "none" });
                        const heading = pass1.find((p) => p.kind === "analysis-heading");
                        const img0Placed = pass1.find((p) => p.kind === "analysis-image" && p.idx === 0);
                        const img0Unit = units.find((u) => u.kind === "analysis-image" && u.idx === 0);
                        if (heading && img0Placed && img0Unit && img0Placed.page > heading.page) {
                            const pageBottom = (heading.page + 1) * PAGE_H;
                            const imgTopIfFits = Math.max(img0Unit.top, heading.top + heading.height);
                            const avail = pageBottom - imgTopIfFits - 10; // 余量：容器边框/取整误差
                            const fix = avail >= 140 ? ({ type: "shrink", avail } as const) : ({ type: "push" } as const);
                            // 缩小首图后其后内容自然位置整体上移，修正后模拟得到修复布局的真实页数
                            const delta = fix.type === "shrink" ? img0Unit.height - (fix.avail + 2) : 0;
                            const units2 = units.map((u) => (u.top > img0Unit.top ? { ...u, top: u.top - delta } : u));
                            const pass2 = simulate(units2, fix);
                            const last = pass2[pass2.length - 1];
                            pages = Math.max(1, Math.ceil((last ? last.top + last.height : height) / PAGE_H));
                            fixes[key.slice(0, -":answer".length)] = fix;
                        }
                    }
                    result[key] = { pages, height };
                    clone.remove();
                }
            } finally {
                host.remove();
            }
            if (!cancelled) {
                setChunkPages(result);
                setAnalysisFixes((prev) => {
                    let changed = false;
                    const next = { ...prev };
                    for (const [id, fix] of Object.entries(fixes)) {
                        const cur = prev[id];
                        const same = cur && cur.type === fix.type && (fix.type === "push" || (cur.type === "shrink" && Math.abs(cur.avail - fix.avail) <= 1));
                        if (!same) {
                            next[id] = fix;
                            changed = true;
                        }
                    }
                    return changed ? next : prev;
                });
            }
        };
        measure();
        return () => {
            cancelled = true;
        };
    }, [loading, items, selectedIds, showQuestionText, showQuestionImages, showAnswers, showAnalysis, showTags, showQRCodes, showQuestionHeader, showQuestionNumber, fitImagesToPage, imageScale, answerImageScale, analysisImageScale]);

    const selectedItems = getSelectedPrintItems(items, selectedIds);
    const reserveAnswerSpace = shouldReserveAnswerSpace(showAnswers, showAnalysis);
    const countLabel = getPrintPreviewCountLabel(items.length, selectedItems.length);
    const emptyState = getPrintPreviewEmptyState(items.length, selectedItems.length);

    // 勾选"图片适应页宽"时忽略缩放滑杆，图片铺满打印页宽（单列显示）
    const getImageStyle = (scale: number) =>
        fitImagesToPage
            ? { width: "100%", maxWidth: "100%", height: "auto", display: "block", margin: "0 auto" }
            : { width: `${scale}%`, maxWidth: "none", height: "auto", display: "block", margin: "0 auto" };

    // 图片增强滤镜：contrast 以中灰为轴拉开色阶——文字（深色）更深、浅灰纸色背景被推为纯白；
    // CSS 滤镜不改变布局高度，页码脚标测量无需因此重算
    const getEnhancedStyle = (scale: number, enabled: boolean) =>
        enabled
            ? {
                  ...getImageStyle(scale),
                  filter: `contrast(${enhanceContrast.toFixed(2)}) brightness(${enhanceBrightness.toFixed(2)})`,
              }
            : getImageStyle(scale);

    // 解析图片自适应：小图最多轻微放大 ANALYSIS_IMAGE_MAX_UPSCALE 倍（过度放大会出现锯齿），
    // 自然宽度接近页宽时不放大，宽图缩小到页宽
    const ANALYSIS_IMAGE_MAX_UPSCALE = 1.25;
    const getAnalysisImageStyle = (scale: number, naturalWidth?: number) => {
        if (!fitImagesToPage) return getImageStyle(scale);
        const cap = naturalWidth
            ? Math.min(PRINT_PAGE_CONTENT_WIDTH_PX, Math.round(naturalWidth * ANALYSIS_IMAGE_MAX_UPSCALE))
            : PRINT_PAGE_CONTENT_WIDTH_PX;
        return { width: "100%", maxWidth: `${cap}px`, height: "auto", display: "block", margin: "0 auto" };
    };

    // 创建原始索引映射，用于显示正确的题目编号
    const originalIndexMap = new Map<string, number>();
    items.forEach((item, index) => {
        originalIndexMap.set(item.id, index);
    });

    // 渲染某一打印块的页码脚标（仅打印可见，绝对定位于每页纸张底部）。
    // lastPageTopPx：答案块与题干合并排版时，其末页不在页网格上，由调用方显式指定位置
    const renderFooters = (key: string, startPage: number, totalPages: number, lastPageTopPx?: number) => {
        const info = chunkPages[key];
        if (!info) return null;
        return getFooterTops(info.pages, lastPageTopPx).map((top, i) => (
            <div
                key={i}
                data-print-footer
                className="hidden print:block absolute right-0 bg-white px-1 text-xs text-muted-foreground"
                style={{ top }}
            >
                {`第${startPage + i}页（共${totalPages}页）`}
            </div>
        ));
    };

    const toggleSelectedItem = (id: string) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    const selectAllItems = () => {
        setSelectedIds(new Set(items.map((item) => item.id)));
    };

    const clearSelectedItems = () => {
        setSelectedIds(new Set());
    };

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <p className="text-muted-foreground">{t.common.loading}</p>
            </div>
        );
    }

    return (
        <>
            {/* Print Controls - Hidden when printing */}
            <div className="print:hidden sticky top-0 z-10 bg-background border-b p-3 sm:p-4 shadow-sm">
                <div className="max-w-6xl mx-auto space-y-3">
                    {/* Header Row */}
                    <div className="flex items-center gap-3">
                        <BackButton fallbackUrl="/notebooks" />
                        <h1 className="text-lg sm:text-xl font-bold flex-1">
                            {t.printPreview?.title || 'Print Preview'} ({countLabel} {t.notebooks?.items || 'items'})
                        </h1>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={toggleSortOrder}
                                title={sortOrder === "desc" ? "切换为升序" : "切换为降序"}
                                disabled={loading}
                            >
                                <ArrowUpDown className="mr-2 h-4 w-4" />
                                {sortOrder === "desc" ? "最新→最早" : "最早→最新"}
                            </Button>
                            <label
                                className="flex items-center gap-1.5 text-xs sm:text-sm cursor-pointer whitespace-nowrap text-muted-foreground hover:text-foreground transition-colors"
                                title="勾选后，点击“打印 / 保存 PDF”时本次所选题目的打印次数各加一"
                            >
                                <input
                                    type="checkbox"
                                    checked={incrementPrintCount}
                                    onChange={(e) => setIncrementPrintCount(e.target.checked)}
                                    className="rounded border-gray-300 text-primary focus:ring-primary w-3.5 h-3.5 sm:w-4 sm:h-4"
                                />
                                {'记录每题打印次数'}
                            </label>
                            <Button onClick={handlePrint} size="sm" className="whitespace-nowrap" disabled={selectedItems.length === 0}>
                                {t.printPreview?.printButton || 'Print / Save PDF'}
                            </Button>
                        </div>
                    </div>

                    {/* Controls Row */}
                    <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-4">
                        {/* Image Scale Control */}
                        <div className="flex items-center gap-2 text-sm bg-muted/50 px-2 sm:px-3 py-1 rounded-md">
                            <span className="whitespace-nowrap text-xs sm:text-sm">{t.printPreview?.imageScale || 'Image Scale'}: {imageScale}%</span>
                            <input
                                type="range"
                                min="30"
                                max="200"
                                value={imageScale}
                                onChange={(e) => setImageScale(Number(e.target.value))}
                                disabled={fitImagesToPage}
                                className="w-16 sm:w-20 accent-primary"
                            />
                        </div>

                        {/* Answer Image Scale Control */}
                        <div className="flex items-center gap-2 text-sm bg-muted/50 px-2 sm:px-3 py-1 rounded-md">
                            <span className="whitespace-nowrap text-xs sm:text-sm">答题一图片: {answerImageScale}%</span>
                            <input
                                type="range"
                                min="30"
                                max="200"
                                value={answerImageScale}
                                onChange={(e) => setAnswerImageScale(Number(e.target.value))}
                                disabled={fitImagesToPage}
                                className="w-16 sm:w-20 accent-primary"
                            />
                        </div>

                        {/* Analysis Image Scale Control */}
                        <div className="flex items-center gap-2 text-sm bg-muted/50 px-2 sm:px-3 py-1 rounded-md">
                            <span className="whitespace-nowrap text-xs sm:text-sm">解析图片: {analysisImageScale}%</span>
                            <input
                                type="range"
                                min="30"
                                max="200"
                                value={analysisImageScale}
                                onChange={(e) => setAnalysisImageScale(Number(e.target.value))}
                                disabled={fitImagesToPage}
                                className="w-16 sm:w-20 accent-primary"
                            />
                        </div>

                        {/* Image Contrast/Brightness Enhancement Control */}
                        <div className="flex items-center gap-2 text-sm bg-muted/50 px-2 sm:px-3 py-1 rounded-md">
                            <span className="whitespace-nowrap text-xs sm:text-sm">图片增强:</span>
                            <span className="whitespace-nowrap text-xs text-muted-foreground">对比 {Math.round(enhanceContrast * 100)}%</span>
                            <input
                                type="range"
                                min="0"
                                max="5"
                                step="0.05"
                                value={enhanceContrast}
                                onChange={(e) => setEnhanceContrast(Number(e.target.value))}
                                disabled={!enhanceAnswerImages && !enhanceQuestionImages && !enhanceAnalysisImages}
                                className="w-16 sm:w-20 accent-primary"
                            />
                            <span className="whitespace-nowrap text-xs text-muted-foreground">亮度 {Math.round(enhanceBrightness * 100)}%</span>
                            <input
                                type="range"
                                min="0"
                                max="3"
                                step="0.01"
                                value={enhanceBrightness}
                                onChange={(e) => setEnhanceBrightness(Number(e.target.value))}
                                disabled={!enhanceAnswerImages && !enhanceQuestionImages && !enhanceAnalysisImages}
                                className="w-16 sm:w-20 accent-primary"
                            />
                            <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 px-2 text-xs"
                                disabled={!enhanceAnswerImages && !enhanceQuestionImages && !enhanceAnalysisImages}
                                onClick={() => { setEnhanceContrast(0.8); setEnhanceBrightness(0.82); }}
                            >
                                重置
                            </Button>
                        </div>

                        {/* Toggle Options - Grid on Mobile */}
                        <div className="flex flex-wrap gap-x-3 gap-y-1 sm:gap-4">
                            <label className="flex items-center gap-1.5 text-xs sm:text-sm cursor-pointer whitespace-nowrap hover:text-primary transition-colors">
                                <input
                                    type="checkbox"
                                    checked={showQuestionHeader}
                                    onChange={(e) => setShowQuestionHeader(e.target.checked)}
                                    className="rounded border-gray-300 text-primary focus:ring-primary w-3.5 h-3.5 sm:w-4 sm:h-4"
                                />
                                {'显示题目栏'}
                            </label>
                            <label className="flex items-center gap-1.5 text-xs sm:text-sm cursor-pointer whitespace-nowrap hover:text-primary transition-colors">
                                <input
                                    type="checkbox"
                                    checked={showQuestionNumber}
                                    onChange={(e) => setShowQuestionNumber(e.target.checked)}
                                    className="rounded border-gray-300 text-primary focus:ring-primary w-3.5 h-3.5 sm:w-4 sm:h-4"
                                />
                                {'显示题号'}
                            </label>
                            <label className="flex items-center gap-1.5 text-xs sm:text-sm cursor-pointer whitespace-nowrap hover:text-primary transition-colors">
                                <input
                                    type="checkbox"
                                    checked={showQuestionText}
                                    onChange={(e) => setShowQuestionText(e.target.checked)}
                                    className="rounded border-gray-300 text-primary focus:ring-primary w-3.5 h-3.5 sm:w-4 sm:h-4"
                                />
                                {t.printPreview?.showQuestionText || 'Question Text'}
                            </label>
                            <label className="flex items-center gap-1.5 text-xs sm:text-sm cursor-pointer whitespace-nowrap hover:text-primary transition-colors">
                                <input
                                    type="checkbox"
                                    checked={showAnswers}
                                    onChange={(e) => setShowAnswers(e.target.checked)}
                                    className="rounded border-gray-300 text-primary focus:ring-primary w-3.5 h-3.5 sm:w-4 sm:h-4"
                                />
                                {t.printPreview?.showAnswers || 'Show Answers'}
                            </label>
                            <label
                                className="flex items-center gap-1.5 text-xs sm:text-sm cursor-pointer whitespace-nowrap hover:text-primary transition-colors"
                                title="勾选后在打印页“答题一：”标题后面显示该题的答题一时间（不另起一行）"
                            >
                                <input
                                    type="checkbox"
                                    checked={showAnswerTime}
                                    onChange={(e) => setShowAnswerTime(e.target.checked)}
                                    className="rounded border-gray-300 text-primary focus:ring-primary w-3.5 h-3.5 sm:w-4 sm:h-4"
                                />
                                {'答题一时间'}
                            </label>
                            <label className="flex items-center gap-1.5 text-xs sm:text-sm cursor-pointer whitespace-nowrap hover:text-primary transition-colors">
                                <input
                                    type="checkbox"
                                    checked={showAnalysis}
                                    onChange={(e) => setShowAnalysis(e.target.checked)}
                                    className="rounded border-gray-300 text-primary focus:ring-primary w-3.5 h-3.5 sm:w-4 sm:h-4"
                                />
                                {t.printPreview?.showAnalysis || 'Show Analysis'}
                            </label>
                            <label className="flex items-center gap-1.5 text-xs sm:text-sm cursor-pointer whitespace-nowrap hover:text-primary transition-colors">
                                <input
                                    type="checkbox"
                                    checked={showTags}
                                    onChange={(e) => setShowTags(e.target.checked)}
                                    className="rounded border-gray-300 text-primary focus:ring-primary w-3.5 h-3.5 sm:w-4 sm:h-4"
                                />
                                {t.printPreview?.showTags || 'Show Tags'}
                            </label>
                            <label className="flex items-center gap-1.5 text-xs sm:text-sm cursor-pointer whitespace-nowrap hover:text-primary transition-colors">
                                <input
                                    type="checkbox"
                                    checked={showQRCodes}
                                    onChange={(e) => setShowQRCodes(e.target.checked)}
                                    className="rounded border-gray-300 text-primary focus:ring-primary w-3.5 h-3.5 sm:w-4 sm:h-4"
                                />
                                显示题目定位二维码
                            </label>
                            <label className="flex items-center gap-1.5 text-xs sm:text-sm cursor-pointer whitespace-nowrap hover:text-primary transition-colors">
                                <input
                                    type="checkbox"
                                    checked={fitImagesToPage}
                                    onChange={(e) => setFitImagesToPage(e.target.checked)}
                                    className="rounded border-gray-300 text-primary focus:ring-primary w-3.5 h-3.5 sm:w-4 sm:h-4"
                                />
                                {'图片适应页宽'}
                            </label>
                            <label
                                className="flex items-center gap-1.5 text-xs sm:text-sm cursor-pointer whitespace-nowrap hover:text-primary transition-colors"
                                title="加深文字颜色、背景变纯白，打印更清晰（仅影响答题一图片）"
                            >
                                <input
                                    type="checkbox"
                                    checked={enhanceAnswerImages}
                                    onChange={(e) => setEnhanceAnswerImages(e.target.checked)}
                                    className="rounded border-gray-300 text-primary focus:ring-primary w-3.5 h-3.5 sm:w-4 sm:h-4"
                                />
                                {'答案图片增强对比'}
                            </label>
                            <label
                                className="flex items-center gap-1.5 text-xs sm:text-sm cursor-pointer whitespace-nowrap hover:text-primary transition-colors"
                                title="将同样的对比/亮度滤镜应用到题目图片（含原始问题图片）"
                            >
                                <input
                                    type="checkbox"
                                    checked={enhanceQuestionImages}
                                    onChange={(e) => setEnhanceQuestionImages(e.target.checked)}
                                    className="rounded border-gray-300 text-primary focus:ring-primary w-3.5 h-3.5 sm:w-4 sm:h-4"
                                />
                                {'应用到题目图片'}
                            </label>
                            <label
                                className="flex items-center gap-1.5 text-xs sm:text-sm cursor-pointer whitespace-nowrap hover:text-primary transition-colors"
                                title="将同样的对比/亮度滤镜应用到解析图片"
                            >
                                <input
                                    type="checkbox"
                                    checked={enhanceAnalysisImages}
                                    onChange={(e) => setEnhanceAnalysisImages(e.target.checked)}
                                    className="rounded border-gray-300 text-primary focus:ring-primary w-3.5 h-3.5 sm:w-4 sm:h-4"
                                />
                                {'应用到解析图片'}
                            </label>
                            <label className="flex items-center gap-1.5 text-xs sm:text-sm cursor-pointer whitespace-nowrap hover:text-primary transition-colors">
                                <input
                                    type="checkbox"
                                    checked={showQuestionImages}
                                    onChange={(e) => setShowQuestionImages(e.target.checked)}
                                    className="rounded border-gray-300 text-primary focus:ring-primary w-3.5 h-3.5 sm:w-4 sm:h-4"
                                />
                                {'显示题目图片'}
                            </label>
                            <label className="flex items-center gap-1.5 text-xs sm:text-sm cursor-pointer whitespace-nowrap hover:text-primary transition-colors">
                                <input
                                    type="checkbox"
                                    checked={padToEvenPages}
                                    onChange={(e) => setPadToEvenPages(e.target.checked)}
                                    className="rounded border-gray-300 text-primary focus:ring-primary w-3.5 h-3.5 sm:w-4 sm:h-4"
                                />
                                {'每题偶数页（双面打印）'}
                            </label>
                        </div>
                    </div>

                    {/* Item Selection Row */}
                    <div className="rounded-md border bg-muted/20 p-3 space-y-2">
                        <div
                            className="flex flex-wrap items-center justify-between gap-2 cursor-pointer"
                            onClick={() => setIsSelectionBoxCollapsed(!isSelectionBoxCollapsed)}
                        >
                            <div className="flex items-center gap-2">
                                <div className="text-sm font-medium">
                                    {t.printPreview?.selectItems || 'Select Items'} ({selectedItems.length}/{items.length})
                                </div>
                                {isSelectionBoxCollapsed ? (
                                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                ) : (
                                    <ChevronUp className="h-4 w-4 text-muted-foreground" />
                                )}
                            </div>
                            <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                                <Button variant="outline" size="sm" onClick={selectAllItems}>
                                    {t.printPreview?.selectAll || 'Select All'}
                                </Button>
                                <Button variant="outline" size="sm" onClick={clearSelectedItems}>
                                    {t.printPreview?.clearSelection || 'Clear Selection'}
                                </Button>
                            </div>
                        </div>
                        {!isSelectionBoxCollapsed && (
                            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 max-h-44 overflow-y-auto pr-1">
                                {items.map((item, index) => (
                                    <label
                                        key={item.id}
                                        className="flex items-start gap-2 rounded border bg-background p-2 text-xs cursor-pointer hover:border-primary/50"
                                    >
                                        <input
                                            type="checkbox"
                                            checked={selectedIds.has(item.id)}
                                            onChange={() => toggleSelectedItem(item.id)}
                                            className="mt-0.5 rounded border-gray-300 text-primary focus:ring-primary"
                                        />
                                        <span className="font-semibold">
                                            {t.printPreview?.questionNumber?.replace('{num}', String(index + 1)) || `Question ${index + 1}`}
                                        </span>
                                    </label>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Print Content */}
            <div className="max-w-4xl mx-auto p-8 print:p-0">
                {selectedItems.map((item, index) => {
                    // 优先使用 tags 关联，回退到 knowledgePoints
                    let tags: string[] = [];
                    if (item.tags && item.tags.length > 0) {
                        tags = item.tags.map(t => t.name);
                    } else {
                        try {
                            tags = JSON.parse(item.knowledgePoints || "[]");
                        } catch (e) {
                            tags = [];
                        }
                    }

                    // 使用原始索引，而不是选中项的索引
                    const originalIndex = originalIndexMap.get(item.id) ?? index;
                    const questionNumber = originalIndex + 1;

                    // 每题页数与页码脚标：题干块从第1页起；题目栏/答案/解析块接在其后
                    //（题干撑满页底后只剩 8px 空隙，后续内容总是落到下一页，页数按两块之和计）
                    const stemInfo = chunkPages[`${item.id}:stem`];
                    const answerChunkInfo = chunkPages[`${item.id}:answer`];
                    const analysisFix = analysisFixes[item.id];
                    const answerRendered = showQuestionHeader || showAnswers || showAnalysis;
                    const broken = showAnswers || showAnalysis;
                    const stemPages = stemInfo?.pages ?? 1;
                    const answerPages = answerRendered ? (answerChunkInfo?.pages ?? 1) : 0;
                    const rawTotal = answerRendered ? stemPages + answerPages : stemPages;
                    // 每题补足偶数页：奇数页时末尾追加空白页（双面打印时每题独占整张纸）
                    const totalPages = padToEvenPages ? rawTotal + (rawTotal % 2) : rawTotal;
                    const needsBlankPage = padToEvenPages && rawTotal % 2 === 1;
                    // 撑满末页所需的最小盒高（末页留 8px 余量防溢出产生空白页）
                    const chunkMinHeightVar = (pages: number) =>
                        ({ "--print-min-h": `${(pages - 1) * PRINT_PAGE_CONTENT_HEIGHT_PX + PRINT_CHUNK_MIN_HEIGHT_PX}px` }) as CSSProperties;
                    // 题干盒在打印时的实际高度（内容或撑满样式取大者）
                    const stemBoxHeight = Math.max(
                        stemInfo?.height ?? 0,
                        (stemPages - 1) * PRINT_PAGE_CONTENT_HEIGHT_PX + PRINT_CHUNK_MIN_HEIGHT_PX
                    );
                    // 仅题目栏（不另起页）时答案块原点=题干盒底（不在页网格上），末页脚标换算到全局页底
                    const answerLastTopLocal =
                        (stemPages + 1) * PRINT_PAGE_CONTENT_HEIGHT_PX - PRINT_FOOTER_HEIGHT_PX - stemBoxHeight;

                    return (
                        <div
                            key={item.id}
                            className={`mb-4 border-b last:border-b-0 ${index > 0 ? "print:break-before-page" : ""}`}
                        >
                            {/* 题干块（第1页起）：二维码 + 题干；打印时撑满到末页页底（--print-min-h 由测量页数决定） */}
                            <div
                                data-print-chunk={`${item.id}:stem`}
                                className={`print:relative ${reserveAnswerSpace ? "pb-20 print:pb-16" : "pb-6"}`}
                                style={chunkMinHeightVar(stemPages)}
                            >
                            {/* QR Code: 与题干同页（第1页），扫码定位本题（打印需要足够大便于手机扫描） */}
                            {showQRCodes && (
                                <div className="mb-4 print:flex print:items-center">
                                    <QRCodeDisplay
                                        errorItemId={item.id}
                                        size={96}
                                        showLabel={false}
                                    />
                                </div>
                            )}

                            {/* Question Images（受“显示题目图片”开关控制，默认显示，排在题目文字之前） */}
                            {showQuestionImages && (() => {
                                let images: { dataUrl?: string; name?: string }[] = [];
                                if (item.questionImages && item.questionImages !== 'null') {
                                    try {
                                        const parsed = JSON.parse(item.questionImages);
                                        if (Array.isArray(parsed)) images = parsed;
                                    } catch (e) {
                                        console.error("Failed to parse question images:", e);
                                    }
                                }
                                // 空数组（详情页编辑保存会写入 '[]'）时回退到原始问题图片
                                if (images.length === 0 && item.originalImageUrl) {
                                    return (
                                        <div className="mb-4" style={{ width: '100%' }}>
                                            <img
                                                src={item.originalImageUrl}
                                                alt={t.detail?.originalProblem || 'Question Image'}
                                                className="h-auto border rounded"
                                                style={getEnhancedStyle(imageScale, enhanceQuestionImages)}
                                            />
                                        </div>
                                    );
                                }
                                if (images.length > 0) {
                                    return (
                                        <div className={`mb-4 grid ${fitImagesToPage ? "grid-cols-1" : "grid-cols-2"} gap-3`}>
                                            {images.map((img: { dataUrl?: string; name?: string }, idx: number) => (
                                                <div key={idx} className="break-inside-avoid" style={{ width: '100%' }}>
                                                    <img
                                                        src={img.dataUrl}
                                                        alt={img.name || `题目图片 ${idx + 1}`}
                                                        className="h-auto rounded border"
                                                        style={getEnhancedStyle(imageScale, enhanceQuestionImages)}
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    );
                                }
                                return null;
                            })()}

                            {/* Question Text（排在题目图片之后） */}
                            {showQuestionText && item.questionText && (
                                <div className="mb-4">
                                    <MarkdownRenderer content={item.questionText} />
                                </div>
                            )}

                            {/* 页码脚标：题干块从第1页起 */}
                            {renderFooters(`${item.id}:stem`, 1, totalPages)}
                        </div>

                        {/* 题目栏 + 解析 + 答案：打印时另起一页，题目栏（题号/来源/知识点等）随解析、答案显示在第2页 */}
                        {(showQuestionHeader || showAnswers || showAnalysis) && (
                        <div
                            data-print-chunk={`${item.id}:answer`}
                            className={`print:relative ${broken ? "print:break-before-page" : ""}`}
                            style={broken ? chunkMinHeightVar(answerPages) : undefined}
                        >
                            {/* Question Header */}
                            {showQuestionHeader && (
                                <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 leading-7">
                                    {item.subject && (
                                        <span className="text-sm text-muted-foreground">
                                            {item.subject.name}
                                        </span>
                                    )}
                                    {item.gradeSemester && (
                                        <span className="text-sm text-muted-foreground">
                                            {item.gradeSemester}
                                        </span>
                                    )}
                                    {item.paperLevel && (
                                        <span className="text-sm text-muted-foreground">
                                            {t.printPreview?.paperLevel || 'Paper Level'}: {item.paperLevel.toUpperCase()}
                                        </span>
                                    )}
                                    {showQuestionNumber && (
                                        <span className="text-sm text-muted-foreground">
                                            题号：{item.questionNumber || questionNumber}
                                        </span>
                                    )}
                                    {showTags && tags.length > 0 && (
                                        <>
                                            <span className="font-semibold">
                                                {t.printPreview?.knowledgePoints || 'Knowledge Points'}:
                                            </span>
                                            {tags.map((tag, tagIndex) => (
                                                <span
                                                    key={`${tag}-${tagIndex}`}
                                                    className="px-2 py-1 bg-muted rounded text-sm"
                                                >
                                                    {tag}
                                                </span>
                                            ))}
                                        </>
                                    )}
                                </div>
                            )}
                            {/* Analysis */}
                            {showAnalysis && (() => {
                                const hasAnalysisText = (item.analysis?.trim() || '').length > 0;
                                let hasAnalysisImages = false;
                                if (item.analysisImages) {
                                    try {
                                        const images = JSON.parse(item.analysisImages);
                                        hasAnalysisImages = Array.isArray(images) && images.length > 0;
                                    } catch (e) {
                                        hasAnalysisImages = false;
                                    }
                                }
                                return hasAnalysisText || hasAnalysisImages;
                            })() && (
                                <div className={`mb-4 ${analysisFix?.type === "push" ? "print:break-before-page" : ""}`}>
                                    <h3 data-frag="analysis-heading" className="font-semibold mb-2">{t.printPreview?.analysis || 'Analysis'}:</h3>
                                    {item.analysis && <MarkdownRenderer content={item.analysis} />}
                                    {/* Analysis Images */}
                                    {item.analysisImages && (() => {
                                        try {
                                            const images = JSON.parse(item.analysisImages);
                                            if (Array.isArray(images) && images.length > 0) {
                                                return (
                                                    <div className={`mt-4 grid ${fitImagesToPage ? "grid-cols-1" : "grid-cols-2"} gap-3`}>
                                                        {images.map((img: any, idx: number) => {
                                                            const widthKey = `${item.id}:analysis:${idx}`;
                                                            const shrinkFirst = analysisFix?.type === "shrink" && idx === 0;
                                                            // 与答案/题目图片同款增强滤镜（CSS filter 不影响布局，防孤行测量无需重算）
                                                            const enhanceFilter = enhanceAnalysisImages
                                                                ? `contrast(${enhanceContrast.toFixed(2)}) brightness(${enhanceBrightness.toFixed(2)})`
                                                                : undefined;
                                                            return (
                                                                <div key={idx} data-frag="analysis-image" data-frag-index={idx} className="break-inside-avoid" style={{ width: '100%' }}>
                                                                    <img
                                                                        src={img.dataUrl}
                                                                        alt={img.name || `解析图片 ${idx + 1}`}
                                                                        className="h-auto rounded border"
                                                                        style={
                                                                            shrinkFirst
                                                                                ? { height: `${analysisFix.avail}px`, width: 'auto', maxWidth: '100%', display: 'block', margin: '0 auto', filter: enhanceFilter }
                                                                                : { ...getAnalysisImageStyle(analysisImageScale, analysisNaturalWidths[widthKey]), filter: enhanceFilter }
                                                                        }
                                                                        data-print-shrink={shrinkFirst ? widthKey : undefined}
                                                                        onLoad={(e) => {
                                                                            const natural = e.currentTarget.naturalWidth;
                                                                            setAnalysisNaturalWidths((prev) =>
                                                                                prev[widthKey] === natural ? prev : { ...prev, [widthKey]: natural }
                                                                            );
                                                                        }}
                                                                    />
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                );
                                            }
                                        } catch (e) {
                                            console.error("Failed to parse analysis images:", e);
                                        }
                                        return null;
                                    })()}
                                </div>
                            )}

                            {/* Answer */}
                            {showAnswers && (() => {
                                const hasAnswerText = (item.answerText?.trim() || '').length > 0;
                                let hasAnswerImages = false;
                                if (item.answerImages) {
                                    try {
                                        const images = JSON.parse(item.answerImages);
                                        hasAnswerImages = Array.isArray(images) && images.length > 0;
                                    } catch (e) {
                                        hasAnswerImages = false;
                                    }
                                }
                                return hasAnswerText || hasAnswerImages;
                            })() && (
                                <div className="mb-4">
                                    <h3 data-frag="answer-heading" className="font-semibold mb-2">
                                        {t.printPreview?.referenceAnswer || '答题一'}:
                                        {showAnswerTime && item.answerTime && (
                                            <span className="font-normal text-xs text-muted-foreground ml-2">
                                                {new Date(item.answerTime).toLocaleString('zh-CN', {
                                                    year: 'numeric',
                                                    month: '2-digit',
                                                    day: '2-digit',
                                                    hour: '2-digit',
                                                    minute: '2-digit'
                                                })}
                                            </span>
                                        )}
                                    </h3>
                                    {item.answerText && <MarkdownRenderer content={item.answerText} />}
                                    {/* Answer Images */}
                                    {item.answerImages && (() => {
                                        try {
                                            const images = JSON.parse(item.answerImages);
                                            if (Array.isArray(images) && images.length > 0) {
                                                return (
                                                    <div className={`mt-4 grid ${fitImagesToPage ? "grid-cols-1" : "grid-cols-2"} gap-3`}>
                                                        {images.map((img: any, idx: number) => (
                                                            <div key={idx} data-frag="answer-image" className="break-inside-avoid" style={{ width: '100%' }}>
                                                                <img
                                                                    src={img.dataUrl}
                                                                    alt={img.name || `答案图片 ${idx + 1}`}
                                                                    className="h-auto rounded border"
                                                                    style={getEnhancedStyle(answerImageScale, enhanceAnswerImages)}
                                                                />
                                                            </div>
                                                        ))}
                                                    </div>
                                                );
                                            }
                                        } catch (e) {
                                            console.error("Failed to parse answer images:", e);
                                        }
                                        return null;
                                    })()}
                                </div>
                            )}
                            {/* 页码脚标：答案/解析块（从题干页数的下一页开始编号） */}
                            {renderFooters(
                                `${item.id}:answer`,
                                stemPages + 1,
                                totalPages,
                                broken ? undefined : answerLastTopLocal
                            )}
                            </div>
                            )}

                            {/* 偶数页补位：本题占奇数页时追加一个空白页（仅打印可见） */}
                            {needsBlankPage && (
                                <div
                                    data-print-blank
                                    className="hidden print:block print:break-before-page print:relative"
                                    style={{ "--print-min-h": `${PRINT_CHUNK_MIN_HEIGHT_PX}px` } as CSSProperties}
                                >
                                    <div
                                        data-print-footer
                                        className="hidden print:block absolute right-0 bg-white px-1 text-xs text-muted-foreground"
                                        style={{ top: PRINT_PAGE_CONTENT_HEIGHT_PX - PRINT_FOOTER_HEIGHT_PX }}
                                    >
                                        {`第${totalPages}页（共${totalPages}页）`}
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}

                {emptyState && (
                    <div className="text-center py-12 text-muted-foreground">
                        {emptyState === 'noSelection'
                            ? (t.printPreview?.noSelection || 'No items selected')
                            : (t.printPreview?.noItems || 'No matching error items')}
                    </div>
                )}
            </div>
        </>
    );
}

export default function PrintPreviewPage() {
    const { t } = useLanguage();
    return (
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center">{t.common.loading}</div>}>
            <PrintPreviewContent />
        </Suspense>
    );
}
