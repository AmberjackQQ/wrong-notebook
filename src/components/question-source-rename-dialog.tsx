"use client";

import { useState, useEffect } from "react";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface RenameQuestionSourceDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    currentName: string;
    onRename: (name: string) => Promise<void>;
}

export function RenameQuestionSourceDialog({ open, onOpenChange, currentName, onRename }: RenameQuestionSourceDialogProps) {
    const [name, setName] = useState(currentName);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (open) setName(currentName);
    }, [open, currentName]);

    const handleRename = async () => {
        if (!name.trim()) return;
        setLoading(true);
        try {
            await onRename(name.trim());
            onOpenChange(false);
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>重命名题目来源</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                    <div className="space-y-2">
                        <Label htmlFor="qs-rename-name">新名称</Label>
                        <Input
                            id="qs-rename-name"
                            value={name}
                            maxLength={200}
                            onChange={(e) => setName(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleRename()}
                        />
                        <p className="text-xs text-muted-foreground">
                            重命名后，已录入错题上的该来源文本会一并更新
                        </p>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        取消
                    </Button>
                    <Button onClick={handleRename} disabled={loading || !name.trim()}>
                        保存
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
