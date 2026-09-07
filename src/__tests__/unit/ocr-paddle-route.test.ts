/**
 * PaddleOCR 路由单元测试
 *
 * mock 全局 fetch 模拟 提交→轮询→JSONL 下载 全流程
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/logger', () => ({
    createLogger: vi.fn(() => ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        box: vi.fn(),
        divider: vi.fn(),
    })),
}));

vi.mock('next-auth', () => ({
    getServerSession: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
    authOptions: {},
}));

vi.mock('@/lib/prisma', () => ({
    prisma: {
        user: {
            findUnique: vi.fn().mockResolvedValue({ id: 'u1', email: 't@t' }),
        },
    },
}));

vi.mock('@/lib/config', () => ({
    getAppConfig: vi.fn(() => ({
        paddleOcr: { token: 'test-token', model: 'PaddleOCR-VL-1.6' },
    })),
}));

import { getServerSession } from 'next-auth';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

process.env.PADDLE_OCR_POLL_MS = '1';
const { POST } = await import('@/app/api/ocr/paddle/route');

const DATA_URL = `data:image/png;base64,${Buffer.from('fake-png-bytes').toString('base64')}`;

function makeRequest(body: unknown): Request {
    return new Request('http://localhost/api/ocr/paddle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

describe('POST /api/ocr/paddle', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getServerSession).mockResolvedValue({ user: { email: 't@t' } } as never);
    });

    it('未登录返回 401', async () => {
        vi.mocked(getServerSession).mockResolvedValueOnce(null as never);
        const res = await POST(makeRequest({ image: DATA_URL }));
        expect(res.status).toBe(401);
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('缺少 image 返回 400', async () => {
        const res = await POST(makeRequest({}));
        expect(res.status).toBe(400);
    });

    it('data URL 走文件上传并返回拼接后的 markdown', async () => {
        // 1. 提交任务
        mockFetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({ data: { jobId: 'job-1' } }),
        });
        // 2. 轮询：running → done
        mockFetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({ data: { state: 'running' } }),
        });
        mockFetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({ data: { state: 'done', resultUrl: { jsonUrl: 'https://x/result.jsonl' } } }),
        });
        // 3. 下载 JSONL
        const jsonl = [
            JSON.stringify({ result: { layoutParsingResults: [{ markdown: { text: '第一页题目 ![a](img_0.jpg)' } }] } }),
            JSON.stringify({ result: { layoutParsingResults: [{ markdown: { text: '第二页题目' } }] } }),
        ].join('\n');
        mockFetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            text: async () => jsonl,
        });

        const res = await POST(makeRequest({ image: DATA_URL }));
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.markdown).toBe('第一页题目\n\n第二页题目');
        // 图片引用应被剔除
        expect(body.markdown).not.toContain('![');

        // 提交请求应使用 FormData（文件上传模式）
        const [url, init] = mockFetch.mock.calls[0];
        expect(url).toContain('/ocr/jobs');
        expect(init.headers.Authorization).toBe('bearer test-token');
        expect(init.body).toBeInstanceOf(FormData);
        expect(init.body.get('model')).toBe('PaddleOCR-VL-1.6');
    });

    it('HTML img 引用带 images 映射时内联为 data URL，无映射时剔除', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({ data: { jobId: 'job-img' } }),
        });
        mockFetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({ data: { state: 'done', resultUrl: { jsonUrl: 'https://x/r.jsonl' } } }),
        });
        const resolvedSrc = 'data:image/jpeg;base64,QUJD';
        const jsonl = JSON.stringify({
            result: {
                layoutParsingResults: [
                    {
                        markdown: {
                            text: '<div style="text-align: center;"><img src="imgs/img_in_image_box_588_43_722_150.jpg" alt="Image" width="17%" /></div>\n\n未解析：<img src="imgs/missing.jpg" /> 与 ![远程](https://tmp/x.jpg)',
                            images: { 'imgs/img_in_image_box_588_43_722_150.jpg': resolvedSrc },
                        },
                    },
                ],
            },
        });
        mockFetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            text: async () => jsonl,
        });

        const res = await POST(makeRequest({ image: DATA_URL }));
        const body = await res.json();

        expect(res.status).toBe(200);
        // 有映射的相对路径被内联为 data URL
        expect(body.markdown).toContain(`src="${resolvedSrc}"`);
        expect(body.markdown).toContain('width="17%"');
        // 无映射的 HTML img 与 markdown 引用均被剔除
        expect(body.markdown).not.toContain('imgs/');
        expect(body.markdown).not.toContain('<img src="imgs/missing.jpg"');
        expect(body.markdown).not.toContain('![');
    });

    it('markdown 图片引用带 images 映射时同样内联', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({ data: { jobId: 'job-md-img' } }),
        });
        mockFetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({ data: { state: 'done', resultUrl: { jsonUrl: 'https://x/r.jsonl' } } }),
        });
        const resolvedSrc = 'data:image/png;base64,WFla';
        mockFetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            text: async () =>
                JSON.stringify({
                    result: {
                        layoutParsingResults: [
                            { markdown: { text: '看图：![fig](imgs/fig_1.jpg)', images: { 'imgs/fig_1.jpg': resolvedSrc } } },
                        ],
                    },
                }),
        });

        const res = await POST(makeRequest({ image: DATA_URL }));
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.markdown).toBe(`看图：![fig](${resolvedSrc})`);
    });

    it('http URL 走 JSON 模式', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({ data: { jobId: 'job-2' } }),
        });
        mockFetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({ data: { state: 'done', resultUrl: { jsonUrl: 'https://x/r.jsonl' } } }),
        });
        mockFetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ result: { layoutParsingResults: [{ markdown: { text: '图片题目' } }] } }),
        });

        const res = await POST(makeRequest({ image: 'https://example.com/a.png' }));
        expect(res.status).toBe(200);

        const [url, init] = mockFetch.mock.calls[0];
        expect(url).toContain('/ocr/jobs');
        expect(init.body).toContain('fileUrl');
    });

    it('任务失败返回 502 并带上失败原因', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({ data: { jobId: 'job-3' } }),
        });
        mockFetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({ data: { state: 'failed', errorMsg: '图片无法解析' } }),
        });

        const res = await POST(makeRequest({ image: DATA_URL }));
        expect(res.status).toBe(502);
        const body = await res.json();
        expect(body.message).toContain('图片无法解析');
    });

    it('提交失败返回 502', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: false,
            status: 401,
            text: async () => 'unauthorized',
        });
        const res = await POST(makeRequest({ image: DATA_URL }));
        expect(res.status).toBe(502);
    });
});
