import React, { useMemo, useEffect, useRef } from 'react';
import katex from 'katex';
import renderMathInElement from 'katex/contrib/auto-render';
import 'katex/dist/katex.min.css';

interface MarkdownRendererProps {
    content: string;
    className?: string;
}

// 链接 href 白名单校验：仅允许站内相对路径与 http(s)，防 javascript: 等注入
const isSafeHref = (href: string): boolean =>
    href.startsWith('/') || href.startsWith('#') || /^https?:\/\//i.test(href);

// 整行仅为"视觉单元"（图片或选项标签）时视为可合并行：
// - markdown 图片 ![alt](src)
// - 裸 <img> 标签
// - div 包裹的上述元素（PaddleOCR 输出形如 <div style="text-align:center;"><img/></div>），
//   内层剥掉图片后允许残留很短的选项标签文本（如 "A."、"①"）
const isVisualUnitLine = (line: string): boolean => {
    const t = line.trim();
    if (!t) return false;
    const divMatch = t.match(/^<div[^>]*>([\s\S]*)<\/div>$/i);
    const inner = divMatch ? divMatch[1] : t;
    const withoutImages = inner
        .replace(/!\[[^\]]*\]\([^)\s]+\)/g, '')
        .replace(/<img\b[^>]*\/?>/gi, '');
    return withoutImages.trim().length <= 10 && !/[<>]/.test(withoutImages);
};

// 相邻视觉单元行合并为一行，并剥掉块级 div 包裹：图片成为外层块容器的行内子元素，
// 横向排成一行而非逐行竖排，且 width="N%" 等百分比尺寸相对外层容器正常生效
// （div 转成 shrink-to-fit 的行内容器会让百分比宽度失效）。行间空行被容忍（合并时
// 丢弃）；遇到普通文本行则结束合并并保留原有空行，图片与正文的段落间距不受影响
const groupConsecutiveVisualLines = (text: string): string => {
    const lines = text.split('\n');
    const out: string[] = [];
    let run: string[] = [];
    let pendingBlanks: string[] = [];
    const flushRun = () => {
        if (run.length > 0) {
            out.push(run
                .join(' ')
                .replace(/<div\b[^>]*>/gi, '')
                .replace(/<\/div>/gi, ' ')
                // Tailwind preflight 将 img 设为 display:block（每图强制独占一行），
                // 合并行内的图片必须恢复行内排列
                .replace(/<img\b([^>]*?)\s*\/?>/gi, (m, attrs: string) => {
                    const inline = /style="/i.test(attrs)
                        ? attrs.replace(/style="/i, 'style="display: inline-block; ')
                        : `${attrs} style="display: inline-block;"`;
                    return `<img ${inline.trim()} />`;
                }));
            run = [];
        }
    };
    for (const line of lines) {
        if (isVisualUnitLine(line)) {
            run.push(line.trim());
            pendingBlanks = [];
        } else if (line.trim() === '' && run.length > 0) {
            pendingBlanks.push(line);
        } else {
            flushRun();
            out.push(...pendingBlanks);
            pendingBlanks = [];
            out.push(line);
        }
    }
    flushRun();
    return out.join('\n');
};

// Simple inline markdown processor
const processInlineMarkdown = (text: string): string => {
    return text
        // Markdown 图片 ![alt](src) → <img>（PaddleOCR 结果中内联的 data URL 图片）；
        // 必须在换行替换前处理（src 中虽无换行，但保持替换顺序清晰）
        .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img src="$2" alt="$1" style="display: inline-block; max-width: 100%; height: auto; vertical-align: middle; margin: 0 2px;" />')
        // Markdown 链接 [text](href) → <a>（图片规则之后处理，剩余的 [..](..) 即链接）；
        // href 不合法时保留原文本
        .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, linkText: string, href: string) =>
            isSafeHref(href) ? `<a href="${href}" style="color: #2563eb; text-decoration: underline;">${linkText}</a>` : match)
        // Bold **text**
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        // Italic *text*
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        // Convert newlines to <br> for display (reduced spacing)
        .replace(/\n\n+/g, '<br/><br/>')
        .replace(/\n/g, '<br/>');
};

// $...$ 有效性校验：内容 trim 后非空，闭合 $ 后不能紧跟数字，
// 避免“价格 $5 和 $6 元”这类金额文本被误判为公式；
// OCR 输出常见 $ \frac{a}{b} $ 形式（$ 两侧带空格），首尾空白允许，渲染时 trim
const isValidInlineDollarMath = (math: string, source: string, endOffset: number): boolean =>
    math.trim().length > 0 && !/^\d/.test(source.slice(endOffset));

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

