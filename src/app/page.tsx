"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { apiClient, ApiError } from "@/lib/api-client";
import { Bot, Eraser, PenLine, SendHorizontal, Sparkles } from "lucide-react";

interface ChatMessage {
    role: "user" | "assistant";
    content: string;
}

const STORAGE_KEY = "chat-messages";

const SUGGESTIONS = [
    "我要看物理错题",
    "打开数学错题本",
    "看看学习统计",
    "怎么打印错题？",
];

// [[JUMP:url]] 动作令牌：助手回复中建议跳转的站内地址，前端渲染为“立即前往”按钮
const JUMP_REGEX = /\[\[JUMP:([^\]]+)\]\]/g;

const splitJumpAction = (text: string): { display: string; jumpUrl: string | null } => {
    let jumpUrl: string | null = null;
    const display = text
        .replace(JUMP_REGEX, (_, url: string) => {
            if (!jumpUrl && url.startsWith("/")) jumpUrl = url;
            return "";
        })
        // 流式输出中可能存在未闭合的半截令牌，渲染时一并隐藏
        .replace(/\[\[JUMP:[^\]]*$/, "");
    return { display, jumpUrl };
};

export default function ChatHomePage() {
    const router = useRouter();
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState("");
    const [sending, setSending] = useState(false);
    const [streamText, setStreamText] = useState("");
    const [error, setError] = useState<string | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // 会话历史本地持久化，刷新后仍在
    useEffect(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed)) setMessages(parsed.filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string"));
            }
        } catch {
            // 忽略损坏的本地数据
        }
    }, []);

    useEffect(() => {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-50)));
        } catch {
            // 存储不可用时忽略
        }
    }, [messages]);

    // 新内容到达时滚动到底部
    useEffect(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [messages, streamText]);

    const sendMessage = async (text: string) => {
        const trimmed = text.trim();
        if (!trimmed || sending) return;

        setError(null);
        setInput("");
        setStreamText("");
        const history = [...messages, { role: "user" as const, content: trimmed }];
        setMessages(history);
        setSending(true);

        try {
            const res = await fetch("/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    messages: history.slice(-16).map((m) => ({ role: m.role, content: m.content })),
                }),
            });

            if (!res.ok) {
                let message = `请求失败（${res.status}）`;
                try {
                    const data = await res.json();
                    if (data?.error) message = data.error;
                } catch {
                    // 非 JSON 错误响应
                }
                throw new Error(message);
            }

            const reader = res.body?.getReader();
            if (!reader) throw new Error("浏览器不支持流式响应");

            const decoder = new TextDecoder();
            let buffer = "";
            let assistant = "";
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                let newlineIndex: number;
                while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
                    const line = buffer.slice(0, newlineIndex).trim();
                    buffer = buffer.slice(newlineIndex + 1);
                    if (!line.startsWith("data:")) continue;
                    const payload = line.slice(5).trim();
                    if (payload === "[DONE]") continue;
                    try {
                        const evt = JSON.parse(payload);
                        if (typeof evt.text === "string") {
                            assistant += evt.text;
                            setStreamText(assistant);
                        }
                        if (evt.error) throw new Error(evt.error);
                    } catch (parseError) {
                        // 仅忽略 JSON 语法错误（非 JSON 的 SSE 行），业务错误继续抛出
                        if (!(parseError instanceof SyntaxError)) throw parseError;
                    }
                }
            }

            if (assistant.trim()) {
                setMessages((prev) => [...prev, { role: "assistant", content: assistant }]);
            } else {
                throw new Error("AI 没有返回内容，请重试");
            }
        } catch (err) {
            const message = err instanceof ApiError
                ? (err.data as { message?: string } | null)?.message || err.message
                : err instanceof Error ? err.message : "发送失败，请重试";
            setError(message);
        } finally {
            setStreamText("");
            setSending(false);
            textareaRef.current?.focus();
        }
    };

    const clearConversation = () => {
        if (sending) return;
        setMessages([]);
        setError(null);
    };

    const renderAssistant = (content: string, key: string) => {
        const { display, jumpUrl } = splitJumpAction(content);
        return (
            <div key={key} className="flex items-start gap-2">
                <div className="shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center mt-1">
                    <Bot className="w-5 h-5 text-primary" />
                </div>
                <div className="max-w-[85%] rounded-2xl bg-muted px-4 py-3 space-y-2">
                    <MarkdownRenderer content={display} className="text-sm leading-6" />
                    {jumpUrl && (
                        <Button size="sm" className="h-8" onClick={() => router.push(jumpUrl)}>
                            <Sparkles className="w-3.5 h-3.5 mr-1" />
                            立即前往
                        </Button>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div className="flex flex-col h-screen bg-background">
            {/* 顶栏 */}
            <header className="shrink-0 border-b px-3 sm:px-4 py-2.5 flex items-center gap-2">
                <h1 className="text-base sm:text-lg font-bold flex-1">AI 助手</h1>
                <Link href="/upload">
                    <Button variant="ghost" size="sm" title="录入错题">
                        <PenLine className="w-4 h-4 mr-1" />
                        录入
                    </Button>
                </Link>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearConversation}
                    disabled={sending || messages.length === 0}
                    title="清空会话"
                >
                    <Eraser className="w-4 h-4 mr-1" />
                    清空
                </Button>
            </header>

            {/* 消息区 */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto">
                <div className="max-w-3xl mx-auto px-3 sm:px-4 py-4 space-y-4">
                    {messages.length === 0 && !streamText && (
                        <div className="text-center py-10 space-y-4">
                            <div className="w-14 h-14 rounded-2xl bg-primary/10 mx-auto flex items-center justify-center">
                                <Bot className="w-8 h-8 text-primary" />
                            </div>
                            <div>
                                <h2 className="text-lg font-bold">你好，我是智能错题本助手</h2>
                                <p className="text-sm text-muted-foreground mt-1">可以让我帮你查看错题、打开错题本、解答疑问</p>
                            </div>
                            <div className="flex flex-wrap justify-center gap-2">
                                {SUGGESTIONS.map((s) => (
                                    <button
                                        key={s}
                                        className="px-3 py-1.5 rounded-full border bg-muted/40 text-sm hover:bg-muted hover:border-primary/40 transition-colors"
                                        onClick={() => sendMessage(s)}
                                    >
                                        {s}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {messages.map((m, i) =>
                        m.role === "user" ? (
                            <div key={i} className="flex justify-end">
                                <div className="max-w-[85%] rounded-2xl bg-primary text-primary-foreground px-4 py-2.5 text-sm whitespace-pre-wrap break-words">
                                    {m.content}
                                </div>
                            </div>
                        ) : (
                            renderAssistant(m.content, `m-${i}`)
                        )
                    )}

                    {streamText && renderAssistant(streamText, "stream")}

                    {sending && !streamText && (
                        <div className="flex items-start gap-2">
                            <div className="shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center mt-1">
                                <Bot className="w-5 h-5 text-primary" />
                            </div>
                            <div className="rounded-2xl bg-muted px-4 py-3">
                                <span className="inline-flex gap-1">
                                    <span className="w-2 h-2 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:0ms]" />
                                    <span className="w-2 h-2 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:150ms]" />
                                    <span className="w-2 h-2 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:300ms]" />
                                </span>
                            </div>
                        </div>
                    )}

                    {error && (
                        <div className="text-center">
                            <span className="text-sm text-red-500">{error}</span>
                        </div>
                    )}
                </div>
            </div>

            {/* 输入区 */}
            <footer className="shrink-0 border-t p-3 sm:p-4">
                <div className="max-w-3xl mx-auto flex items-end gap-2">
                    <textarea
                        ref={textareaRef}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                                e.preventDefault();
                                sendMessage(input);
                            }
                        }}
                        placeholder="输入消息，Enter 发送，Shift+Enter 换行"
                        rows={1}
                        disabled={sending}
                        className="flex-1 resize-none rounded-xl border bg-muted/30 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 max-h-32 disabled:opacity-60"
                    />
                    <Button
                        size="icon"
                        className="rounded-xl w-10 h-10 shrink-0"
                        onClick={() => sendMessage(input)}
                        disabled={sending || !input.trim()}
                        title="发送"
                    >
                        <SendHorizontal className="w-4 h-4" />
                    </Button>
                </div>
            </footer>
        </div>
    );
}
