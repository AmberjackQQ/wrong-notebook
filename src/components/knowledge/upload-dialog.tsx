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
import { FileUp, Loader2 } from "lucide-react";

import { Notebook } from "@/types/api";
import { apiClient } from "@/lib/api-client";
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
    const [file, setFile] = useState<File | null>(null);
    const [displayName, setDisplayName] = useState("");
    const [docType, setDocType] = useState<string>("textbook");
    const [subjectId, setSubjectId] = useState<string>("none");
    const [uploading, setUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (open) {
            setFile(null);
            setDisplayName("");
            setDocType("textbook");
            setSubjectId(defaultSubjectId || "none");
        }
    }, [open, defaultSubjectId]);

    const stripPdfExt = (name: string) => name.replace(/\.pdf$/i, "");

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const picked = e.target.files?.[0] || null;
        e.target.value = "";
        if (!picked) return;
        if (!/\.pdf$/i.test(picked.name)) {
            alert(k?.dialog?.invalidType || "Only PDF files are supported");
            return;
        }
        if (picked.size > MAX_FILE_SIZE) {
            alert(k?.dialog?.tooLarge || "File too large (max 200MB)");
            return;
        }
        setFile(picked);
        if (!displayName.trim()) setDisplayName(stripPdfExt(picked.name));
    };

    const handleUpload = async () => {
        if (!file) {
            alert(k?.dialog?.noFile || "Please choose a PDF file");
            return;
        }
        setUploading(true);
        try {
            const fd = new FormData();
            fd.append("file", file);
            fd.append("docType", docType);
            fd.append("subjectId", subjectId === "none" ? "" : subjectId);
            if (displayName.trim()) fd.append("displayName", displayName.trim());
            await apiClient.upload("/api/knowledge", fd);
            onOpenChange(false);
            onUploaded();
        } catch (error: unknown) {
            console.error(error);
            const apiError = error as { data?: { message?: string } };
            alert(apiError.data?.message || k?.dialog?.uploadFailed || "Upload failed");
        } finally {
            setUploading(false);
        }
    };

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
                            {file && (
                                <span className="text-sm text-muted-foreground truncate">
                                    {file.name} ({(file.size / 1024 / 1024).toFixed(1)} MB)
                                </span>
                            )}
                        </div>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".pdf,application/pdf"
                            className="hidden"
                            onChange={handleFileChange}
                        />
                    </div>
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
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>{k?.dialog?.docTypeLabel || "Document Type"}</Label>
                            <Select value={docType} onValueChange={setDocType} disabled={uploading}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
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
                    <Button onClick={handleUpload} disabled={uploading || !file}>
                        {uploading ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                {k?.uploading || "Uploading..."}
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
