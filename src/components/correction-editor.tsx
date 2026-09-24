"use client";

import { useState, useEffect } from "react";
import { ParsedQuestion } from "@/lib/ai";
import { calculateGrade } from "@/lib/grade-calculator";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Save, Loader2, Box, Plus, X, ChevronDown, ScanText, Sparkles } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { frontendLogger } from "@/lib/frontend-logger";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { TagInput } from "@/components/tag-input";
import { NotebookSelector } from "@/components/notebook-selector";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiClient } from "@/lib/api-client";
import { UserProfile, Notebook } from "@/types/api";
import { inferSubjectFromName } from "@/lib/knowledge-tags";
import { normalizeMistakeStatusForSave, type MistakeStatus } from "@/lib/mistake-status";
import { GeogebraDemo } from "@/components/geogebra-demo";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RichTextEditorWithImage } from "@/components/rich-text-editor-with-image";

interface ParsedQuestionWithSubject extends ParsedQuestion {
    subjectId?: string;
    gradeSemester?: string;
    paperLevel?: string;
    questionNumber?: string;
    geogebraCommands?: string;
    answerImages?: string; // JSON string of answer images
    analysisImages?: string; // JSON string of analysis images
    answerTime?: string; // ISO string of when the answer was completed
}

interface CorrectionEditorProps {
    initialData: ParsedQuestion;
    onSave: (data: ParsedQuestionWithSubject) => Promise<void>;
    onCancel: () => void;
    imagePreview?: string | null;
    initialSubjectId?: string;
    initialPaperLevel?: string;
    initialGradeSemester?: string;
    aiTimeout?: number;
}

