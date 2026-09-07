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
const MAX_POLL_MS = 180000;

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
                // 相对路径（如 imgs/img_in_image_box_588_43_722_150.jpg）→ base64 data URL
                images?: Record<string, string>;
            };
        }[];
    };
}

// 处理 markdown 中的图片引用：
// 1) 结果自带 images 映射时，把文本中的相对路径（HTML src 属性、markdown 链接）内联为
//    base64 data URL，图片即可离线自包含渲染；
// 2) 没有对应映射的引用仍剔除（远程临时链接，离线不可用）。
function inlineImages(text: string, images?: Record<string, string>): string {
    let result = text;
    for (const [path, dataUrl] of Object.entries(images || {})) {
        if (typeof dataUrl !== 'string' || !dataUrl) continue;
        // 字面量全局替换：同一图片可能被引用多次
        result = result.split(path).join(dataUrl);
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
            return createErrorResponse('OCR 识别超时，请稍后重试', 504);
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
                if (text) pages.push(inlineImages(text, page.markdown?.images));
            }
        }

        return NextResponse.json({ markdown: pages.join('\n\n') });
    } catch (error: unknown) {
        logger.error({ error }, 'PaddleOCR route error');
        return internalError(`OCR 识别失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
}
