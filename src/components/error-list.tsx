"use client";

import { useEffect, useState, useRef } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Search, Filter, CheckCircle, Clock, ChevronDown, Printer, ListChecks, Trash2, X, ArrowUpDown } from "lucide-react";
import Link from "next/link";
import { format } from "date-fns";
import { useLanguage } from "@/contexts/LanguageContext";
import { useRouter } from "next/navigation";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { KnowledgeFilter } from "@/components/knowledge-filter";
import { ErrorItem, PaginatedResponse } from "@/types/api";
import { apiClient } from "@/lib/api-client";
import { cleanMarkdown } from "@/lib/markdown-utils";
import { Pagination } from "@/components/ui/pagination";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants/pagination";
import { getMistakeStatusLabel } from "@/lib/mistake-status";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChevronDown as ChevronDownIcon } from "lucide-react";

interface ErrorListProps {
    subjectId?: string;
    subjectName?: string;
}

type KnowledgeFilterChange = {
    gradeSemester?: string;
    chapter?: string;
    tags?: string[];
};

export function ErrorList({ subjectId, subjectName }: ErrorListProps = {}) {
    const [items, setItems] = useState<ErrorItem[]>([]);
    const [, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [masteryFilter, setMasteryFilter] = useState<"all" | "mastered" | "unmastered">("all");
    const [timeFilter, setTimeFilter] = useState<"all" | "week" | "month">("all");
    const [gradeFilter, setGradeFilter] = useState("");
    const [chapterFilter, setChapterFilter] = useState("");
    const [paperLevelFilter, setPaperLevelFilter] = useState<string>("all");
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [expandedTags, setExpandedTags] = useState<Set<string>>(new Set());
    // 分页状态
    const [page, setPage] = useState(1);
    const [pageSize] = useState(DEFAULT_PAGE_SIZE);
    const [total, setTotal] = useState(0);
    const [totalPages, setTotalPages] = useState(0);
    // 多选模式状态
    const [isSelectMode, setIsSelectMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [isDeleting, setIsDeleting] = useState(false);
    // 自定义题目来源
    const [customQuestionSources, setCustomQuestionSources] = useState<string[]>([]);
    const [sourcePopoverOpen, setSourcePopoverOpen] = useState(false);
    // 排序状态
    const [sortBy, setSortBy] = useState<string>("createdAt");
    const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
    const { t, language } = useLanguage();
    const router = useRouter();

    const handleExportPrint = () => {
        const params = new URLSearchParams();
        if (subjectId) params.append("subjectId", subjectId);
        if (search) params.append("query", search);
        if (masteryFilter !== "all") {
            params.append("mastery", masteryFilter === "mastered" ? "1" : "0");
        }
        if (timeFilter !== "all") {
            params.append("timeRange", timeFilter);
        }
        if (selectedTags.length > 0) {
            params.append("tags", selectedTags.join(","));
        }
        if (gradeFilter) params.append("gradeSemester", gradeFilter);
        if (chapterFilter) params.append("chapter", chapterFilter); // 章节筛选
        if (paperLevelFilter !== "all") params.append("paperLevel", paperLevelFilter);

        // 如果是多选模式且有选中的题目，传递选中的题目ID
        if (isSelectMode && selectedIds.size > 0) {
            params.append("selectedIds", Array.from(selectedIds).join(","));
        }

        router.push(`/print-preview?${params.toString()}`);
    };

    const handleTagClick = (tag: string) => {
        setSelectedTags(prev => {
            if (prev.includes(tag)) {
                return prev.filter(t => t !== tag);
            } else {
                return [...prev, tag];
            }
        });
    };

    // 从当前页面的题目中提取所有唯一的标签
    const extractUniqueTags = (items: ErrorItem[]): string[] => {
        const tagSet = new Set<string>();
        items.forEach(item => {
            // 从 tags 关联中提取
            if (item.tags && Array.isArray(item.tags)) {
                item.tags.forEach(tag => tagSet.add(tag.name));
            }
            // 从 knowledgePoints 字段中提取（兼容旧数据）
            if (item.knowledgePoints) {
                try {
                    const parsed = JSON.parse(item.knowledgePoints);
                    if (Array.isArray(parsed)) {
                        parsed.forEach(tag => typeof tag === 'string' && tagSet.add(tag));
                    }
                } catch (e) {
                    // 忽略解析错误
                }
            }
        });
        return Array.from(tagSet).sort();
    };

    // 全选/取消全选标签
    const handleSelectAllTags = () => {
        const allTags = extractUniqueTags(items);
        if (selectedTags.length === allTags.length) {
            setSelectedTags([]);
        } else {
            setSelectedTags(allTags);
        }
    };

    const handleFilterChange = ({ gradeSemester, chapter, tags }: KnowledgeFilterChange) => {
        if (gradeSemester !== undefined) setGradeFilter(gradeSemester);
        if (chapter !== undefined) setChapterFilter(chapter);
        if (tags !== undefined) setSelectedTags(tags);

        // Clear dependent filters and reset page
        if (!gradeSemester) {
            setGradeFilter("");
            setChapterFilter("");
            setSelectedTags([]);
        } else if (!chapter) {
            setChapterFilter("");
        }
        setPage(1); // 筛选变化时重置页码
    };

    // 使用服务端 items 直接渲染，章节过滤已在 KnowledgeFilter 中通过 tag 实现
    const filteredItems = items;

    const toggleTagsExpanded = (itemId: string, e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setExpandedTags(prev => {
            const newSet = new Set(prev);
            if (newSet.has(itemId)) {
                newSet.delete(itemId);
            } else {
                newSet.add(itemId);
            }
            return newSet;
        });
    };

    // 多选模式相关函数
    const toggleSelectMode = () => {
        setIsSelectMode(!isSelectMode);
        setSelectedIds(new Set());
    };

    const toggleSelectItem = (id: string, e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIds(prev => {
            const newSet = new Set(prev);
            if (newSet.has(id)) {
                newSet.delete(id);
            } else {
                newSet.add(id);
            }
            return newSet;
        });
    };

    const handleBatchDelete = async () => {
        if (selectedIds.size === 0) return;

        const confirmMsg = (t.notebook?.confirmBatchDelete || "Delete {count} items?")
            .replace("{count}", selectedIds.size.toString());
        if (!confirm(confirmMsg)) return;

        setIsDeleting(true);
        try {
            await apiClient.post("/api/error-items/batch-delete", {
                ids: Array.from(selectedIds),
            });
            alert(t.notebook?.batchDeleteSuccess || "Deleted successfully");
            setIsSelectMode(false);
            setSelectedIds(new Set());
            fetchItems();
        } catch (error) {
            console.error(error);
            alert(t.common?.messages?.deleteFailed || "Delete failed");
        } finally {
            setIsDeleting(false);
        }
    };

    const toggleSelectAll = () => {
        if (selectedIds.size === items.length) {
            // 如果已全选，则取消全选
            setSelectedIds(new Set());
        } else {
            // 否则全选当前页的所有项目
            setSelectedIds(new Set(items.map(item => item.id)));
        }
    };

    const toggleSortOrder = () => {
        setSortOrder(sortOrder === "desc" ? "asc" : "desc");
    };

    // 追踪筛选条件是否变化（用于判断是否需要重置页码）
    const prevFiltersRef = useRef({ search, masteryFilter, timeFilter, selectedTags, subjectId, gradeFilter, chapterFilter, paperLevelFilter, sortBy, sortOrder });

    // 获取自定义题目来源
    useEffect(() => {
        const fetchCustomSources = async () => {
            try {
                const sources = await apiClient.get<{ id: string; name: string }[]>("/api/question-sources");
                setCustomQuestionSources(sources.map(s => s.name));
            } catch (error) {
                console.error("Failed to fetch custom question sources:", error);
                setCustomQuestionSources([]);
            }
        };

        fetchCustomSources();
    }, []);

    useEffect(() => {
        const prevFilters = prevFiltersRef.current;
        const filtersChanged =
            prevFilters.search !== search ||
            prevFilters.masteryFilter !== masteryFilter ||
            prevFilters.timeFilter !== timeFilter ||
            prevFilters.selectedTags !== selectedTags ||
            prevFilters.subjectId !== subjectId ||
            prevFilters.gradeFilter !== gradeFilter ||
            prevFilters.chapterFilter !== chapterFilter ||
            prevFilters.paperLevelFilter !== paperLevelFilter ||
            prevFilters.sortBy !== sortBy ||
            prevFilters.sortOrder !== sortOrder;

        // 更新 ref
        prevFiltersRef.current = { search, masteryFilter, timeFilter, selectedTags, subjectId, gradeFilter, chapterFilter, paperLevelFilter, sortBy, sortOrder };

        if (filtersChanged && page !== 1) {
            // 筛选条件变化且不在第一页，重置到第一页（会再次触发此 effect）
            setPage(1);
            return;
        }

        // 正常请求数据
        fetchItems();
    }, [page, search, masteryFilter, timeFilter, selectedTags, subjectId, gradeFilter, chapterFilter, paperLevelFilter, sortBy, sortOrder]);

    const fetchItems = async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (subjectId) params.append("subjectId", subjectId);
            if (search) params.append("query", search);
            if (masteryFilter !== "all") {
                params.append("mastery", masteryFilter === "mastered" ? "1" : "0");
            }
            if (timeFilter !== "all") {
                params.append("timeRange", timeFilter);
            }
            if (selectedTags.length > 0) {
                params.append("tags", selectedTags.join(","));
            }
            if (gradeFilter) params.append("gradeSemester", gradeFilter);
            if (chapterFilter) params.append("chapter", chapterFilter); // 章节筛选
            if (paperLevelFilter !== "all") params.append("paperLevel", paperLevelFilter);
            // 排序参数
            params.append("sortBy", sortBy);
            params.append("sortOrder", sortOrder);
            // 分页参数
            params.append("page", page.toString());
            params.append("pageSize", pageSize.toString());

            const response = await apiClient.get<PaginatedResponse<ErrorItem>>(`/api/error-items/list?${params.toString()}`);
            setItems(response.items);
            setTotal(response.total);
            setTotalPages(response.totalPages);
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row gap-4">
                <div className="relative w-full sm:flex-1">
                    <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder={t.notebook.search}
                        className="pl-9"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline">
                            <Filter className="mr-2 h-4 w-4" />
                            {t.notebook.filter}
                            <ChevronDown className="ml-2 h-4 w-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuLabel>{t.filter.masteryStatus || "Mastery Status"}</DropdownMenuLabel>
                        <DropdownMenuItem onClick={() => setMasteryFilter("all")}>
                            {masteryFilter === "all" && "✓ "}{t.filter.all || "All"}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setMasteryFilter("unmastered")}>
                            {masteryFilter === "unmastered" && "✓ "}{t.filter.review || "To Review"}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setMasteryFilter("mastered")}>
                            {masteryFilter === "mastered" && "✓ "}{t.filter.mastered || "Mastered"}
                        </DropdownMenuItem>

                        <DropdownMenuSeparator />

                        <DropdownMenuLabel>{t.filter.timeRange || "Time Range"}</DropdownMenuLabel>
                        <DropdownMenuItem onClick={() => setTimeFilter("all")}>
                            {timeFilter === "all" && "✓ "}{t.filter.allTime || "All Time"}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setTimeFilter("week")}>
                            {timeFilter === "week" && "✓ "}{t.filter.lastWeek || "Last Week"}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setTimeFilter("month")}>
                            {timeFilter === "month" && "✓ "}{t.filter.lastMonth || "Last Month"}
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
                <Button variant="outline" onClick={handleExportPrint}>
                    <Printer className="mr-2 h-4 w-4" />
                    {isSelectMode && selectedIds.size > 0
                        ? `导出打印 (${selectedIds.size})`
                        : (t.notebook?.exportPrint || "导出打印")}
                </Button>
                <Button
                    variant="outline"
                    onClick={toggleSortOrder}
                    title={sortOrder === "desc" ? "切换为升序" : "切换为降序"}
                >
                    <ArrowUpDown className="mr-2 h-4 w-4" />
                    {sortOrder === "desc" ? "最新→最早" : "最早→最新"}
                </Button>
                <Button
                    variant={isSelectMode ? "secondary" : "outline"}
                    onClick={toggleSelectMode}
                >
                    <ListChecks className="mr-2 h-4 w-4" />
                    {isSelectMode ? (t.notebook?.cancelSelect || "取消") : (t.notebook?.selectMode || "多选")}
                </Button>
            </div>

            {/* Advanced Filters Row */}
            <div className="flex flex-col sm:flex-row gap-4 items-stretch sm:items-center">
                <div className="w-full sm:w-auto">
                    <KnowledgeFilter
                        gradeSemester={gradeFilter}
                        tags={selectedTags}
                        onFilterChange={handleFilterChange}
                        subjectName={subjectName}
                        availableTags={extractUniqueTags(items)}
                    />
                </div>
                <div className="flex flex-wrap gap-2">
                    <Popover open={sourcePopoverOpen} onOpenChange={setSourcePopoverOpen}>
                        <PopoverTrigger asChild>
                            <Button
                                variant={paperLevelFilter === "all" ? "secondary" : "outline"}
                                size="sm"
                                className="min-w-[100px]"
                            >
                                {paperLevelFilter === "all" ? (t.filter.all || "全部") : paperLevelFilter}
                                <ChevronDownIcon className="ml-2 h-4 w-4" />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[200px] p-0">
                            <div className="max-h-[300px] overflow-y-auto p-1">
                                <div className="px-2 py-1.5 text-sm font-semibold text-muted-foreground">
                                    预设选项
                                </div>
                                <Button
                                    variant="ghost"
                                    className={`w-full justify-start px-2 ${paperLevelFilter === "all" ? "bg-secondary" : ""}`}
                                    size="sm"
                                    onClick={() => {
                                        setPaperLevelFilter("all");
                                        setSourcePopoverOpen(false);
                                    }}
                                >
                                    {t.filter.all || "全部"}
                                </Button>
                                {["模拟考试", "期中考试", "期末考试"].map(source => (
                                    <Button
                                        key={source}
                                        variant="ghost"
                                        className={`w-full justify-start px-2 ${paperLevelFilter === source ? "bg-secondary" : ""}`}
                                        size="sm"
                                        onClick={() => {
                                            setPaperLevelFilter(source);
                                            setSourcePopoverOpen(false);
                                        }}
                                    >
                                        {source}
                                    </Button>
                                ))}
                                {customQuestionSources.length > 0 && (
                                    <>
                                        <div className="px-2 py-1.5 text-sm font-semibold text-muted-foreground mt-2">
                                            自定义来源
                                        </div>
                                        {customQuestionSources.map(source => (
                                            <Button
                                                key={source}
                                                variant="ghost"
                                                className={`w-full justify-start px-2 ${paperLevelFilter === source ? "bg-secondary" : ""}`}
                                                size="sm"
                                                onClick={() => {
                                                    setPaperLevelFilter(source);
                                                    setSourcePopoverOpen(false);
                                                }}
                                            >
                                                {source}
                                            </Button>
                                        ))}
                                    </>
                                )}
                            </div>
                        </PopoverContent>
                    </Popover>
                </div>
            </div>

            {selectedTags.length > 0 && (
                <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
                    <span className="text-sm text-muted-foreground">
                        {t.filter.filteringByTag || "Filtering by tags"}:
                    </span>
                    <div className="flex flex-wrap gap-1">
                        {selectedTags.map(tag => (
                            <Badge key={tag} variant="secondary" className="cursor-pointer" onClick={() => handleTagClick(tag)}>
                                {tag}
                                <span className="ml-1 text-xs">×</span>
                            </Badge>
                        ))}
                    </div>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={() => setSelectedTags([])}
                    >
                        {t.filter.clear || "Clear"}
                    </Button>
                </div>
            )}

            {/* 多选模式下的全选提示 */}
            {isSelectMode && (
                <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
                    <Checkbox
                        checked={selectedIds.size === items.length && items.length > 0}
                        onCheckedChange={toggleSelectAll}
                        className="h-5 w-5 border-2 bg-background shadow-sm"
                    />
                    <span className="text-sm text-muted-foreground">
                        {selectedIds.size === items.length ? "已全选当前页" : "点击全选当前页所有项目"}
                    </span>
                </div>
            )}

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {filteredItems.map((item) => {
                    // 优先使用 tags 关联，回退到 knowledgePoints
                    let tags: string[] = [];
                    if (item.tags && item.tags.length > 0) {
                        tags = item.tags.map((tag) => tag.name);
                    } else {
                        try {
                            tags = JSON.parse(item.knowledgePoints || "[]");
                        } catch {
                            tags = [];
                        }
                    }
                    return (
                        <div key={item.id} className="relative">
                            {/* 选择模式下的复选框 */}
                            {isSelectMode && (
                                <div
                                    className="absolute top-2 left-2 z-10"
                                    onClick={(e) => toggleSelectItem(item.id, e)}
                                >
                                    <Checkbox
                                        checked={selectedIds.has(item.id)}
                                        className="h-5 w-5 border-2 bg-background shadow-sm"
                                    />
                                </div>
                            )}
                            <Link href={isSelectMode ? "#" : `/error-items/${item.id}`} onClick={(e) => isSelectMode && e.preventDefault()}>
                                <Card className="h-full hover:border-primary/50 transition-colors cursor-pointer gap-2 pt-4">
                                    <CardHeader className="pb-0">
                                        <div className="flex justify-between items-start">
                                            <Badge
                                                variant={item.masteryLevel > 0 ? "default" : "secondary"}
                                                className={item.masteryLevel > 0 ? "bg-green-600 hover:bg-green-700" : ""}
                                            >
                                                {item.masteryLevel > 0 ? (
                                                    <span className="flex items-center gap-1">
                                                        <CheckCircle className="h-3 w-3" /> {t.notebook.mastered}
                                                    </span>
                                                ) : (
                                                    <span className="flex items-center gap-1">
                                                        <Clock className="h-3 w-3" /> {t.notebook.review}
                                                    </span>
                                                )}
                                            </Badge>
                                            <span className="text-xs text-muted-foreground">
                                                {format(new Date(item.createdAt), "MM/dd HH:mm")}
                                            </span>
                                        </div>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="text-sm line-clamp-3">
                                            {(() => {
                                                // 提取文本并清理 LaTeX/Markdown 格式
                                                const rawText = (item.questionText || "").split('\n\n')[0]; // 取第一段
                                                const cleanText = cleanMarkdown(rawText);

                                                return cleanText.length > 80
                                                    ? cleanText.substring(0, 80) + "..."
                                                    : cleanText;
                                            })()}
                                        </div>
                                        <div className="flex flex-wrap gap-2 mt-3">
                                            <Badge
                                                variant={item.mistakeStatus === "focus" ? "default" : item.mistakeStatus === "wrong_attempt" ? "default" : "secondary"}
                                                className={item.mistakeStatus === "focus" ? "text-xs bg-red-100 border-red-300 text-red-800" : "text-xs"}
                                            >
                                                {getMistakeStatusLabel(item.mistakeStatus, language)}
                                            </Badge>
                                            {(item.analysis || item.analysisImages) && (
                                                <Badge variant="outline" className="text-xs bg-blue-50 border-blue-200 text-blue-700">
                                                    解析
                                                </Badge>
                                            )}
                                            {(item.answerText || item.answerImages) && (
                                                <Badge variant="outline" className="text-xs bg-green-50 border-green-200 text-green-700">
                                                    做题答案
                                                </Badge>
                                            )}
                                        </div>
                                        <div className="flex flex-wrap gap-2 mt-3">
                                            {(expandedTags.has(item.id) ? tags : tags.slice(0, 3)).map((tag: string) => (
                                                <Badge
                                                    key={tag}
                                                    variant={selectedTags.includes(tag) ? "default" : "outline"}
                                                    className="text-xs cursor-pointer hover:bg-primary/10 transition-colors"
                                                    onClick={(e) => {
                                                        e.preventDefault();
                                                        handleTagClick(tag);
                                                    }}
                                                >
                                                    {tag}
                                                </Badge>
                                            ))}
                                            {tags.length > 3 && (
                                                <Badge
                                                    variant="secondary"
                                                    className="text-xs cursor-pointer hover:bg-secondary/80 transition-colors"
                                                    title={expandedTags.has(item.id)
                                                        ? (t.notebooks?.collapseTagsTooltip || "Click to collapse")
                                                        : (t.notebooks?.expandTagsTooltip || "Click to expand {count} tags").replace("{count}", (tags.length - 3).toString())}
                                                    onClick={(e) => toggleTagsExpanded(item.id, e)}
                                                >
                                                    {expandedTags.has(item.id) ? (
                                                        <>{t.notebooks?.collapseTags || "Collapse"}</>
                                                    ) : (
                                                        <>{(t.notebooks?.expandTags || "+{count} more").replace("{count}", (tags.length - 3).toString())}</>
                                                    )}
                                                </Badge>
                                            )}
                                            {item.paperLevel && (
                                                <Badge variant="outline" className="text-xs bg-purple-50 border-purple-200 text-purple-700">
                                                    {item.paperLevel}
                                                </Badge>
                                            )}
                                        </div>
                                    </CardContent>
                                </Card>
                            </Link>
                        </div>
                    );
                })}
            </div>

            {/* 分页器 */}
            <Pagination
                page={page}
                totalPages={totalPages}
                total={total}
                pageSize={pageSize}
                onPageChange={setPage}
            />

            {/* 多选模式底部操作栏 */}
            {isSelectMode && (
                <div className="fixed bottom-0 left-0 right-0 bg-background border-t shadow-lg p-4 z-50">
                    <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
                        <div className="flex items-center gap-4">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={toggleSelectAll}
                            >
                                {selectedIds.size === items.length ? (
                                    <>
                                        <span className="mr-2">☐</span>
                                        取消全选
                                    </>
                                ) : (
                                    <>
                                        <span className="mr-2">☑</span>
                                        全选
                                    </>
                                )}
                            </Button>
                            <span className="text-sm text-muted-foreground">
                                {(t.notebook?.selectedCount || "{count} selected").replace("{count}", selectedIds.size.toString())}
                            </span>
                        </div>
                        <div className="flex gap-2">
                            <Button
                                variant="outline"
                                onClick={toggleSelectMode}
                            >
                                <X className="mr-2 h-4 w-4" />
                                {t.notebook?.cancelSelect || "取消"}
                            </Button>
                            <Button
                                variant="destructive"
                                onClick={handleBatchDelete}
                                disabled={selectedIds.size === 0 || isDeleting}
                            >
                                <Trash2 className="mr-2 h-4 w-4" />
                                {t.notebook?.deleteSelected || "删除选中"}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
