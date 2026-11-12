"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BookOpen, CheckCircle, Clock, Languages, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface NotebookCardProps {
    id: string;
    name: string;
    type?: "error" | "vocab";
    errorCount: number;
    vocabCount?: number;
    reviewCount?: number;
    masteredCount?: number;
    reviewLabel?: string;
    masteredLabel?: string;
    onClick: () => void;
    onRename?: () => void;
    onDelete?: (id: string) => void;
    itemLabel?: string;
}

export function NotebookCard({ id, name, type = "error", errorCount, vocabCount = 0, reviewCount = 0, masteredCount = 0, reviewLabel = "待复习", masteredLabel = "已掌握", onClick, onRename, onDelete, itemLabel = "items" }: NotebookCardProps) {
    const isVocab = type === "vocab";
    const hasItems = isVocab ? vocabCount > 0 : errorCount > 0;
    return (
        <Card
            className="cursor-pointer hover:border-primary/50 transition-colors relative group"
            onClick={onClick}
        >
            <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                        {isVocab ? <Languages className="h-5 w-5 text-primary" /> : <BookOpen className="h-5 w-5 text-primary" />}
                        <CardTitle className="text-lg truncate">{name}</CardTitle>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        {onRename && (
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                className="h-8 w-8"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onRename();
                                }}
                            >
                                <Pencil className="h-4 w-4" />
                            </Button>
                        )}
                        {onDelete && (
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                className="h-8 w-8"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onDelete(id);
                                }}
                            >
                                <Trash2 className={`h-4 w-4 ${hasItems ? "text-muted-foreground" : "text-destructive"}`} />
                            </Button>
                        )}
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                <div className="flex items-center gap-2 flex-wrap">
                    {isVocab ? (
                        <Badge variant="secondary">
                            {vocabCount} {itemLabel}
                        </Badge>
                    ) : (
                        <>
                            <Badge variant="secondary">
                                {errorCount} {itemLabel}
                            </Badge>
                            <Badge variant="secondary" className="gap-1 text-amber-600" title={reviewLabel}>
                                <Clock className="h-3 w-3" /> {reviewCount} {reviewLabel}
                            </Badge>
                            <Badge className="gap-1 bg-green-600 hover:bg-green-700" title={masteredLabel}>
                                <CheckCircle className="h-3 w-3" /> {masteredCount} {masteredLabel}
                            </Badge>
                        </>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}
