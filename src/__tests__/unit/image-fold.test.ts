import { describe, it, expect } from "vitest";
import { foldBase64Images, expandBase64Images } from "@/lib/image-fold";

describe("image-fold", () => {
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
  const jpeg = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
  const webp = "data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+OhDg=";

  it("折叠 base64 图片为 [图片N] 占位符并连续编号", () => {
    const tokens = new Map<number, string>();
    const folded = foldBase64Images(
      `<p>前文</p><img src="${png}"><img src="${jpeg}">`,
      tokens
    );
    expect(folded).toBe('<p>前文</p><img src="[图片1]"><img src="[图片2]">');
    expect(tokens.get(1)).toBe(png);
    expect(tokens.get(2)).toBe(jpeg);
    expect(tokens.size).toBe(2);
  });

  it("expand 还原 src 位置上的占位符（round-trip）", () => {
    const tokens = new Map<number, string>();
    const original = `<img src="${webp}"><p>说明</p>`;
    const expanded = expandBase64Images(foldBase64Images(original, tokens), tokens);
    expect(expanded).toBe(original);
  });

  it("正文中独立的 [图片N] 文字不受影响", () => {
    const tokens = new Map<number, string>();
    tokens.set(1, png);
    const text = "如图 [图片1] 所示";
    expect(expandBase64Images(text, tokens)).toBe(text);
  });

  it("未知编号的 src 占位符原样保留", () => {
    const tokens = new Map<number, string>();
    const text = `<img src="[图片9]">`;
    expect(expandBase64Images(text, tokens)).toBe(text);
  });

  it("无图片时 fold 不改变文本且清空旧 tokens", () => {
    const tokens = new Map<number, string>();
    tokens.set(1, png);
    const text = "<p>纯文本</p>";
    expect(foldBase64Images(text, tokens)).toBe(text);
    expect(tokens.size).toBe(0);
  });

  it("支持多种图片格式与不同引号", () => {
    const tokens = new Map<number, string>();
    const original = `<img src='${png}'><img src="${jpeg}">`;
    const folded = foldBase64Images(original, tokens);
    expect(folded).toBe(`<img src='[图片1]'><img src="[图片2]">`);
    expect(expandBase64Images(folded, tokens)).toBe(original);
  });

  it("占位符编号被用户改动后无法还原则原样保留", () => {
    const tokens = new Map<number, string>();
    const original = `<img src="${png}">`;
    const folded = foldBase64Images(original, tokens);
    // 用户把 [图片1] 改成 [图片2]（超出 tokens 范围）
    const edited = folded.replace("[图片1]", "[图片2]");
    expect(expandBase64Images(edited, tokens)).toBe(edited);
  });
});
