import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// buildHtmlBlockRegex 未导出，从源码中提取正则字面量做验证，
// 防止未来改动破坏“div 包裹块级元素整体保留”的行为
const source = readFileSync(
  resolve(__dirname, "../../components/markdown-renderer.tsx"),
  "utf-8"
);
const match = source.match(/const buildHtmlBlockRegex = \(\) =>\s*(\/.+\/gi);/);
if (!match) throw new Error("buildHtmlBlockRegex not found in source");
const buildHtmlBlockRegex = () => new RegExp(match![1].slice(1, -3), "gi");

describe("markdown-renderer 块级 HTML 正则", () => {
  const re = () => buildHtmlBlockRegex();

  it("div 直接包裹 table 时连同 div 与尾部 img 整体匹配", () => {
    const text = `正文段落\n\n<div style="text-align: center;"><table border=1><tr><td>A</td></tr></table><img src="x" width="41%" /></div>\n\n后续`;
    const m = re().exec(text)!;
    expect(m[0].startsWith("<div")).toBe(true);
    expect(m[0].endsWith("</div>")).toBe(true);
    expect(m[0]).toContain("<table");
    expect(m[0]).toContain('<img src="x"');
  });

  it("div 与块级标签之间允许换行缩进", () => {
    const text = `<div style="text-align: center;">\n<ul><li>1</li></ul>\n</div>`;
    expect(re().exec(text)![0]).toBe(text);
  });

  it("table 与 </div> 之间允许 img 与换行组合", () => {
    const text = `<div>\n<table><tr><td>1</td></tr></table>\n<img src="a" />\n<img src="b" /><br/>\n</div>`;
    expect(re().exec(text)![0]).toBe(text);
  });

  it("裸 table 仍单独匹配（无包裹 div 时保持原行为）", () => {
    const text = `前文\n\n<table><tr><td>1</td></tr></table>\n<img src="x" />`;
    const m = re().exec(text)!;
    expect(m[0]).toBe("<table><tr><td>1</td></tr></table>");
  });

  it("div 内含普通文本时不整体匹配，退回抽取内部 table", () => {
    const text = `<div>说明文字<table><tr><td>1</td></tr></table></div>`;
    const m = re().exec(text)!;
    expect(m[0]).toBe("<table><tr><td>1</td></tr></table>");
  });

  it("div 与 table 之间夹其他标签时不误吞（避免跨嵌套截断）", () => {
    const text = `<div>标题</div>\n<table><tr><td>1</td></tr></table>`;
    const m = re().exec(text)!;
    expect(m[0]).toBe("<table><tr><td>1</td></tr></table>");
  });

  it("flex 样式的 div 包裹 table+img 可整体匹配（并排布局场景）", () => {
    const text = `<div style="display: flex; align-items: center; justify-content: center; gap: 10px;"><table border=1><tr><td>I/A</td></tr></table><img src="data:image/png;base64,AAAA" alt="Image" width="41%" /></div>`;
    expect(re().exec(text)![0]).toBe(text);
  });
});
