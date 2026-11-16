"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { BackButton } from "@/components/ui/back-button";
import { Pagination } from "@/components/ui/pagination";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Eye, FileText, Pencil, Plus, Search, Trash2, Download } from "lucide-react";

import { KnowledgeDoc, Notebook, PaginatedResponse } from "@/types/api";
import { apiClient } from "@/lib/api-client";
import { formatFileSize } from "@/lib/utils";
import { useLanguage } from "@/contexts/LanguageContext";
import { UploadDialog } from "@/components/knowledge/upload-dialog";
import { RenameDocDialog } from "@/components/knowledge/rename-doc-dialog";

const PAGE_SIZE = 20;
const DOC_TYPES = ["textbook", "guide", "exercise", "exam"] as const;

export default function KnowledgePage() {
    const { t } = useLanguage();
    const k = t.knowledge;
    const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
    const [total, setTotal] = useState(0);
    const [totalPages, setTotalPages] = useState(1);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(false);

    const [subjects, setSubjects] = useState<Notebook[]>([]);
    const [subjectFilter, setSubjectFilter] = useState<string>("all");
    const [docTypeFilter, setDocTypeFilter] = useState<string>("all");
    const [searchInput, setSearchInput] = useState("");
    const [query, setQuery] = useState("");
    const [page, setPage] = useState(1);

    const [uploadOpen, setUploadOpen] = useState(false);
    const [renameTarget, setRenameTarget] = useState<KnowledgeDoc | null>(null);
    const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        apiClient.get<Notebook[]>("/api/notebooks")
            .then(setSubjects)
            .catch((e) => console.error("Failed to fetch subjects:", e));
    }, []);

    // 搜索防抖：输入停止 300ms 后才触发请求
    useEffect(() => {
        if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
        searchTimerRef.current = setTimeout(() => {
            setQuery(searchInput.trim());
            setPage(1);
        }, 300);
        return () => {
            if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
        };
    }, [searchInput]);

    const fetchDocs = useCallback(async () => {
        setLoading(true);
        setLoadError(false);
        try {
            const params = new URLSearchParams();
            if (subjectFilter !== "all") params.set("subjectId", subjectFilter);
            if (docTypeFilter !== "all") params.set("docType", docTypeFilter);
            if (query) params.set("query", query);
            params.set("page", String(page));
            params.set("pageSize", String(PAGE_SIZE));
            const data = await apiClient.get<PaginatedResponse<KnowledgeDoc>>(
                `/api/knowledge?${params.toString()}`
            );
            setDocs(data.items);
            setTotal(data.total);
            setTotalPages(data.totalPages);
        } catch (error) {
            console.error("Failed to fetch knowledge docs:", error);
            setLoadError(true);
        } finally {
            setLoading(false);
        }
    }, [subjectFilter, docTypeFilter, query, page]);

    useEffect(() => {
        fetchDocs();
    }, [fetchDocs]);

    const handleSubjectFilter = (value: string) => {
        setSubjectFilter(value);
        setPage(1);
    };

    const handleDocTypeFilter = (value: string) => {
        setDocTypeFilter(value);
        setPage(1);
    };

    const handleRename = async (name: string) => {
        if (!renameTarget) return;
        await apiClient.patch(`/api/knowledge/${renameTarget.id}`, { displayName: name });
        setRenameTarget(null);
        await fetchDocs();
    };

    const handleDelete = async (doc: KnowledgeDoc) => {
        if (!confirm((k?.deleteConfirm || 'Are you sure you want to delete "{name}"?').replace("{name}", doc.displayName))) return;
        try {
            const res = await apiClient.delete<{ success: boolean; fileDeleteFailed?: boolean }>(
                `/api/knowledge/${doc.id}`
            );
            if (res.fileDeleteFailed) {
                alert(k?.fileDeleteFailed || "Deleted, but the PDF file could not be removed from disk.");
            }
            await fetchDocs();
        } catch (error: unknown) {
            console.error(error);
            const apiError = error as { data?: { message?: string } };
            alert(apiError.data?.message || k?.errors?.loadFailed || "Failed");
        }
    };

    const chipClass = (active: boolean) =>
        `px-3 py-1.5 rounded-full text-sm border transition-colors whitespace-nowrap ${
            active
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-muted-foreground border-border hover:bg-accent"
        }`;

    return (
        <main className="min-h-screen p-4 md:p-8 bg-background">
            <div className="max-w-6xl mx-auto space-y-6">
                <div className="flex items-start gap-4">
                    <BackButton fallbackUrl="/upload" />
                    <div className="flex-1 space-y-1">
                        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
                            {k?.title || "Knowledge Base"}
                        </h1>
                        <p className="text-muted-foreground text-sm sm:text-base">
                            {k?.subtitle || ""}
                        </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <Button onClick={() => setUploadOpen(true)} size="sm" className="hidden sm:flex">
                            <Plus className="mr-2 h-4 w-4" />
                            {k?.upload || "Upload Document"}
                        </Button>
                        <Button onClick={() => setUploadOpen(true)} size="icon" className="sm:hidden">
                            <Plus className="h-4 w-4" />
                        </Button>
                    </div>
                </div>

                {/* 筛选行：学科 chips + 类型 + 搜索 */}
                <div className="space-y-3">
                    <div className="flex gap-2 overflow-x-auto pb-1">
                        <button
                            className={chipClass(subjectFilter === "all")}
                            onClick={() => handleSubjectFilter("all")}
                        >
                            {k?.filterAll || "All"}
                        </button>
                        {subjects.map((s) => (
                            <button
                                key={s.id}
                                className={chipClass(subjectFilter === s.id)}
                                onClick={() => handleSubjectFilter(s.id)}
                            >
                                {s.name}
                            </button>
                        ))}
                        <button
                            className={chipClass(subjectFilter === "none")}
                            onClick={() => handleSubjectFilter("none")}
                        >
                            {k?.filterUncategorized || "Uncategorized"}
                        </button>
                    </div>
                    <div className="flex gap-2">
                        <Select value={docTypeFilter} onValueChange={handleDocTypeFilter}>
                            <SelectTrigger className="w-[160px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">{k?.filterAll || "All"}</SelectItem>
                                {DOC_TYPES.map((type) => (
                                    <SelectItem key={type} value={type}>
                                        {k?.docType?.[type] || type}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                className="pl-9"
                                placeholder={k?.searchPlaceholder || "Search filename..."}
                                value={searchInput}
                                onChange={(e) => setSearchInput(e.target.value)}
                            />
                        </div>
                    </div>
                </div>

                {loadError ? (
                    <div className="text-center py-12 border-2 border-dashed rounded-lg">
                        <p className="text-muted-foreground">{k?.errors?.loadFailed || "Failed to load documents"}</p>
                    </div>
                ) : !loading && docs.length === 0 ? (
                    <div className="text-center py-12 border-2 border-dashed rounded-lg">
                        <p className="text-muted-foreground mb-4">{k?.empty || "No documents yet."}</p>
                        <Button onClick={() => setUploadOpen(true)}>
                            <Plus className="mr-2 h-4 w-4" />
                            {k?.upload || "Upload Document"}
                        </Button>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {docs.map((doc) => (
                            <div
                                key={doc.id}
                                className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                            >
                                <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
                                <Link
                                    href={`/knowledge/${doc.id}`}
                                    className="flex-1 min-w-0 hover:underline"
                                    title={doc.displayName}
                                >
                                    <span className="block font-medium truncate">{doc.displayName}</span>
                                    <span className="block text-xs text-muted-foreground truncate">
                                        {doc.filename} · {formatFileSize(doc.size)}
                                    </span>
                                </Link>
                                <Badge variant="secondary" className="hidden sm:inline-flex shrink-0">
                                    {k?.docType?.[doc.docType as keyof typeof k.docType] || doc.docType}
                                </Badge>
                                {doc.subject ? (
                                    <Badge variant="outline" className="hidden md:inline-flex shrink-0">
                                        {doc.subject.name}
                                    </Badge>
                                ) : (
                                    <Badge variant="outline" className="hidden md:inline-flex shrink-0 text-muted-foreground">
                                        {k?.filterUncategorized || "Uncategorized"}
                                    </Badge>
                                )}
                                <span className="hidden sm:inline text-xs text-muted-foreground shrink-0">
                                    {new Date(doc.createdAt).toLocaleDateString()}
                                </span>
                                <div className="flex items-center gap-1 shrink-0">
                                    <Link href={`/knowledge/${doc.id}`}>
                                        <Button variant="ghost" size="icon" className="h-8 w-8" title={k?.actions?.view || "View"}>
                                            <Eye className="h-4 w-4" />
                                        </Button>
                                    </Link>
                                    <a href={`/api/knowledge/${doc.id}/file?download=1`}>
                                        <Button variant="ghost" size="icon" className="h-8 w-8" title={k?.actions?.download || "Download"}>
                                            <Download className="h-4 w-4" />
                                        </Button>
                                    </a>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8"
                                        title={k?.actions?.rename || "Rename"}
                                        onClick={() => setRenameTarget(doc)}
                                    >
                                        <Pencil className="h-4 w-4" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                        title={k?.actions?.delete || "Delete"}
                                        onClick={() => handleDelete(doc)}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                        ))}
                        <Pagination
                            page={page}
                            totalPages={totalPages}
                            onPageChange={setPage}
                            total={total}
                            pageSize={PAGE_SIZE}
                        />
                    </div>
                )}

                <UploadDialog
                    open={uploadOpen}
                    onOpenChange={setUploadOpen}
                    subjects={subjects}
                    onUploaded={fetchDocs}
                />

                <RenameDocDialog
                    open={!!renameTarget}
                    onOpenChange={(open) => { if (!open) setRenameTarget(null); }}
                    currentName={renameTarget?.displayName || ""}
                    onRename={handleRename}
                />
            </div>
        </main>
    );
}
