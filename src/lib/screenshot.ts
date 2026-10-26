// 屏幕截图共享逻辑：getDisplayMedia 请求与错误提示文案
// 各截图入口（上传区/富文本编辑器/错题详情页）共用，保证行为与提示一致

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 请求屏幕捕获；NotReadableError（捕获源启动失败，常为瞬时故障）时短暂等待重试一次。
// 注意：CaptureController 只能配合一次 getDisplayMedia，重试时必须换新的（或去掉）
export async function getDisplayStreamWithRetry(
    options: DisplayMediaStreamOptions
): Promise<MediaStream> {
    try {
        return await navigator.mediaDevices.getDisplayMedia(options);
    } catch (error) {
        if ((error as Error)?.name === "NotReadableError") {
            console.warn("屏幕捕获源启动失败，300ms 后自动重试一次");
            await sleep(300);
            const retryOptions: DisplayMediaStreamOptions & { controller?: unknown } = { ...options };
            if (typeof window !== "undefined" && "CaptureController" in window) {
                retryOptions.controller = new (window as unknown as { CaptureController: { new(): unknown } }).CaptureController();
            } else {
                delete retryOptions.controller;
            }
            return navigator.mediaDevices.getDisplayMedia(retryOptions);
        }
        throw error;
    }
}

// 按错误类型给出可操作提示（NotAllowedError=用户取消 由调用方静默处理，不经此函数）
export function screenshotErrorMessage(error: unknown): string {
    const e = error as Error;
    switch (e?.name) {
        case "NotReadableError":
            return "无法启动屏幕捕获源。请先完全重启浏览器再试；若仍失败，请改用 Chrome 或 Edge（部分浏览器如夸克等不支持屏幕捕获），或检查是否处于远程桌面环境。";
        case "NotFoundError":
            return "未找到可用的屏幕捕获源。";
        case "SecurityError":
            return "当前页面环境不允许屏幕捕获（需要 HTTPS 访问）。";
        default:
            return `屏幕截图失败: ${e?.message || "未知错误"}`;
    }
}
