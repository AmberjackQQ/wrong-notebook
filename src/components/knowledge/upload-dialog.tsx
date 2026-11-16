"use client";

import { useEffect, useRef, useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { FileUp, Loader2, X } from "lucide-react";

import { Notebook } from "@/types/api";
import { apiClient } from "@/lib/api-client";
import { formatFileSize } from "@/lib/utils";
import { useLanguage } from "@/contexts/LanguageContext";

const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200MB
const DOC_TYPES = ["textbook", "guide", "exercise", "exam"] as const;

interface UploadDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    subjects: Notebook[];
    defaultSubjectId?: string;
    onUploaded: () => void;
}

export function UploadDialog({ open, onOpenChange, subjects, defaultSubjectId, onUploaded }: UploadDialogProps) {
    const { t } = useLanguage();
    const k = t.knowledge;
    const [files, setFiles] = useState<File[]>([]);
    const [displayName, setDisplayName] = useState("");
    const [docType, setDocType] = useState<string>("auto");
    const [subjectId, setSubjectId] = useState<string>("auto");
    const [uploading, setUploading] = useState(false);
    const [progress, setProgress] = useState({ current: 0, total: 0 });
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (open) {
            setFiles([]);
            setDisplayName("");
            setDocType("auto");
            setSubjectId(defaultSubjectId || "auto");
            setProgress({ current: 0, total: 0 });
        }
    }, [open, defaultSubjectId]);

    const stripPdfExt = (name: string) => name.replace(/\.pdf$/i, "");

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const picked = Array.from(e.target.files || []);
        e.target.value = "";
        if (picked.length === 0) return;

        const invalid = picked.filter((f) => !/\.pdf$/i.test(f.name));
        const oversized = picked.filter((f) => /\.pdf$/i.test(f.name) && f.size > MAX_FILE_SIZE);
        if (invalid.length > 0) {
            alert(`${invalid.map((f) => f.name).join("、")}: ${k?.dialog?.invalidType || "Only PDF files are supported"}`);
        }
        if (oversized.length > 0) {
            alert(`${oversized.map((f) => f.name).join("、")}: ${k?.dialog?.tooLarge || "File too large (max 200MB)"}`);
        }
        const valid = picked.filter((f) => /\.pdf$/i.test(f.name) && f.size <= MAX_FILE_SIZE);
        if (valid.length === 0) return;

        setFiles(valid);
        // 仅单文件时允许自定义显示名，默认取文件名；多文件一律用各自文件名
        if (valid.length === 1) {
            setDisplayName(stripPdfExt(valid[0].name));
        } else {
            setDisplayName("");
        }
    };

    const removeFile = (index: number) => {
        setFiles((prev) => {
            const next = prev.filter((_, i) => i !== index);
            if (next.length === 1) setDisplayName(stripPdfExt(next[0].name));
            else if (next.length === 0) setDisplayName("");
            return next;
        });
    };

    const handleUpload = async () => {
        if (files.length === 0) {
            alert(k?.dialog?.noFile || "Please choose a PDF file");
            return;
        }
        setUploading(true);
        setProgress({ current: 0, total: files.length });

        const failed: File[] = [];
        for (let i = 0; i < files.length; i++) {
            setProgress({ current: i + 1, total: files.length });
            try {
                const fd = new FormData();
                fd.append("file", files[i]);
                fd.append("docType", docType);
                fd.append("subjectId", subjectId === "none" ? "" : subjectId);
                // 单文件时应用自定义显示名；多文件由服务端默认取各自文件名
                if (files.length === 1 && displayName.trim()) {
                    fd.append("displayName", displayName.trim());
                }
                await apiClient.upload("/api/knowledge", fd);
            } catch (error: unknown) {
                console.error(error);
                failed.push(files[i]);
            }
        }

        setUploading(false);
        if (failed.length === 0) {
            onOpenChange(false);
            onUploaded();
        } else {
            // 失败的留在列表里可重试，成功的已入库
            setFiles(failed);
            alert(`${failed.map((f) => f.name).join("、")}: ${k?.dialog?.uploadFailed || "Upload failed"}`);
            if (failed.length < files.length) onUploaded();
        }
    };

    const hasMultiple = files.length > 1;

    return (
        <Dialog open={open} onOpenChange={(o) => { if (!uploading) onOpenChange(o); }}>
            <DialogContent className="max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{k?.dialog?.title || "Upload PDF Document"}</DialogTitle>
                    <DialogDescription>{k?.subtitle || ""}</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-2">
                    <div className="space-y-2">
                        <Label htmlFor="kb-file">{k?.dialog?.fileLabel || "PDF File"}</Label>
                        <div className="flex items-center gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                disabled={uploading}
                                onClick={() => fileInputRef.current?.click()}
                            >
                                <FileUp className="mr-2 h-4 w-4" />
                                {k?.dialog?.chooseFile || "Choose File"}
                            </Button>
                            {!hasMultiple && files.length === 1 && (
                                <span className="text-sm text-muted-foreground truncate">
                                    {files[0].name} ({formatFileSize(files[0].size)})
                                </span>
                            )}
                        </div>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".pdf,application/pdf"
                            multiple
                            className="hidden"
                            onChange={handleFileChange}
                        />
                        {hasMultiple && (
                            <div className="space-y-1">
                                {files.map((f, i) => (
                                    <div key={`${f.name}-${i}`} className="flex items-center gap-2 text-sm rounded border px-2 py-1.5">
                                        <span className="flex-1 min-w-0 truncate" title={f.name}>
                                            {f.name}
                                        </span>
                                        <span className="text-muted-foreground shrink-0">{formatFileSize(f.size)}</span>
                                        <button
                                            type="button"
                                            className="text-muted-foreground hover:text-destructive shrink-0 disabled:opacity-50"
                                            disabled={uploading}
                                            onClick={() => removeFile(i)}
                                            title={k?.dialog?.removeFile || "Remove"}
                                        >
                                            <X className="h-4 w-4" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                    {!hasMultiple && (
                        <div className="space-y-2">
                            <Label htmlFor="kb-display-name">{k?.dialog?.displayNameLabel || "Display Name"}</Label>
                            <Input
                                id="kb-display-name"
                                placeholder={k?.dialog?.displayNamePlaceholder || "Defaults to filename"}
                                value={displayName}
                                onChange={(e) => setDisplayName(e.target.value)}
                                maxLength={200}
                            />
                        </div>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>{k?.dialog?.docTypeLabel || "Document Type"}</Label>
                            <Select value={docType} onValueChange={setDocType} disabled={uploading}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="auto">
                                        {k?.docType?.auto || "Auto-detect"}
                                    </SelectItem>
                                    {DOC_TYPES.map((type) => (
                                        <SelectItem key={type} value={type}>
                                            {k?.docType?.[type] || type}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>{k?.dialog?.subjectLabel || "Subject"}</Label>
                            <Select value={subjectId} onValueChange={setSubjectId} disabled={uploading}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="auto">
                                        {k?.dialog?.subjectAuto || "Auto-match"}
                                    </SelectItem>
                                    <SelectItem value="none">
                                        {k?.filterUncategorized || "Uncategorized"}
                                    </SelectItem>
                                    {subjects.map((s) => (
                                        <SelectItem key={s.id} value={s.id}>
                                            {s.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={uploading}>
                        {t.common.cancel}
                    </Button>
                    <Button onClick={handleUpload} disabled={uploading || files.length === 0}>
                        {uploading ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                {(k?.dialog?.uploadProgress || "Uploading {current}/{total}...")
                                    .replace("{current}", String(progress.current))
                                    .replace("{total}", String(progress.total))}
                            </>
                        ) : (
                            (k?.upload || "Upload Document")
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