export function CorrectionEditor({ initialData, onSave, onCancel, imagePreview, initialSubjectId, initialPaperLevel, initialGradeSemester }: CorrectionEditorProps) {
    // Get current time in ISO format for default answer time
    const getCurrentTime = () => new Date().toISOString();

    const [data, setData] = useState<ParsedQuestionWithSubject>({
        ...initialData,
        wrongAnswerText: initialData.wrongAnswerText || "",
        mistakeAnalysis: initialData.mistakeAnalysis || "",
        mistakeStatus: initialData.mistakeStatus || "unknown",
        subjectId: initialSubjectId,
        gradeSemester: initialGradeSemester || "",
        paperLevel: initialPaperLevel || "模拟考试",
        questionNumber: "",
        answerTime: getCurrentTime()
    });

    // Debug: log initial data setup
    frontendLogger.info('[CorrectionEditor]', 'Initial state setup', {
        initialPaperLevel,
        initialGradeSemester,
        paperLevelInState: initialPaperLevel || "模拟考试",
        gradeSemesterInState: initialGradeSemester || ""
    });
    const { t, language } = useLanguage();
    const [isOcrRunning, setIsOcrRunning] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isAnalyzingGeogebra, setIsAnalyzingGeogebra] = useState(false);
    const [geogebraError, setGeogebraError] = useState<string | null>(null);
    const [isSuggestingTags, setIsSuggestingTags] = useState(false);
    const [tagsError, setTagsError] = useState<string | null>(null);
    const [newSourceName, setNewSourceName] = useState("");
    const [isAddingSource, setIsAddingSource] = useState(false);
    const [sourcePopoverOpen, setSourcePopoverOpen] = useState(false);
    const [hasInitializedPaperLevel, setHasInitializedPaperLevel] = useState(false);
    const [hasInitializedGradeSemester, setHasInitializedGradeSemester] = useState(false);

    // 图片状态管理
    const [answerImages, setAnswerImages] = useState<Array<{ id: string; dataUrl: string; name: string }>>([]);
    const [analysisImages, setAnalysisImages] = useState<Array<{ id: string; dataUrl: string; name: string }>>([]);
    // 解析OCR：识别解析图片的文字（飞桨 PaddleOCR），与题目OCR同一套路由
    const [isAnalysisOcrRunning, setIsAnalysisOcrRunning] = useState(false);

    const [educationStage, setEducationStage] = useState<string | undefined>(undefined);
    const [notebooks, setNotebooks] = useState<Notebook[]>([]);
    const [customQuestionSources, setCustomQuestionSources] = useState<string[]>([]);



    // Fetch user info and calculate grade on mount
    useEffect(() => {
        // Log pre-set paper level if provided
        if (initialPaperLevel) {
            frontendLogger.info('[CorrectionEditor]', 'Using pre-set paper level from list filters', {
                initialPaperLevel: initialPaperLevel
            });
        }

        // Log pre-set grade semester if provided
        if (initialGradeSemester) {
            frontendLogger.info('[CorrectionEditor]', 'Using pre-set grade semester from last submission', {
                initialGradeSemester: initialGradeSemester,
                willSetAs: initialGradeSemester
            });
        } else {
            frontendLogger.info('[CorrectionEditor]', 'No initial grade semester provided, will calculate from user profile');
        }

        // Fetch notebooks for mapping
        apiClient.get<Notebook[]>("/api/notebooks")
            .then(setNotebooks)
            .catch(err => console.error("Failed to fetch notebooks:", err));

        apiClient.get<UserProfile>("/api/user")
            .then(user => {
                if (user && user.educationStage && user.enrollmentYear) {
                    const grade = calculateGrade(user.educationStage, user.enrollmentYear, new Date(), language);
                    // Only auto-set gradeSemester if it's currently empty
                    setData(prev => {
                        if (!prev.gradeSemester || prev.gradeSemester.trim() === "") {
                            frontendLogger.info('[CorrectionEditor]', 'Auto-calculating grade from user profile', {
                                calculatedGrade: grade
                            });
                            return { ...prev, gradeSemester: grade };
                        }
                        frontendLogger.info('[CorrectionEditor]', 'Keeping existing gradeSemester, skipping auto-calculation', {
                            existingGrade: prev.gradeSemester,
                            calculatedGrade: grade
                        });
                        return prev;
                    });
                    setEducationStage(user.educationStage);
                }
            })
            .catch(err => console.error("Failed to fetch user info for grade calculation:", err));
    }, [language, initialPaperLevel, initialGradeSemester]);

    // 获取自定义题目来源：跟随所选科目（笔记本）过滤，
    // 只显示该笔记本内错题实际用过的来源，其他科目的来源不显示
    useEffect(() => {
        const url = data.subjectId
            ? `/api/question-sources?subjectId=${encodeURIComponent(data.subjectId)}`
            : "/api/question-sources";
        apiClient.get<{ id: string; name: string }[]>(url)
            .then(sources => {
                setCustomQuestionSources(sources.map(s => s.name));
            })
            .catch(err => {
                console.error("Failed to fetch custom question sources:", err);
                // If API fails (404), it's not a critical error, just means no custom sources yet
                setCustomQuestionSources([]);
            });
    }, [data.subjectId]);

    // Update paperLevel when initialPaperLevel becomes available (after localStorage loads)
    useEffect(() => {
        if (initialPaperLevel && !hasInitializedPaperLevel) {
            frontendLogger.info('[CorrectionEditor]', 'Initializing paperLevel from initialPaperLevel', {
                initialPaperLevel,
                currentValue: data.paperLevel
            });
            setData(prev => ({ ...prev, paperLevel: initialPaperLevel }));
            setHasInitializedPaperLevel(true);
        }
    }, [initialPaperLevel, hasInitializedPaperLevel]);

    // Update gradeSemester when initialGradeSemester becomes available (after localStorage loads)
    useEffect(() => {
        if (initialGradeSemester && !hasInitializedGradeSemester) {
            frontendLogger.info('[CorrectionEditor]', 'Initializing gradeSemester from initialGradeSemester', {
                initialGradeSemester,
                currentValue: data.gradeSemester
            });
            setData(prev => ({ ...prev, gradeSemester: initialGradeSemester }));
            setHasInitializedGradeSemester(true);
        }
    }, [initialGradeSemester, hasInitializedGradeSemester]);

    // OCR 识别题目图片：与错题详情页的同名功能一致——
    // 用飞桨 PaddleOCR 识别原始图片中的文字，结果直接填入题目文字编辑框
    const handleOcrQuestionImage = async () => {
        if (!imagePreview) {
            alert('没有可识别的题目图片');
            return;
        }

        setIsOcrRunning(true);
        try {
            // OCR 路由内部最长轮询飞桨任务 5 分钟（300s），客户端超时必须大于它，否则任务未完成即被中止
            const result = await apiClient.post<{ markdown: string }>('/api/ocr/paddle', {
                image: imagePreview,
            }, { timeout: 320000 });
            if (result.markdown) {
                // 识别结果直接填入题目文字（点击OCR即明确要用图片文字作为题目），保存时持久化
                setData(prev => ({ ...prev, questionText: result.markdown }));
            } else {
                alert('未识别到文字内容');
            }
        } catch (error: unknown) {
            console.error('OCR failed:', error);
            const apiError = error as { data?: { message?: string }; status?: number };
            const msg = apiError.data?.message || (error instanceof Error ? error.message : '');
            const friendly = msg.includes('AI_TIMEOUT_ERROR')
                ? '识别超时（题目较复杂或服务繁忙），请稍后重试'
                : msg || '请稍后重试';
            alert(`OCR 识别失败：${friendly}`);
        } finally {
            setIsOcrRunning(false);
        }
    };

    // OCR 识别解析图片：与题目OCR同款——识别解析图片中的文字，结果直接填入解析思路编辑框
    const handleOcrAnalysisImage = async () => {
        const image = analysisImages[0]?.dataUrl;
        if (!image) {
            alert('没有可识别的解析图片');
            return;
        }

        setIsAnalysisOcrRunning(true);
        try {
            // OCR 路由内部最长轮询飞桨任务 5 分钟（300s），客户端超时必须大于它，否则任务未完成即被中止
            const result = await apiClient.post<{ markdown: string }>('/api/ocr/paddle', {
                image,
            }, { timeout: 320000 });
            if (result.markdown) {
                // 识别结果直接填入解析思路（点击OCR即明确要用图片文字作为解析），保存时持久化
                setData(prev => ({ ...prev, analysis: result.markdown }));
            } else {
                alert('未识别到文字内容');
            }
        } catch (error: unknown) {
            console.error('Analysis OCR failed:', error);
            const apiError = error as { data?: { message?: string }; status?: number };
            const msg = apiError.data?.message || (error instanceof Error ? error.message : '');
            const friendly = msg.includes('AI_TIMEOUT_ERROR')
                ? '识别超时（题目较复杂或服务繁忙），请稍后重试'
                : msg || '请稍后重试';
            alert(`OCR 识别失败：${friendly}`);
        } finally {
            setIsAnalysisOcrRunning(false);
        }
    };

    const handleAnalyzeGeogebra = async () => {
        if (!data.questionText.trim()) {
            alert(t.editor.enterQuestionFirst || '请先输入题目文本');
            return;
        }
        if (!data.answerText.trim()) {
            alert('请先生成或输入答案');
            return;
        }

        setIsAnalyzingGeogebra(true);
        setGeogebraError(null);
        try {
            const response = await fetch("/api/geogebra-analyze", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    questionText: data.questionText,
                    answerText: data.answerText,
                    analysis: data.analysis,
                }),
            });

            if (!response.ok) {
                throw new Error("Analysis failed");
            }

            const result = await response.json();
            if (result.suitable && result.commands?.length > 0) {
                setData(prev => ({
                    ...prev,
                    geogebraCommands: JSON.stringify(result.commands),
                }));
            } else {
                setGeogebraError(result.description || "该题目不适合用 GeoGebra 演示");
            }
        } catch (error: any) {
            console.error("GeoGebra analysis failed:", error);
            setGeogebraError("分析失败，请稍后重试");
        } finally {
            setIsAnalyzingGeogebra(false);
        }
    };

    const handleSuggestTags = async () => {
        if (!data.questionText.trim()) {
            alert(t.editor.enterQuestionFirst || '请先输入题目文本');
            return;
        }

        const subjectKey = inferSubjectFromName(notebooks.find(n => n.id === data.subjectId)?.name || null)
            || inferSubjectFromName(data.subject || null)
            || undefined;

        setIsSuggestingTags(true);
        setTagsError(null);
        try {
            const response = await fetch("/api/ai/tags", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    questionText: data.questionText,
                    answerText: data.answerText,
                    analysis: data.analysis,
                    subject: subjectKey,
                    gradeSemester: data.gradeSemester || undefined,
                }),
            });

            const result = await response.json().catch(() => null);

            if (!response.ok) {
                throw new Error(result?.message || t.editor.tagsAiError || "知识点生成失败");
            }

            const tags: string[] = Array.isArray(result?.knowledgePoints) ? result.knowledgePoints : [];
            if (tags.length === 0) throw new Error(t.editor.tagsAiError || "知识点生成失败");

            // 与已输入标签合并去重，不丢用户手动输入项
            setData(prev => ({
                ...prev,
                knowledgePoints: Array.from(new Set([...prev.knowledgePoints, ...tags])),
            }));
        } catch (error) {
            console.error("Knowledge tags suggestion failed:", error);
            const message = error instanceof Error ? error.message : null;
            setTagsError(message || t.editor.tagsAiError || "知识点生成失败");
        } finally {
            setIsSuggestingTags(false);
        }
    };

    const handleAddCustomSource = async () => {
        const trimmedName = newSourceName.trim();
        if (!trimmedName) {
            alert('请输入来源名称');
            return;
        }

        if (customQuestionSources.includes(trimmedName)) {
            alert('该来源已存在');
            return;
        }

        setIsAddingSource(true);
        try {
            const response = await apiClient.post<{ id: string; name: string }>("/api/question-sources", { name: trimmedName });
            setCustomQuestionSources(prev => [...prev, response.name]);
            setData({ ...data, paperLevel: response.name });
            setNewSourceName("");
            setSourcePopoverOpen(false);
            frontendLogger.info('[CorrectionEditor]', 'Custom question source added', { name: response.name });
        } catch (error: any) {
            console.error("Failed to add custom source:", error);
            // 优先显示服务端返回的具体原因（apiClient 的 error.message 只有状态码摘要）
            alert(error.data?.message || error.message || '添加失败，请稍后重试');
        } finally {
            setIsAddingSource(false);
        }
    };

    const handleDeleteCustomSource = async (sourceName: string) => {
        if (!confirm(`确定要删除来源「${sourceName}」吗？`)) {
            return;
        }

        try {
            // Find the source ID by name
            const sources = await apiClient.get<{ id: string; name: string }[]>("/api/question-sources");
            const sourceToDelete = sources.find(s => s.name === sourceName);

            if (!sourceToDelete) {
                alert('找不到要删除的来源');
                return;
            }

            await apiClient.delete(`/api/question-sources/${sourceToDelete.id}`);
            setCustomQuestionSources(prev => prev.filter(s => s !== sourceName));
            if (data.paperLevel === sourceName) {
                setData({ ...data, paperLevel: "模拟考试" });
            }
            frontendLogger.info('[CorrectionEditor]', 'Custom question source deleted', { name: sourceName });
        } catch (error: any) {
            console.error("Failed to delete custom source:", error);
            alert(error.message || '删除失败，请稍后重试');
        }
    };


    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold">{t.editor.title}</h2>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={onCancel}>
                        {t.editor.cancel}
                    </Button>
                    <Button
                        onClick={async () => {
                            if (!data.subjectId) {
                                alert(t.editor.messages?.selectNotebook || "Please select a notebook");
                                return;
                            }
                            if (isSaving) return; // 防止重复点击
                            setIsSaving(true);
                            try {
                                // 将图片数组转换为JSON字符串
                                const answerImagesJson = answerImages.length > 0 ? JSON.stringify(answerImages) : '[]';
                                const analysisImagesJson = analysisImages.length > 0 ? JSON.stringify(analysisImages) : '[]';

                                await onSave({
                                    ...data,
                                    answerImages: answerImagesJson,
                                    analysisImages: analysisImagesJson,
                                    mistakeStatus: normalizeMistakeStatusForSave(
                                        data.mistakeStatus,
                                        data.wrongAnswerText
                                    ),
                                });
                            } finally {
                                setIsSaving(false);
                            }
                        }}
                        disabled={isSaving}
                    >
                        {isSaving ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                            <Save className="mr-2 h-4 w-4" />
                        )}
                        {isSaving ? (t.common?.pleaseWait || "Please wait...") : t.editor.save}
                    </Button>
                </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
                {/* 左侧：编辑区 */}
                <div className="space-y-6">
                    {imagePreview && (
                        <Card>
                            <CardContent className="p-4">
                                <img src={imagePreview} alt="Original" className="w-full rounded-md" />
                            </CardContent>
                        </Card>
                    )}

                    <div className="space-y-2">
                        <Label>{t.editor.selectNotebook || "Select Notebook"}</Label>
                        <NotebookSelector
                            value={data.subjectId}
                            onChange={(id) => setData({ ...data, subjectId: id })}
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>{t.editor.gradeSemester || "Grade/Semester"}</Label>
                            <Input
                                value={data.gradeSemester || ""}
                                onChange={(e) => setData({ ...data, gradeSemester: e.target.value })}
                                placeholder="e.g. Junior High Grade 1, 1st Semester"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>{t.editor.paperLevel || "题目来源"}</Label>
                            <Popover open={sourcePopoverOpen} onOpenChange={setSourcePopoverOpen}>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant="outline"
                                        role="combobox"
                                        className="w-full justify-between"
                                    >
                                        {data.paperLevel || (t.editor.paperLevels?.a || "模拟考试")}
                                        <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-[--radix-popover-trigger-width] max-h-[--radix-popover-content-available-height] p-0">
                                    <div className="max-h-[300px] overflow-y-auto">
                                        <div className="p-1">
                                            <div className="px-2 py-1.5 text-sm font-semibold text-muted-foreground">
                                                预设选项
                                            </div>
                                            {["模拟考试", "期中考试", "期末考试"].sort().map(source => (
                                                <Button
                                                    key={source}
                                                    variant="ghost"
                                                    className="w-full justify-start px-2"
                                                    onClick={() => {
                                                        setData({ ...data, paperLevel: source });
                                                        setSourcePopoverOpen(false);
                                                    }}
                                                >
                                                    {source}
                                                </Button>
                                            ))}
                                        </div>
                                        {customQuestionSources.length > 0 && (
                                            <div className="border-t p-1">
                                                <div className="px-2 py-1.5 text-sm font-semibold text-muted-foreground">
                                                    自定义来源
                                                </div>
                                                {customQuestionSources.sort().map(source => (
                                                    <div
                                                        key={source}
                                                        className="flex items-center gap-1 px-2"
                                                    >
                                                        <Button
                                                            variant="ghost"
                                                            className="flex-1 justify-start px-2"
                                                            onClick={() => {
                                                                setData({ ...data, paperLevel: source });
                                                                setSourcePopoverOpen(false);
                                                            }}
                                                        >
                                                            {source}
                                                        </Button>
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            className="h-7 w-7 p-0"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleDeleteCustomSource(source);
                                                            }}
                                                        >
                                                            <X className="h-3 w-3" />
                                                        </Button>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                        <div className="border-t p-2">
                                            <div className="flex gap-2">
                                                <Input
                                                    placeholder="新来源名称"
                                                    value={newSourceName}
                                                    onChange={(e) => setNewSourceName(e.target.value)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') {
                                                            handleAddCustomSource();
                                                        }
                                                    }}
                                                    className="flex-1"
                                                />
                                                <Button
                                                    size="sm"
                                                    onClick={handleAddCustomSource}
                                                    disabled={isAddingSource || !newSourceName.trim()}
                                                >
                                                    {isAddingSource ? (
                                                        <Loader2 className="h-4 w-4 animate-spin" />
                                                    ) : (
                                                        <Plus className="h-4 w-4" />
                                                    )}
                                                </Button>
                                            </div>
                                        </div>
                                    </div>
                                </PopoverContent>
                            </Popover>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label>题号</Label>
                        <Input
                            value={data.questionNumber || ""}
                            onChange={(e) => setData({ ...data, questionNumber: e.target.value })}
                            placeholder="例如：1、2、3或(1)、(2)、(3)"
                        />
                        <p className="text-xs text-muted-foreground">
                            可选：为题目添加编号标识
                        </p>
                    </div>

                    <div className="space-y-2">
                        <Label>{t.editor.question}</Label>
                        <Textarea
                            value={data.questionText}
                            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setData({ ...data, questionText: e.target.value })}
                            className="min-h-[150px] font-mono text-sm"
                            placeholder={t.editor.placeholder || "Supports Markdown and LaTeX..."}
                        />
                        <Button
                            variant="default"
                            size="sm"
                            onClick={handleOcrQuestionImage}
                            disabled={isOcrRunning || !imagePreview}
                            title={!imagePreview ? '没有可识别的题目图片' : undefined}
                            className="w-full bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white font-medium"
                        >
                            {isOcrRunning ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    识别中，可能需要1~5分钟…
                                </>
                            ) : (
                                <>
                                    <ScanText className="mr-2 h-4 w-4" />
                                    OCR识别题目图片
                                </>
                            )}
                        </Button>
                        <p className="text-xs text-muted-foreground">
                            💡 用飞桨 PaddleOCR 识别题目图片中的文字，识别结果将填入上方题目文字框
                        </p>
                    </div>

                    <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                            <Label>{t.editor.tags}</Label>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-7 px-2.5 text-xs"
                                onClick={handleSuggestTags}
                                disabled={isSuggestingTags || !data.questionText.trim()}
                            >
                                {isSuggestingTags ? (
                                    <>
                                        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                                        {t.editor.tagsGenerating || "生成中…"}
                                    </>
                                ) : (
                                    <>
                                        <Sparkles className="mr-1 h-3.5 w-3.5" />
                                        {t.editor.tagsAiGenerate || "AI 生成"}
                                    </>
                                )}
                            </Button>
                        </div>
                        <TagInput
                            value={data.knowledgePoints}
                            onChange={(tags) => setData({ ...data, knowledgePoints: tags })}
                            placeholder={t.editor.tagsPlaceholder || "Enter knowledge tags..."}
                            enterHint={t.editor.createTagHint}
                            subject={inferSubjectFromName(notebooks.find(n => n.id === data.subjectId)?.name || null) || inferSubjectFromName(data.subject || null) || undefined}
                            gradeStage={educationStage}
                        />
                        {tagsError && (
                            <p className="text-xs text-red-500">{tagsError}</p>
                        )}
                        <p className="text-xs text-muted-foreground">
                            {t.editor.tagsHint || "💡 Tag suggestions will appear as you type"}
                        </p>
                    </div>

                    <div className="space-y-2">
                        <Label>{t.editor.answer}</Label>
                        <RichTextEditorWithImage
                            value={data.answerText}
                            onChange={(text, images) => {
                                setData({ ...data, answerText: text });
                                setAnswerImages(images);
                            }}
                            placeholder={t.editor.placeholder || "Supports Markdown and LaTeX..."}
                            rows={4}
                            existingImages={answerImages}
                        />
                    </div>

                    <div className="space-y-2">
                        <Label>答题一时间</Label>
                        <Input
                            type="datetime-local"
                            value={data.answerTime ? new Date(data.answerTime).toISOString().slice(0, 16) : ''}
                            onChange={(e) => {
                                const dateTimeStr = e.target.value;
                                if (dateTimeStr) {
                                    // Convert to ISO format
                                    const date = new Date(dateTimeStr);
                                    setData({ ...data, answerTime: date.toISOString() });
                                } else {
                                    setData({ ...data, answerTime: new Date().toISOString() });
                                }
                            }}
                        />
                        <p className="text-xs text-muted-foreground">
                            设置答题一时间，默认为当前导入时间
                        </p>
                    </div>

                    <div className="space-y-2">
                        <Label>{t.editor.analysis}</Label>
                        <RichTextEditorWithImage
                            value={data.analysis}
                            onChange={(text, images) => {
                                setData({ ...data, analysis: text });
                                setAnalysisImages(images);
                            }}
                            placeholder={t.editor.placeholder || "Supports Markdown and LaTeX..."}
                            rows={8}
                            existingImages={analysisImages}
                        />
                        <Button
                            variant="default"
                            size="sm"
                            onClick={handleOcrAnalysisImage}
                            disabled={isAnalysisOcrRunning || analysisImages.length === 0}
                            title={analysisImages.length === 0 ? '没有可识别的解析图片（先在上方解析框粘贴或上传图片）' : undefined}
                            className="w-full bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white font-medium"
                        >
                            {isAnalysisOcrRunning ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    识别中，可能需要1~5分钟…
                                </>
                            ) : (
                                <>
                                    <ScanText className="mr-2 h-4 w-4" />
                                    OCR识别解析图片
                                </>
                            )}
                        </Button>
                        <p className="text-xs text-muted-foreground">
                            💡 用飞桨 PaddleOCR 识别解析图片中的文字，识别结果将填入上方解析思路框
                        </p>
                    </div>

                    <Card>
                        <CardHeader>
                            <CardTitle>{t.editor.mistakeAnalysisTitle || "错因分析"}</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <Label>{t.editor.mistakeStatus || "作答状态"}</Label>
                                <Select
                                    value={data.mistakeStatus || "unknown"}
                                    onValueChange={(val) => setData({ ...data, mistakeStatus: val as MistakeStatus })}
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="not_attempted">{t.editor.mistakeStatuses?.notAttempted || "不会做"}</SelectItem>
                                        <SelectItem value="wrong_attempt">{t.editor.mistakeStatuses?.wrongAttempt || "做错了"}</SelectItem>
                                        <SelectItem value="partially_wrong">{t.editor.mistakeStatuses?.partiallyWrong || "部分做错"}</SelectItem>
                                        <SelectItem value="small_mistake">{t.editor.mistakeStatuses?.smallMistake || "小错误"}</SelectItem>
                                        <SelectItem value="new_method">{t.editor.mistakeStatuses?.newMethod || "新方法"}</SelectItem>
                                        <SelectItem value="unknown">{t.editor.mistakeStatuses?.unknown || "未判断"}</SelectItem>
                                        <SelectItem value="focus">{t.editor.mistakeStatuses?.focus || "重点关注"}</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>{t.editor.wrongAnswerText || "错误解答原文"}</Label>
                                <Textarea
                                    value={data.wrongAnswerText || ""}
                                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setData({
                                        ...data,
                                        wrongAnswerText: e.target.value,
                                        mistakeStatus: e.target.value.trim() ? "wrong_attempt" : data.mistakeStatus,
                                    })}
                                    className="min-h-[100px] font-mono text-sm"
                                    placeholder={t.editor.wrongAnswerPlaceholder || "如果图片里没有错误解答，可留空"}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>{t.editor.mistakeAnalysis || "错因分析"}</Label>
                                <Textarea
                                    value={data.mistakeAnalysis || ""}
                                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setData({
                                        ...data,
                                        mistakeAnalysis: e.target.value,
                                    })}
                                    className="min-h-[140px] font-mono text-sm"
                                    placeholder={t.editor.mistakeAnalysisPlaceholder || "分析错误可能发生在哪一步、为什么错、导致什么后果"}
                                />
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* 右侧：预览区 */}
                <div className="space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>{t.editor.preview?.question || "Question Preview"}</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <MarkdownRenderer content={data.questionText} />
                        </CardContent>
                    </Card>

                    {/* GeoGebra Dynamic Demo */}
                    {data.geogebraCommands ? (
                        <GeogebraDemo commands={data.geogebraCommands} height={350} onRegenerate={handleAnalyzeGeogebra} />
                    ) : data.questionText.trim() && data.answerText.trim() ? (
                        <div className="rounded-lg border border-dashed p-4">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                    <Box className="h-4 w-4" />
                                    <span>GeoGebra 动态演示</span>
                                </div>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={handleAnalyzeGeogebra}
                                    disabled={isAnalyzingGeogebra}
                                >
                                    {isAnalyzingGeogebra ? (
                                        <>
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            AI 分析中...
                                        </>
                                    ) : (
                                        <>
                                            <Box className="mr-2 h-4 w-4" />
                                            生成演示
                                        </>
                                    )}
                                </Button>
                            </div>
                            {geogebraError && (
                                <p className="text-xs text-muted-foreground mt-2">{geogebraError}</p>
                            )}
                            <p className="text-xs text-muted-foreground mt-2">
                                AI 将判断本题是否可以用 GeoGebra 进行动态演示
                            </p>
                        </div>
                    ) : null}

                    <Card>
                        <CardHeader>
                            <CardTitle>{t.editor.preview?.answer || "Answer Preview"}</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <MarkdownRenderer content={data.answerText} />
                            {answerImages.length > 0 && (
                                <div className="grid grid-cols-2 gap-3">
                                    {answerImages.map((image, idx) => (
                                        <div key={image.id} className="relative border rounded-lg p-2">
                                            <img
                                                src={image.dataUrl}
                                                alt={image.name || `答案图片 ${idx + 1}`}
                                                className="w-full h-32 object-cover rounded"
                                            />
                                            <div className="text-xs text-muted-foreground mt-1 truncate">
                                                {image.name}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>{t.editor.preview?.analysis || "Analysis Preview"}</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <MarkdownRenderer content={data.analysis} />
                            {analysisImages.length > 0 && (
                                <div className="grid grid-cols-2 gap-3">
                                    {analysisImages.map((image, idx) => (
                                        <div key={image.id} className="relative border rounded-lg p-2">
                                            <img
                                                src={image.dataUrl}
                                                alt={image.name || `解析图片 ${idx + 1}`}
                                                className="w-full h-32 object-cover rounded"
                                            />
                                            <div className="text-xs text-muted-foreground mt-1 truncate">
                                                {image.name}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>{t.editor.preview?.mistakeAnalysis || "错因分析预览"}</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3 text-sm">
                            <div className="text-muted-foreground">
                                {t.editor.mistakeStatus || "作答状态"}：
                                {data.mistakeStatus === 'wrong_attempt'
                                    ? (t.editor.mistakeStatuses?.wrongAttempt || "做错了")
                                    : data.mistakeStatus === 'partially_wrong'
                                        ? (t.editor.mistakeStatuses?.partiallyWrong || "部分做错")
                                        : data.mistakeStatus === 'small_mistake'
                                            ? (t.editor.mistakeStatuses?.smallMistake || "小错误")
                                            : data.mistakeStatus === 'new_method'
                                                ? (t.editor.mistakeStatuses?.newMethod || "新方法")
                                                : data.mistakeStatus === 'not_attempted'
                                                    ? (t.editor.mistakeStatuses?.notAttempted || "不会做")
                                                    : data.mistakeStatus === 'focus'
                                                        ? (t.editor.mistakeStatuses?.focus || "重点关注")
                                                        : (t.editor.mistakeStatuses?.unknown || "未判断")}
                            </div>
                            {data.wrongAnswerText && (
                                <div>
                                    <div className="font-medium mb-1">{t.editor.wrongAnswerText || "错误解答原文"}</div>
                                    <MarkdownRenderer content={data.wrongAnswerText} />
                                </div>
                            )}
                            {data.mistakeAnalysis && (
                                <div>
                                    <div className="font-medium mb-1">{t.editor.mistakeAnalysis || "错因分析"}</div>
                                    <MarkdownRenderer content={data.mistakeAnalysis} />
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
