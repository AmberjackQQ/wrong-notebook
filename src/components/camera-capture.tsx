"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Camera, X, RefreshCw, Check, Loader2 } from "lucide-react";

interface CameraCaptureProps {
    onConfirm: (dataUrl: string) => void;
    onCancel: () => void;
}

// 照片输出上限：最长边 1600px、JPEG 0.85，控制存库 base64 体积
const MAX_OUTPUT_SIDE = 1600;

interface CropArea {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * 拍照组件：全屏弹窗，摄像头取景 → 拍照 → 框选裁剪 → 输出 JPEG dataUrl。
 * 框选用 Pointer 事件，兼容手机触屏与鼠标；不框选则使用整张照片。
 */
export function CameraCapture({ onConfirm, onCancel }: CameraCaptureProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const imageRef = useRef<HTMLImageElement>(null);
    const selectionStartRef = useRef<{ x: number; y: number } | null>(null);
    const selectingRef = useRef(false);
    const confirmedRef = useRef(false);

    const [phase, setPhase] = useState<"camera" | "crop">("camera");
    const [starting, setStarting] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [capturedUrl, setCapturedUrl] = useState<string | null>(null);
    const [capturedName, setCapturedName] = useState("");
    const [cropArea, setCropArea] = useState<CropArea | null>(null);

    const stopStream = () => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach((track) => track.stop());
            streamRef.current = null;
        }
    };

    // 相机阶段启动摄像头；切走阶段或卸载时停止
    useEffect(() => {
        if (phase !== "camera") return;
        let cancelled = false;
        setStarting(true);
        setError(null);

        (async () => {
            try {
                if (!navigator.mediaDevices?.getUserMedia) {
                    throw new Error("当前浏览器不支持摄像头访问");
                }
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        facingMode: "environment", // 手机优先用后置摄像头
                        width: { ideal: 1920 },
                        height: { ideal: 1080 },
                    },
                    audio: false,
                });
                if (cancelled) {
                    stream.getTracks().forEach((track) => track.stop());
                    return;
                }
                streamRef.current = stream;
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                    await videoRef.current.play().catch(() => { });
                }
            } catch (err) {
                if (!cancelled) {
                    const message = err instanceof Error ? err.message : String(err);
                    setError(
                        (err as { name?: string })?.name === "NotAllowedError"
                            ? "无法访问摄像头，请检查权限设置"
                            : `摄像头启动失败: ${message}`
                    );
                }
            } finally {
                if (!cancelled) setStarting(false);
            }
        })();

        return () => {
            cancelled = true;
            stopStream();
        };
    }, [phase]);

    // 卸载兜底清理（覆盖确认/取消后父组件卸载本组件的路径）
    useEffect(() => () => stopStream(), []);

    const handleCapture = () => {
        const video = videoRef.current;
        if (!video || !video.videoWidth || !video.videoHeight) return;

        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(video, 0, 0);

        stopStream();
        setCapturedUrl(canvas.toDataURL("image/jpeg", 0.9));
        const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
        setCapturedName(`拍照-${stamp}.jpg`);
        setCropArea(null);
        setPhase("crop");
    };

    const handleRetake = () => {
        setCapturedUrl(null);
        setCropArea(null);
        setPhase("camera");
    };

    // Pointer 事件坐标换算为图片显示尺寸内的坐标（超界收敛到边界内）
    const pointFromEvent = (e: React.PointerEvent<HTMLImageElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        return {
            x: Math.min(Math.max(e.clientX - rect.left, 0), rect.width),
            y: Math.min(Math.max(e.clientY - rect.top, 0), rect.height),
        };
    };

    const handlePointerDown = (e: React.PointerEvent<HTMLImageElement>) => {
        e.preventDefault();
        // capture 让移出图片后的 move/up 仍派发到图片元素（触屏拖动必需）
        e.currentTarget.setPointerCapture(e.pointerId);
        selectionStartRef.current = pointFromEvent(e);
        selectingRef.current = true;
        setCropArea(null);
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLImageElement>) => {
        if (!selectingRef.current || !selectionStartRef.current) return;
        const p = pointFromEvent(e);
        const area = {
            x: Math.min(selectionStartRef.current.x, p.x),
            y: Math.min(selectionStartRef.current.y, p.y),
            width: Math.abs(p.x - selectionStartRef.current.x),
            height: Math.abs(p.y - selectionStartRef.current.y),
        };
        // 过小区域视为误触，不显示
        if (area.width > 5 && area.height > 5) {
            setCropArea(area);
        }
    };

    const handlePointerUp = () => {
        selectingRef.current = false;
        selectionStartRef.current = null;
    };

    const handleConfirm = () => {
        if (!capturedUrl || confirmedRef.current) return;
        confirmedRef.current = true;

        const img = new Image();
        img.onload = () => {
            try {
                const nw = img.naturalWidth;
                const nh = img.naturalHeight;
                let sx = 0;
                let sy = 0;
                let sw = nw;
                let sh = nh;

                // 框选坐标（显示尺寸）映射回原始像素
                if (cropArea) {
                    const rect = imageRef.current?.getBoundingClientRect();
                    if (rect && rect.width > 0 && rect.height > 0) {
                        const scaleX = nw / rect.width;
                        const scaleY = nh / rect.height;
                        sx = Math.max(0, cropArea.x * scaleX);
                        sy = Math.max(0, cropArea.y * scaleY);
                        sw = Math.max(1, Math.min(cropArea.width * scaleX, nw - sx));
                        sh = Math.max(1, Math.min(cropArea.height * scaleY, nh - sy));
                    }
                }

                // 最长边限幅，缩小输出
                const scale = Math.min(1, MAX_OUTPUT_SIDE / Math.max(sw, sh));
                const dw = Math.max(1, Math.round(sw * scale));
                const dh = Math.max(1, Math.round(sh * scale));

                const canvas = document.createElement("canvas");
                canvas.width = dw;
                canvas.height = dh;
                const ctx = canvas.getContext("2d");
                if (!ctx) throw new Error("无法获取canvas上下文");
                ctx.fillStyle = "#ffffff";
                ctx.fillRect(0, 0, dw, dh);
                ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);

                const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
                stopStream();
                onConfirm(dataUrl);
            } catch (err) {
                confirmedRef.current = false;
                console.error("Photo processing failed:", err);
                setError("照片处理失败，请重试");
            }
        };
        img.onerror = () => {
            confirmedRef.current = false;
            setError("照片处理失败，请重试");
        };
        img.src = capturedUrl;
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4">
            <div className="bg-background rounded-lg shadow-xl max-w-4xl w-full p-4 space-y-3 max-h-[95vh] overflow-auto">
                <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold">拍照</h2>
                    <Button variant="ghost" size="icon" onClick={onCancel}>
                        <X className="h-4 w-4" />
                    </Button>
                </div>

                {phase === "camera" ? (
                    <div className="space-y-3">
                        <div className="flex justify-center">
                            <div className="relative overflow-hidden rounded-lg bg-black min-h-[300px] min-w-[300px] max-w-full flex items-center justify-center">
                                {/* 视频不铺满容器：按流的真实宽高比自适应，避免两侧黑边 */}
                                <video
                                    ref={videoRef}
                                    autoPlay
                                    playsInline
                                    muted
                                    className="max-w-full"
                                    style={{ maxHeight: "65vh" }}
                                />
                                {starting && !error && (
                                    <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-white">
                                        <Loader2 className="h-5 w-5 animate-spin" />
                                        正在启动摄像头…
                                    </div>
                                )}
                            </div>
                        </div>
                        {error && <p className="text-sm text-destructive">{error}</p>}
                        <div className="flex gap-2">
                            <Button className="flex-1" onClick={handleCapture} disabled={starting || !!error}>
                                <Camera className="mr-2 h-4 w-4" />
                                拍照
                            </Button>
                            <Button variant="outline" onClick={onCancel}>
                                取消
                            </Button>
                        </div>
                    </div>
                ) : capturedUrl ? (
                    <div className="space-y-3">
                        <p className="text-sm text-muted-foreground">
                            在照片上拖动选择要保留的区域；不选择则使用整张照片
                        </p>
                        <div className="flex justify-center">
                            <div className="relative inline-block max-w-full">
                                <img
                                    ref={imageRef}
                                    src={capturedUrl}
                                    alt={capturedName}
                                    className="max-w-full rounded border cursor-crosshair select-none"
                                    style={{ maxHeight: "65vh", touchAction: "none" }}
                                    draggable={false}
                                    onPointerDown={handlePointerDown}
                                    onPointerMove={handlePointerMove}
                                    onPointerUp={handlePointerUp}
                                    onPointerCancel={handlePointerUp}
                                />
                                {cropArea && (
                                    <div
                                        className="absolute border-2 border-blue-500 bg-blue-500/20 pointer-events-none"
                                        style={{
                                            left: `${cropArea.x}px`,
                                            top: `${cropArea.y}px`,
                                            width: `${cropArea.width}px`,
                                            height: `${cropArea.height}px`,
                                        }}
                                    />
                                )}
                            </div>
                        </div>
                        {error && <p className="text-sm text-destructive">{error}</p>}
                        <div className="flex gap-2">
                            <Button className="flex-1" onClick={handleConfirm}>
                                <Check className="mr-2 h-4 w-4" />
                                确认添加
                            </Button>
                            <Button variant="outline" onClick={handleRetake}>
                                <RefreshCw className="mr-2 h-4 w-4" />
                                重拍
                            </Button>
                            <Button variant="ghost" onClick={onCancel}>
                                取消
                            </Button>
                        </div>
                    </div>
                ) : null}
            </div>
        </div>
    );
}
