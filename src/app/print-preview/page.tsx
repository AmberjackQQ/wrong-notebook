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
import { ArrowUpDown, ChevronDown, ChevronUp } from "lucide-react";

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

    const selectedItems = getSelectedPrintItems(items, selectedIds);
    const reserveAnswerSpace = shouldReserveAnswerSpace(showAnswers, showAnalysis);
    const countLabel = getPrintPreviewCountLabel(items.length, selectedItems.length);
    const emptyState = getPrintPreviewEmptyState(items.length, selectedItems.length);

    // 创建原始索引映射，用于显示正确的题目编号
    const originalIndexMap = new Map<string, number>();
    items.forEach((item, index) => {
        originalIndexMap.set(item.id, index);
    });

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
                                className="w-16 sm:w-20 accent-primary"
                            />
                        </div>

                        {/* Answer Image Scale Control */}
                        <div className="flex items-center gap-2 text-sm bg-muted/50 px-2 sm:px-3 py-1 rounded-md">
                            <span className="whitespace-nowrap text-xs sm:text-sm">做题答案图片: {answerImageScale}%</span>
                            <input
                                type="range"
                                min="30"
                                max="200"
                                value={answerImageScale}
                                onChange={(e) => setAnswerImageScale(Number(e.target.value))}
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
                            className={`mb-4 border-b last:border-b-0 print:break-inside-avoid ${reserveAnswerSpace ? "pb-20 print:pb-16" : "pb-6"}`}
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
                                                    <div className="mb-4 grid grid-cols-2 gap-3">
                                                        {images.map((img: any, idx: number) => (
                                                            <div key={idx} className="break-inside-avoid" style={{ width: '100%' }}>
                                                                <img
                                                                    src={img.dataUrl}
                                                                    alt={img.name || `题目图片 ${idx + 1}`}
                                                                    className="h-auto rounded border"
                                                                    style={{
                                                                        width: `${imageScale}%`,
                                                                        maxWidth: 'none', /* Allow scaling beyond container for print */
                                                                        height: 'auto',
                                                                        display: 'block',
                                                                        margin: '0 auto'
                                                                    }}
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
                                                style={{
                                                    width: `${imageScale}%`,
                                                    maxWidth: 'none', /* Allow scaling beyond container for print */
                                                    height: 'auto',
                                                    display: 'block',
                                                    margin: '0 auto'
                                                }}
                                            />
                                        </div>
                                    )}
                                </>
                            )}



                            {/* Answer */}
                            {showAnswers && (() => {
                                const hasAnswerText = item.answerText?.trim().length > 0;
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
                                    <h3 className="font-semibold mb-2">{t.printPreview?.referenceAnswer || '做题答案'}:</h3>
                                    {item.answerText && <MarkdownRenderer content={item.answerText} />}
                                    {/* Answer Images */}
                                    {item.answerImages && (() => {
                                        try {
                                            const images = JSON.parse(item.answerImages);
                                            if (Array.isArray(images) && images.length > 0) {
                                                return (
                                                    <div className="mt-4 grid grid-cols-2 gap-3">
                                                        {images.map((img: any, idx: number) => (
                                                            <div key={idx} className="break-inside-avoid" style={{ width: '100%' }}>
                                                                <img
                                                                    src={img.dataUrl}
                                                                    alt={img.name || `答案图片 ${idx + 1}`}
                                                                    className="h-auto rounded border"
                                                                    style={{
                                                                        width: `${answerImageScale}%`,
                                                                        maxWidth: 'none', /* Allow scaling beyond container for print */
                                                                        height: 'auto',
                                                                        display: 'block',
                                                                        margin: '0 auto'
                                                                    }}
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
                                const hasAnalysisText = item.analysis?.trim().length > 0;
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
                                                    <div className={`mt-4 grid grid-cols-2 gap-3 ${!item.analysis ? '' : ''}`}>
                                                        {images.map((img: any, idx: number) => (
                                                            <div key={idx} className="break-inside-avoid" style={{ width: '100%' }}>
                                                                <img
                                                                    src={img.dataUrl}
                                                                    alt={img.name || `解析图片 ${idx + 1}`}
                                                                    className="h-auto rounded border"
                                                                    style={{
                                                                        width: `${analysisImageScale}%`,
                                                                        maxWidth: 'none', /* Allow scaling beyond container for print */
                                                                        height: 'auto',
                                                                        display: 'block',
                                                                        margin: '0 auto'
                                                                    }}
                                                                />
                                                            </div>
                                                        ))}
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
