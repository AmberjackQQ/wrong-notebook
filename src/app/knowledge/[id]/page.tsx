"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BackButton } from "@/components/ui/back-button";
import { Download, ExternalLink } from "lucide-react";

import { KnowledgeDoc } from "@/types/api";
import { apiClient } from "@/lib/api-client";
import { formatFileSize } from "@/lib/utils";
import { useLanguage } from "@/contexts/LanguageContext";

export default function KnowledgeViewerPage() {
    const params = useParams();
    const id = params.id as string;
    const { t } = useLanguage();
    const k = t.knowledge;
    const [doc, setDoc] = useState<KnowledgeDoc | null>(null);
    const [loading, setLoading] = useState(true);
    const [notFound, setNotFound] = useState(false);

    useEffect(() => {
        if (!id) return;
        apiClient.get<KnowledgeDoc>(`/api/knowledge/${id}`)
            .then(setDoc)
            .catch(() => setNotFound(true))
            .finally(() => setLoading(false));
    }, [id]);

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <p className="text-muted-foreground">{t.common.loading}</p>
            </div>
        );
    }

    if (notFound || !doc) {
        return (
            <main className="min-h-screen flex items-center justify-center p-4">
                <div className="text-center space-y-4">
                    <p className="text-muted-foreground">{k?.errors?.notFound || "Document not found"}</p>
                    <Link href="/knowledge">
                        <Button variant="outline">{t.common.back || "Back"}</Button>
                    </Link>
                </div>
            </main>
        );
    }

    const fileUrl = `/api/knowledge/${id}/file`;

    return (
        <main className="min-h-screen p-4 md:p-8 bg-background">
            <div className="max-w-6xl mx-auto space-y-4">
                <div className="flex items-start gap-4">
                    <BackButton fallbackUrl="/knowledge" />
                    <div className="flex-1 min-w-0 space-y-1">
                        <h1 className="text-xl sm:text-2xl font-bold tracking-tight truncate" title={doc.displayName}>
                            {doc.displayName}
                        </h1>
                        <div className="flex items-center gap-2 flex-wrap text-sm text-muted-foreground">
                            <Badge variant="secondary">
                                {k?.docType?.[doc.docType as keyof typeof k.docType] || doc.docType}
                            </Badge>
                            {doc.subject?.name && <Badge variant="outline">{doc.subject.name}</Badge>}
                            <span>{formatFileSize(doc.size)}</span>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <a href={fileUrl} target="_blank" rel="noopener noreferrer">
                            <Button variant="outline" size="sm" className="hidden sm:flex">
                                <ExternalLink className="mr-2 h-4 w-4" />
                                {k?.viewer?.openInBrowser || "Open in browser"}
                            </Button>
                        </a>
                        <a href={`${fileUrl}?download=1`}>
                            <Button variant="outline" size="sm">
                                <Download className="mr-2 h-4 w-4" />
                                <span className="hidden sm:inline">{k?.viewer?.downloadFile || "Download"}</span>
                            </Button>
                        </a>
                    </div>
                </div>

                <iframe
                    src={fileUrl}
                    title={doc.displayName}
                    className="w-full h-[calc(100vh-12rem)] rounded-lg border bg-white"
                />
            </div>
        </main>
    );
}
