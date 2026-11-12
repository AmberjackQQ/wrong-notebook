"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BookOpen, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Loader2, Search, Sparkles, Trash2 } from "lucide-react";

import { PaginatedResponse, VocabularyEntry } from "@/types/api";
import { apiClient } from "@/lib/api-client";
import { useLanguage } from "@/contexts/LanguageContext";

const PAGE_SIZE = 20;

// exchange 字段码 → 显示标签（顺序即展示顺序）
const EXCHANGE_KEY_ORDER: { key: string; labelKey: "pastTense" | "pastParticiple" | "presentParticiple" | "thirdPerson" | "plural" | "comparative" | "superlative" | "lemma" }[] = [
    { key: "p", labelKey: "pastTense" },
    { key: "d", labelKey: "pastParticiple" },
    { key: "i", labelKey: "presentParticiple" },
    { key: "3", labelKey: "thirdPerson" },
    { key: "s", labelKey: "plural" },
    { key: "r", labelKey: "comparative" },
    { key: "t", labelKey: "superlative" },
    { key: "0", labelKey: "lemma" },
];

interface ExchangeItem {
    key: string;
    value: string;
}

function parseExchange(exchange: string | null | undefined): ExchangeItem[] {
    if (!exchange) return [];
    const map = new Map<string, string[]>();
    for (const part of exchange.split("/")) {
        const idx = part.indexOf(":");
        if (idx <= 0) continue;
        const key = part.slice(0, idx);
        const value = part.slice(idx + 1);
        const list = map.get(key) || [];
        list.push(value);
        map.set(key, list);
    }
    return EXCHANGE_KEY_ORDER
        .filter(({ key }) => map.has(key))
        .map(({ key }) => ({ key, value: map.get(key)!.join(" / ") }));
}

