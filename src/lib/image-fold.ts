// 编辑框里 <img src="data:image/...;base64,XXXX"> 体积巨大，会把编辑框撑爆：
// 显示时把 base64 载荷折叠为 [图片N] 占位符，输入时还原成完整 data URL，
// 保存与渲染始终使用完整内容（展开只认 src="[图片N]" 形式，正文里的同名文字不受影响）
const DATA_IMG_URL_RE = /data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi;
const FOLDED_IMG_SRC_RE = /src=(["'])\[图片(\d+)\]\1/g;

// 折叠并把 base64 载荷存入 tokens（编号与占位符一一对应），供输入时还原
export function foldBase64Images(text: string, tokens: Map<number, string>): string {
    tokens.clear();
    let i = 0;
    return text.replace(DATA_IMG_URL_RE, (dataUrl) => {
        tokens.set(++i, dataUrl);
        return `[图片${i}]`;
    });
}

// 把输入文本里的 [图片N] 占位符还原成 tokens 中对应的完整 data URL
export function expandBase64Images(text: string, tokens: Map<number, string>): string {
    return text.replace(FOLDED_IMG_SRC_RE, (m, quote: string, n: string) => {
        const dataUrl = tokens.get(Number(n));
        return dataUrl ? `src=${quote}${dataUrl}${quote}` : m;
    });
}
