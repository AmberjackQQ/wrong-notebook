/**
 * /api/question-sources API 集成测试
 * 重点：PATCH 重命名（含 errorItem.paperLevel 名称级联更新）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    mockPrismaUser: {
        findUnique: vi.fn(),
    },
    mockPrismaQuestionSource: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
        create: vi.fn(),
    },
    mockPrismaErrorItem: {
        findMany: vi.fn(),
        updateMany: vi.fn(),
    },
    mockTransaction: vi.fn(),
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
        questionSource: mocks.mockPrismaQuestionSource,
        errorItem: mocks.mockPrismaErrorItem,
        $transaction: mocks.mockTransaction,
    },
}));

vi.mock('next-auth', () => ({
    getServerSession: vi.fn(() => Promise.resolve(mocks.mockSession)),
}));

vi.mock('@/lib/auth', () => ({
    authOptions: {},
}));

import { GET, POST } from '@/app/api/question-sources/route';
import { PATCH } from '@/app/api/question-sources/[id]/route';
import { getServerSession } from 'next-auth';

const MOCK_USER = { id: 'user-123', email: 'user@example.com' };

const SOURCE = {
    id: 'qs-1',
    name: '人大附中期中',
    userId: 'user-123',
    sortOrder: 0,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
};

const RENAMED = { ...SOURCE, name: '人大附中2026期中' };

function makePatchRequest(id: string, body: unknown) {
    const req = new Request(`http://localhost/api/question-sources/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
    });
    const ctx = { params: Promise.resolve({ id }) };
    return [req, ctx] as const;
}

describe('/api/question-sources', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.mockPrismaUser.findUnique.mockResolvedValue(MOCK_USER);
        vi.mocked(getServerSession).mockResolvedValue(mocks.mockSession);
        // $transaction(数组) → 顺序执行各 promise
        mocks.mockTransaction.mockImplementation(async (ops) => Promise.all(ops));
    });

    describe('GET /api/question-sources', () => {
        it('返回用户来源列表', async () => {
            mocks.mockPrismaQuestionSource.findMany.mockResolvedValue([SOURCE]);

            const res = await GET(new Request('http://localhost/api/question-sources'));
            const data = await res.json();

            expect(res.status).toBe(200);
            expect(data).toHaveLength(1);
            expect(mocks.mockPrismaQuestionSource.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ where: { userId: 'user-123' } })
            );
        });

        it('带 subjectId 时只返回该错题本用过的来源', async () => {
            mocks.mockPrismaQuestionSource.findMany.mockResolvedValue([SOURCE, { ...SOURCE, id: 'qs-2', name: '未使用来源' }]);
            mocks.mockPrismaErrorItem.findMany.mockResolvedValue([{ paperLevel: '人大附中期中' }]);

            const res = await GET(new Request('http://localhost/api/question-sources?subjectId=sub-1'));
            const data = await res.json();

            expect(res.status).toBe(200);
            expect(data).toHaveLength(1);
            expect(data[0].name).toBe('人大附中期中');
        });
    });

    describe('POST /api/question-sources', () => {
        it('新名称创建 201；已存在同名幂等返回 200', async () => {
            mocks.mockPrismaQuestionSource.findFirst
                .mockResolvedValueOnce(null)   // 查重：无同名
                .mockResolvedValueOnce({ sortOrder: 2 }); // 最大 sortOrder
            mocks.mockPrismaQuestionSource.create.mockResolvedValue({ ...SOURCE, sortOrder: 3 });

            const res = await POST(new Request('http://localhost/api/question-sources', {
                method: 'POST',
                body: JSON.stringify({ name: '  期末冲刺卷  ' }),
                headers: { 'Content-Type': 'application/json' },
            }));

            expect(res.status).toBe(201);
            expect(mocks.mockPrismaQuestionSource.create).toHaveBeenCalledWith(
                expect.objectContaining({ data: { name: '期末冲刺卷', userId: 'user-123', sortOrder: 3 } })
            );

            // 幂等：同名已存在 → 200 且不创建
            mocks.mockPrismaQuestionSource.findFirst.mockResolvedValueOnce(SOURCE);
            const res2 = await POST(new Request('http://localhost/api/question-sources', {
                method: 'POST',
                body: JSON.stringify({ name: SOURCE.name }),
                headers: { 'Content-Type': 'application/json' },
            }));
            expect(res2.status).toBe(200);
            expect(mocks.mockPrismaQuestionSource.create).toHaveBeenCalledTimes(1);
        });
    });

    describe('PATCH /api/question-sources/[id] (重命名 + 级联)', () => {
        it('成功：事务内改名 + 按 userId+旧名 级联更新错题 paperLevel', async () => {
            mocks.mockPrismaQuestionSource.findUnique.mockResolvedValue(SOURCE);
            mocks.mockPrismaQuestionSource.findFirst.mockResolvedValue(null); // 无重名
            mocks.mockPrismaQuestionSource.update.mockResolvedValue(RENAMED);
            mocks.mockPrismaErrorItem.updateMany.mockResolvedValue({ count: 5 });

            const res = await PATCH(...makePatchRequest('qs-1', { name: '  人大附中2026期中  ' }));
            const data = await res.json();

            expect(res.status).toBe(200);
            expect(data.name).toBe('人大附中2026期中');
            expect(mocks.mockTransaction).toHaveBeenCalledTimes(1);
            expect(mocks.mockPrismaQuestionSource.update).toHaveBeenCalledWith(
                expect.objectContaining({ data: { name: '人大附中2026期中' } })
            );
            expect(mocks.mockPrismaErrorItem.updateMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { userId: 'user-123', paperLevel: '人大附中期中' },
                    data: { paperLevel: '人大附中2026期中' },
                })
            );
        });

        it('同名早退：直接返回现有行，不做改名和级联', async () => {
            mocks.mockPrismaQuestionSource.findUnique.mockResolvedValue(SOURCE);

            const res = await PATCH(...makePatchRequest('qs-1', { name: SOURCE.name }));

            expect(res.status).toBe(200);
            expect(mocks.mockTransaction).not.toHaveBeenCalled();
            expect(mocks.mockPrismaQuestionSource.update).not.toHaveBeenCalled();
            expect(mocks.mockPrismaErrorItem.updateMany).not.toHaveBeenCalled();
        });

        it('同用户重名返回 400', async () => {
            mocks.mockPrismaQuestionSource.findUnique.mockResolvedValue(SOURCE);
            mocks.mockPrismaQuestionSource.findFirst.mockResolvedValue({ ...SOURCE, id: 'qs-other', name: '人大附中2026期中' });

            const res = await PATCH(...makePatchRequest('qs-1', { name: '人大附中2026期中' }));

            expect(res.status).toBe(400);
            expect(mocks.mockTransaction).not.toHaveBeenCalled();
        });

        it('空名返回 400', async () => {
            const res = await PATCH(...makePatchRequest('qs-1', { name: '   ' }));

            expect(res.status).toBe(400);
            expect(mocks.mockPrismaQuestionSource.findUnique).not.toHaveBeenCalled();
        });

        it('来源不存在返回 400', async () => {
            mocks.mockPrismaQuestionSource.findUnique.mockResolvedValue(null);

            const res = await PATCH(...makePatchRequest('qs-missing', { name: '新名' }));

            expect(res.status).toBe(400);
        });

        it('他人来源返回 401', async () => {
            mocks.mockPrismaQuestionSource.findUnique.mockResolvedValue({ ...SOURCE, userId: 'someone-else' });

            const res = await PATCH(...makePatchRequest('qs-1', { name: '新名' }));

            expect(res.status).toBe(401);
            expect(mocks.mockTransaction).not.toHaveBeenCalled();
        });

        it('未登录返回 401', async () => {
            vi.mocked(getServerSession).mockResolvedValue(null as unknown as typeof mocks.mockSession);

            const res = await PATCH(...makePatchRequest('qs-1', { name: '新名' }));

            expect(res.status).toBe(401);
        });
    });
});
