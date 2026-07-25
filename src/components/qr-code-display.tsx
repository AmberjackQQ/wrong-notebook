"use client";

import { QRCodeSVG } from "qrcode.react";
import { generateQRCodeData } from "@/lib/qrcode-generator";

interface QRCodeDisplayProps {
  errorItemId: string;
  size?: number;
  showLabel?: boolean;
  className?: string;
}

/**
 * Display QR code for an error item
 * QR code contains the path to the error item (without domain)
 */
export function QRCodeDisplay({
  errorItemId,
  size = 128,
  showLabel = false,
  className = "",
}: QRCodeDisplayProps) {
  const qrData = generateQRCodeData(errorItemId);

  return (
    <div className={`flex flex-col items-center gap-2 ${className}`}>
      <QRCodeSVG
        value={qrData}
        size={size}
        level="M"
        includeMargin={false}
        className="border-2 border-gray-200 rounded-lg p-2 bg-white"
      />
      {showLabel && (
        <p className="text-xs text-muted-foreground text-center">
          扫码查看本题详情
        </p>
      )}
    </div>
  );
}
