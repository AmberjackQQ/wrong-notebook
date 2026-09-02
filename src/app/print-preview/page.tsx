"use client";

import { useEffect, useState, Suspense } from "react";
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
    PRINT_PAGE_CONTENT_WIDTH_PX,
    estimatePageCount,
    getFooterTops,
} from "@/lib/print-page";
import { ArrowUpDown, ChevronDown, ChevronUp } from "lucide-react";
import { QRCodeDisplay } from "@/components/qr-code-display";

function PrintPreviewContent() {
    const searchParams = useSearchParams();
    const { t } = useLanguage();
    const [items, setItems] = useState<ErrorItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [showAnswers, setShowAnswers] = useState(false);
    const [showAnalysis, setShowAnalysis] = useState(false);
    const [showTags, setShowTags] = useState(false);
    const [imageScale, setImageScale] = useState(70);
    const [answerImageScale, setAnswerImageScale] = useState(70);
    const [analysisImageScale, setAnalysisImageScale] = useState(70);
    const [showQuestionText, setShowQuestionText] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [sortBy, setSortBy] = useState<string>("createdAt");
    const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
    const [showQuestionHeader, setShowQuestionHeader] = useState(true);
    const [isSelectionBoxCollapsed, setIsSelectionBoxCollapsed] = useState(false);
    const [showQRCodes, setShowQRCodes] = useState(false);
    // 图片自动缩放至打印页宽（默认开启）
    const [fitImagesToPage, setFitImagesToPage] = useState(true);
    // 每个打印块（题干/答案）在打印页宽下的高度与页数估算，key 为 `${itemId}:stem` | `${itemId}:answer`
    const [chunkPages, setChunkPages] = useState<Record<string, { pages: number; height: number }>>({});
    // 解析图片的自然宽度（onLoad 时记录），用于按图片大小决定缩放
    const [analysisNaturalWidths, setAnalysisNaturalWidths] = useState<Record<string, number>>({});

    useEffect(() => {
        fetchItems();
    }, []);

    const toggleSortOrder = () => {
        const newOrder = sortOrder === "desc" ? "asc" : "desc";
        setSortOrder(newOrder);
        // 重新获取数据
        fetchItemsWithSort(newOrder);
    };

    const fetchItemsWithSort = async (order: "asc" | "desc") => {
        setLoading(true);
        try {
            const params = new URLSearchParams(searchParams.toString());
            // 打印预览需要所有符合条件的数据，设置较大的 pageSize
            params.set("pageSize", String(PRINT_PREVIEW_PAGE_SIZE));
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
            const params = new URLSearchParams(searchParams.toString());
            // 打印预览需要所有符合条件的数据，设置较大的 pageSize
            params.set("pageSize", String(PRINT_PREVIEW_PAGE_SIZE));
            // 添加排序参数
            params.set("sortBy", sortBy);
            params.set("sortOrder", sortOrder);
            const response = await apiClient.get<PaginatedResponse<ErrorItem>>(`/api/error-items/list?${params.toString()}`);
            setItems(response.items);

            // 检查URL参数中是否有指定的selectedIds
            const selectedIdsParam = searchParams.get("selectedIds");
            if (selectedIdsParam) {
                const ids = selectedIdsParam.split(",");
                // 验证这些ID是否都在当前items中
                const validIds = ids.filter(id => response.items.some(item => item.id === id));
                setSelectedIds(new Set(validIds));
            } else {
                // 如果没有指定selectedIds，默认全选
                setSelectedIds(new Set(response.items.map((item) => item.id)));
            }
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    const handlePrint = () => {
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
            try {
                for (const chunk of chunks) {
                    const key = chunk.getAttribute("data-print-chunk");
                    if (!key) continue;
                    const clone = chunk.cloneNode(true) as HTMLElement;
                    clone.querySelectorAll("[data-print-footer]").forEach((f) => f.remove());
                    host.appendChild(clone);
                    await Promise.all(Array.from(clone.querySelectorAll("img")).map(waitImage));
                    const height = clone.offsetHeight;
                    result[key] = { pages: estimatePageCount(height), height };
                    clone.remove();
                }
            } finally {
                host.remove();
            }
            if (!cancelled) setChunkPages(result);
        };
        measure();
        return () => {
            cancelled = true;
        };
    }, [loading, items, selectedIds, showQuestionText, showAnswers, showAnalysis, showTags, showQRCodes, showQuestionHeader, fitImagesToPage, imageScale, answerImageScale, analysisImageScale]);

    const selectedItems = getSelectedPrintItems(items, selectedIds);
    const reserveAnswerSpace = shouldReserveAnswerSpace(showAnswers, showAnalysis);
    const countLabel = getPrintPreviewCountLabel(items.length, selectedItems.length);
    const emptyState = getPrintPreviewEmptyState(items.length, selectedItems.length);

    // 勾选"图片适应页宽"时忽略缩放滑杆，图片铺满打印页宽（单列显示）
    const getImageStyle = (scale: number) =>
        fitImagesToPage
            ? { width: "100%", maxWidth: "100%", height: "auto", display: "block", margin: "0 auto" }
            : { width: `${scale}%`, maxWidth: "none", height: "auto", display: "block", margin: "0 auto" };

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

    // 渲染某一打印块的页码脚标（仅打印可见，绝对定位于每页底部）
    const renderFooters = (key: string, startPage: number, totalPages: number, minBoxHeight = 0) => {
        const info = chunkPages[key];
        if (!info) return null;
        return getFooterTops(info.height, info.pages, minBoxHeight).map((top, i) => (
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
                                        <span className="line-clamp-2">
                                            <span className="font-semibold">
                                                {t.printPreview?.questionNumber?.replace('{num}', String(index + 1)) || `Question ${index + 1}`}
                                            </span>
                                            {item.questionText ? `：${item.questionText}` : ''}
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

                    return (
                        <div
                            key={item.id}
                            className={`mb-4 border-b last:border-b-0 ${index > 0 ? "print:break-before-page" : ""}`}
                        >
                            {/* 题干块（第1页）：二维码 + 题干；打印时至少占满一整页（print:min-h-[963px] 对应 PRINT_CHUNK_MIN_HEIGHT_PX） */}
                            <div
                                data-print-chunk={`${item.id}:stem`}
                                className={`print:relative print:min-h-[963px] ${reserveAnswerSpace ? "pb-20 print:pb-16" : "pb-6"}`}
                            >
                            {/* QR Code: 与题干同页（第1页），扫码定位本题 */}
                            {showQRCodes && (
                                <div className="mb-4 print:flex print:items-center">
                                    <QRCodeDisplay
                                        errorItemId={item.id}
                                        size={48}
                                        showLabel={false}
                                        className="print:scale-75 print:origin-left"
                                    />
                                </div>
                            )}

                            {/* Original Image or Text */}
                            {showQuestionText && item.questionText ? (
                                <div className="mb-4">
                                    <MarkdownRenderer content={item.questionText} />
                                </div>
                            ) : (
                                <>
                                    {/* Question Images Array */}
                                    {item.questionImages && (() => {
                                        try {
                                            const images = JSON.parse(item.questionImages);
                                            if (Array.isArray(images) && images.length > 0) {
                                                return (
                                                    <div className={`mb-4 grid ${fitImagesToPage ? "grid-cols-1" : "grid-cols-2"} gap-3`}>
                                                        {images.map((img: any, idx: number) => (
                                                            <div key={idx} className="break-inside-avoid" style={{ width: '100%' }}>
                                                                <img
                                                                    src={img.dataUrl}
                                                                    alt={img.name || `题目图片 ${idx + 1}`}
                                                                    className="h-auto rounded border"
                                                                    style={getImageStyle(imageScale)}
                                                                />
                                                            </div>
                                                        ))}
                                                    </div>
                                                );
                                            }
                                        } catch (e) {
                                            console.error("Failed to parse question images:", e);
                                        }
                                        return null;
                                    })()}
                                    {/* Fallback to Original Image */}
                                    {(!item.questionImages || item.questionImages === 'null') && item.originalImageUrl && (
                                        <div className="mb-4" style={{ width: '100%' }}>
                                            <img
                                                src={item.originalImageUrl}
                                                alt={t.detail?.originalProblem || 'Question Image'}
                                                className="h-auto border rounded"
                                                style={getImageStyle(imageScale)}
                                            />
                                        </div>
                                    )}
                                </>
                            )}

                            {/* 页码脚标：题干块从第1页起 */}
                            {(() => {
                                const stemInfo = chunkPages[`${item.id}:stem`];
                                const answerInfo = chunkPages[`${item.id}:answer`];
                                const answerRendered = showQuestionHeader || showAnswers || showAnalysis;
                                const broken = showAnswers || showAnalysis;
                                const stemPages = stemInfo?.pages ?? 1;
                                const answerPages = answerRendered ? (answerInfo?.pages ?? 1) : 0;
                                const total = broken
                                    ? stemPages + answerPages
                                    : answerRendered
                                        ? Math.max(1, stemPages + answerPages - 1)
                                        : stemPages;
                                return renderFooters(`${item.id}:stem`, 1, total, PRINT_CHUNK_MIN_HEIGHT_PX);
                            })()}
                        </div>

                        {/* 题目栏 + 答案 + 解析：打印时另起一页，题目栏（题号/来源/知识点等）随答案、解析显示在第2页 */}
                        {(showQuestionHeader || showAnswers || showAnalysis) && (
                        <div
                            data-print-chunk={`${item.id}:answer`}
                            className={`print:relative ${showAnswers || showAnalysis ? "print:break-before-page" : ""}`}
                        >
                            {/* Question Header */}
                            {showQuestionHeader && (
                                <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 leading-7">
                                    <span className="text-lg font-bold">
                                        {t.printPreview?.questionNumber?.replace('{num}', String(questionNumber)) || `Question ${questionNumber}`}
                                    </span>
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
                                    <h3 className="font-semibold mb-2">{t.printPreview?.referenceAnswer || '答题一'}:</h3>
                                    {item.answerText && <MarkdownRenderer content={item.answerText} />}
                                    {/* Answer Images */}
                                    {item.answerImages && (() => {
                                        try {
                                            const images = JSON.parse(item.answerImages);
                                            if (Array.isArray(images) && images.length > 0) {
                                                return (
                                                    <div className={`mt-4 grid ${fitImagesToPage ? "grid-cols-1" : "grid-cols-2"} gap-3`}>
                                                        {images.map((img: any, idx: number) => (
                                                            <div key={idx} className="break-inside-avoid" style={{ width: '100%' }}>
                                                                <img
                                                                    src={img.dataUrl}
                                                                    alt={img.name || `答案图片 ${idx + 1}`}
                                                                    className="h-auto rounded border"
                                                                    style={getImageStyle(answerImageScale)}
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
                                <div className="mb-4">
                                    <h3 className="font-semibold mb-2">{t.printPreview?.analysis || 'Analysis'}:</h3>
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
                                                            return (
                                                                <div key={idx} className="break-inside-avoid" style={{ width: '100%' }}>
                                                                    <img
                                                                        src={img.dataUrl}
                                                                        alt={img.name || `解析图片 ${idx + 1}`}
                                                                        className="h-auto rounded border"
                                                                        style={getAnalysisImageStyle(analysisImageScale, analysisNaturalWidths[widthKey])}
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
                            {/* 页码脚标：答案/解析块（另起一页时从题干页数的下一页开始编号） */}
                            {(() => {
                                const stemInfo = chunkPages[`${item.id}:stem`];
                                const answerInfo = chunkPages[`${item.id}:answer`];
                                const broken = showAnswers || showAnalysis;
                                const stemPages = stemInfo?.pages ?? 1;
                                const answerPages = answerInfo?.pages ?? 1;
                                const start = broken ? stemPages + 1 : stemPages;
                                return renderFooters(`${item.id}:answer`, start, start + answerPages - 1);
                            })()}
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
