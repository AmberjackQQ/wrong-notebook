"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { format } from "date-fns";
import { ArrowLeft, Clock, CheckCircle, FileText, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { apiClient } from "@/lib/api-client";

interface KnowledgeTag {
    id: string;
    name: string;
}

interface QuestionDetail {
    id: string;
    questionText: string;
    questionImages?: string | null; // JSON array of { id, dataUrl, name }
    knowledgePoints: string; // 旧数据兼容：JSON 字符串数组
    tags: KnowledgeTag[];
    masteryLevel: number;
    subject?: {
        id: string;
        name: string;
    } | null;
    gradeSemester?: string | null;
    paperLevel?: string | null;
    questionNumber?: string | null;
    printCount?: number;
    createdAt: string;
}

export default function QuestionDetailPage() {
    const params = useParams();
    const router = useRouter();
    const [item, setItem] = useState<QuestionDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        const fetchItem = async () => {
            try {
                const data = await apiClient.get<QuestionDetail>(`/api/error-items/${params.id}`);
                setItem(data);
            } catch (err) {
                console.error("Failed to fetch question detail:", err);
                setError("加载题目详情失败，请稍后重试");
            } finally {
                setLoading(false);
            }
        };
        fetchItem();
    }, [params.id]);

    const parseKnowledgeTags = (): string[] => {
        if (!item) return [];
        if (item.tags && item.tags.length > 0) return item.tags.map((t) => t.name);
        if (item.knowledgePoints) {
            try {
                const parsed = JSON.parse(item.knowledgePoints);
                return Array.isArray(parsed) ? parsed : [];
            } catch {
                return [];
            }
        }
        return [];
    };

    const parseQuestionImages = (): Array<{ dataUrl: string; name?: string }> => {
        if (!item?.questionImages) return [];
        try {
            const parsed = JSON.parse(item.questionImages);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (error || !item) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
                <p className="text-muted-foreground">{error || "题目不存在"}</p>
                <Button variant="outline" onClick={() => router.back()}>
                    <ArrowLeft className="mr-2 h-4 w-4" /> 回退
                </Button>
            </div>
        );
    }

    const knowledgeTags = parseKnowledgeTags();
    const questionImages = parseQuestionImages();

    return (
        <div className="max-w-4xl mx-auto p-4 space-y-6">
            {/* 顶部：试题信息 + 知识点信息 */}
            <Card>
                <CardHeader className="pb-0">
                    <div className="flex justify-between items-start">
                        <CardTitle className="text-xl">试题信息</CardTitle>
                        <Badge variant={item.masteryLevel > 0 ? "default" : "secondary"} className={item.masteryLevel > 0 ? "bg-green-600" : ""}>
                            {item.masteryLevel > 0 ? (
                                <span className="flex items-center gap-1">
                                    <CheckCircle className="h-3 w-3" /> 已掌握
                                </span>
                            ) : (
                                <span className="flex items-center gap-1">
                                    <Clock className="h-3 w-3" /> 待复习
                                </span>
                            )}
                        </Badge>
                    </div>
                </CardHeader>
                <CardContent className="space-y-4 pt-4">
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-2 text-sm">
                        <div>
                            <span className="text-muted-foreground">学科：</span>
                            <span>{item.subject?.name || "—"}</span>
                        </div>
                        <div>
                            <span className="text-muted-foreground">题目来源：</span>
                            <span>{item.paperLevel || "—"}</span>
                        </div>
                        <div>
                            <span className="text-muted-foreground">题号：</span>
                            <span>{item.questionNumber || "—"}</span>
                        </div>
                        <div>
                            <span className="text-muted-foreground">年级/学期：</span>
                            <span>{item.gradeSemester || "—"}</span>
                        </div>
                        <div>
                            <span className="text-muted-foreground">打印次数：</span>
                            <span>{item.printCount ?? 0}</span>
                        </div>
                        <div>
                            <span className="text-muted-foreground">记录时间：</span>
                            <span>{format(new Date(item.createdAt), "yyyy/MM/dd HH:mm")}</span>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <h4 className="text-sm font-semibold">知识点信息</h4>
                        {knowledgeTags.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                                {knowledgeTags.map((tag) => (
                                    <Badge key={tag} variant="outline" className="text-xs">
                                        {tag}
                                    </Badge>
                                ))}
                            </div>
                        ) : (
                            <p className="text-sm text-muted-foreground">（暂无知识点）</p>
                        )}
                    </div>
                </CardContent>
            </Card>

            {/* 中部：题目详情 */}
            <Card>
                <CardHeader className="pb-0">
                    <CardTitle className="text-xl">题目详情</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 pt-4">
                    {item.questionText?.trim() ? (
                        <MarkdownRenderer content={item.questionText} />
                    ) : (
                        <p className="text-sm text-muted-foreground">（无题目文字，请查看题目图片）</p>
                    )}
                    {questionImages.length > 0 && (
                        <div className="grid grid-cols-2 gap-3">
                            {questionImages.map((img, idx) => (
                                <img
                                    key={idx}
                                    src={img.dataUrl}
                                    alt={img.name || `题目图片 ${idx + 1}`}
                                    className="w-full rounded-lg border"
                                />
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* 底部按钮 */}
            <div className="flex gap-3">
                <Button variant="outline" onClick={() => router.back()}>
                    <ArrowLeft className="mr-2 h-4 w-4" /> 回退
                </Button>
                <Button onClick={() => router.push(`/error-items/${item.id}`)}>
                    <FileText className="mr-2 h-4 w-4" /> 错题详情
                </Button>
            </div>
        </div>
    );
}
