"use client";

import { useState, useRef, useEffect } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { X, ImageIcon } from "lucide-react";
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

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value, images);
  };

  // Sync with existingImages when they change from parent
  useEffect(() => {
    console.log('🔄 RichTextEditor 接收到新的图片列表:', existingImages);
    setImages(existingImages || []);
  }, [existingImages]);

  useEffect(() => {
    // Notify parent when images change
    console.log('📤 RichTextEditor 通知父组件图片变化:', images);
    onChange(value, images);
  }, [images]);

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
        <div className="absolute top-2 right-2 text-xs text-muted-foreground bg-background/80 px-2 py-1 rounded">
          💡 可以粘贴图片
        </div>
      </div>

      {images.length > 0 && (
        <div className="space-y-2">
          <div className="text-sm font-medium">已粘贴的图片：</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {images.map(image => (
              <Card key={image.id} className="relative p-2">
                <div className="relative group">
                  <img
                    src={image.dataUrl}
                    alt={image.name}
                    className="w-full h-32 object-cover rounded"
                  />
                  <Button
                    size="sm"
                    variant="destructive"
                    className="absolute top-1 right-1 h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => removeImage(image.id)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
                <div className="text-xs text-muted-foreground mt-1 truncate">
                  {image.name}
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
