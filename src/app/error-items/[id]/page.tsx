"use client";

// 添加 CaptureController 类型声明
declare global {
    interface Window {
        CaptureController: {
            new(): {
                setFocusBehavior(behavior: 'no-focus-change' | 'focus-capturing-application'): void;
            };
        };
    }
}

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, CheckCircle, XCircle, RefreshCw, Trash2, Edit, Save, X, Box, Loader2, Plus, ChevronDown, Monitor } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import Link from "next/link";
import { useLanguage } from "@/contexts/LanguageContext";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { TagInput } from "@/components/tag-input";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiClient } from "@/lib/api-client";
import { UserProfile, Notebook } from "@/types/api";
import { inferSubjectFromName } from "@/lib/knowledge-tags";
import { getMistakeStatusLabel, normalizeMistakeStatusForSave } from "@/lib/mistake-status";
import { NotebookSelector } from "@/components/notebook-selector";
import { GeogebraDemo } from "@/components/geogebra-demo";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RichTextEditorWithImage } from "@/components/rich-text-editor-with-image";

interface KnowledgeTag {
    id: string;
    name: string;
}

interface ErrorItemDetail {
    id: string;
    questionText: string;
    questionImages?: string | null; // JSON array of image objects
    answerText: string;
    answerImages?: string | null; // JSON array of image objects
    analysis: string;
    analysisImages?: string | null; // JSON array of image objects
    wrongAnswerText?: string | null;
    mistakeAnalysis?: string | null;
    mistakeStatus?: string | null;
    knowledgePoints: string; // 保留兼容旧数据
    tags: KnowledgeTag[]; // 新的标签关联
    masteryLevel: number;
    originalImageUrl: string | null; // 允许为null
    userNotes: string | null;
    subjectId?: string | null;
    subject?: {
        id: string;
        name: string;
    } | null;
    gradeSemester?: string | null;
    paperLevel?: string | null;
    answerTime?: string | null; // 答题时间
    geogebraCommands?: string | null;
    createdAt: string; // 添加导入时间字段
    updatedAt?: string;
}

