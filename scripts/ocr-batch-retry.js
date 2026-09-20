/*
 * OCR 批量续跑包装：反复调用 ocr-batch-fill.js（本身可断点续跑），
 * 若仍被限频（429/队列满）则等待后自动重试，直到无剩余题目或达到最大轮数。
 * 用法：node scripts/ocr-batch-retry.js
 */
const { execSync } = require('child_process');
const path = require('path');
const Database = require('better-sqlite3');

const MAX_ROUNDS = 20;
const WAIT_MS = 15 * 60 * 1000;

const remaining = () => {
    const db = new Database(path.join(__dirname, '../prisma/dev.db'), { readonly: true });
    const c = db.prepare(`
        SELECT COUNT(*) AS c FROM ErrorItem e JOIN User u ON e.userId = u.id
        WHERE u.email = 'admin@localhost'
          AND (e.questionText IS NULL OR TRIM(e.questionText) = '')
    `).get().c;
    db.close();
    return c;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
    for (let round = 1; round <= MAX_ROUNDS; round++) {
        console.log(`=== 续跑第 ${round}/${MAX_ROUNDS} 轮 ${new Date().toISOString()}，剩余 ${remaining()} 题 ===`);
        try {
            execSync('node scripts/ocr-batch-fill.js', { stdio: 'inherit', cwd: path.join(__dirname, '..') });
        } catch (e) {
            console.error('批量脚本异常退出：', e.message);
        }
        const rem = remaining();
        console.log(`=== 第 ${round} 轮结束，剩余 ${rem} 题 ===`);
        if (rem === 0) {
            console.log('=== 全部完成 ===');
            break;
        }
        if (round < MAX_ROUNDS) {
            console.log(`=== 等待 15 分钟后自动重试 ===`);
            await sleep(WAIT_MS);
        }
    }
    console.log(`=== 续跑包装结束，最终剩余 ${remaining()} 题 ===`);
})();
