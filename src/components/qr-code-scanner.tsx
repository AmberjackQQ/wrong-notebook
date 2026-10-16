"use client";

import { useEffect, useRef, useState } from "react";
import {
  Html5Qrcode,
} from "html5-qrcode";
import { Button } from "@/components/ui/button";
import { X, Camera, Upload } from "lucide-react";
import { isValidErrorItemPath } from "@/lib/qrcode-generator";

interface QRCodeScannerProps {
  onScanSuccess: (path: string) => void;
  onClose: () => void;
}

/**
 * QR Code Scanner Component
 * Supports both camera scanning and image upload
 */
export function QRCodeScanner({ onScanSuccess, onClose }: QRCodeScannerProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const fileScannerRef = useRef<Html5Qrcode | null>(null);
  // html5-qrcode 的状态机不允许并发的 start/stop（会抛
  // "Cannot transition to a new state, already under transition"），
  // 用过渡锁串行化所有摄像头启停
  const transitioningRef = useRef(false);
  // 摄像头每秒解码多次，只处理第一帧成功结果
  const handledRef = useRef(false);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadMode, setUploadMode] = useState(false);

  useEffect(() => {
    const scanner = new Html5Qrcode("qr-reader");
    scannerRef.current = scanner;

    return () => {
      if (scanner.isScanning) {
        scanner.stop().catch(console.error);
      }
    };
  }, []);

  /**
   * Handle successful scan
   */
  const handleScanSuccess = async (decodedText: string) => {
    // 摄像头模式 fps=10 会连续解码同一码，只认第一帧
    if (handledRef.current) return;
    // Validate the scanned path
    if (isValidErrorItemPath(decodedText)) {
      handledRef.current = true;
      // 先停掉摄像头再通知父组件：父组件会立刻卸载本组件，
      // 若停在回调之后，卸载清理和这里的 stop 会并发冲突
      await stopScanning();
      onScanSuccess(decodedText);
      onClose();
    } else {
      setError("无效的题目二维码，请确保扫描的是错题本题目二维码");
    }
  };

  /**
   * Start camera scanning
   */
  const startScanning = async () => {
    setError(null);
    setIsScanning(true);
    setUploadMode(false);

    if (transitioningRef.current) return;
    transitioningRef.current = true;
    try {
      await scannerRef.current?.start(
        { facingMode: "environment" }, // Use back camera on mobile
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
        },
        (decodedText) => {
          handleScanSuccess(decodedText);
        },
        (errorMessage) => {
          // Scan warnings are usually OK, ignore them
          console.warn("QR scan warning:", errorMessage);
        }
      );
    } catch (err) {
      // 组件卸载/模式切换导致的启动中断属正常流程，静默忽略
      if (String(err).includes("transition")) {
        return;
      }
      const errorMessage =
        err instanceof Error ? err.message : "Unknown error";
      setError("无法访问摄像头，请检查权限设置: " + errorMessage);
      setIsScanning(false);
    } finally {
      transitioningRef.current = false;
    }
  };

  /**
   * Stop camera scanning
   */
  const stopScanning = async () => {
    if (transitioningRef.current) return;
    if (scannerRef.current?.isScanning) {
      transitioningRef.current = true;
      try {
        await scannerRef.current.stop();
      } catch (err) {
        // 已在过渡中（如卸载清理已触发 stop）时忽略，避免状态机冲突抛错
        console.warn("QR scanner stop ignored:", err);
      } finally {
        transitioningRef.current = false;
      }
    }
    setIsScanning(false);
  };

  /**
   * Handle file upload for QR code scanning
   */
  const handleFileUpload = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setError(null);

    try {
      // Must be created against the hidden qr-file-reader element,
      // which only exists in upload mode
      if (!fileScannerRef.current) {
        fileScannerRef.current = new Html5Qrcode("qr-file-reader");
      }
      const qrCodeMessage = await fileScannerRef.current.scanFile(file, true);

      handleScanSuccess(qrCodeMessage);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : String(err ?? "Unknown error");
      setError("无法识别图片中的二维码: " + errorMessage);
    }

    // Reset input
    event.target.value = "";
  };

  /**
   * Switch between camera and upload modes
   */
  const switchToUpload = async () => {
    // 等摄像头停稳再切换：卸载 qr-reader 元素会让进行中的 stop 失败
    await stopScanning();
    setUploadMode(true);
    setError(null);
  };

  const switchToCamera = () => {
    setUploadMode(false);
    setError(null);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="bg-background rounded-lg shadow-xl max-w-md w-full p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">扫描二维码</h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* QR Code reader area */}
        {!uploadMode ? (
          <div id="qr-reader" className="w-full overflow-hidden rounded-lg" />
        ) : (
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 flex flex-col items-center justify-center">
            <Upload className="h-12 w-12 text-gray-400 mb-4" />
            <p className="text-sm text-muted-foreground text-center mb-4">
              上传包含二维码的图片
            </p>
            <input
              type="file"
              accept="image/*"
              onChange={handleFileUpload}
              className="hidden"
              id="qr-upload"
            />
            {/* Hidden decoder element required by scanFile in upload mode */}
            <div id="qr-file-reader" className="hidden" />
            <label htmlFor="qr-upload">
              <Button asChild>
                <span>选择图片</span>
              </Button>
            </label>
          </div>
        )}

        {/* Error message */}
        {error && <p className="text-sm text-destructive">{error}</p>}

        {/* Control buttons */}
        <div className="flex gap-2">
          {!isScanning && !uploadMode ? (
            <>
              <Button onClick={startScanning} className="flex-1">
                <Camera className="mr-2 h-4 w-4" />
                启动摄像头
              </Button>
              <Button
                onClick={switchToUpload}
                variant="outline"
                className="flex-1"
              >
                <Upload className="mr-2 h-4 w-4" />
                上传图片
              </Button>
            </>
          ) : !uploadMode ? (
            <Button onClick={stopScanning} variant="outline" className="w-full">
              停止扫描
            </Button>
          ) : (
            <Button
              onClick={switchToCamera}
              variant="outline"
              className="w-full"
            >
              <Camera className="mr-2 h-4 w-4" />
              切换到摄像头
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
