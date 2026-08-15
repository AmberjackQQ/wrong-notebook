import React, { useMemo, useEffect, useRef } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

interface MarkdownRendererProps {
    content: string;
    className?: string;
}

// Simple inline markdown processor
const processInlineMarkdown = (text: string): string => {
    return text
        // Bold **text**
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        // Italic *text*
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        // Convert newlines to <br> for display (reduced spacing)
        .replace(/\n\n+/g, '<br/><br/>')
        .replace(/\n/g, '<br/>');
};

// Custom component for KaTeX rendering
const KatexInline: React.FC<{ math: string }> = ({ math }) => {
    const containerRef = useRef<HTMLSpanElement>(null);

    useEffect(() => {
        if (containerRef.current) {
            try {
                katex.render(math, containerRef.current, {
                    displayMode: false,
                    throwOnError: false,
                    errorColor: '#cc0000',
                });
            } catch (error) {
                containerRef.current.innerHTML = `<span style="color: #cc0000;">LaTeX Error</span>`;
            }
        }
    }, [math]);

    return <span ref={containerRef} style={{ display: 'inline-block', margin: '0 1px', verticalAlign: 'middle' }} />;
};

const KatexBlock: React.FC<{ math: string }> = ({ math }) => {
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (containerRef.current) {
            try {
                katex.render(math, containerRef.current, {
                    displayMode: true,
                    throwOnError: false,
                    errorColor: '#cc0000',
                });
            } catch (error) {
                containerRef.current.innerHTML = `<div style="color: #cc0000;">LaTeX Error</div>`;
            }
        }
    }, [math]);

    return (
        <div ref={containerRef} style={{ textAlign: 'center', margin: '2px 0', overflowX: 'auto', overflowY: 'hidden' }} />
    );
};

export function MarkdownRenderer({ content, className = '' }: MarkdownRendererProps) {
    // Process content inline: render mixed markdown and LaTeX without line breaks
    const renderedContent = useMemo(() => {
        if (!content) return null;

        const elements: React.ReactNode[] = [];
        let lastIndex = 0;

        // Match LaTeX formulas: \(...\) for inline, \[...\] for block
        const latexRegex = /\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]/g;
        let match;

        while ((match = latexRegex.exec(content)) !== null) {
            // Add text before LaTeX formula
            if (match.index > lastIndex) {
                const textContent = content.substring(lastIndex, match.index);
                // Process as inline markdown to avoid wrapping in <p>
                elements.push(
                    <span key={`text-${lastIndex}`} dangerouslySetInnerHTML={{
                        __html: processInlineMarkdown(textContent)
                    }} />
                );
            }

            // Add LaTeX formula
            if (match[1] !== undefined) {
                elements.push(<KatexInline key={`inline-${match.index}`} math={match[1]} />);
            } else if (match[2] !== undefined) {
                elements.push(<KatexBlock key={`block-${match.index}`} math={match[2].trim()} />);
            }

            lastIndex = match.index + match[0].length;
        }

        // Add remaining text after last LaTeX formula
        if (lastIndex < content.length) {
            const textContent = content.substring(lastIndex);
            elements.push(
                <span key={`text-${lastIndex}`} dangerouslySetInnerHTML={{
                    __html: processInlineMarkdown(textContent)
                }} />
            );
        }

        return elements;
    }, [content]);

    if (!content) {
        return <div className={`markdown-content overflow-x-auto min-w-0 ${className}`}></div>;
    }

    return (
        <div
            className={`markdown-content overflow-x-auto min-w-0 ${className}`}
            style={{
                lineHeight: '1.0',
                margin: '0',
                padding: '0'
            }}
        >
            <style>{`
                .markdown-content .katex {
                    margin: 2px 0;
                }
                .markdown-content .katex-display {
                    margin: 4px 0;
                }
            `}</style>
            {renderedContent}
        </div>
    );
}
