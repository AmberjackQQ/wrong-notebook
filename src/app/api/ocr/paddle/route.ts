import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { unauthorized, badRequest, createErrorResponse, internalError } from "@/lib/api-errors";
import { getAppConfig } from "@/lib/config";
import { createLogger } from "@/lib/logger";

const logger = createLogger('api:ocr:paddle');

const JOB_URL = 'https://paddleocr.aistudio-app.com/api/v2/ocr/jobs';
// 轮询间隔可通过环境变量注入（单测用短间隔），默认与飞桨示例一致
const POLL_INTERVAL_MS = Number(process.env.PADDLE_OCR_POLL_MS) || 5000;
// AI Studio 高峰期任务排队可能超过 3 分钟，给足 5 分钟；客户端超时需大于此值
const MAX_POLL_MS = 300000;

interface PaddleJobResponse {
    data?: {
        jobId?: string;
        state?: 'pending' | 'running' | 'done' | 'failed';
        errorMsg?: string;
        resultUrl?: { jsonUrl?: string };
    };
    errorMsg?: string;
}

interface PaddleJsonlLine {
    result?: {
        layoutParsingResults?: {
            markdown?: {
                text?: string;
                // 相对路径（如 imgs/img_in_image_box_588_43_722_150.jpg）→ 图像内容。
                // 实测 AI Studio 云服务返回临时预签名 URL（URL 返回模式），官方文档另有纯 Base64 模式
                images?: Record<string, string>;
            };
        }[];
    };
}

const IMAGE_MIME_BY_EXT: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
};

function mimeForImage(refPath: string, contentType?: string | null): string {
    const ext = refPath.slice(refPath.lastIndexOf('.') + 1).toLowerCase();
    if (IMAGE_MIME_BY_EXT[ext]) return IMAGE_MIME_BY_EXT[ext];
    if (contentType?.startsWith('image/')) return contentType.split(';')[0];
    return 'image/jpeg';
}

// images 映射值的三种形态及处理：
// 1) data URL → 直接使用；
// 2) http(s) 预签名 URL（AI Studio 实际行为，有失效时间）→ 立即下载转 base64 data URL，
//    实现离线自包含；下载失败时返回原值，交由 inlineImages 末尾的剔除逻辑移除（同样离线不可用）；
//    注意其 content-type 常为 application/octet-stream，MIME 需按扩展名判断
// 3) 纯 Base64（官方文档默认模式）→ 按扩展名补 MIME 前缀
async function toInlineDataUrl(refPath: string, value: string): Promise<string> {
    if (value.startsWith('data:')) return value;
    if (/^https?:\/\//.test(value)) {
        try {
            const res = await fetch(value);
            if (res.ok) {
                const buf = Buffer.from(await res.arrayBuffer());
                return `data:${mimeForImage(refPath, res.headers.get('content-type'))};base64,${buf.toString('base64')}`;
            }
            logger.warn({ refPath, status: res.status }, 'PaddleOCR image download failed');
        } catch (error) {
            logger.warn({ refPath, error }, 'PaddleOCR image download error');
        }
        return value;
    }
    return `data:${mimeForImage(refPath)};base64,${value}`;
}

