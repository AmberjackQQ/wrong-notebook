"use client";

import { useState, useRef, useEffect } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { X, ImageIcon, Monitor } from "lucide-react";
import { Card } from "@/components/ui/card";

interface PastedImage {
  id: string;
  dataUrl: string;
  name: string;
}

interface RichTextEditorWithImageProps {
  value: string;
  onChange: (value: string, images: PastedImage[]) => void;
  placeholder?: string;
  rows?: number;
  className?: string;
  existingImages?: PastedImage[];
}

export function RichTextEditorWithImage({
  value,
  onChange,
  placeholder = "Enter text...",
  rows = 8,
  className = "",
  existingImages = []
}: RichTextEditorWithImageProps) {
  const [images, setImages] = useState<PastedImage[]>(existingImages);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 屏幕截图相关状态
  const [isScreenshotting, setIsScreenshotting] = useState(false);
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null);
  const [screenshotStream, setScreenshotStream] = useState<MediaStream | null>(null);
  const [cropArea, setCropArea] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [isSelectingArea, setIsSelectingArea] = useState(false);
  const [selectionStart, setSelectionStart] = useState<{ x: number; y: number } | null>(null);
  const previewImageRef = useRef<HTMLImageElement>(null);

  // 使用 ref 来存储拖拽状态，避免 useEffect 依赖问题
  const selectionStartRef = useRef<{ x: number; y: number } | null>(null);
  const isSelectingAreaRef = useRef(false);
  const previewContainerRef = useRef<HTMLDivElement>(null);

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    const imageFiles: File[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.indexOf("image") !== -1) {
        const file = item.getAsFile();
        if (file) {
          imageFiles.push(file);
        }
      }
    }

    if (imageFiles.length > 0) {
      e.preventDefault();
      processImages(imageFiles);
    }
  };

  const processImages = (files: File[]) => {
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        const newImage: PastedImage = {
          id: Date.now().toString() + Math.random(),
          dataUrl,
          name: file.name || "Pasted image"
        };
        setImages(prev => [...prev, newImage]);
      };
      reader.readAsDataURL(file);
    });
  };

  const removeImage = (id: string) => {
    setImages(prev => prev.filter(img => img.id !== id));
  };

  // 开始屏幕截图
  const startScreenshot = async () => {
    try {
      setIsScreenshotting(true);
      console.log('📸 开始屏幕截图');

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false
      } as MediaStreamConstraints);

      const videoTrack = stream.getVideoTracks()[0];

      // 监听用户取消屏幕共享
      videoTrack.onended = () => {
        console.log('👤 用户取消屏幕共享');
        resetScreenshotState();
      };

      setScreenshotStream(stream);

      const settings = videoTrack.getSettings();
      console.log('📹 视频设置:', settings);

      // 创建预览
      const video = document.createElement('video');
      video.srcObject = stream;
      video.play();

      // 重要：设置crossOrigin以避免跨域问题
      video.crossOrigin = "anonymous";

      video.onloadedmetadata = () => {
        console.log('🎬 视频元数据加载完成');
        console.log('📏 视频尺寸:', video.videoWidth, 'x', video.videoHeight);

        // 等待几帧，确保视频有数据
        setTimeout(() => {
          const canvas = document.createElement('canvas');
          canvas.width = settings.width ? settings.width : video.videoWidth;
          canvas.height = settings.height ? settings.height : video.videoHeight;

          console.log('🖼️ Canvas尺寸:', canvas.width, 'x', canvas.height);

          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            // 检查canvas内容是否正确捕获
            try {
              const sampleData = ctx.getImageData(0, 0, 1, 1).data;
              console.log('🎨 Canvas样本像素:', sampleData);
            } catch (e) {
              console.error('❌ 无法获取Canvas数据（可能被污染）:', e);
            }

            const dataUrl = canvas.toDataURL('image/png');
            console.log('✅ 截图完成 - dataUrl长度:', dataUrl.length);
            console.log('✅ 前50字符:', dataUrl.substring(0, 50));

            if (dataUrl && dataUrl.length > 1000) {
              setScreenshotPreview(dataUrl);
            } else {
              console.error('❌ 截图数据无效');
              alert('截图失败，请重试');
              resetScreenshotState();
            }
          } else {
            console.error('❌ 无法获取Canvas上下文');
            alert('截图失败，请重试');
            resetScreenshotState();
          }

          // 停止预览视频流
          stream.getTracks().forEach(track => track.stop());
        }, 300); // 延迟300ms确保视频有数据
      };

    } catch (error) {
      console.error('❌ 屏幕截图失败:', error);
      setIsScreenshotting(false);
      // 用户取消屏幕共享时不需要显示错误提示
      if ((error as Error).name !== 'NotAllowedError') {
        alert('屏幕截图失败，请确保允许屏幕共享权限');
      }
    }
  };

  // 确认裁剪区域 - 修复坐标映射问题
  const confirmCrop = () => {
    console.log('🖼️ 确认裁剪 - cropArea:', cropArea);

    if (!cropArea || !screenshotPreview) {
      console.error('❌ 缺少必要数据');
      return;
    }

    console.log('🖼️ 开始处理裁剪');

    const img = new Image();
    img.onload = () => {
      console.log('📸 图片加载完成');
      console.log('📏 原始图片尺寸:', img.naturalWidth, 'x', img.naturalHeight);
      console.log('📏 显示图片尺寸:', img.width, 'x', img.height);

      // 获取图片元素的实际显示尺寸
      const imgElement = previewImageRef.current;
      if (!imgElement) {
        console.error('❌ 无法获取图片元素');
        return;
      }

      const displayWidth = imgElement.width;
      const displayHeight = imgElement.height;
      const naturalWidth = img.naturalWidth;
      const naturalHeight = img.naturalHeight;

      // 计算缩放比例
      const scaleX = naturalWidth / displayWidth;
      const scaleY = naturalHeight / displayHeight;

      console.log('🔄 缩放比例 - scaleX:', scaleX, 'scaleY:', scaleY);

      // 将显示坐标映射到原始图片坐标
      const scaledArea = {
        x: cropArea.x * scaleX,
        y: cropArea.y * scaleY,
        width: cropArea.width * scaleX,
        height: cropArea.height * scaleY
      };

      console.log('🎯 映射后的裁剪区域:', scaledArea);

      // 确保裁剪区域在有效范围内
      const safeArea = {
        x: Math.max(0, Math.min(Math.floor(scaledArea.x), naturalWidth)),
        y: Math.max(0, Math.min(Math.floor(scaledArea.y), naturalHeight)),
        width: Math.max(1, Math.min(Math.floor(scaledArea.width), naturalWidth - Math.floor(scaledArea.x))),
        height: Math.max(1, Math.min(Math.floor(scaledArea.height), naturalHeight - Math.floor(scaledArea.y)))
      };

      console.log('🔒 安全裁剪区域:', safeArea);

      const canvas = document.createElement('canvas');
      canvas.width = safeArea.width;
      canvas.height = safeArea.height;

      const ctx = canvas.getContext('2d');
      if (ctx) {
        // 直接绘制裁剪区域
        ctx.drawImage(
          img,
          safeArea.x, safeArea.y, safeArea.width, safeArea.height,
          0, 0, safeArea.width, safeArea.height
        );

        const croppedDataUrl = canvas.toDataURL('image/png');
        console.log('✅ 裁剪完成 - dataUrl长度:', croppedDataUrl.length);
        console.log('✅ 前50字符:', croppedDataUrl.substring(0, 50));

        if (croppedDataUrl && croppedDataUrl.length > 1000) {
          const newImage: PastedImage = {
            id: Date.now().toString() + Math.random(),
            dataUrl: croppedDataUrl,
            name: "屏幕截图"
          };

          console.log('➕ 添加新图片到列表');
          setImages(prev => [...prev, newImage]);
          resetScreenshotState();
        } else {
          console.error('❌ 裁剪结果无效');
          alert('裁剪失败，请重试');
        }
      }
    };

    img.onerror = () => {
      console.error('❌ 图片加载失败');
      alert('图片加载失败，请重试');
    };

    img.src = screenshotPreview;
  };

  // 取消截图
  const cancelScreenshot = () => {
    if (screenshotStream) {
      screenshotStream.getTracks().forEach(track => track.stop());
    }

    // 重置 ref
    selectionStartRef.current = null;
    isSelectingAreaRef.current = false;

    resetScreenshotState();
  };

  // 重置截图状态
  const resetScreenshotState = () => {
    setIsScreenshotting(false);
    setScreenshotPreview(null);
    setCropArea(null);
    setIsSelectingArea(false);
    setSelectionStart(null);

    // 重置 ref
    selectionStartRef.current = null;
    isSelectingAreaRef.current = false;

    if (screenshotStream) {
      screenshotStream.getTracks().forEach(track => track.stop());
      setScreenshotStream(null);
    }
  };

  // React 事件处理器
  const handleImageMouseDown = (e: React.MouseEvent<HTMLImageElement>) => {
    console.log('🖱️ React鼠标按下事件触发');
    e.preventDefault();
    e.stopPropagation();

    const imgElement = e.currentTarget;
    const rect = imgElement.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    console.log('🖱️ 鼠标按下位置 - x:', x, 'y:', y);

    // 更新 ref
    selectionStartRef.current = { x, y };
    isSelectingAreaRef.current = true;

    // 更新 state
    setSelectionStart({ x, y });
    setIsSelectingArea(true);
    setCropArea(null);
  };

  const handleImageMouseMove = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!isSelectingAreaRef.current || !selectionStartRef.current) return;

    const imgElement = e.currentTarget;
    const rect = imgElement.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const newCropArea = {
      x: Math.min(selectionStartRef.current.x, x),
      y: Math.min(selectionStartRef.current.y, y),
      width: Math.abs(x - selectionStartRef.current.x),
      height: Math.abs(y - selectionStartRef.current.y)
    };

    // 避免过小的区域
    if (newCropArea.width > 5 && newCropArea.height > 5) {
      setCropArea(newCropArea);
    }
  };

  const handleImageMouseUp = (e: React.MouseEvent<HTMLImageElement>) => {
    console.log('🖱️ React鼠标抬起事件触发');
    e.preventDefault();

    isSelectingAreaRef.current = false;
    setIsSelectingArea(false);
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value, images);
  };

  // Sync with existingImages when they change from parent
  useEffect(() => {
    console.log('🔄 RichTextEditor 接收到新的图片列表:', existingImages);
    console.log('📊 图片数量:', existingImages?.length || 0);
    setImages(existingImages || []);
  }, [existingImages]);

  useEffect(() => {
    // Notify parent when images change
    console.log('📤 RichTextEditor 通知父组件图片变化:', images);
    onChange(value, images);
  }, [images]);

  // Cleanup screenshot stream when component unmounts
  useEffect(() => {
    return () => {
      if (screenshotStream) {
        screenshotStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [screenshotStream]);

  return (
    <div className="space-y-3">
      <div className="relative">
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={handleTextChange}
          onPaste={handlePaste}
          placeholder={placeholder}
          rows={rows}
          className={`w-full font-mono text-sm ${className}`}
        />
        <div className="absolute top-2 right-2 flex items-center gap-2">
          <div className="text-xs text-muted-foreground bg-background/80 px-2 py-1 rounded">
            💡 可以粘贴图片
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={startScreenshot}
            className="h-6 text-xs"
            disabled={isScreenshotting}
          >
            <Monitor className="h-3 w-3 mr-1" />
            屏幕截图
          </Button>
        </div>
      </div>

      {/* 屏幕截图预览和裁剪 - 固定在最顶层 */}
      {isScreenshotting && screenshotPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="max-w-4xl w-full max-h-[90vh] overflow-auto p-4 space-y-3">
            <div className="text-sm font-medium">选择要裁剪的区域：</div>
            <div
              className="relative inline-block w-full"
              style={{ pointerEvents: 'auto' }}
            >
              <img
                ref={previewImageRef}
                src={screenshotPreview}
                alt="Screenshot preview"
                className="w-full border rounded cursor-crosshair"
                style={{
                  maxWidth: '100%',
                  pointerEvents: 'auto',
                  userSelect: 'none',
                  display: 'block'
                }}
                draggable={false}
                onMouseDown={handleImageMouseDown}
                onMouseMove={handleImageMouseMove}
                onMouseUp={handleImageMouseUp}
                onMouseLeave={handleImageMouseUp}
              />
              {cropArea && (
                <div
                  className="absolute border-2 border-blue-500 bg-blue-500/20 pointer-events-none"
                  style={{
                    left: `${cropArea.x}px`,
                    top: `${cropArea.y}px`,
                    width: `${cropArea.width}px`,
                    height: `${cropArea.height}px`,
                    pointerEvents: 'none'
                  }}
                />
              )}
            </div>
            <div className="flex gap-2">
              {cropArea ? (
                <>
                  <Button size="sm" onClick={confirmCrop}>
                    确认添加
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setCropArea(null)}>
                    重新选择
                  </Button>
                </>
              ) : (
                <div className="text-xs text-muted-foreground">
                  在图片上拖动鼠标选择区域
                </div>
              )}
              <Button size="sm" variant="ghost" onClick={cancelScreenshot}>
                取消
              </Button>
            </div>
          </Card>
        </div>
      )}

      {images.length > 0 && (
        <div className="space-y-2">
          <div className="text-sm font-medium">已添加的图片：</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {images.map((image, index) => (
              <div key={image.id} className="relative group border rounded-lg p-2 bg-card">
                <div className="relative overflow-hidden rounded">
                  <img
                    src={image.dataUrl}
                    alt={image.name}
                    className="w-full h-32 object-cover"
                  />
                  <Button
                    size="sm"
                    variant="destructive"
                    className="absolute -top-2 -right-2 h-8 w-8 p-0 shadow-lg z-50 rounded-full bg-red-600 hover:bg-red-700 text-white border-2 border-white"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeImage(image.id);
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <div className="text-xs text-muted-foreground mt-1 truncate">
                  {image.name}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