export default function ErrorDetailPage() {
    const params = useParams();
    const router = useRouter();
    const { t, language } = useLanguage();
    const [item, setItem] = useState<ErrorItemDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [isEditingNotes, setIsEditingNotes] = useState(false);
    const [notesInput, setNotesInput] = useState("");
    const [isImageViewerOpen, setIsImageViewerOpen] = useState(false);
    const [currentImageUrl, setCurrentImageUrl] = useState<string | null>(null);
    const [isEditingTags, setIsEditingTags] = useState(false);
    const [tagsInput, setTagsInput] = useState<string[]>([]);
    const [isEditingMetadata, setIsEditingMetadata] = useState(false);
    const [gradeSemesterInput, setGradeSemesterInput] = useState("");
    const [paperLevelInput, setPaperLevelInput] = useState("模拟考试");
    const [notebookInput, setNotebookInput] = useState<string | null>(null);
    const [importTimeInput, setImportTimeInput] = useState("");

    const [educationStage, setEducationStage] = useState<string | undefined>(undefined);

    const [isAnalyzingGeogebra, setIsAnalyzingGeogebra] = useState(false);
    const [geogebraError, setGeogebraError] = useState<string | null>(null);

    const [customQuestionSources, setCustomQuestionSources] = useState<string[]>([]);
    const [newSourceName, setNewSourceName] = useState("");
    const [isAddingSource, setIsAddingSource] = useState(false);
    const [sourcePopoverOpen, setSourcePopoverOpen] = useState(false);
    const [isScreenshotting, setIsScreenshotting] = useState(false);
    const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null);
    const [screenshotStream, setScreenshotStream] = useState<MediaStream | null>(null);
    const [cropArea, setCropArea] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
    const [isSelectingArea, setIsSelectingArea] = useState(false);
    const [selectionStart, setSelectionStart] = useState<{ x: number; y: number } | null>(null);
    const [imagePosition, setImagePosition] = useState({ x: 0, y: 0, scale: 1 });
    const previewImageRef = useRef<HTMLImageElement>(null);

    // 解析截图相关状态
    const [isAnalysisScreenshotting, setIsAnalysisScreenshotting] = useState(false);
    const [analysisScreenshotPreview, setAnalysisScreenshotPreview] = useState<string | null>(null);
    const [analysisScreenshotStream, setAnalysisScreenshotStream] = useState<MediaStream | null>(null);
    const [analysisCropArea, setAnalysisCropArea] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
    const [isAnalysisSelectingArea, setIsAnalysisSelectingArea] = useState(false);
    const [analysisSelectionStart, setAnalysisSelectionStart] = useState<{ x: number; y: number } | null>(null);
    const analysisPreviewImageRef = useRef<HTMLImageElement>(null);

    useEffect(() => {
        // Fetch user info for education stage
        apiClient.get<UserProfile>("/api/user")
            .then(user => {
                if (user && user.educationStage) {
                    setEducationStage(user.educationStage);
                }
            })
            .catch(err => console.error("Failed to fetch user info:", err));

        // Cleanup function to stop screenshot stream when component unmounts
        return () => {
            if (screenshotStream) {
                screenshotStream.getTracks().forEach(track => track.stop());
            }
        };
    }, [screenshotStream]);

    // Cleanup analysis screenshot stream when component unmounts
    useEffect(() => {
        return () => {
            if (analysisScreenshotStream) {
                analysisScreenshotStream.getTracks().forEach(track => track.stop());
                console.log('🧹 Analysis screenshot stream cleaned up');
            }
        };
    }, [analysisScreenshotStream]);

    useEffect(() => {
        // Fetch custom question sources
        apiClient.get<{ id: string; name: string }[]>("/api/question-sources")
            .then(sources => {
                const sourceNames = sources.map(s => s.name);
                setCustomQuestionSources(sourceNames);
            })
            .catch(err => {
                console.error("Failed to fetch custom question sources:", err);
                setCustomQuestionSources([]);
            });

        if (params.id) {
            fetchItem(params.id as string);
        }
    }, [params.id]);

    const fetchItem = async (id: string) => {
        try {
            const data = await apiClient.get<ErrorItemDetail>(`/api/error-items/${id}`);
            setItem(data);
        } catch (error) {
            console.error(error);
            alert(t.common?.messages?.loadFailed || 'Failed to load item');
            router.push("/notebooks");
        } finally {
            setLoading(false);
        }
    };

    const handleAnalyzeGeogebra = async () => {
        if (!item) return;
        setIsAnalyzingGeogebra(true);
        setGeogebraError(null);
        try {
            const result = await apiClient.post<{
                suitable: boolean;
                commands: string[];
                description: string;
            }>(`/api/error-items/${item.id}/geogebra`, {});

            if (result.suitable && result.commands.length > 0) {
                setItem({ ...item, geogebraCommands: JSON.stringify(result.commands) });
            } else {
                setGeogebraError(result.description || "该题目不适合用 GeoGebra 演示");
            }
        } catch (error: any) {
            console.error("GeoGebra analysis failed:", error);
            const msg = error?.data?.message || error?.message || "";
            if (msg.includes("AI_AUTH_ERROR")) {
                setGeogebraError("AI 认证失败，请检查设置");
            } else if (msg.includes("AI_CONNECTION")) {
                setGeogebraError("AI 连接失败，请检查网络");
            } else {
                setGeogebraError("分析失败，请稍后重试");
            }
        } finally {
            setIsAnalyzingGeogebra(false);
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
            setPaperLevelInput(response.name);
            setNewSourceName("");
            setSourcePopoverOpen(false);
        } catch (error: any) {
            console.error("Failed to add custom source:", error);
            alert(error.message || '添加失败，请稍后重试');
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
            if (paperLevelInput === sourceName) {
                setPaperLevelInput("模拟考试");
            }
        } catch (error: any) {
            console.error("Failed to delete custom source:", error);
            alert(error.message || '删除失败，请稍后重试');
        }
    };

    // 检查是否支持屏幕截图
    const isScreenshotSupported = () => {
        return typeof navigator !== 'undefined' &&
            'mediaDevices' in navigator &&
            'getDisplayMedia' in navigator.mediaDevices;
    };

    // 屏幕截图功能
    const handleScreenshot = async () => {
        if (!isScreenshotSupported()) {
            alert('您的浏览器不支持屏幕截图功能');
            return;
        }

        setIsScreenshotting(true);

        try {
            // 创建 CaptureController 来控制焦点行为
            let controller;
            if ('CaptureController' in window) {
                controller = new (window as any).CaptureController();
            }

            // 请求屏幕共享权限
            const displayMediaOptions: DisplayMediaStreamOptions & {
                preferCurrentTab?: boolean;
                controller?: any;
                video?: {
                    cursor: "always" | "never" | "motion";
                };
            } = {
                video: {
                    cursor: "always" as const
                },
                audio: false,
            };

            if (controller) {
                (displayMediaOptions as any).controller = controller;
            }

            const stream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);

            // 保存流以供后续使用
            setScreenshotStream(stream);

            // 获取视频轨道并检查捕获类型
            const [videoTrack] = stream.getVideoTracks();
            const settings = videoTrack.getSettings();
            const displaySurface = (settings as any).displaySurface;

            // 如果是标签页或窗口，设置不切换焦点
            if (controller && (displaySurface === 'browser' || displaySurface === 'window')) {
                try {
                    controller.setFocusBehavior('no-focus-change');
                    console.log('✅ 已设置不切换焦点行为');
                } catch (e) {
                    console.warn('⚠️ 无法设置焦点行为:', e);
                }
            }

            // 创建视频元素
            const video = document.createElement('video');
            video.srcObject = stream;
            video.muted = true;
            video.autoplay = true;
            video.playsInline = true;

            // 等待视频准备并播放
            await new Promise<void>((resolve, reject) => {
                video.onloadedmetadata = () => {
                    video.play().then(() => {
                        resolve();
                    }).catch(reject);
                };
                video.onerror = reject;
            });

            // 等待一帧渲染（确保稳定）
            await new Promise(resolve => setTimeout(resolve, 500));

            // 检查视频尺寸
            if (video.videoWidth === 0 || video.videoHeight === 0) {
                throw new Error('视频没有有效尺寸');
            }

            // 创建canvas并捕获预览
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;

            const ctx = canvas.getContext('2d');
            if (!ctx) {
                throw new Error('无法获取canvas上下文');
            }

            // 绘制视频帧
            ctx.drawImage(video, 0, 0);

            // 转换为dataURL并显示预览
            const previewDataUrl = canvas.toDataURL('image/png');
            setScreenshotPreview(previewDataUrl);

        } catch (error) {
            if (error instanceof Error) {
                if (error.name === 'NotAllowedError') {
                    // 用户主动取消，不记录错误
                    console.log('用户取消了屏幕截图');
                } else {
                    console.error('Screenshot failed:', error);
                    alert(`屏幕截图失败: ${error.message}`);
                }
            }
            setIsScreenshotting(false);
        }
    };

    // 确认截图
    const confirmScreenshot = () => {
        const processAndAddImage = (imageDataUrl: string) => {
            const newImage = {
                id: `screenshot-${Date.now()}`,
                dataUrl: imageDataUrl,
                name: `屏幕截图-${Date.now()}.png`
            };

            console.log('📤 准备添加图片到答案列表:', {
                id: newImage.id,
                dataSize: imageDataUrl.length,
                currentImagesCount: answerImages.length
            });

            setAnswerImages(prev => {
                const updated = [...prev, newImage];
                console.log('✅ 图片已添加，新的总数:', updated.length);
                return updated;
            });

            cleanupScreenshot();
        };

        // 如果有框选区域，进行裁剪
        if (cropArea && screenshotPreview) {
            console.log('✂️ 开始裁剪图片，框选区域:', cropArea);

            const img = new Image();
            img.crossOrigin = "anonymous";

            img.onload = () => {
                try {
                    console.log('📷 原始图片尺寸:', {
                        natural: { width: img.naturalWidth, height: img.naturalHeight }
                    });

                    // 验证原始图片是否有效
                    if (img.naturalWidth === 0 || img.naturalHeight === 0) {
                        console.error('❌ 原始图片无效');
                        alert('原始图片无效');
                        return;
                    }

                    // 使用ref获取预览图片的实际显示尺寸
                    let displayWidth = 0;
                    let displayHeight = 0;

                    if (previewImageRef.current) {
                        const rect = previewImageRef.current.getBoundingClientRect();
                        displayWidth = rect.width;
                        displayHeight = rect.height;
                        console.log('📐 使用ref获取的预览图片显示尺寸:', { displayWidth, displayHeight });
                    } else {
                        console.warn('⚠️ previewImageRef.current为null，尝试查找DOM元素');
                        const previewImages = document.querySelectorAll('img[src*="data:image"]');
                        for (const image of previewImages) {
                            const rect = image.getBoundingClientRect();
                            if (rect.width > 100 && rect.height > 100) {
                                displayWidth = rect.width;
                                displayHeight = rect.height;
                                console.log('📐 通过DOM查找获取的尺寸:', { displayWidth, displayHeight });
                                break;
                            }
                        }
                    }

                    // 如果无法获取显示尺寸，使用原始图片尺寸
                    if (displayWidth === 0 || displayHeight === 0) {
                        console.warn('⚠️ 无法获取显示尺寸，使用原始图片尺寸');
                        displayWidth = img.naturalWidth;
                        displayHeight = img.naturalHeight;
                    }

                    // 计算精确的缩放比例
                    const scaleX = img.naturalWidth / displayWidth;
                    const scaleY = img.naturalHeight / displayHeight;

                    console.log('📏 尺寸比例计算:', {
                        natural: { width: img.naturalWidth, height: img.naturalHeight },
                        display: { width: displayWidth, height: displayHeight },
                        scale: { x: scaleX.toFixed(4), y: scaleY.toFixed(4) }
                    });

                    // 根据框选区域和比例计算实际裁剪区域
                    const actualX = cropArea.x * scaleX;
                    const actualY = cropArea.y * scaleY;
                    const actualWidth = cropArea.width * scaleX;
                    const actualHeight = cropArea.height * scaleY;

                    console.log('✂️ 计算的裁剪区域:', {
                        display: cropArea,
                        actual: {
                            x: actualX.toFixed(2),
                            y: actualY.toFixed(2),
                            width: actualWidth.toFixed(2),
                            height: actualHeight.toFixed(2)
                        }
                    });

                    // 验证并调整裁剪区域，确保在有效范围内
                    let finalX = Math.max(0, Math.min(actualX, img.naturalWidth - 1));
                    let finalY = Math.max(0, Math.min(actualY, img.naturalHeight - 1));
                    let finalWidth = Math.min(actualWidth, img.naturalWidth - finalX);
                    let finalHeight = Math.min(actualHeight, img.naturalHeight - finalY);

                    // 确保尺寸至少为1px
                    finalWidth = Math.max(1, finalWidth);
                    finalHeight = Math.max(1, finalHeight);

                    console.log('🔧 调整后的最终裁剪区域:', {
                        x: finalX.toFixed(2),
                        y: finalY.toFixed(2),
                        width: finalWidth.toFixed(2),
                        height: finalHeight.toFixed(2)
                    });

                    if (finalWidth <= 0 || finalHeight <= 0) {
                        console.error('❌ 调整后的区域仍然无效');
                        alert('选择的区域太小，请重新选择');
                        return;
                    }

                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    if (!ctx) {
                        console.error('❌ 无法获取canvas上下文');
                        alert('图片处理失败');
                        return;
                    }

                    canvas.width = finalWidth;
                    canvas.height = finalHeight;

                    // 设置白色背景
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, finalWidth, finalHeight);

                    console.log('🎨 开始canvas绘制操作');

                    ctx.drawImage(
                        img,
                        finalX, finalY, finalWidth, finalHeight,
                        0, 0, finalWidth, finalHeight
                    );

                    const croppedDataUrl = canvas.toDataURL('image/png');
                    console.log('✅ 裁剪完成，数据大小:', croppedDataUrl.length);

                    // 验证结果
                    if (croppedDataUrl.length < 100) {
                        console.error('❌ 裁剪结果数据无效');
                        alert('裁剪结果无效');
                        return;
                    }

                    processAndAddImage(croppedDataUrl);
                } catch (error) {
                    console.error('❌ 裁剪处理失败:', error);
                    alert('图片处理失败: ' + (error instanceof Error ? error.message : String(error)));
                }
            };

            img.onerror = (error) => {
                console.error('❌ 图片加载失败:', error);
                alert('图片加载失败');
            };

            img.src = screenshotPreview;
            return;
        } else if (screenshotPreview) {
            console.log('📷 直接使用完整截图');
            processAndAddImage(screenshotPreview);
        } else {
            console.error('❌ 没有截图数据');
            alert('没有可用的截图');
        }
    };

    // 取消截图
    const cancelScreenshot = () => {
        cleanupScreenshot();
    };

    // 清理截图状态
    const cleanupScreenshot = () => {
        if (screenshotStream) {
            screenshotStream.getTracks().forEach(track => track.stop());
            setScreenshotStream(null);
        }
        setScreenshotPreview(null);
        setIsScreenshotting(false);
        setCropArea(null);
        setIsSelectingArea(false);
        setSelectionStart(null);
    };

    // 开始框选
    const handleStartSelection = (e: React.MouseEvent<HTMLDivElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        setSelectionStart({ x, y });
        setIsSelectingArea(true);
        setCropArea(null);
    };

    // 更新框选区域
    const handleUpdateSelection = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!isSelectingArea || !selectionStart) return;

        const rect = e.currentTarget.getBoundingClientRect();
        const currentX = e.clientX - rect.left;
        const currentY = e.clientY - rect.top;

        const x = Math.min(selectionStart.x, currentX);
        const y = Math.min(selectionStart.y, currentY);
        const width = Math.abs(currentX - selectionStart.x);
        const height = Math.abs(currentY - selectionStart.y);

        setCropArea({ x, y, width, height });
    };

    // 结束框选
    const handleEndSelection = () => {
        setIsSelectingArea(false);
        setSelectionStart(null);
    };

    // 清除框选
    const clearCropArea = () => {
        setCropArea(null);
    };

    // === 解析截图功能 ===
    const handleAnalysisScreenshot = async () => {
        if (!isScreenshotSupported()) {
            alert('您的浏览器不支持屏幕截图功能');
            return;
        }

        setIsAnalysisScreenshotting(true);

        try {
            // 创建 CaptureController 来控制焦点行为
            let controller;
            if ('CaptureController' in window) {
                controller = new (window as any).CaptureController();
            }

            // 请求屏幕共享权限
            const displayMediaOptions: DisplayMediaStreamOptions & {
                preferCurrentTab?: boolean;
                controller?: any;
                video?: {
                    cursor: "always" | "never" | "motion";
                };
            } = {
                video: {
                    cursor: "always" as const
                },
                audio: false,
            };

            if (controller) {
                (displayMediaOptions as any).controller = controller;
            }

            const stream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);

            // 保存流以供后续使用
            setAnalysisScreenshotStream(stream);

            // 获取视频轨道并检查捕获类型
            const [videoTrack] = stream.getVideoTracks();
            const settings = videoTrack.getSettings();
            const displaySurface = (settings as any).displaySurface;

            // 如果是标签页或窗口，设置不切换焦点
            if (controller && (displaySurface === 'browser' || displaySurface === 'window')) {
                try {
                    controller.setFocusBehavior('no-focus-change');
                    console.log('✅ 已设置不切换焦点行为');
                } catch (e) {
                    console.warn('⚠️ 无法设置焦点行为:', e);
                }
            }

            // 创建视频元素
            const video = document.createElement('video');
            video.srcObject = stream;
            video.muted = true;
            video.autoplay = true;
            video.playsInline = true;

            // 等待视频准备并播放
            await new Promise<void>((resolve, reject) => {
                video.onloadedmetadata = () => {
                    video.play().then(() => {
                        resolve();
                    }).catch(reject);
                };
                video.onerror = reject;
            });

            // 等待一帧渲染（确保稳定）
            await new Promise(resolve => setTimeout(resolve, 500));

            // 检查视频尺寸
            if (video.videoWidth === 0 || video.videoHeight === 0) {
                throw new Error('视频没有有效尺寸');
            }

            // 创建canvas并捕获预览
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;

            const ctx = canvas.getContext('2d');
            if (!ctx) {
                throw new Error('无法获取canvas上下文');
            }

            // 绘制视频帧
            ctx.drawImage(video, 0, 0);

            // 转换为dataURL并显示预览
            const previewDataUrl = canvas.toDataURL('image/png');
            setAnalysisScreenshotPreview(previewDataUrl);

        } catch (error) {
            if (error instanceof Error) {
                if (error.name === 'NotAllowedError') {
                    // 用户主动取消，不记录错误
                    console.log('用户取消了屏幕截图');
                } else {
                    console.error('Analysis screenshot failed:', error);
                    alert(`屏幕截图失败: ${error.message}`);
                }
            }
        } finally {
            setIsAnalysisScreenshotting(false);
        }
    };

    const confirmAnalysisScreenshot = () => {
        const processAndAddAnalysisImage = (imageDataUrl: string) => {
            // 验证图片数据是否有效
            if (!imageDataUrl || imageDataUrl.length < 100) {
                console.error('❌ 无效的图片数据');
                alert('图片数据无效');
                return;
            }

            const newImage = {
                id: `analysis-screenshot-${Date.now()}`,
                dataUrl: imageDataUrl,
                name: `解析截图-${Date.now()}.png`
            };

            console.log('📤 准备添加图片到解析列表:', {
                id: newImage.id,
                dataSize: imageDataUrl.length,
                currentImagesCount: analysisImages.length
            });

            setAnalysisImages(prev => {
                const updated = [...prev, newImage];
                console.log('✅ 解析图片已添加，新的总数:', updated.length);
                return updated;
            });

            cleanupAnalysisScreenshot();
        };

        // 如果有框选区域，进行裁剪
        if (analysisCropArea && analysisScreenshotPreview) {
            console.log('✂️ 开始裁剪解析图片，框选区域:', analysisCropArea);

            const img = new Image();
            img.crossOrigin = "anonymous";

            img.onload = () => {
                try {
                    console.log('📷 解析原始图片尺寸:', {
                        natural: { width: img.naturalWidth, height: img.naturalHeight }
                    });

                    // 验证原始图片是否有效
                    if (img.naturalWidth === 0 || img.naturalHeight === 0) {
                        console.error('❌ 原始图片无效');
                        alert('原始图片无效');
                        return;
                    }

                    // 使用ref获取预览图片的实际显示尺寸
                    let displayWidth = 0;
                    let displayHeight = 0;

                    if (analysisPreviewImageRef.current) {
                        const rect = analysisPreviewImageRef.current.getBoundingClientRect();
                        displayWidth = rect.width;
                        displayHeight = rect.height;
                        console.log('📐 使用ref获取的解析预览图片显示尺寸:', { displayWidth, displayHeight });
                    } else {
                        console.warn('⚠️ analysisPreviewImageRef.current为null，尝试查找DOM元素');
                        const previewImages = document.querySelectorAll('img[src*="data:image"]');
                        for (const image of previewImages) {
                            const rect = image.getBoundingClientRect();
                            if (rect.width > 100 && rect.height > 100) {
                                displayWidth = rect.width;
                                displayHeight = rect.height;
                                console.log('📐 通过DOM查找获取的解析图片尺寸:', { displayWidth, displayHeight });
                                break;
                            }
                        }
                    }

                    // 如果无法获取显示尺寸，使用原始图片尺寸
                    if (displayWidth === 0 || displayHeight === 0) {
                        console.warn('⚠️ 无法获取显示尺寸，使用原始图片尺寸');
                        displayWidth = img.naturalWidth;
                        displayHeight = img.naturalHeight;
                    }

                    // 计算精确的缩放比例
                    const scaleX = img.naturalWidth / displayWidth;
                    const scaleY = img.naturalHeight / displayHeight;

                    console.log('📏 解析尺寸比例计算:', {
                        natural: { width: img.naturalWidth, height: img.naturalHeight },
                        display: { width: displayWidth, height: displayHeight },
                        scale: { x: scaleX.toFixed(4), y: scaleY.toFixed(4) }
                    });

                    // 根据框选区域和比例计算实际裁剪区域
                    const actualX = analysisCropArea.x * scaleX;
                    const actualY = analysisCropArea.y * scaleY;
                    const actualWidth = analysisCropArea.width * scaleX;
                    const actualHeight = analysisCropArea.height * scaleY;

                    console.log('✂️ 计算的解析裁剪区域:', {
                        display: analysisCropArea,
                        actual: {
                            x: actualX.toFixed(2),
                            y: actualY.toFixed(2),
                            width: actualWidth.toFixed(2),
                            height: actualHeight.toFixed(2)
                        }
                    });

                    // 验证并调整裁剪区域，确保在有效范围内
                    let finalX = Math.max(0, Math.min(actualX, img.naturalWidth - 1));
                    let finalY = Math.max(0, Math.min(actualY, img.naturalHeight - 1));
                    let finalWidth = Math.min(actualWidth, img.naturalWidth - finalX);
                    let finalHeight = Math.min(actualHeight, img.naturalHeight - finalY);

                    // 确保尺寸至少为1px
                    finalWidth = Math.max(1, finalWidth);
                    finalHeight = Math.max(1, finalHeight);

                    console.log('🔧 调整后的解析最终裁剪区域:', {
                        x: finalX.toFixed(2),
                        y: finalY.toFixed(2),
                        width: finalWidth.toFixed(2),
                        height: finalHeight.toFixed(2)
                    });

                    if (finalWidth <= 0 || finalHeight <= 0) {
                        console.error('❌ 调整后的解析区域仍然无效');
                        alert('选择的区域太小，请重新选择');
                        return;
                    }

                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    if (!ctx) {
                        console.error('❌ 无法获取canvas上下文');
                        alert('图片处理失败');
                        return;
                    }

                    canvas.width = finalWidth;
                    canvas.height = finalHeight;

                    // 设置白色背景
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, finalWidth, finalHeight);

                    console.log('🎨 开始解析canvas绘制操作');

                    ctx.drawImage(
                        img,
                        finalX, finalY, finalWidth, finalHeight,
                        0, 0, finalWidth, finalHeight
                    );

                    const croppedDataUrl = canvas.toDataURL('image/png');
                    console.log('✅ 解析裁剪完成，数据大小:', croppedDataUrl.length);

                    // 验证结果
                    if (croppedDataUrl.length < 100) {
                        console.error('❌ 解析裁剪结果数据无效');
                        alert('裁剪结果无效');
                        return;
                    }

                    processAndAddAnalysisImage(croppedDataUrl);
                } catch (error) {
                    console.error('❌ 解析裁剪处理失败:', error);
                    alert('图片处理失败: ' + (error instanceof Error ? error.message : String(error)));
                }
            };

            img.onerror = (error) => {
                console.error('❌ 解析图片加载失败:', error);
                alert('图片加载失败');
            };

            img.src = analysisScreenshotPreview;
        } else if (analysisScreenshotPreview) {
            console.log('📷 直接使用完整解析截图');

            // 验证原始截图数据
            if (analysisScreenshotPreview.length < 100) {
                console.error('❌ 原始解析截图数据无效');
                alert('原始截图数据无效');
                return;
            }

            processAndAddAnalysisImage(analysisScreenshotPreview);
        } else {
            console.error('❌ 没有解析截图数据');
            alert('没有可用的截图');
        }
    };

    // 清理解析截图状态
    const cleanupAnalysisScreenshot = () => {
        if (analysisScreenshotStream) {
            analysisScreenshotStream.getTracks().forEach(track => track.stop());
            setAnalysisScreenshotStream(null);
        }
        setAnalysisScreenshotPreview(null);
        setIsAnalysisScreenshotting(false);
        setAnalysisCropArea(null);
        setIsAnalysisSelectingArea(false);
        setAnalysisSelectionStart(null);
    };

    // 解析开始框选
    const handleAnalysisStartSelection = (e: React.MouseEvent<HTMLDivElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        setAnalysisSelectionStart({ x, y });
        setIsAnalysisSelectingArea(true);
        setAnalysisCropArea(null);
    };

    // 解析更新框选区域
    const handleAnalysisUpdateSelection = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!isAnalysisSelectingArea || !analysisSelectionStart) return;

        const rect = e.currentTarget.getBoundingClientRect();
        const currentX = e.clientX - rect.left;
        const currentY = e.clientY - rect.top;

        const x = Math.min(analysisSelectionStart.x, currentX);
        const y = Math.min(analysisSelectionStart.y, currentY);
        const width = Math.abs(currentX - analysisSelectionStart.x);
        const height = Math.abs(currentY - analysisSelectionStart.y);

        setAnalysisCropArea({ x, y, width, height });
    };

    // 解析结束框选
    const handleAnalysisEndSelection = () => {
        setIsAnalysisSelectingArea(false);
        setAnalysisSelectionStart(null);
    };

    // 解析清除框选
    const clearAnalysisCropArea = () => {
        setAnalysisCropArea(null);
    };

    const toggleMastery = async () => {
        if (!item) return;

        const newLevel = item.masteryLevel > 0 ? 0 : 1;

        try {
            await apiClient.patch(`/api/error-items/${item.id}/mastery`, { masteryLevel: newLevel });
            setItem({ ...item, masteryLevel: newLevel });
            alert(newLevel > 0 ? (t.common?.messages?.markMastered || 'Marked as mastered') : (t.common?.messages?.unmarkMastered || 'Unmarked'));
        } catch (error) {
            console.error(error);
            alert(t.common?.messages?.updateFailed || 'Update failed');
        }
    };

    const deleteItem = async () => {
        if (!item) return;

        const confirmMessage = t.common?.messages?.confirmDelete || 'Are you sure you want to delete this error item?';
        if (!confirm(confirmMessage)) return;

        try {
            await apiClient.delete(`/api/error-items/${item.id}/delete`);
            alert(t.common?.messages?.deleteSuccess || 'Deleted successfully');
            if (item.subjectId) {
                router.push(`/notebooks/${item.subjectId}`);
            } else {
                router.push('/notebooks');
            }
        } catch (error) {
            console.error(error);
            alert(t.common?.messages?.deleteFailed || 'Delete failed');
        }
    };

    const startEditingNotes = () => {
        setNotesInput(item?.userNotes || "");
        setIsEditingNotes(true);
    };

    const cancelEditingNotes = () => {
        setIsEditingNotes(false);
        setNotesInput("");
    };

    const startEditingTags = () => {
        if (item) {
            // 优先使用新的 tags 关联
            if (item.tags && item.tags.length > 0) {
                setTagsInput(item.tags.map(t => t.name));
            } else if (item.knowledgePoints) {
                // 回退到旧的 knowledgePoints 字段
                try {
                    const tags = JSON.parse(item.knowledgePoints);
                    setTagsInput(tags);
                } catch (e) {
                    setTagsInput([]);
                }
            } else {
                setTagsInput([]);
            }
            setIsEditingTags(true);
        }
    };

    const saveTagsHandler = async () => {
        try {
            // 直接传递标签名称数组，后端会处理关联
            await apiClient.put(`/api/error-items/${item?.id}`, {
                knowledgePoints: tagsInput, // 后端接收数组
            });

            setIsEditingTags(false);
            await fetchItem(params.id as string);
            alert(t.common?.messages?.tagUpdateSuccess || 'Tags updated successfully!');
        } catch (error) {
            console.error("[Frontend] Error updating:", error);
            alert(t.common?.messages?.updateFailed || 'Update failed');
        }
    };

    const cancelEditingTags = () => {
        setIsEditingTags(false);
        setTagsInput([]);
    };

    const startEditingMetadata = () => {
        if (item) {
            setNotebookInput(item.subjectId || null);
            setGradeSemesterInput(item.gradeSemester || "");
            setPaperLevelInput(item.paperLevel || "模拟考试");
            // 格式化导入时间为 datetime-local 格式
            const importTime = new Date(item.createdAt);
            const formattedTime = importTime.toISOString().slice(0, 16); // YYYY-MM-DDTHH:mm
            setImportTimeInput(formattedTime);
            setIsEditingMetadata(true);
        }
    };

    const saveMetadataHandler = async () => {
        try {
            // 转换导入时间为ISO格式
            const parsedTime = new Date(importTimeInput);
            const formattedTime = parsedTime.toISOString();

            await apiClient.put(`/api/error-items/${item?.id}`, {
                subjectId: notebookInput || null,
                gradeSemester: gradeSemesterInput,
                paperLevel: paperLevelInput,
                createdAt: formattedTime, // 添加导入时间更新
            });

            setIsEditingMetadata(false);
            fetchItem(params.id as string);
            alert(t.common?.messages?.metaUpdateSuccess || 'Metadata updated successfully!');
        } catch (error) {
            console.error(error);
            alert(t.common?.messages?.updateFailed || 'Update failed');
        }
    };

    const cancelEditingMetadata = () => {
        setIsEditingMetadata(false);
        setNotebookInput(null);
        setGradeSemesterInput("");
        setPaperLevelInput("a");
        setImportTimeInput("");
    };

    const [isEditingQuestion, setIsEditingQuestion] = useState(false);
    const [questionInput, setQuestionInput] = useState("");
    const [questionImages, setQuestionImages] = useState<Array<{ id: string; dataUrl: string; name: string }>>([]);

    const [isEditingAnswer, setIsEditingAnswer] = useState(false);
    const [answerInput, setAnswerInput] = useState("");
    const [answerImages, setAnswerImages] = useState<Array<{ id: string; dataUrl: string; name: string }>>([]);
    const [answerTimeInput, setAnswerTimeInput] = useState("");

    const [isEditingAnalysis, setIsEditingAnalysis] = useState(false);
    const [analysisInput, setAnalysisInput] = useState("");
    const [analysisImages, setAnalysisImages] = useState<Array<{ id: string; dataUrl: string; name: string }>>([]);

    const [isEditingMistake, setIsEditingMistake] = useState(false);
    const [wrongAnswerInput, setWrongAnswerInput] = useState("");
    const [mistakeAnalysisInput, setMistakeAnalysisInput] = useState("");
    const [mistakeStatusInput, setMistakeStatusInput] = useState("unknown");

    // --- Question Handlers ---
    const startEditingQuestion = () => {
        if (item) {
            setQuestionInput(item.questionText);
            // Parse existing images
            if (item.questionImages) {
                try {
                    const parsedImages = JSON.parse(item.questionImages);
                    setQuestionImages(parsedImages);
                } catch (e) {
                    console.error("Failed to parse question images:", e);
                    setQuestionImages([]);
                }
            } else {
                setQuestionImages([]);
            }
            setIsEditingQuestion(true);
        }
    };

    const handleDeleteOriginalImage = async () => {
        if (!item) return;

        try {
            await apiClient.put(`/api/error-items/${item.id}`, {
                originalImageUrl: null
            });

            if (item) {
                setItem({
                    ...item,
                    originalImageUrl: null
                });
            }

            alert('原始问题图片已删除');
        } catch (error) {
            console.error('删除原始图片失败:', error);
            alert('删除失败，请稍后重试');
        }
    };

    const saveQuestionHandler = async () => {
        try {
            // 将空图片数组保存为空JSON数组，而不是null
            const imagesJson = questionImages.length > 0 ? JSON.stringify(questionImages) : '[]';
            await apiClient.put(`/api/error-items/${item?.id}`, {
                questionText: questionInput || '',
                questionImages: imagesJson
            });
            setIsEditingQuestion(false);
            if (item) {
                setItem({
                    ...item,
                    questionText: questionInput || '',
                    questionImages: imagesJson
                });
            }
            setQuestionImages([]);
            alert(t.common?.messages?.saveSuccess || 'Saved successfully');
        } catch (error) {
            console.error(error);
            alert(t.common?.messages?.saveFailed || 'Save failed');
        }
    };

    const cancelEditingQuestion = () => {
        setIsEditingQuestion(false);
        setQuestionInput("");
        setQuestionImages([]);
    };

    // --- Answer Handlers ---
    const startEditingAnswer = () => {
        if (item) {
            setAnswerInput(item.answerText);
            // Parse existing images
            if (item.answerImages) {
                try {
                    const parsedImages = JSON.parse(item.answerImages);
                    setAnswerImages(parsedImages);
                } catch (e) {
                    console.error("Failed to parse answer images:", e);
                    setAnswerImages([]);
                }
            } else {
                setAnswerImages([]);
            }
            // Set answer time - use existing answer time or default to import time
            if (item.answerTime) {
                const answerTime = new Date(item.answerTime);
                setAnswerTimeInput(answerTime.toISOString().slice(0, 16)); // YYYY-MM-DDTHH:mm
            } else {
                // Default to import time (createdAt)
                const importTime = new Date(item.createdAt);
                setAnswerTimeInput(importTime.toISOString().slice(0, 16)); // YYYY-MM-DDTHH:mm
            }
            setIsEditingAnswer(true);
        }
    };

    const saveAnswerHandler = async () => {
        try {
            // 将空图片数组保存为空JSON数组，而不是null
            const imagesJson = answerImages.length > 0 ? JSON.stringify(answerImages) : '[]';

            const hasTime = answerTimeInput;

            // Prepare update data
            const updateData: any = {
                answerText: (answerInput || '').trim() || null,
                answerImages: imagesJson
            };

            // Only include answerTime if it's provided
            if (hasTime) {
                const parsedAnswerTime = new Date(answerTimeInput);
                if (isNaN(parsedAnswerTime.getTime())) {
                    alert("答题时间格式无效");
                    return;
                }
                updateData.answerTime = parsedAnswerTime.toISOString();
            }

            await apiClient.put(`/api/error-items/${item?.id}`, updateData);
            setIsEditingAnswer(false);
            if (item) {
                setItem({
                    ...item,
                    answerText: ((answerInput || '').trim() || null),
                    answerImages: imagesJson,
                    answerTime: updateData.answerTime || item.answerTime
                } as typeof item);
            }
            setAnswerImages([]);
            setAnswerTimeInput("");
            alert(t.common?.messages?.saveSuccess || 'Saved successfully');
        } catch (error: any) {
            console.error('Save answer error:', error);
            const errorMessage = error?.data?.message || error?.message || error?.toString() || 'Unknown error';
            alert(`保存失败: ${errorMessage}`);
        }
    };

    const cancelEditingAnswer = () => {
        setIsEditingAnswer(false);
        setAnswerInput("");
        setAnswerImages([]);
        setAnswerTimeInput("");
    };

    // --- Analysis Handlers ---
    const startEditingAnalysis = () => {
        if (item) {
            setAnalysisInput(item.analysis);
            // Parse existing images
            if (item.analysisImages) {
                try {
                    const parsedImages = JSON.parse(item.analysisImages);
                    setAnalysisImages(parsedImages);
                } catch (e) {
                    console.error("Failed to parse analysis images:", e);
                    setAnalysisImages([]);
                }
            } else {
                setAnalysisImages([]);
            }
            setIsEditingAnalysis(true);
        }
    };

    const saveAnalysisHandler = async () => {
        try {
            // 将空图片数组保存为空JSON数组，而不是null
            const imagesJson = analysisImages.length > 0 ? JSON.stringify(analysisImages) : '[]';

            // 移除验证限制，允许保存空内容
            // 用户可以清空解析内容和图片

            await apiClient.put(`/api/error-items/${item?.id}`, {
                analysis: (analysisInput || '').trim() || null,
                analysisImages: imagesJson
            });
            setIsEditingAnalysis(false);
            if (item) {
                setItem({
                    ...item,
                    analysis: (analysisInput || '').trim() || null,
                    analysisImages: imagesJson
                } as typeof item);
            }
            setAnalysisImages([]);
            alert(t.common?.messages?.saveSuccess || 'Saved successfully');
        } catch (error) {
            console.error(error);
            alert(t.common?.messages?.saveFailed || 'Save failed');
        }
    };

    const cancelEditingAnalysis = () => {
        setIsEditingAnalysis(false);
        setAnalysisInput("");
        setAnalysisImages([]);
    };

    // --- Mistake Analysis Handlers ---
    const startEditingMistake = () => {
        if (item) {
            setWrongAnswerInput(item.wrongAnswerText || "");
            setMistakeAnalysisInput(item.mistakeAnalysis || "");
            setMistakeStatusInput(item.mistakeStatus || "unknown");
            setIsEditingMistake(true);
        }
    };

    const saveMistakeHandler = async () => {
        try {
            const normalizedStatus = normalizeMistakeStatusForSave(
                mistakeStatusInput,
                wrongAnswerInput
            );
            await apiClient.put(`/api/error-items/${item?.id}`, {
                wrongAnswerText: wrongAnswerInput,
                mistakeAnalysis: mistakeAnalysisInput,
                mistakeStatus: normalizedStatus,
            });
            setIsEditingMistake(false);
            if (item) {
                setItem({
                    ...item,
                    wrongAnswerText: wrongAnswerInput,
                    mistakeAnalysis: mistakeAnalysisInput,
                    mistakeStatus: normalizedStatus,
                });
            }
            alert(t.common?.messages?.saveSuccess || 'Saved successfully');
        } catch (error) {
            console.error(error);
            alert(t.common?.messages?.saveFailed || 'Save failed');
        }
    };

    const cancelEditingMistake = () => {
        setIsEditingMistake(false);
        setWrongAnswerInput("");
        setMistakeAnalysisInput("");
        setMistakeStatusInput("unknown");
    };

    const saveNotes = async () => {
        if (!item) return;

        try {
            await apiClient.patch(`/api/error-items/${item.id}/notes`, { userNotes: notesInput });
            setItem({ ...item, userNotes: notesInput });
            setIsEditingNotes(false);
            alert(t.common?.messages?.noteSaveSuccess || 'Notes saved successfully');
        } catch (error) {
            console.error(error);
            alert(t.common?.messages?.saveFailed || 'Save failed');
        }
    };

    if (loading) return <div className="p-8 text-center">{t.common.loading}</div>;
    if (!item) return <div className="p-8 text-center">{t.detail.notFound || "Item not found"}</div>;

    // 优先从 tags 关联获取，回退到 knowledgePoints
    let tags: string[] = [];
    if (item.tags && item.tags.length > 0) {
        tags = item.tags.map(t => t.name);
    } else if (item.knowledgePoints) {
        try {
            const parsed = JSON.parse(item.knowledgePoints);
            tags = Array.isArray(parsed) ? parsed : [];
        } catch (e) {
            tags = [];
        }
    }

    return (
        <main className="min-h-screen bg-background">
            <div className="container mx-auto p-4 space-y-6 pb-20">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div className="flex items-center gap-4">
                        <Link href={item.subjectId ? `/notebooks/${item.subjectId}` : "/notebooks"}>
                            <Button variant="ghost" size="icon">
                                <ArrowLeft className="w-4 h-4" />
                            </Button>
                        </Link>
                        <h1 className="text-2xl font-bold">{t.detail.title}</h1>
                    </div>

                    <div className="flex gap-2">
                        <Link href={`/practice?id=${item.id}`}>
                            <Button variant="outline" size="sm">
                                <RefreshCw className="mr-2 h-4 w-4" />
                                {t.detail.practice}
                            </Button>
                        </Link>
                        <Button
                            size="sm"
                            variant={item.masteryLevel > 0 ? "default" : "default"}
                            className={item.masteryLevel > 0 ? "bg-green-600 hover:bg-green-700 text-white" : ""}
                            onClick={toggleMastery}
                        >
                            {item.masteryLevel > 0 ? (
                                <>
                                    <CheckCircle className="mr-2 h-4 w-4" />
                                    {t.detail.mastered}
                                </>
                            ) : (
                                <>
                                    <XCircle className="mr-2 h-4 w-4" />
                                    {t.detail.markMastered}
                                </>
                            )}
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={deleteItem}
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                        >
                            <Trash2 className="mr-2 h-4 w-4" />
                            {t.detail.delete || "Delete"}
                        </Button>
                    </div>
                </div>

                <div className="grid gap-6 lg:grid-cols-2">
                    {/* Left Column: Question & Image */}
                    <div className="space-y-6 min-w-0">
                        <Card>
                            <CardHeader>
                                <div className="flex justify-between items-center">
                                    <CardTitle>{t.detail.question}</CardTitle>
                                    {!isEditingQuestion && (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={startEditingQuestion}
                                        >
                                            <Edit className="h-4 w-4 mr-1" />
                                            {t.common?.edit || 'Edit'}
                                        </Button>
                                    )}
                                </div>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                {item.originalImageUrl && (
                                    <div className="relative">
                                        <p className="text-sm font-medium mb-2 text-muted-foreground">
                                            {t.detail.originalProblem || "Original Problem"}
                                        </p>

                                        {isEditingQuestion ? (
                                            // 编辑模式：显示删除按钮
                                            <div className="relative inline-block w-full">
                                                <img
                                                    src={item.originalImageUrl}
                                                    alt={t.detail.originalProblem || "Original Problem"}
                                                    className="w-full rounded-lg border"
                                                />
                                                <Button
                                                    size="sm"
                                                    variant="destructive"
                                                    className="absolute top-2 right-2 h-8 w-8 p-0 shadow-lg rounded-full bg-red-600 hover:bg-red-700 text-white border-2 border-white"
                                                    onClick={() => {
                                                        if (confirm('确定要删除原始问题图片吗？')) {
                                                            handleDeleteOriginalImage();
                                                        }
                                                    }}
                                                >
                                                    <X className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        ) : (
                                            // 查看模式：可点击放大
                                            <div
                                                className="cursor-pointer hover:opacity-90 transition-opacity"
                                                onClick={() => {
                                                    setCurrentImageUrl(item.originalImageUrl);
                                                    setIsImageViewerOpen(true);
                                                }}
                                                title={t.detail?.clickToView || 'Click to view full image'}
                                            >
                                                <img
                                                    src={item.originalImageUrl}
                                                    alt={t.detail.originalProblem || "Original Problem"}
                                                    className="w-full rounded-lg border hover:border-primary/50 transition-colors"
                                                />
                                                <p className="text-xs text-muted-foreground mt-1 text-center">
                                                    💡 {t.detail?.clickToEnlarge || 'Click to enlarge'}
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {isEditingQuestion ? (
                                    <div className="space-y-3">
                                        <RichTextEditorWithImage
                                            value={questionInput}
                                            onChange={(text, images) => {
                                                setQuestionInput(text);
                                                setQuestionImages(images);
                                            }}
                                            placeholder="Enter question text..."
                                            rows={8}
                                            existingImages={questionImages}
                                        />
                                        <div className="flex gap-2">
                                            <Button size="sm" onClick={saveQuestionHandler}>
                                                <Save className="h-4 w-4 mr-1" />
                                                {t.common?.save || 'Save'}
                                            </Button>
                                            <Button size="sm" variant="outline" onClick={cancelEditingQuestion}>
                                                <X className="h-4 w-4 mr-1" />
                                                {t.common?.cancel || 'Cancel'}
                                            </Button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        <MarkdownRenderer content={item.questionText} />
                                        {item.questionImages && (
                                            <div className="space-y-2">
                                                <div className="text-sm font-medium">题目图片：</div>
                                                <div className="grid grid-cols-2 gap-3">
                                                    {(() => {
                                                        try {
                                                            const images = JSON.parse(item.questionImages);
                                                            return images.map((img: any, idx: number) => (
                                                                <div
                                                                    key={idx}
                                                                    className="relative cursor-pointer hover:opacity-90 transition-opacity group"
                                                                    onClick={() => {
                                                                        setCurrentImageUrl(img.dataUrl);
                                                                        setIsImageViewerOpen(true);
                                                                    }}
                                                                    title={t.detail?.clickToEnlarge || 'Click to enlarge'}
                                                                >
                                                                    <img
                                                                        src={img.dataUrl}
                                                                        alt={img.name || `题目图片 ${idx + 1}`}
                                                                        className="w-full rounded-lg border hover:border-primary/50 transition-colors"
                                                                    />
                                                                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                                                                        <div className="bg-black/50 text-white px-3 py-1 rounded-full text-sm">
                                                                            🔍 {t.detail?.clickToEnlarge || 'Click to enlarge'}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            ));
                                                        } catch (e) {
                                                            return null;
                                                        }
                                                    })()}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* 知识点标签 */}
                                <div className="space-y-2">
                                    <div className="flex justify-between items-center">
                                        <h4 className="text-sm font-semibold">{t.editor?.tags || 'Knowledge Tags'}</h4>
                                        {!isEditingTags && (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={startEditingTags}
                                            >
                                                <Edit className="h-4 w-4 mr-1" />
                                                {t.common?.edit || 'Edit'}
                                            </Button>
                                        )}
                                    </div>

                                    {isEditingTags ? (
                                        <div className="space-y-3">
                                            <TagInput
                                                value={tagsInput}
                                                onChange={setTagsInput}
                                                placeholder={t.editor?.tagsPlaceholder || 'Enter or select knowledge tags...'}
                                                subject={inferSubjectFromName(item.subject?.name || null) || undefined}
                                                gradeStage={educationStage}
                                            />
                                            <p className="text-xs text-muted-foreground">
                                                {t.editor?.tagsHint || '💡 Select from standard or custom tags'}
                                            </p>
                                            <div className="flex gap-2">
                                                <Button size="sm" onClick={saveTagsHandler}>
                                                    <Save className="h-4 w-4 mr-1" />
                                                    {t.common?.save || 'Save'}
                                                </Button>
                                                <Button size="sm" variant="outline" onClick={cancelEditingTags}>
                                                    <X className="h-4 w-4 mr-1" />
                                                    {t.common?.cancel || 'Cancel'}
                                                </Button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex flex-wrap gap-2">
                                            {tags.map((tag) => (
                                                <Badge key={tag} variant="secondary">
                                                    {tag}
                                                </Badge>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* 年级/学期 和 试卷等级 */}
                                <div className="space-y-2 pt-4 border-t">
                                    <div className="flex justify-between items-center">
                                        <h4 className="text-sm font-semibold">
                                            {t.detail?.questionInfo || 'Question Info'}
                                        </h4>
                                        {!isEditingMetadata && (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={startEditingMetadata}
                                            >
                                                <Edit className="h-4 w-4 mr-1" />
                                                {t.common?.edit || 'Edit'}
                                            </Button>
                                        )}
                                    </div>

                                    {isEditingMetadata ? (
                                        <div className="space-y-3">
                                            <div className="space-y-2">
                                                <label className="text-sm text-muted-foreground">
                                                    {t.notebooks?.title || 'Notebook'}
                                                </label>
                                                <NotebookSelector
                                                    value={notebookInput || undefined}
                                                    onChange={(val) => setNotebookInput(val)}
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <label className="text-sm text-muted-foreground">
                                                    {t.filter.grade}
                                                </label>
                                                <Input
                                                    value={gradeSemesterInput}
                                                    onChange={(e) => setGradeSemesterInput(e.target.value)}
                                                    placeholder={t.notebook?.gradeSemesterPlaceholder || 'e.g. Grade 7, Semester 1'}
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <label className="text-sm text-muted-foreground">
                                                    {t.filter.paperLevel}
                                                </label>
                                                <Popover open={sourcePopoverOpen} onOpenChange={setSourcePopoverOpen}>
                                                    <PopoverTrigger asChild>
                                                        <Button
                                                            variant="outline"
                                                            role="combobox"
                                                            className="w-full justify-between"
                                                        >
                                                            {paperLevelInput || "模拟考试"}
                                                            <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                                        </Button>
                                                    </PopoverTrigger>
                                                    <PopoverContent className="w-[--radix-popover-trigger-width] max-h-[--radix-popover-content-available-height] p-0">
                                                        <div className="max-h-[300px] overflow-y-auto">
                                                            <div className="p-1">
                                                                <div className="px-2 py-1.5 text-sm font-semibold text-muted-foreground">
                                                                    预设选项
                                                                </div>
                                                                {["模拟考试", "期中考试", "期末考试"].map(source => (
                                                                    <Button
                                                                        key={source}
                                                                        variant="ghost"
                                                                        className="w-full justify-start px-2"
                                                                        onClick={() => {
                                                                            setPaperLevelInput(source);
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
                                                                    {customQuestionSources.map(source => (
                                                                        <div
                                                                            key={source}
                                                                            className="flex items-center gap-1 px-2"
                                                                        >
                                                                            <Button
                                                                                variant="ghost"
                                                                                className="flex-1 justify-start px-2"
                                                                                onClick={() => {
                                                                                    setPaperLevelInput(source);
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
                                            <div className="space-y-2">
                                                <label className="text-sm text-muted-foreground">
                                                    导入时间
                                                </label>
                                                <Input
                                                    type="datetime-local"
                                                    value={importTimeInput}
                                                    onChange={(e) => setImportTimeInput(e.target.value)}
                                                    max={new Date().toISOString().slice(0, 16)}
                                                />
                                            </div>
                                            <div className="flex gap-2">
                                                <Button size="sm" onClick={saveMetadataHandler}>
                                                    <Save className="h-4 w-4 mr-1" />
                                                    {t.common?.save || 'Save'}
                                                </Button>
                                                <Button size="sm" variant="outline" onClick={cancelEditingMetadata}>
                                                    <X className="h-4 w-4 mr-1" />
                                                    {t.common?.cancel || 'Cancel'}
                                                </Button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="space-y-2 text-sm">
                                            <div className="flex justify-between">
                                                <span className="text-muted-foreground">{t.notebooks?.title || 'Notebook'}:</span>
                                                <span className="font-medium">
                                                    {item.subject?.name || (t.common?.notSet || 'Not set')}
                                                </span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-muted-foreground">{t.filter.grade}:</span>
                                                <span className="font-medium">
                                                    {item.gradeSemester || (t.common?.notSet || 'Not set')}
                                                </span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-muted-foreground">{t.filter.paperLevel}:</span>
                                                <span className="font-medium">
                                                    {item.paperLevel || (t.common?.notSet || '未设置')}
                                                </span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-muted-foreground">导入时间:</span>
                                                <span className="font-medium">
                                                    {new Date(item.createdAt).toLocaleString('zh-CN', {
                                                        year: 'numeric',
                                                        month: '2-digit',
                                                        day: '2-digit',
                                                        hour: '2-digit',
                                                        minute: '2-digit'
                                                    })}
                                                </span>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <div className="flex justify-between items-center">
                                    <CardTitle>{t.detail.yourNotes}</CardTitle>
                                    {!isEditingNotes && (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={startEditingNotes}
                                        >
                                            <Edit className="h-4 w-4 mr-1" />
                                            {t.detail.editNotes || "Edit"}
                                        </Button>
                                    )}
                                </div>
                            </CardHeader>
                            <CardContent>
                                {isEditingNotes ? (
                                    <div className="space-y-3">
                                        <Textarea
                                            value={notesInput}
                                            onChange={(e) => setNotesInput(e.target.value)}
                                            placeholder={t.detail.notesPlaceholder || "Enter your notes..."}
                                            rows={5}
                                            className="w-full"
                                        />
                                        <div className="flex gap-2">
                                            <Button
                                                size="sm"
                                                onClick={saveNotes}
                                            >
                                                <Save className="h-4 w-4 mr-1" />
                                                {t.common.save || "Save"}
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={cancelEditingNotes}
                                            >
                                                <X className="h-4 w-4 mr-1" />
                                                {t.common.cancel || "Cancel"}
                                            </Button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="whitespace-pre-wrap">
                                        {item.userNotes ? (
                                            <p className="text-foreground">{item.userNotes}</p>
                                        ) : (
                                            <p className="text-muted-foreground italic">
                                                {t.detail.noNotes}
                                            </p>
                                        )}
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </div>

                    {/* Right Column: Analysis & Answer */}
                    <div className="space-y-6 min-w-0">
                        {/* GeoGebra Dynamic Demo */}
                        {item.geogebraCommands ? (
                            <GeogebraDemo commands={item.geogebraCommands} height={400} onRegenerate={handleAnalyzeGeogebra} />
                        ) : (
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
                                    AI 将判断本题是否可以用 GeoGebra 进行动态演示，如适合则自动生成交互式图形
                                </p>
                            </div>
                        )}

                        <Card className="border-primary/20">
                            <CardHeader>
                                <div className="flex justify-between items-center">
                                    <CardTitle className="text-primary">做题答案</CardTitle>
                                    {!isEditingAnswer && (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={startEditingAnswer}
                                        >
                                            <Edit className="h-4 w-4 mr-1" />
                                            {t.common?.edit || 'Edit'}
                                        </Button>
                                    )}
                                </div>
                            </CardHeader>
                            <CardContent>
                                {isEditingAnswer ? (
                                    <div className="space-y-3">
                                        <div className="space-y-2">
                                            <label className="text-sm text-muted-foreground">答题时间</label>
                                            <Input
                                                type="datetime-local"
                                                value={answerTimeInput}
                                                onChange={(e) => setAnswerTimeInput(e.target.value)}
                                                max={new Date().toISOString().slice(0, 16)}
                                            />
                                        </div>
                                        <RichTextEditorWithImage
                                            value={answerInput}
                                            onChange={(text, images) => {
                                                setAnswerInput(text);
                                                setAnswerImages(images);
                                            }}
                                            placeholder="Enter answer..."
                                            rows={5}
                                            existingImages={answerImages}
                                        />
                                        <div className="flex gap-2">
                                            <Button size="sm" onClick={saveAnswerHandler}>
                                                <Save className="h-4 w-4 mr-1" />
                                                {t.common?.save || 'Save'}
                                            </Button>
                                            <Button size="sm" variant="outline" onClick={cancelEditingAnswer}>
                                                <X className="h-4 w-4 mr-1" />
                                                {t.common?.cancel || 'Cancel'}
                                            </Button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        <div className="flex justify-between items-center pb-2 border-b">
                                            <span className="text-sm text-muted-foreground">答题时间</span>
                                            <span className="text-sm font-medium">
                                                {item.answerTime ? (
                                                    new Date(item.answerTime).toLocaleString('zh-CN', {
                                                        year: 'numeric',
                                                        month: '2-digit',
                                                        day: '2-digit',
                                                        hour: '2-digit',
                                                        minute: '2-digit'
                                                    })
                                                ) : (
                                                    <span className="text-muted-foreground italic">未设置</span>
                                                )}
                                            </span>
                                        </div>
                                        <MarkdownRenderer content={item.answerText} className="font-semibold" />
                                        {item.answerImages && (
                                            <div className="space-y-2">
                                                <div className="text-sm font-medium">答案图片：</div>
                                                <div className="grid grid-cols-2 gap-3">
                                                    {(() => {
                                                        try {
                                                            const images = JSON.parse(item.answerImages);
                                                            return images.map((img: any, idx: number) => (
                                                                <div key={idx} className="relative">
                                                                    <img
                                                                        src={img.dataUrl}
                                                                        alt={img.name || `答案图片 ${idx + 1}`}
                                                                        className="w-full rounded-lg border cursor-pointer hover:opacity-90 transition-opacity"
                                                                        onClick={() => {
                                                                            setCurrentImageUrl(img.dataUrl);
                                                                            setIsImageViewerOpen(true);
                                                                        }}
                                                                        title="点击查看全图"
                                                                    />
                                                                    <p className="text-xs text-muted-foreground mt-1 text-center">
                                                                        💡 点击查看全图
                                                                    </p>
                                                                </div>
                                                            ));
                                                        } catch (e) {
                                                            return null;
                                                        }
                                                    })()}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <div className="flex justify-between items-center">
                                    <CardTitle>{t.detail.analysis}</CardTitle>
                                    {!isEditingAnalysis && (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={startEditingAnalysis}
                                        >
                                            <Edit className="h-4 w-4 mr-1" />
                                            {t.common?.edit || 'Edit'}
                                        </Button>
                                    )}
                                </div>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                {isEditingAnalysis ? (
                                    <div className="space-y-3">
                                        <RichTextEditorWithImage
                                            value={analysisInput}
                                            onChange={(text, images) => {
                                                setAnalysisInput(text);
                                                setAnalysisImages(images);
                                            }}
                                            placeholder="Enter analysis..."
                                            rows={12}
                                            existingImages={analysisImages}
                                        />

                                        <div className="flex gap-2">
                                            <Button size="sm" onClick={saveAnalysisHandler}>
                                                <Save className="h-4 w-4 mr-1" />
                                                {t.common?.save || 'Save'}
                                            </Button>
                                            <Button size="sm" variant="outline" onClick={cancelEditingAnalysis}>
                                                <X className="h-4 w-4 mr-1" />
                                                {t.common?.cancel || 'Cancel'}
                                            </Button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        <MarkdownRenderer content={item.analysis} />
                                        {item.analysisImages && (
                                            <div className="space-y-2">
                                                <div className="text-sm font-medium">解析图片：</div>
                                                <div className="grid grid-cols-2 gap-3">
                                                    {(() => {
                                                        try {
                                                            const images = JSON.parse(item.analysisImages);
                                                            return images.map((img: any, idx: number) => (
                                                                <div key={idx} className="relative">
                                                                    <img
                                                                        src={img.dataUrl}
                                                                        alt={img.name || `解析图片 ${idx + 1}`}
                                                                        className="w-full rounded-lg border cursor-pointer hover:opacity-90 transition-opacity"
                                                                        onClick={() => {
                                                                            setCurrentImageUrl(img.dataUrl);
                                                                            setIsImageViewerOpen(true);
                                                                        }}
                                                                        title="点击查看全图"
                                                                    />
                                                                    <p className="text-xs text-muted-foreground mt-1 text-center">
                                                                        💡 点击查看全图
                                                                    </p>
                                                                </div>
                                                            ));
                                                        } catch (e) {
                                                            return null;
                                                        }
                                                    })()}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <div className="flex justify-between items-center">
                                    <CardTitle>{t.detail?.mistakeAnalysis || '错因分析'}</CardTitle>
                                    {!isEditingMistake && (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={startEditingMistake}
                                        >
                                            <Edit className="h-4 w-4 mr-1" />
                                            {t.common?.edit || 'Edit'}
                                        </Button>
                                    )}
                                </div>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                {isEditingMistake ? (
                                    <div className="space-y-4">
                                        <div className="space-y-2">
                                            <label className="text-sm text-muted-foreground">{t.editor?.mistakeStatus || '作答状态'}</label>
                                            <Select
                                                value={mistakeStatusInput}
                                                onValueChange={setMistakeStatusInput}
                                            >
                                                <SelectTrigger>
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="not_attempted">{t.editor?.mistakeStatuses?.notAttempted || '不会做'}</SelectItem>
                                                    <SelectItem value="wrong_attempt">{t.editor?.mistakeStatuses?.wrongAttempt || '做错了'}</SelectItem>
                                                    <SelectItem value="partially_wrong">{t.editor?.mistakeStatuses?.partiallyWrong || '部分做错'}</SelectItem>
                                                    <SelectItem value="unknown">{t.editor?.mistakeStatuses?.unknown || '未判断'}</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-sm text-muted-foreground">{t.editor?.wrongAnswerText || '错误解答原文'}</label>
                                            <Textarea
                                                value={wrongAnswerInput}
                                                onChange={(e) => {
                                                    setWrongAnswerInput(e.target.value);
                                                    if (e.target.value.trim()) setMistakeStatusInput('wrong_attempt');
                                                }}
                                                rows={5}
                                                className="w-full font-mono text-sm"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-sm text-muted-foreground">{t.editor?.mistakeAnalysis || '错因分析'}</label>
                                            <Textarea
                                                value={mistakeAnalysisInput}
                                                onChange={(e) => {
                                                    setMistakeAnalysisInput(e.target.value);
                                                }}
                                                rows={8}
                                                className="w-full font-mono text-sm"
                                            />
                                        </div>
                                        <div className="flex gap-2">
                                            <Button size="sm" onClick={saveMistakeHandler}>
                                                <Save className="h-4 w-4 mr-1" />
                                                {t.common?.save || 'Save'}
                                            </Button>
                                            <Button size="sm" variant="outline" onClick={cancelEditingMistake}>
                                                <X className="h-4 w-4 mr-1" />
                                                {t.common?.cancel || 'Cancel'}
                                            </Button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        <Badge variant={item.mistakeStatus === 'wrong_attempt' ? 'default' : 'secondary'}>
                                            {getMistakeStatusLabel(item.mistakeStatus, language)}
                                        </Badge>
                                        {item.wrongAnswerText ? (
                                            <div>
                                                <h4 className="text-sm font-semibold mb-2">{t.editor?.wrongAnswerText || '错误解答原文'}</h4>
                                                <MarkdownRenderer content={item.wrongAnswerText} />
                                            </div>
                                        ) : null}
                                        {item.mistakeAnalysis ? (
                                            <div>
                                                <h4 className="text-sm font-semibold mb-2">{t.editor?.mistakeAnalysis || '错因分析'}</h4>
                                                <MarkdownRenderer content={item.mistakeAnalysis} />
                                            </div>
                                        ) : (
                                            <p className="text-sm text-muted-foreground italic">{t.detail?.noMistakeAnalysis || '暂无错因分析'}</p>
                                        )}
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                        {/* 操作按钮 */}

                    </div>
                </div>
            </div>

            {/* Image Viewer Modal */}
            {
                isImageViewerOpen && (currentImageUrl || item?.originalImageUrl) && (
                    <div
                        className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
                        onClick={() => {
                            setIsImageViewerOpen(false);
                            setCurrentImageUrl(null);
                        }}
                    >
                        <div className="relative max-w-7xl max-h-full">
                            <button
                                className="absolute -top-12 right-0 text-white hover:text-gray-300 text-lg font-semibold bg-black/50 px-4 py-2 rounded"
                                onClick={() => {
                                    setIsImageViewerOpen(false);
                                    setCurrentImageUrl(null);
                                }}
                            >
                                {t.detail?.close || '✕ Close'}
                            </button>
                            <img
                                src={currentImageUrl || item?.originalImageUrl || ''}
                                alt="Full size"
                                className="max-w-full max-h-[90vh] object-contain rounded-lg"
                                onClick={(e) => e.stopPropagation()}
                            />
                            <p className="text-center text-white/70 text-sm mt-4">
                                {t.detail?.clickOutside || 'Click outside to close'}
                            </p>
                        </div>
                    </div>
                )
            }
        </main >
    );
}
