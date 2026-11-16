/**
 * /api/knowledge API 集成测试
 * 知识库文档：列表 / 上传 / 元数据 / 修改 / 删除 / PDF 文件流
 * 磁盘存储层 @/lib/knowledge-storage 全量 mock，不触真实文件系统
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';

const mocks = vi.hoisted(() => ({
    mockPrismaUser: {
        findUnique: vi.fn(),
    },
    mockPrismaSubject: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
    },
    mockPrismaKnowledgeDoc: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
    },
    mockSavePdf: vi.fn(),
    mockDeletePdf: vi.fn(),
    mockPdfExists: vi.fn(),
    mockOpenPdfStream: vi.fn(),
    mockClassifyKnowledgeDoc: vi.fn(),
    mockSession: {
        user: {
            email: 'user@example.com',
            name: 'Test User',
        },
        expires: '2025-12-31',
    },
}));

vi.mock('@/lib/prisma', () => ({
    prisma: {
        user: mocks.mockPrismaUser,
        subject: mocks.mockPrismaSubject,
        knowledgeDoc: mocks.mockPrismaKnowledgeDoc,
    },
}));

vi.mock('next-auth', () => ({
    getServerSession: vi.fn(() => Promise.resolve(mocks.mockSession)),
}));

vi.mock('@/lib/auth', () => ({
    authOptions: {},
}));

vi.mock('@/lib/knowledge-storage', () => ({
    KNOWLEDGE_DOC_TYPES: ['textbook', 'guide', 'exercise', 'exam'],
    isValidPdfFilename: vi.fn((name: string) => /\.pdf$/i.test(name)),
    savePdf: mocks.mockSavePdf,
    deletePdf: mocks.mockDeletePdf,
    pdfExists: mocks.mockPdfExists,
    getDocPath: vi.fn((userId: string, storageName: string) => `/data/uploads/knowledge/${userId}/${storageName}`),
    openPdfStream: mocks.mockOpenPdfStream,
}));

vi.mock('@/lib/knowledge-classifier', () => ({
    classifyKnowledgeDoc: mocks.mockClassifyKnowledgeDoc,
}));

import { GET as GET_LIST, POST } from '@/app/api/knowledge/route';
import { GET as GET_ONE, PATCH, DELETE as DELETE_DOC } from '@/app/api/knowledge/[id]/route';
import { GET as GET_FILE } from '@/app/api/knowledge/[id]/file/route';
import { getServerSession } from 'next-auth';

const MOCK_USER = { id: 'user-123', email: 'user@example.com' };

function makePdfForm(opts?: { filename?: string; size?: number; docType?: string; subjectId?: string; displayName?: string }) {
    const fd = new FormData();
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF"
    const file = new File([pdfBytes], opts?.filename || 'a.pdf', { type: 'application/pdf' });
    if (opts?.size !== undefined) {
        Object.defineProperty(file, 'size', { value: opts.size });
    }
    // jsdom 的 File 没有 arrayBuffer()，路由用它读字节，这里补上
    Object.defineProperty(file, 'arrayBuffer', { value: async () => pdfBytes.buffer.slice(0) });
    fd.append('file', file);
    if (opts?.docType !== undefined) fd.append('docType', opts.docType);
    if (opts?.subjectId !== undefined) fd.append('subjectId', opts.subjectId);
    if (opts?.displayName !== undefined) fd.append('displayName', opts.displayName);
    return fd;
}

// jsdom 环境的 Request 没有 formData()，用桩对象替代（POST 路由只用到 url + formData）
function makeUploadRequest(fd: FormData): Request {
    return { url: 'http://localhost/api/knowledge', formData: async () => fd } as unknown as Request;
}

const OWNED_DOC = {
    id: 'doc-1',
    userId: 'user-123',
    filename: '数学必修一.pdf',
    storageName: 'uuid-1.pdf',
    displayName: '数学必修一',
    docType: 'textbook',
    size: 12345,
    subjectId: 'sub-1',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    subject: { id: 'sub-1', name: '数学' },
};

describe('/api/knowledge', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.mockPrismaUser.findUnique.mockResolvedValue(MOCK_USER);
        vi.mocked(getServerSession).mockResolvedValue(mocks.mockSession);
        mocks.mockSavePdf.mockResolvedValue('uuid-new.pdf');
        mocks.mockDeletePdf.mockResolvedValue(undefined);
        mocks.mockPdfExists.mockReturnValue(true);
        mocks.mockOpenPdfStream.mockReturnValue(
            Readable.toWeb(Readable.from([Buffer.from('%PDF-fake')])) as unknown as ReadableStream<Uint8Array>
        );
    });

    describe('鉴权', () => {
        it('未登录返回 401（列表 / 上传 / 元数据 / 删除 / 文件流）', async () => {
            vi.mocked(getServerSession).mockResolvedValue(null as unknown as typeof mocks.mockSession);

            expect((await GET_LIST(new Request('http://localhost/api/knowledge'))).status).toBe(401);
            expect((await POST(makeUploadRequest(makePdfForm()))).status).toBe(401);
            expect((await GET_ONE(new Request('http://localhost/api/knowledge/doc-1'), { params: Promise.resolve({ id: 'doc-1' }) })).status).toBe(401);
            expect((await DELETE_DOC(new Request('http://localhost/api/knowledge/doc-1', { method: 'DELETE' }), { params: Promise.resolve({ id: 'doc-1' }) })).status).toBe(401);
            expect((await GET_FILE(new Request('http://localhost/api/knowledge/doc-1/file'), { params: Promise.resolve({ id: 'doc-1' }) })).status).toBe(401);
            expect(mocks.mockSavePdf).not.toHaveBeenCalled();
            expect(mocks.mockPrismaKnowledgeDoc.delete).not.toHaveBeenCalled();
        });
    });

    describe('GET /api/knowledge (列表)', () => {
        it('返回分页结构', async () => {
            mocks.mockPrismaKnowledgeDoc.count.mockResolvedValue(1);
            // 模拟路由 select 已排除 storageName（真实 Prisma 行为）
            const { storageName: _ignored, ...slimDoc } = OWNED_DOC;
            mocks.mockPrismaKnowledgeDoc.findMany.mockResolvedValue([slimDoc]);

            const res = await GET_LIST(new Request('http://localhost/api/knowledge?page=2&pageSize=10'));
            const data = await res.json();

            expect(res.status).toBe(200);
            expect(data.total).toBe(1);
            expect(data.page).toBe(2);
            expect(data.pageSize).toBe(10);
            expect(data.totalPages).toBe(1);
            expect(data.items[0].displayName).toBe('数学必修一');
            // 列表不泄露磁盘存储名
            expect(JSON.stringify(data)).not.toContain('uuid-1.pdf');
        });

        it('subjectId=none 过滤未分类（subjectId: null）', async () => {
            mocks.mockPrismaKnowledgeDoc.count.mockResolvedValue(0);
            mocks.mockPrismaKnowledgeDoc.findMany.mockResolvedValue([]);

            await GET_LIST(new Request('http://localhost/api/knowledge?subjectId=none'));

            expect(mocks.mockPrismaKnowledgeDoc.count).toHaveBeenCalledWith(
                expect.objectContaining({ where: expect.objectContaining({ subjectId: null }) })
            );
        });

        it('docType + query 组合过滤', async () => {
            mocks.mockPrismaKnowledgeDoc.count.mockResolvedValue(0);
            mocks.mockPrismaKnowledgeDoc.findMany.mockResolvedValue([]);

            await GET_LIST(new Request('http://localhost/api/knowledge?docType=exam&query=%E6%9C%9F%E6%9C%AB'));

            const arg = mocks.mockPrismaKnowledgeDoc.count.mock.calls[0][0];
            expect(arg.where.docType).toBe('exam');
            expect(arg.where.OR).toEqual([
                { filename: { contains: '期末' } },
                { displayName: { contains: '期末' } },
            ]);
        });

        it('非法 docType 不进入过滤条件', async () => {
            mocks.mockPrismaKnowledgeDoc.count.mockResolvedValue(0);
            mocks.mockPrismaKnowledgeDoc.findMany.mockResolvedValue([]);

            await GET_LIST(new Request('http://localhost/api/knowledge?docType=hack'));

            const arg = mocks.mockPrismaKnowledgeDoc.count.mock.calls[0][0];
            expect(arg.where.docType).toBeUndefined();
        });
    });

    describe('POST /api/knowledge (上传)', () => {
        it('成功上传：savePdf 收到 userId + Buffer，建库成功返回 201', async () => {
            mocks.mockPrismaSubject.findFirst.mockResolvedValue({ id: 'sub-1', name: '数学' });
            mocks.mockPrismaKnowledgeDoc.create.mockResolvedValue(OWNED_DOC);

            const res = await POST(makeUploadRequest(makePdfForm({ subjectId: 'sub-1', docType: 'guide', displayName: '教辅A' })));
            const data = await res.json();

            expect(res.status).toBe(201);
            expect(data.displayName).toBe('数学必修一');
            expect(mocks.mockSavePdf).toHaveBeenCalledTimes(1);
            const [calledUserId, calledData] = mocks.mockSavePdf.mock.calls[0];
            expect(calledUserId).toBe('user-123');
            expect(Buffer.isBuffer(calledData)).toBe(true);
            expect(mocks.mockPrismaKnowledgeDoc.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        userId: 'user-123',
                        subjectId: 'sub-1',
                        docType: 'guide',
                        displayName: '教辅A',
                    }),
                })
            );
            expect(mocks.mockDeletePdf).not.toHaveBeenCalled();
        });

        it('缺少文件返回 400', async () => {
            const fd = new FormData();
            const res = await POST(makeUploadRequest(fd));

            expect(res.status).toBe(400);
            expect(mocks.mockSavePdf).not.toHaveBeenCalled();
        });

        it('非 PDF 扩展名返回 400', async () => {
            const fd = new FormData();
            fd.append('file', new File([new Uint8Array([0x00])], 'a.txt', { type: 'text/plain' }));

            const res = await POST(makeUploadRequest(fd));

            expect(res.status).toBe(400);
            expect(mocks.mockSavePdf).not.toHaveBeenCalled();
        });

        it('超过 200MB 返回 400', async () => {
            const res = await POST(makeUploadRequest(makePdfForm({ size: 201 * 1024 * 1024 })));

            expect(res.status).toBe(400);
            expect(mocks.mockSavePdf).not.toHaveBeenCalled();
        });

        it('非法 docType 返回 400', async () => {
            const res = await POST(makeUploadRequest(makePdfForm({ docType: 'other' })));

            expect(res.status).toBe(400);
            expect(mocks.mockSavePdf).not.toHaveBeenCalled();
        });

        it('subjectId 不属于当前用户返回 404', async () => {
            mocks.mockPrismaSubject.findFirst.mockResolvedValue(null);

            const res = await POST(makeUploadRequest(makePdfForm({ subjectId: 'sub-other' })));

            expect(res.status).toBe(404);
            expect(mocks.mockSavePdf).not.toHaveBeenCalled();
        });

        it('建库失败时回滚删除已落盘文件', async () => {
            mocks.mockPrismaKnowledgeDoc.create.mockRejectedValue(new Error('db down'));

            const res = await POST(makeUploadRequest(makePdfForm()));

            expect(res.status).toBe(500);
            expect(mocks.mockSavePdf).toHaveBeenCalledTimes(1);
            expect(mocks.mockDeletePdf).toHaveBeenCalledWith('user-123', 'uuid-new.pdf');
        });
    });

    describe('POST /api/knowledge (auto 自动分类)', () => {
        const USER_SUBJECTS = [
            { id: 'sub-math', name: '数学' },
            { id: 'sub-english', name: '英语' },
        ];

        it('docType=auto + subjectId=auto：分类成功 201，落库解析值 + classification.method', async () => {
            mocks.mockPrismaSubject.findMany.mockResolvedValue(USER_SUBJECTS);
            mocks.mockClassifyKnowledgeDoc.mockResolvedValue({ docType: 'exam', subjectId: 'sub-math', method: 'ai' });
            mocks.mockPrismaKnowledgeDoc.create.mockResolvedValue({ ...OWNED_DOC, docType: 'exam', subjectId: 'sub-math' });

            const res = await POST(makeUploadRequest(makePdfForm({ docType: 'auto', subjectId: 'auto' })));
            const data = await res.json();

            expect(res.status).toBe(201);
            expect(data.docType).toBe('exam');
            expect(data.subjectId).toBe('sub-math');
            expect(data.classification).toEqual({ method: 'ai' });
            expect(mocks.mockClassifyKnowledgeDoc).toHaveBeenCalledWith(
                'a.pdf',
                expect.any(Buffer),
                USER_SUBJECTS
            );
            expect(mocks.mockPrismaKnowledgeDoc.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ docType: 'exam', subjectId: 'sub-math' }),
                })
            );
        });

        it('分类返回 subjectId=null 时落库未分类', async () => {
            mocks.mockPrismaSubject.findMany.mockResolvedValue(USER_SUBJECTS);
            mocks.mockClassifyKnowledgeDoc.mockResolvedValue({ docType: 'guide', subjectId: null, method: 'heuristic' });
            mocks.mockPrismaKnowledgeDoc.create.mockResolvedValue({ ...OWNED_DOC, docType: 'guide', subjectId: null });

            const res = await POST(makeUploadRequest(makePdfForm({ docType: 'auto', subjectId: 'auto' })));
            const data = await res.json();

            expect(res.status).toBe(201);
            expect(data.subjectId).toBeNull();
            expect(mocks.mockPrismaKnowledgeDoc.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ docType: 'guide', subjectId: null }),
                })
            );
        });

        it('分类器抛错不阻断上传：仍 201 且退 textbook/未分类/method=fallback', async () => {
            mocks.mockPrismaSubject.findMany.mockResolvedValue(USER_SUBJECTS);
            mocks.mockClassifyKnowledgeDoc.mockRejectedValue(new Error('boom'));
            mocks.mockPrismaKnowledgeDoc.create.mockResolvedValue({ ...OWNED_DOC, docType: 'textbook', subjectId: null });

            const res = await POST(makeUploadRequest(makePdfForm({ docType: 'auto', subjectId: 'auto' })));
            const data = await res.json();

            expect(res.status).toBe(201);
            expect(data.docType).toBe('textbook');
            expect(data.subjectId).toBeNull();
            expect(data.classification).toEqual({ method: 'fallback' });
        });

        it('显式 docType + subjectId=auto：手动类型优先，学科来自分类器', async () => {
            mocks.mockPrismaSubject.findMany.mockResolvedValue(USER_SUBJECTS);
            mocks.mockClassifyKnowledgeDoc.mockResolvedValue({ docType: 'exam', subjectId: 'sub-english', method: 'ai' });
            mocks.mockPrismaKnowledgeDoc.create.mockResolvedValue({ ...OWNED_DOC, docType: 'exam', subjectId: 'sub-english' });

            const res = await POST(makeUploadRequest(makePdfForm({ docType: 'exam', subjectId: 'auto' })));

            expect(res.status).toBe(201);
            expect(mocks.mockPrismaKnowledgeDoc.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ docType: 'exam', subjectId: 'sub-english' }),
                })
            );
        });

        it('docType=auto + 显式 subjectId：类型来自分类器，学科保持手动值', async () => {
            mocks.mockPrismaSubject.findFirst.mockResolvedValue({ id: 'sub-math', name: '数学' });
            mocks.mockPrismaSubject.findMany.mockResolvedValue(USER_SUBJECTS);
            mocks.mockClassifyKnowledgeDoc.mockResolvedValue({ docType: 'exercise', subjectId: 'sub-english', method: 'ai' });
            mocks.mockPrismaKnowledgeDoc.create.mockResolvedValue({ ...OWNED_DOC, docType: 'exercise', subjectId: 'sub-math' });

            const res = await POST(makeUploadRequest(makePdfForm({ docType: 'auto', subjectId: 'sub-math' })));
            const data = await res.json();

            expect(res.status).toBe(201);
            expect(mocks.mockPrismaKnowledgeDoc.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ docType: 'exercise', subjectId: 'sub-math' }),
                })
            );
            // 手动指定学科时不应用分类器的 subjectId
            expect(data.subjectId).toBe('sub-math');
        });
    });

    describe('GET /api/knowledge/[id] (元数据)', () => {
        it('返回文档元数据且不泄露 storageName', async () => {
            mocks.mockPrismaKnowledgeDoc.findFirst.mockResolvedValue(OWNED_DOC);

            const res = await GET_ONE(new Request('http://localhost/api/knowledge/doc-1'), { params: Promise.resolve({ id: 'doc-1' }) });
            const data = await res.json();

            expect(res.status).toBe(200);
            expect(data.id).toBe('doc-1');
            expect(data.storageName).toBeUndefined();
        });

        it('他人文档返回 404', async () => {
            mocks.mockPrismaKnowledgeDoc.findFirst.mockResolvedValue(null);

            const res = await GET_ONE(new Request('http://localhost/api/knowledge/doc-1'), { params: Promise.resolve({ id: 'doc-1' }) });

            expect(res.status).toBe(404);
        });
    });

    describe('PATCH /api/knowledge/[id]', () => {
        it('修改 displayName', async () => {
            mocks.mockPrismaKnowledgeDoc.findFirst.mockResolvedValue(OWNED_DOC);
            mocks.mockPrismaKnowledgeDoc.update.mockResolvedValue({ ...OWNED_DOC, displayName: '新名字' });

            const req = new Request('http://localhost/api/knowledge/doc-1', {
                method: 'PATCH',
                body: JSON.stringify({ displayName: '  新名字  ' }),
                headers: { 'Content-Type': 'application/json' },
            });
            const res = await PATCH(req, { params: Promise.resolve({ id: 'doc-1' }) });
            const data = await res.json();

            expect(res.status).toBe(200);
            expect(data.displayName).toBe('新名字');
            expect(mocks.mockPrismaKnowledgeDoc.update).toHaveBeenCalledWith(
                expect.objectContaining({ data: { displayName: '新名字' } })
            );
        });

        it('displayName 超长返回 400', async () => {
            mocks.mockPrismaKnowledgeDoc.findFirst.mockResolvedValue(OWNED_DOC);

            const req = new Request('http://localhost/api/knowledge/doc-1', {
                method: 'PATCH',
                body: JSON.stringify({ displayName: 'a'.repeat(201) }),
                headers: { 'Content-Type': 'application/json' },
            });
            const res = await PATCH(req, { params: Promise.resolve({ id: 'doc-1' }) });

            expect(res.status).toBe(400);
        });

        it('修改 subjectId：合法学科通过归属校验', async () => {
            mocks.mockPrismaKnowledgeDoc.findFirst.mockResolvedValue(OWNED_DOC);
            mocks.mockPrismaSubject.findFirst.mockResolvedValue({ id: 'sub-9', name: '物理' });
            mocks.mockPrismaKnowledgeDoc.update.mockResolvedValue({ ...OWNED_DOC, subjectId: 'sub-9' });

            const req = new Request('http://localhost/api/knowledge/doc-1', {
                method: 'PATCH',
                body: JSON.stringify({ subjectId: 'sub-9' }),
                headers: { 'Content-Type': 'application/json' },
            });
            const res = await PATCH(req, { params: Promise.resolve({ id: 'doc-1' }) });

            expect(res.status).toBe(200);
            expect(mocks.mockPrismaKnowledgeDoc.update).toHaveBeenCalledWith(
                expect.objectContaining({ data: { subjectId: 'sub-9' } })
            );
        });

        it('subjectId=null 转未分类（不查学科表）', async () => {
            mocks.mockPrismaKnowledgeDoc.findFirst.mockResolvedValue(OWNED_DOC);
            mocks.mockPrismaKnowledgeDoc.update.mockResolvedValue({ ...OWNED_DOC, subjectId: null });

            const req = new Request('http://localhost/api/knowledge/doc-1', {
                method: 'PATCH',
                body: JSON.stringify({ subjectId: null }),
                headers: { 'Content-Type': 'application/json' },
            });
            await PATCH(req, { params: Promise.resolve({ id: 'doc-1' }) });

            expect(mocks.mockPrismaSubject.findFirst).not.toHaveBeenCalled();
            expect(mocks.mockPrismaKnowledgeDoc.update).toHaveBeenCalledWith(
                expect.objectContaining({ data: { subjectId: null } })
            );
        });

        it('subjectId 属于他人返回 404', async () => {
            mocks.mockPrismaKnowledgeDoc.findFirst.mockResolvedValue(OWNED_DOC);
            mocks.mockPrismaSubject.findFirst.mockResolvedValue(null);

            const req = new Request('http://localhost/api/knowledge/doc-1', {
                method: 'PATCH',
                body: JSON.stringify({ subjectId: 'sub-other' }),
                headers: { 'Content-Type': 'application/json' },
            });
            const res = await PATCH(req, { params: Promise.resolve({ id: 'doc-1' }) });

            expect(res.status).toBe(404);
            expect(mocks.mockPrismaKnowledgeDoc.update).not.toHaveBeenCalled();
        });

        it('非法 docType 返回 400', async () => {
            mocks.mockPrismaKnowledgeDoc.findFirst.mockResolvedValue(OWNED_DOC);

            const req = new Request('http://localhost/api/knowledge/doc-1', {
                method: 'PATCH',
                body: JSON.stringify({ docType: 'other' }),
                headers: { 'Content-Type': 'application/json' },
            });
            const res = await PATCH(req, { params: Promise.resolve({ id: 'doc-1' }) });

            expect(res.status).toBe(400);
        });

        it('无任何可更新字段返回 400', async () => {
            mocks.mockPrismaKnowledgeDoc.findFirst.mockResolvedValue(OWNED_DOC);

            const req = new Request('http://localhost/api/knowledge/doc-1', {
                method: 'PATCH',
                body: JSON.stringify({}),
                headers: { 'Content-Type': 'application/json' },
            });
            const res = await PATCH(req, { params: Promise.resolve({ id: 'doc-1' }) });

            expect(res.status).toBe(400);
            expect(mocks.mockPrismaKnowledgeDoc.update).not.toHaveBeenCalled();
        });
    });

    describe('DELETE /api/knowledge/[id]', () => {
        it('成功删除：先删库行再删文件', async () => {
            mocks.mockPrismaKnowledgeDoc.findFirst.mockResolvedValue(OWNED_DOC);
            mocks.mockPrismaKnowledgeDoc.delete.mockResolvedValue(OWNED_DOC);

            const res = await DELETE_DOC(new Request('http://localhost/api/knowledge/doc-1', { method: 'DELETE' }), { params: Promise.resolve({ id: 'doc-1' }) });
            const data = await res.json();

            expect(res.status).toBe(200);
            expect(data.success).toBe(true);
            expect(data.fileDeleteFailed).toBe(false);
            expect(mocks.mockPrismaKnowledgeDoc.delete).toHaveBeenCalledWith({ where: { id: 'doc-1' } });
            expect(mocks.mockDeletePdf).toHaveBeenCalledWith('user-123', 'uuid-1.pdf');
        });

        it('他人文档返回 404 且不删文件', async () => {
            mocks.mockPrismaKnowledgeDoc.findFirst.mockResolvedValue(null);

            const res = await DELETE_DOC(new Request('http://localhost/api/knowledge/doc-1', { method: 'DELETE' }), { params: Promise.resolve({ id: 'doc-1' }) });

            expect(res.status).toBe(404);
            expect(mocks.mockPrismaKnowledgeDoc.delete).not.toHaveBeenCalled();
            expect(mocks.mockDeletePdf).not.toHaveBeenCalled();
        });

        it('文件删除失败不回滚：仍删库行并返回 fileDeleteFailed', async () => {
            mocks.mockPrismaKnowledgeDoc.findFirst.mockResolvedValue(OWNED_DOC);
            mocks.mockPrismaKnowledgeDoc.delete.mockResolvedValue(OWNED_DOC);
            mocks.mockDeletePdf.mockRejectedValue(new Error('EPERM: file locked'));

            const res = await DELETE_DOC(new Request('http://localhost/api/knowledge/doc-1', { method: 'DELETE' }), { params: Promise.resolve({ id: 'doc-1' }) });
            const data = await res.json();

            expect(res.status).toBe(200);
            expect(data.success).toBe(true);
            expect(data.fileDeleteFailed).toBe(true);
            expect(mocks.mockPrismaKnowledgeDoc.delete).toHaveBeenCalledTimes(1);
        });
    });

    describe('GET /api/knowledge/[id]/file (文件流)', () => {
        it('文档不存在返回 404', async () => {
            mocks.mockPrismaKnowledgeDoc.findFirst.mockResolvedValue(null);

            const res = await GET_FILE(new Request('http://localhost/api/knowledge/doc-1/file'), { params: Promise.resolve({ id: 'doc-1' }) });

            expect(res.status).toBe(404);
        });

        it('磁盘文件缺失返回 404', async () => {
            mocks.mockPrismaKnowledgeDoc.findFirst.mockResolvedValue(OWNED_DOC);
            mocks.mockPdfExists.mockReturnValue(false);

            const res = await GET_FILE(new Request('http://localhost/api/knowledge/doc-1/file'), { params: Promise.resolve({ id: 'doc-1' }) });

            expect(res.status).toBe(404);
        });

        it('inline 浏览：PDF 头 + RFC5987 中文名 + Content-Length', async () => {
            mocks.mockPrismaKnowledgeDoc.findFirst.mockResolvedValue(OWNED_DOC);

            const res = await GET_FILE(new Request('http://localhost/api/knowledge/doc-1/file'), { params: Promise.resolve({ id: 'doc-1' }) });

            expect(res.status).toBe(200);
            expect(res.headers.get('content-type')).toBe('application/pdf');
            expect(res.headers.get('content-length')).toBe('12345');
            expect(mocks.mockOpenPdfStream).toHaveBeenCalledWith('user-123', 'uuid-1.pdf');
            const disposition = res.headers.get('content-disposition') || '';
            expect(disposition.startsWith("inline; filename*=UTF-8''")).toBe(true);
            expect(disposition).toContain(encodeURIComponent('数学必修一.pdf'));
            expect(res.headers.get('cache-control')).toContain('private');
        });

        it('download=1 时 Content-Disposition 为 attachment', async () => {
            mocks.mockPrismaKnowledgeDoc.findFirst.mockResolvedValue(OWNED_DOC);

            const res = await GET_FILE(
                new Request('http://localhost/api/knowledge/doc-1/file?download=1'),
                { params: Promise.resolve({ id: 'doc-1' }) }
            );

            expect(res.status).toBe(200);
            const disposition = res.headers.get('content-disposition') || '';
            expect(disposition.startsWith("attachment; filename*=UTF-8''")).toBe(true);
        });
    });
});
