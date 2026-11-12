"use client";

import { useRef, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { Camera, ImageUp, Loader2 } from "lucide-react";
import { CameraCapture } from "@/components/camera-capture";

import { VocabularyEntry } from "@/types/api";
import { apiClient } from "@/lib/api-client";
import { useLanguage } from "@/contexts/LanguageContext";

interface AddVocabularyDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    subjectId: string;
    onAdded: (entry: VocabularyEntry) => void;
}

export function AddVocabularyDialog({ open, onOpenChange, subjectId, onAdded }: AddVocabularyDialogProps) {
    const { t } = useLanguage();
    const v = t.vocabulary;
    const [word, setWord] = useState("");
    const [sentence, setSentence] = useState("");
    const [note, setNote] = useState("");
    const [saving, setSaving] = useState(false);
    const [ocrRunning, setOcrRunning] = useState(false);
    const [cameraOpen, setCameraOpen] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const reset = () => {
        setWord("");
        setSentence("");
        setNote("");
    };

    const handleSave = async () => {
        if (!word.trim()) return;
        setSaving(true);
        try {
            const entry = await apiClient.post<VocabularyEntry>("/api/vocab", {
                subjectId,
                word: word.trim(),
                sentence,
                note,
            });
            reset();
            onOpenChange(false);
            onAdded(entry);
        } catch (error: unknown) {
            console.error(error);
            const apiError = error as { data?: { message?: string } };
            alert(apiError.data?.message || v?.addError || "添加词汇失败");
        } finally {
            setSaving(false);
        }
    };

    // OCR 识别截图/照片文字，结果填入例句框由用户编辑确认（与错题 OCR 同款超时口径）
    const handleOcrImage = async (dataUrl: string) => {
        setOcrRunning(true);
        try {
            const result = await apiClient.post<{ markdown: string }>("/api/ocr/paddle", {
                image: dataUrl,
            }, { timeout: 320000 });
            if (result.markdown) {
                setSentence(result.markdown);
                alert(v?.ocrResultHint || "识别结果已填入下方，请确认后保存");
            } else {
                alert(v?.dictMissing ? "未识别到文字内容" : "未识别到文字内容");
            }
        } catch (error: unknown) {
            console.error("OCR failed:", error);
            const apiError = error as { data?: { message?: string } };
            const msg = apiError.data?.message || (error instanceof Error ? error.message : "");
            const friendly = msg.includes("AI_TIMEOUT_ERROR")
                ? "识别超时（图片较复杂或服务繁忙），请稍后重试"
                : msg || "请稍后重试";
            alert(`OCR 识别失败：${friendly}`);
        } finally {
            setOcrRunning(false);
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            if (typeof reader.result === "string") {
                handleOcrImage(reader.result);
            }
        };
        reader.readAsDataURL(file);
        e.target.value = "";
    };

    return (
        <>
            <Dialog open={open} onOpenChange={(o) => { if (!ocrRunning) onOpenChange(o); }}>
                <DialogContent className="max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>{v?.add || "添加词汇"}</DialogTitle>
                        <DialogDescription>
                            {"输入单词保存后自动查询词典解析，也可粘贴例句或 OCR 识别"}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-2">
                            <Label htmlFor="vocab-word">{v?.wordLabel || "单词"}</Label>
                            <Input
                                id="vocab-word"
                                placeholder={v?.wordPlaceholder || "例如：abandon"}
                                value={word}
                                onChange={(e) => setWord(e.target.value)}
                                autoComplete="off"
                                spellCheck={false}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="vocab-sentence">{v?.sentenceLabel || "例句（可选）"}</Label>
                            <Textarea
                                id="vocab-sentence"
                                placeholder={v?.sentencePlaceholder || "输入你自己的例句..."}
                                value={sentence}
                                onChange={(e) => setSentence(e.target.value)}
                                rows={3}
                            />
                            <div className="flex items-center gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={ocrRunning}
                                    onClick={() => fileInputRef.current?.click()}
                                >
                                    <ImageUp className="mr-2 h-4 w-4" />
                                    {v?.uploadImage || "选择截图"}
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={ocrRunning}
                                    onClick={() => setCameraOpen(true)}
                                >
                                    <Camera className="mr-2 h-4 w-4" />
                                    {v?.takePhoto || "拍照识别"}
                                </Button>
                                {ocrRunning && (
                                    <span className="flex items-center gap-1 text-sm text-muted-foreground">
                                        <Loader2 className="h-3 w-3 animate-spin" />
                                        {v?.ocrRunning || "识别中..."}
                                    </span>
                                )}
                            </div>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={handleFileChange}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="vocab-note">{v?.noteLabel || "笔记（可选）"}</Label>
                            <Textarea
                                id="vocab-note"
                                placeholder={v?.notePlaceholder || "输入你的笔记..."}
                                value={note}
                                onChange={(e) => setNote(e.target.value)}
                                rows={2}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                            {t.common.cancel}
                        </Button>
                        <Button onClick={handleSave} disabled={saving || !word.trim()}>
                            {saving ? (v?.saving || "保存中...") : (v?.save || "保存")}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            {cameraOpen && (
                <CameraCapture
                    onConfirm={(dataUrl) => {
                        setCameraOpen(false);
                        handleOcrImage(dataUrl);
                    }}
                    onCancel={() => setCameraOpen(false)}
                />
            )}
        </>
    );
}