// 块级 HTML（PaddleOCR 识别结果常含 <table>、列表等）：整块原样渲染。
// 不能走 processInlineMarkdown——其 \n→<br/> 替换会插到表格标签之间，
// 浏览器解析时把非法节点提升到表格外，表格结构被破坏
const buildHtmlBlockRegex = () =>
    /<(table|thead|tbody|tfoot|ul|ol|dl|pre|blockquote)\b[\s\S]*?<\/\1>/gi;

// HTML 块容器：注入后对块内文本再做一次 KaTeX 自动渲染，
// 让表格单元格等位置的 $...$、\(...\) 公式正常显示
const HtmlBlock: React.FC<{ html: string }> = ({ html }) => {
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (containerRef.current) {
            containerRef.current.innerHTML = html;
            renderMathInElement(containerRef.current, {
                delimiters: [
                    { left: '$$', right: '$$', display: true },
                    { left: '\\[', right: '\\]', display: true },
                    { left: '\\(', right: '\\)', display: false },
                    { left: '$', right: '$', display: false },
                ],
                throwOnError: false,
            });
        }
    }, [html]);

    return <div ref={containerRef} />;
};

export function MarkdownRenderer({ content, className = '' }: MarkdownRendererProps) {
    // Process content inline: render mixed markdown and LaTeX without line breaks
    const renderedContent = useMemo(() => {
        if (!content) return null;
        const normalizedContent = groupConsecutiveVisualLines(content);

        const elements: React.ReactNode[] = [];

        // Match LaTeX formulas: \[...\] block, \(...\) inline,
        // plus $$...$$ / $...$（PaddleOCR 等 markdown 输出的常用定界符）
        const latexRegex = /\\\[([\s\S]*?)\\\]|\\\(([\s\S]*?)\\\)|\$\$([\s\S]+?)\$\$|\$([^\n$]+?)\$/g;

        const pushText = (text: string, key: string) => {
            elements.push(
                <span key={key} dangerouslySetInnerHTML={{
                    __html: processInlineMarkdown(text)
                }} />
            );
        };

        // 普通文本段：走 LaTeX + markdown 管线
        const pushTextSegment = (text: string, segIndex: number) => {
            let lastIndex = 0;
            let match;
            latexRegex.lastIndex = 0;

            while ((match = latexRegex.exec(text)) !== null) {
                const start = match.index;
                const raw = match[0];

                if (start > lastIndex) {
                    pushText(text.substring(lastIndex, start), `text-${segIndex}-${lastIndex}`);
                }

                if (match[1] !== undefined) {
                    elements.push(<KatexBlock key={`block-${segIndex}-${start}`} math={match[1]} />);
                } else if (match[2] !== undefined) {
                    elements.push(<KatexInline key={`inline-${segIndex}-${start}`} math={match[2]} />);
                } else if (match[3] !== undefined) {
                    elements.push(<KatexBlock key={`block-${segIndex}-${start}`} math={match[3].trim()} />);
                } else if (match[4] !== undefined && isValidInlineDollarMath(match[4], text, start + raw.length)) {
                    elements.push(<KatexInline key={`inline-${segIndex}-${start}`} math={match[4].trim()} />);
                } else {
                    // 不构成公式的 $...$（如金额）按普通文本输出
                    pushText(raw, `text-${segIndex}-${start}`);
                }

                lastIndex = start + raw.length;
            }

            if (lastIndex < text.length) {
                pushText(text.substring(lastIndex), `text-${segIndex}-${lastIndex}`);
            }
        };

        // 先按块级 HTML 切分，HTML 块原样渲染，其余文本段走常规管线
        const htmlBlockRegex = buildHtmlBlockRegex();
        let cursor = 0;
        let htmlMatch: RegExpExecArray | null;
        let segIndex = 0;

        while ((htmlMatch = htmlBlockRegex.exec(normalizedContent)) !== null) {
            if (htmlMatch.index > cursor) {
                pushTextSegment(normalizedContent.substring(cursor, htmlMatch.index), segIndex);
                segIndex += 1;
            }
            elements.push(<HtmlBlock key={`html-${htmlMatch.index}`} html={htmlMatch[0]} />);
            cursor = htmlMatch.index + htmlMatch[0].length;
        }
        if (cursor < normalizedContent.length) {
            pushTextSegment(normalizedContent.substring(cursor), segIndex);
        }

        return elements;
    }, [content]);

    if (!content) {
        return <div className={`markdown-content min-w-0 break-words ${className}`}></div>;
    }

    // 容器不设滚动（overflow-x-auto 会使 overflow-y 一并变为 auto，
    // 行内内容轻微溢出就出现滚动条），内容自然展开；长公式块自带横向滚动
    return (
        <div
            className={`markdown-content min-w-0 break-words ${className}`}
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
