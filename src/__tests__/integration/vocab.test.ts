/**
 * /api/vocab API 集成测试
 * 测试词汇添加（含词典回填）、列表分页搜索、更新、删除、AI 例句生成
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    mockPrismaUser: {
        findUnique: vi.fn(),
    },
    mockPrismaSubject: {
        findUnique: vi.fn(),
    },
    mockPrismaVocabEntry: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        count: vi.fn(),
    },
    mockLookupWord: vi.fn(),
    mockGenerateExamples: vi.fn(),
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
        vocabularyEntry: mocks.mockPrismaVocabEntry,
    },
}));

vi.mock('@/lib/vocab/dictionary', () => ({
    lookupWord: mocks.mockLookupWord,
}));

vi.mock('@/lib/ai', () => ({
    getAIService: () => ({
        generateVocabExamples: mocks.mockGenerateExamples,
    }),
}));

vi.mock('next-auth', () => ({
    getServerSession: vi.fn(() => Promise.resolve(mocks.mockSession)),
}));

vi.mock('@/lib/auth', () => ({
    authOptions: {},
}));

import { GET, POST } from '@/app/api/vocab/route';
import { PUT, DELETE } from '@/app/api/vocab/[id]/route';
import { POST as POST_EXAMPLES } from '@/app/api/vocab/[id]/examples/route';
import { getServerSession } from 'next-auth';

const mockUser = { id: 'user-123', email: 'user@example.com' };
const mockSubject = { id: 'subject-1', userId: 'user-123', name: '英语词汇', type: 'vocab' };

const baseEntry = {
    id: 'entry-1',
    userId: 'user-123',
    subjectId: 'subject-1',
    word: 'abandon',
    phonetic: null,
    translation: null,
    definition: null,
    pos: null,
    collins: null,
    oxford: null,
    tags: null,
    exchange: null,
    sentence: null,
    note: null,
    aiExamples: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
};

describe('/api/vocab', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.mockPrismaUser.findUnique.mockResolvedValue(mockUser);
        vi.mocked(getServerSession).mockResolvedValue(mocks.mockSession);
    });

    describe('GET 列表', () => {
        it('返回分页结构', async () => {
            mocks.mockPrismaVocabEntry.count.mockResolvedValue(2);
            mocks.mockPrismaVocabEntry.findMany.mockResolvedValue([baseEntry, { ...baseEntry, id: 'entry-2', word: 'apple' }]);

            const req = new Request('http://localhost/api/vocab?subjectId=subject-1&page=1&pageSize=20');
            const res = await GET(req);
            const data = await res.json();

            expect(res.status).toBe(200);
            expect(data.total).toBe(2);
            expect(data.items).toHaveLength(2);
            expect(data.totalPages).toBe(1);
        });

        it('未登录返回 401', async () => {
            vi.mocked(getServerSession).mockResolvedValue(null);

            const req = new Request('http://localhost/api/vocab');
            const res = await GET(req);
            expect(res.status).toBe(401);
        });
    });

    describe('POST 添加', () => {
        const validBody = { subjectId: 'subject-1', word: '  Abandon  ' };

        it('词典命中：归一小写保存并回填词典字段', async () => {
            mocks.mockPrismaSubject.findUnique.mockResolvedValue(mockSubject);
            mocks.mockPrismaVocabEntry.findUnique.mockResolvedValue(null);
            mocks.mockLookupWord.mockReturnValue({
                word: 'abandon', phonetic: "ə'bændən", translation: 'vt. 放弃',
                definition: 'v. forsake', pos: 'v:100', collins: 2, oxford: 1,
                tags: 'cet4 cet6', exchange: 'i:abandoning',
            });
            mocks.mockPrismaVocabEntry.create.mockImplementation(({ data }) => Promise.resolve({ ...baseEntry, ...data }));

            const req = new Request('http://localhost/api/vocab', {
                method: 'POST',
                body: JSON.stringify(validBody),
                headers: { 'content-type': 'application/json' },
            });
            const res = await POST(req);
            const data = await res.json();

            expect(res.status).toBe(201);
            expect(data.word).toBe('abandon'); // 归一小写
            expect(data.phonetic).toBe("ə'bændən");
            expect(data.collins).toBe(2);
            expect(mocks.mockLookupWord).toHaveBeenCalledWith('abandon');
        });

        it('词典未命中：仍保存词条（字段为空）', async () => {
            mocks.mockPrismaSubject.findUnique.mockResolvedValue(mockSubject);
            mocks.mockPrismaVocabEntry.findUnique.mockResolvedValue(null);
            mocks.mockLookupWord.mockReturnValue(null);
            mocks.mockPrismaVocabEntry.create.mockImplementation(({ data }) => Promise.resolve({ ...baseEntry, ...data }));

            const req = new Request('http://localhost/api/vocab', {
                method: 'POST',
                body: JSON.stringify({ subjectId: 'subject-1', word: 'zzzqqx' }),
                headers: { 'content-type': 'application/json' },
            });
            const res = await POST(req);
            const data = await res.json();

            expect(res.status).toBe(201);
            expect(data.word).toBe('zzzqqx');
            expect(data.phonetic).toBeNull();
        });

        it('重复词条返回 409', async () => {
            mocks.mockPrismaSubject.findUnique.mockResolvedValue(mockSubject);
            mocks.mockPrismaVocabEntry.findUnique.mockResolvedValue(baseEntry);

            const req = new Request('http://localhost/api/vocab', {
                method: 'POST',
                body: JSON.stringify(validBody),
                headers: { 'content-type': 'application/json' },
            });
            const res = await POST(req);
            expect(res.status).toBe(409);
        });

        it('非词汇本返回 400', async () => {
            mocks.mockPrismaSubject.findUnique.mockResolvedValue({ ...mockSubject, type: 'error' });

            const req = new Request('http://localhost/api/vocab', {
                method: 'POST',
                body: JSON.stringify(validBody),
                headers: { 'content-type': 'application/json' },
            });
            const res = await POST(req);
            expect(res.status).toBe(400);
        });

        it('缺少单词返回 400', async () => {
            const req = new Request('http://localhost/api/vocab', {
                method: 'POST',
                body: JSON.stringify({ subjectId: 'subject-1', word: '   ' }),
                headers: { 'content-type': 'application/json' },
            });
            const res = await POST(req);
            expect(res.status).toBe(400);
        });
    });
});

describe('/api/vocab/[id]', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.mockPrismaUser.findUnique.mockResolvedValue(mockUser);
        vi.mocked(getServerSession).mockResolvedValue(mocks.mockSession);
    });

    it('PUT 更新例句和笔记', async () => {
        mocks.mockPrismaVocabEntry.findUnique.mockResolvedValue(baseEntry);
        mocks.mockPrismaVocabEntry.update.mockResolvedValue({ ...baseEntry, sentence: 'He abandoned the plan.', note: '重点词' });

        const req = new Request('http://localhost/api/vocab/entry-1', {
            method: 'PUT',
            body: JSON.stringify({ sentence: 'He abandoned the plan.', note: '重点词' }),
            headers: { 'content-type': 'application/json' },
        });
        const res = await PUT(req, { params: Promise.resolve({ id: 'entry-1' }) });
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.sentence).toBe('He abandoned the plan.');
        expect(mocks.mockPrismaVocabEntry.update).toHaveBeenCalledWith({
            where: { id: 'entry-1' },
            data: { sentence: 'He abandoned the plan.', note: '重点词' },
        });
    });

    it('PUT 空字符串清空字段', async () => {
        mocks.mockPrismaVocabEntry.findUnique.mockResolvedValue({ ...baseEntry, sentence: 'x' });
        mocks.mockPrismaVocabEntry.update.mockResolvedValue({ ...baseEntry, sentence: null, note: null });

        const req = new Request('http://localhost/api/vocab/entry-1', {
            method: 'PUT',
            body: JSON.stringify({ sentence: '  ', note: '' }),
            headers: { 'content-type': 'application/json' },
        });
        const res = await PUT(req, { params: Promise.resolve({ id: 'entry-1' }) });

        expect(res.status).toBe(200);
        expect(mocks.mockPrismaVocabEntry.update).toHaveBeenCalledWith({
            where: { id: 'entry-1' },
            data: { sentence: null, note: null },
        });
    });

    it('非本人词条返回 401', async () => {
        mocks.mockPrismaVocabEntry.findUnique.mockResolvedValue({ ...baseEntry, userId: 'other-user' });

        const req = new Request('http://localhost/api/vocab/entry-1', {
            method: 'PUT',
            body: JSON.stringify({ sentence: 'x' }),
            headers: { 'content-type': 'application/json' },
        });
        const res = await PUT(req, { params: Promise.resolve({ id: 'entry-1' }) });
        expect(res.status).toBe(401);
    });

    it('DELETE 删除词条', async () => {
        mocks.mockPrismaVocabEntry.findUnique.mockResolvedValue(baseEntry);
        mocks.mockPrismaVocabEntry.delete.mockResolvedValue(baseEntry);

        const req = new Request('http://localhost/api/vocab/entry-1', { method: 'DELETE' });
        const res = await DELETE(req, { params: Promise.resolve({ id: 'entry-1' }) });

        expect(res.status).toBe(200);
        expect(mocks.mockPrismaVocabEntry.delete).toHaveBeenCalledWith({ where: { id: 'entry-1' } });
    });
});

describe('/api/vocab/[id]/examples', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.mockPrismaUser.findUnique.mockResolvedValue(mockUser);
        vi.mocked(getServerSession).mockResolvedValue(mocks.mockSession);
    });

    it('AI 例句生成并落库', async () => {
        mocks.mockPrismaVocabEntry.findUnique.mockResolvedValue({ ...baseEntry, sentence: 'He abandoned it.' });
        mocks.mockGenerateExamples.mockResolvedValue({
            examples: [{ en: 'He abandoned the plan.', zh: '他放弃了计划。' }],
        });
        mocks.mockPrismaVocabEntry.update.mockResolvedValue({
            ...baseEntry,
            aiExamples: JSON.stringify([{ en: 'He abandoned the plan.', zh: '他放弃了计划。' }]),
        });

        const req = new Request('http://localhost/api/vocab/entry-1/examples', { method: 'POST' });
        const res = await POST_EXAMPLES(req, { params: Promise.resolve({ id: 'entry-1' }) });
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.aiExamples).toContain('abandoned');
        expect(mocks.mockGenerateExamples).toHaveBeenCalledWith('abandon', 'He abandoned it.');
    });

    it('AI 失败返回 502', async () => {
        mocks.mockPrismaVocabEntry.findUnique.mockResolvedValue(baseEntry);
        mocks.mockGenerateExamples.mockRejectedValue(new Error('AI_TIMEOUT_ERROR'));

        const req = new Request('http://localhost/api/vocab/entry-1/examples', { method: 'POST' });
        const res = await POST_EXAMPLES(req, { params: Promise.resolve({ id: 'entry-1' }) });

        expect(res.status).toBe(502);
        expect(mocks.mockPrismaVocabEntry.update).not.toHaveBeenCalled();
    });
});