function parseExamplesJson(json: string | null | undefined): { en: string; zh: string }[] {
    if (!json) return [];
    try {
        const parsed = JSON.parse(json);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

// 词性占比 "n:46/v:54" → "n 46% / v 54%"
function formatPos(pos: string | null | undefined): string {
    if (!pos) return "";
    return pos
        .split("/")
        .map((p) => {
            const idx = p.indexOf(":");
            if (idx <= 0) return p;
            return `${p.slice(0, idx)} ${p.slice(idx + 1)}%`;
        })
        .join(" / ");
}

interface VocabularyListProps {
    subjectId: string;
    refreshKey?: number;
}

export function VocabularyList({ subjectId, refreshKey = 0 }: VocabularyListProps) {
    const { t } = useLanguage();
    const v = t.vocabulary;
    const [entries, setEntries] = useState<VocabularyEntry[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [search, setSearch] = useState("");
    const [loading, setLoading] = useState(true);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [htmlOpenId, setHtmlOpenId] = useState<string | null>(null);
    const [generatingId, setGeneratingId] = useState<string | null>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const fetchEntries = useCallback(async (opts: { subjectId: string; query: string; page: number }) => {
        setLoading(true);
        try {
            const params = new URLSearchParams({
                subjectId: opts.subjectId,
                page: String(opts.page),
                pageSize: String(PAGE_SIZE),
            });
            if (opts.query) params.set("query", opts.query);
            const data = await apiClient.get<PaginatedResponse<VocabularyEntry>>(`/api/vocab?${params}`);
            setEntries(data.items);
            setTotal(data.total);
            setTotalPages(data.totalPages);
        } catch (error) {
            console.error("Failed to fetch vocab entries:", error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchEntries({ subjectId, query: search.trim(), page });
    }, [fetchEntries, subjectId, search, page, refreshKey]);

    // 翻页或刷新后回到第一页的搜索输入
    const handleSearchChange = (value: string) => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            setSearch(value);
            setPage(1);
        }, 300);
    };

    const handleDelete = async (entry: VocabularyEntry) => {
        if (!confirm((v?.deleteConfirm || '确定删除词条「{word}」？').replace("{word}", entry.word))) return;
        try {
            await apiClient.delete(`/api/vocab/${entry.id}`);
            fetchEntries({ subjectId, query: search.trim(), page });
        } catch (error) {
            console.error(error);
            alert(v?.deleteError || "删除失败");
        }
    };

    const handleGenerateExamples = async (entry: VocabularyEntry) => {
        setGeneratingId(entry.id);
        try {
            const updated = await apiClient.post<VocabularyEntry>(`/api/vocab/${entry.id}/examples`, {});
            setEntries((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
        } catch (error: unknown) {
            console.error(error);
            const apiError = error as { data?: { message?: string } };
            alert(apiError.data?.message || "AI 生成例句失败，请稍后重试");
        } finally {
            setGeneratingId(null);
        }
    };

    const hasDictInfo = (entry: VocabularyEntry) =>
        Boolean(entry.phonetic || entry.translation || entry.definition);

    return (
        <div className="space-y-4">
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                    placeholder={v?.searchPlaceholder || "搜索单词或释义..."}
                    value={search}
                    onChange={(e) => handleSearchChange(e.target.value)}
                    className="pl-9"
                />
            </div>

            {loading ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t.common.loading}
                </div>
            ) : entries.length === 0 ? (
                <div className="text-center py-12 border-2 border-dashed rounded-lg">
                    <p className="text-muted-foreground">{v?.empty || "还没有词汇"}</p>
                </div>
            ) : (
                <div className="space-y-2">
                    {entries.map((entry) => {
                        const expanded = expandedId === entry.id;
                        const aiExamples = parseExamplesJson(entry.aiExamples);
                        const oxfordExamples = parseExamplesJson(entry.oxfordExamples);
                        const exchangeItems = parseExchange(entry.exchange);
                        const posText = formatPos(entry.pos);
                        return (
                            <div key={entry.id} className="border rounded-lg overflow-hidden">
                                <div
                                    className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors"
                                    onClick={() => setExpandedId(expanded ? null : entry.id)}
                                >
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="font-semibold">{entry.word}</span>
                                            {entry.phonetic && (
                                                <span className="text-sm text-muted-foreground font-mono">/{entry.phonetic}/</span>
                                            )}
                                            {entry.collins ? (
                                                <span className="text-xs text-amber-600" title={v?.collinsLabel}>{"★".repeat(entry.collins)}</span>
                                            ) : null}
                                            {entry.oxford ? (
                                                <Badge variant="outline" className="text-xs px-1.5 py-0">{v?.oxfordLabel || "牛津三千"}</Badge>
                                            ) : null}
                                        </div>
                                        {entry.translation && (
                                            <p className="text-sm text-muted-foreground truncate mt-0.5">
                                                {entry.translation.split("\n")[0]}
                                            </p>
                                        )}
                                    </div>
                                    {expanded ? (
                                        <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
                                    ) : (
                                        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                                    )}
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 shrink-0"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleDelete(entry);
                                        }}
                                    >
                                        <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                                    </Button>
                                </div>

                                {expanded && (
                                    <div className="px-4 pb-4 pt-1 space-y-3 border-t bg-muted/20 text-sm">
                                        {!hasDictInfo(entry) && (
                                            <p className="text-xs text-muted-foreground pt-2">{v?.dictMissing || "词典未收录该词"}</p>
                                        )}
                                        {posText && (
                                            <p className="text-muted-foreground">{posText}</p>
                                        )}
                                        {oxfordExamples.length > 0 && (
                                            <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/40 p-3">
                                                <p className="text-xs font-medium text-amber-700 dark:text-amber-400 mb-1.5">{v?.oxfordExamplesTitle || "牛津例句"}</p>
                                                <ul className="space-y-1.5 list-disc list-inside">
                                                    {oxfordExamples.map((ex, i) => (
                                                        <li key={i}>
                                                            {ex.en}
                                                            <span className="block text-muted-foreground text-xs">{ex.zh}</span>
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}
                                        {entry.oxfordHtml && (
                                            <div>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    className="h-7 text-xs"
                                                    onClick={() => setHtmlOpenId(htmlOpenId === entry.id ? null : entry.id)}
                                                >
                                                    <BookOpen className="mr-1 h-3 w-3" />
                                                    {htmlOpenId === entry.id
                                                        ? (v?.hideOxfordEntry || "收起")
                                                        : (v?.showOxfordEntry || "展开")}
                                                    {v?.oxfordFullEntry || "完整牛津释义"}
                                                </Button>
                                                {htmlOpenId === entry.id && (
                                                    <div
                                                        className="oxford-html mt-2 rounded-md border p-3 bg-background"
                                                        dangerouslySetInnerHTML={{ __html: entry.oxfordHtml }}
                                                    />
                                                )}
                                            </div>
                                        )}
                                        {entry.translation && (
                                            <div>
                                                <p className="text-xs font-medium text-muted-foreground mb-1">{v?.translationLabel || "中文释义"}</p>
                                                <div className="whitespace-pre-wrap">{entry.translation}</div>
                                            </div>
                                        )}
                                        {entry.definition && (
                                            <div>
                                                <p className="text-xs font-medium text-muted-foreground mb-1">{v?.definitionLabel || "英英释义"}</p>
                                                <div className="whitespace-pre-wrap">{entry.definition}</div>
                                            </div>
                                        )}
                                        {exchangeItems.length > 0 && (
                                            <div>
                                                <p className="text-xs font-medium text-muted-foreground mb-1">{v?.forms || "词形变化"}</p>
                                                <div className="flex flex-wrap gap-x-4 gap-y-1">
                                                    {exchangeItems.map((item) => {
                                                        const order = EXCHANGE_KEY_ORDER.find(({ key }) => key === item.key);
                                                        const label = order ? (v?.[order.labelKey] as string | undefined) : undefined;
                                                        return (
                                                            <span key={item.key}>
                                                                <span className="text-muted-foreground">{label || item.key}：</span>
                                                                {item.value}
                                                            </span>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}
                                        {entry.tags && (
                                            <div>
                                                <p className="text-xs font-medium text-muted-foreground mb-1">{v?.examTagsLabel || "考试标签"}</p>
                                                <div className="flex flex-wrap gap-1">
                                                    {entry.tags.split(/\s+/).filter(Boolean).map((tag) => (
                                                        <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                        {entry.sentence && (
                                            <div>
                                                <p className="text-xs font-medium text-muted-foreground mb-1">{v?.sentenceTitle || "我的例句"}</p>
                                                <div className="whitespace-pre-wrap">{entry.sentence}</div>
                                            </div>
                                        )}
                                        {entry.note && (
                                            <div>
                                                <p className="text-xs font-medium text-muted-foreground mb-1">{v?.noteTitle || "笔记"}</p>
                                                <div className="whitespace-pre-wrap">{entry.note}</div>
                                            </div>
                                        )}
                                        <div>
                                            <div className="flex items-center gap-2 mb-1">
                                                <p className="text-xs font-medium text-muted-foreground">{v?.aiExamplesTitle || "AI 例句"}</p>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    className="h-7 text-xs"
                                                    disabled={generatingId === entry.id}
                                                    onClick={() => handleGenerateExamples(entry)}
                                                >
                                                    {generatingId === entry.id ? (
                                                        <>
                                                            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                                            {v?.aiGenerating || "生成中..."}
                                                        </>
                                                    ) : (
                                                        <>
                                                            <Sparkles className="mr-1 h-3 w-3" />
                                                            {v?.aiGenerate || "AI 生成例句"}
                                                        </>
                                                    )}
                                                </Button>
                                            </div>
                                            {aiExamples.length > 0 ? (
                                                <ul className="space-y-1.5 list-disc list-inside">
                                                    {aiExamples.map((ex, i) => (
                                                        <li key={i}>
                                                            {ex.en}
                                                            <span className="block text-muted-foreground text-xs">{ex.zh}</span>
                                                        </li>
                                                    ))}
                                                </ul>
                                            ) : (
                                                <p className="text-xs text-muted-foreground">—</p>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={page <= 1}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                        <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-sm text-muted-foreground">
                        {page} / {totalPages} · {total}
                    </span>
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={page >= totalPages}
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    >
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                </div>
            )}
        </div>
    );
}
