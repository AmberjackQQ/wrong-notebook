"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Html5Qrcode,
  Html5QrcodeError,
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
   * Start camera scanning
   */
  const startScanning = async () => {
    setError(null);
    setIsScanning(true);
    setUploadMode(false);

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
      const errorMessage =
        err instanceof Error ? err.message : "Unknown error";
      setError("无法访问摄像头，请检查权限设置: " + errorMessage);
      setIsScanning(false);
    }
  };

  /**
   * Stop camera scanning
   */
  const stopScanning = async () => {
    if (scannerRef.current?.isScanning) {
      await scannerRef.current.stop();
    }
    setIsScanning(false);
  };

  /**
   * Handle file upload for QR code scanning
   */
  const handleFileUpload = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      setError(null);

      try {
        const html5QrCode = new Html5Qrcode("qr-reader");
        const qrCodeMessage = await html5QrCode.scanFile(file, true);

        handleScanSuccess(qrCodeMessage);
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Unknown error";
        setError("无法识别图片中的二维码: " + errorMessage);
      }

      // Reset input
      event.target.value = "";
    },
    []
  );

  /**
   * Handle successful scan
   */
  const handleScanSuccess = (decodedText: string) => {
    // Validate the scanned path
    if (isValidErrorItemPath(decodedText)) {
      onScanSuccess(decodedText);
      stopScanning();
      onClose();
    } else {
      setError("无效的题目二维码，请确保扫描的是错题本题目二维码");
    }
  };

  /**
   * Switch between camera and upload modes
   */
  const switchToUpload = () => {
    stopScanning();
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