// 处理 markdown 中的图片引用：
// 1) 结果自带 images 映射时，把文本中的相对路径（HTML src 属性、markdown 链接）内联为
//    base64 data URL，图片即可离线自包含渲染；
// 2) 没有对应映射的引用仍剔除（远程临时链接，离线不可用）。
async function inlineImages(text: string, images?: Record<string, string>): Promise<string> {
    let result = text;
    for (const [path, image] of Object.entries(images || {})) {
        if (typeof image !== 'string' || !image) continue;
        // 字面量全局替换：同一图片可能被引用多次
        result = result.split(path).join(await toInlineDataUrl(path, image));
    }
    // 剔除未解析的 markdown 图片引用（排除已内联的 data URL）
    result = result.replace(/!\[[^\]]*\]\((?!data:)[^)]*\)/g, '');
    // 剔除未解析的 HTML <img> 标签
    result = result.replace(/<img[^>]*src=["'](?!data:)[^"']*["'][^>]*\/?>/g, '');
    return result.trim();
}

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(req: Request) {
    const session = await getServerSession(authOptions);

    try {
        let user;
        if (session?.user?.email) {
            user = await prisma.user.findUnique({
                where: { email: session.user.email },
            });
        }
        if (!user) {
            return unauthorized("Authentication required");
        }

        const body = await req.json();
        const image: string = typeof body?.image === 'string' ? body.image : '';
        if (!image) {
            return badRequest("Missing image");
        }

        const { token, model } = getAppConfig().paddleOcr || {};
        if (!token) {
            return badRequest("未配置飞桨 OCR token");
        }
        const ocrModel = model || 'PaddleOCR-VL-1.6';

        const authHeaders = { Authorization: `bearer ${token}` };
        const optionalPayload = JSON.stringify({
            useDocOrientationClassify: false,
            useDocUnwarping: false,
            useChartRecognition: false,
        });

        // 提交任务：http URL 走 JSON 模式，data URL 走文件上传模式
        let submitResponse: Response;
        if (image.startsWith('http')) {
            submitResponse = await fetch(JOB_URL, {
                method: 'POST',
                headers: { ...authHeaders, 'Content-Type': 'application/json' },
                body: JSON.stringify({ fileUrl: image, model: ocrModel, optionalPayload: JSON.parse(optionalPayload) }),
            });
        } else {
            const match = /^data:([^;,]+);base64,(.+)$/s.exec(image);
            if (!match) {
                return badRequest("无效的图片数据");
            }
            const contentType = match[1];
            const bytes = Buffer.from(match[2], 'base64');
            const form = new FormData();
            form.append('file', new Blob([bytes], { type: contentType }), 'original-image');
            form.append('model', ocrModel);
            form.append('optionalPayload', optionalPayload);
            submitResponse = await fetch(JOB_URL, {
                method: 'POST',
                headers: authHeaders,
                body: form,
            });
        }

        if (!submitResponse.ok) {
            const detail = await submitResponse.text().catch(() => '');
            logger.error({ status: submitResponse.status, detail: detail.slice(0, 500) }, 'PaddleOCR job submit failed');
            return createErrorResponse(`OCR 任务提交失败（${submitResponse.status}）`, 502);
        }
        const submitted = (await submitResponse.json()) as PaddleJobResponse;
        const jobId = submitted.data?.jobId;
        if (!jobId) {
            return createErrorResponse('OCR 任务提交失败：未返回任务 ID', 502);
        }

        // 轮询任务状态
        const deadline = Date.now() + MAX_POLL_MS;
        let jsonUrl = '';
        while (Date.now() < deadline) {
            await sleep(POLL_INTERVAL_MS);
            const statusResponse = await fetch(`${JOB_URL}/${jobId}`, { headers: authHeaders });
            if (!statusResponse.ok) {
                logger.error({ jobId, status: statusResponse.status }, 'PaddleOCR job status fetch failed');
                return createErrorResponse(`查询 OCR 任务状态失败（${statusResponse.status}）`, 502);
            }
            const status = (await statusResponse.json()) as PaddleJobResponse;
            const state = status.data?.state;
            if (state === 'done') {
                jsonUrl = status.data?.resultUrl?.jsonUrl || '';
                break;
            }
            if (state === 'failed') {
                logger.error({ jobId, errorMsg: status.data?.errorMsg }, 'PaddleOCR job failed');
                return createErrorResponse(`OCR 识别失败：${status.data?.errorMsg || '未知原因'}`, 502);
            }
            // pending / running：继续等待
        }
        if (!jsonUrl) {
            return createErrorResponse('OCR 识别超时（AI Studio 服务繁忙或题目较复杂），请稍后重试', 504);
        }

        // 下载 JSONL 结果，拼接每页 markdown 文本
        const jsonlResponse = await fetch(jsonUrl);
        if (!jsonlResponse.ok) {
            return createErrorResponse(`获取 OCR 结果失败（${jsonlResponse.status}）`, 502);
        }
        const lines = (await jsonlResponse.text()).trim().split('\n');
        const pages: string[] = [];
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            const parsed = JSON.parse(trimmed) as PaddleJsonlLine;
            for (const page of parsed.result?.layoutParsingResults || []) {
                const text = page.markdown?.text || '';
                if (text) pages.push(await inlineImages(text, page.markdown?.images));
            }
        }

        return NextResponse.json({ markdown: pages.join('\n\n') });
    } catch (error: unknown) {
        logger.error({ error }, 'PaddleOCR route error');
        return internalError(`OCR 识别失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
}
