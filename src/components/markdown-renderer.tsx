import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

interface MarkdownRendererProps {
    content: string;
    className?: string;
}

export function MarkdownRenderer({ content, className = '' }: MarkdownRendererProps) {
    // Handle null or undefined content
    if (!content) {
        return <div className={`markdown-content overflow-x-auto min-w-0 ${className}`}></div>;
    }

    // Preprocess content to ensure proper paragraph breaks and LaTeX rendering
    // Convert single line breaks to double line breaks for better readability
    const processedContent = content
        // First, convert literal \n sequences to actual newlines (fix for AI responses)
        .replace(/\\n/g, '\n')
        // Convert LaTeX \(...\) format to Markdown $...$ format for better compatibility
        .replace(/\\\(([^)]+)\\\)/g, '$$$1$$')
        // Convert LaTeX \[...\] format to Markdown $$...$$ format
        .replace(/\\\[([^]]+)\\\]/g, (match, p1) => {
            // 处理多行块级数学公式
            const formula = p1.trim();
            return `\n$$${formula}\n$$\n`;
        })
        // Preserve existing double line breaks with a unique marker
        .replace(/\n\n/g, '\n\n###PRESERVE_BREAK###\n\n')
        // Convert patterns that should be new paragraphs
        .replace(/([。！？；])\n(?!\n)/g, '$1\n\n')  // Chinese punctuation followed by single newline
        .replace(/([.!?;])\s*\n(?!\n)/g, '$1\n\n')   // English punctuation followed by single newline
        .replace(/(\d+\))\s*\n(?!\n)/g, '$1\n\n')    // Numbered items like (1), (2)
        .replace(/([\u2460-\u2473])\s*\n(?!\n)/g, '$1\n\n')  // Circled numbers ①②③
        // Fix: Remove indentation for lines starting with circled numbers or (n) to prevent code block rendering
        .replace(/\n\s+([\u2460-\u2473])/g, '\n$1')
        .replace(/\n\s+(\d+\))/g, '\n$1')
        // Restore preserved double line breaks (use flexible whitespace matching)
        .replace(/\s*###PRESERVE_BREAK###\s*/g, '\n\n');

    // Debug: 测试LaTeX解析
    console.log('🔍 Original content preview:', content.substring(0, 100) + '...');
    console.log('🔍 Processed content preview:', processedContent.substring(0, 100) + '...');

    return (
        <div className={`markdown-content overflow-x-auto min-w-0 ${className}`}>
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeKatex]}
                components={{
                    // 自定义样式
                    h1: ({ node, ...props }) => <h1 className="text-2xl font-bold mt-6 mb-4" {...props} />,
                    h2: ({ node, ...props }) => <h2 className="text-xl font-bold mt-5 mb-3" {...props} />,
                    h3: ({ node, ...props }) => <h3 className="text-lg font-bold mt-4 mb-2" {...props} />,
                    p: ({ node, ...props }) => <p className="mb-3 leading-relaxed" {...props} />,
                    ul: ({ node, ...props }) => <ul className="list-disc list-inside mb-3 space-y-1" {...props} />,
                    ol: ({ node, ...props }) => <ol className="list-decimal list-inside mb-3 space-y-1" {...props} />,
                    li: ({ node, ...props }) => <li className="ml-4" {...props} />,
                    blockquote: ({ node, ...props }) => (
                        <blockquote className="border-l-4 border-primary pl-4 italic my-4 text-muted-foreground" {...props} />
                    ),
                    code: ({ node, inline, className, children, ...props }: any) => {
                        if (inline) {
                            return <code className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono text-foreground" {...props}>{children}</code>;
                        }
                        return (
                            <code className="block bg-muted p-4 rounded-lg overflow-x-auto my-3 font-mono text-sm" {...props}>
                                {children}
                            </code>
                        );
                    },
                    table: ({ node, ...props }) => (
                        <div className="overflow-x-auto my-4">
                            <table className="min-w-full border-collapse border border-border" {...props} />
                        </div>
                    ),
                    th: ({ node, ...props }) => (
                        <th className="border border-border px-4 py-2 bg-muted font-semibold text-left" {...props} />
                    ),
                    td: ({ node, ...props }) => (
                        <td className="border border-border px-4 py-2" {...props} />
                    ),
                    strong: ({ node, ...props }) => <strong className="font-bold text-foreground" {...props} />,
                    em: ({ node, ...props }) => <em className="italic" {...props} />,
                }}
            >
                {processedContent}
            </ReactMarkdown>
        </div>
    );
}
