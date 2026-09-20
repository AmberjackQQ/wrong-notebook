/*
 * 批量替换知识点标签：调用 /api/ai/tags（与编辑页「AI 生成」按钮同一生产路径），
 * 为 admin@localhost 的全部题目重新生成知识点并替换旧标签（串行、可断点续跑）。
 * - AI 调用：Playwright 以 e2e-qr-test@localhost 登录后 page.evaluate fetch（路由按会话鉴权，
 *   但 /api/ai/tags 本身无状态，返回值与题目归属无关）
 * - 写回：better-sqlite3 直接复刻 PUT /api/error-items/[id] 的标签逻辑
 *   （findOrCreate KnowledgeTag → 重连 _ErrorItemToKnowledgeTag → knowledgePoints JSON）
 * - 启动时先备份全部旧标签到 scripts/tags-backup-<ts>.json
 * 用法：node scripts/tags-batch-replace.js [--limit N]
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { chromium } = require('@playwright/test');

const BASE_URL = 'https://localhost:3000';
const E2E_EMAIL = 'e2e-qr-test@localhost';
const E2E_PASSWORD = 'test1234';

const argvLimit = (() => {
    const i = process.argv.indexOf('--limit');
    return i > -1 ? Number(process.argv[i + 1]) : 0;
})();

const LOG_FILE = path.join(__dirname, 'tags-batch-progress.log');
const STATE_FILE = path.join(__dirname, 'tags-batch-state.jsonl');
const log = (msg) => {
    const line = `[${new Date().toISOString()}] ${msg}`;
    console.log(line);
    fs.appendFileSync(LOG_FILE, line + '\n');
};

// inferSubjectFromName 复刻（src/lib/knowledge-tags.ts）
function inferSubjectFromName(subjectName) {
    if (!subjectName) return null;
    const lowerName = subjectName.toLowerCase();
    if (lowerName.includes('math') || lowerName.includes('数学')) return 'math';
    if (lowerName.includes('physics') || lowerName.includes('物理')) return 'physics';
    if (lowerName.includes('chemistry') || lowerName.includes('化学')) return 'chemistry';
    if (lowerName.includes('biology') || lowerName.includes('生物')) return 'biology';
    if (lowerName.includes('english') || lowerName.includes('英语')) return 'english';
    if (lowerName.includes('chinese') || lowerName.includes('语文')) return 'chinese';
    if (lowerName.includes('history') || lowerName.includes('历史')) return 'history';
    if (lowerName.includes('geography') || lowerName.includes('地理')) return 'geography';
    if (lowerName.includes('politics') || lowerName.includes('政治')) return 'politics';
    return null;
}

// PUT 路由的标签学科归类（数学→math，英语→english，其余→other）
function tagRowSubject(subjectName) {
    if (subjectName.includes('math') || subjectName.includes('数学')) return 'math';
    if (subjectName.includes('english') || subjectName.includes('英语')) return 'english';
    return 'other';
}

// findParentTagIdForGrade 复刻（src/lib/tag-recognition.ts）
function findParentTagIdForGrade(db, gradeSemester, subjectKey) {
    if (!gradeSemester || !subjectKey) return null;
    const rootTags = db.prepare(
        "SELECT id, name FROM KnowledgeTag WHERE subject = ? AND isSystem = 1 AND parentId IS NULL"
    ).all(subjectKey);
    if (rootTags.length === 0) return null;

    const normalizedInput = gradeSemester.trim();
    const exactMatch = rootTags.find(t => t.name === normalizedInput);
    if (exactMatch) return exactMatch.id;

    const gradeLevelMap = {
        "一年级": "一年级", "Grade 1": "一年级",
        "二年级": "二年级", "Grade 2": "二年级",
        "三年级": "三年级", "Grade 3": "三年级",
        "四年级": "四年级", "Grade 4": "四年级",
        "五年级": "五年级", "Grade 5": "五年级",
        "六年级": "六年级", "Grade 6": "六年级",
        "初一": "七年级", "Grade 7": "七年级", "七年级": "七年级",
        "初二": "八年级", "Grade 8": "八年级", "八年级": "八年级",
        "初三": "九年级", "Grade 9": "九年级", "九年级": "九年级",
        "高一": "高一", "Grade 10": "高一", "Senior 1": "高一",
        "高二": "高二", "Grade 11": "高二", "Senior 2": "高二",
        "高三": "高三", "Grade 12": "高三", "Senior 3": "高三",
    };

    let targetGradePrefix = "";
    for (const [key, value] of Object.entries(gradeLevelMap)) {
        if (normalizedInput.includes(key)) { targetGradePrefix = value; break; }
    }
    if (!targetGradePrefix) return null;

    let targetSemester = "";
    if (normalizedInput.includes("上") || normalizedInput.includes("1st") || normalizedInput.includes("First")) targetSemester = "上";
    else if (normalizedInput.includes("下") || normalizedInput.includes("2nd") || normalizedInput.includes("Second")) targetSemester = "下";

    const candidates = [];
    if (targetSemester) candidates.push(`${targetGradePrefix}${targetSemester}`);
    candidates.push(targetGradePrefix);
    for (const candidate of candidates) {
        const match = rootTags.find(t => t.name === candidate);
        if (match) return match.id;
    }
    return null;
}

const genId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;

// 清除内联 base64 图片引用，避免占用 8000 字符预算
function cleanQuestionText(text) {
    return text
        .replace(/!\[[^\]]*\]\(data:[^)]*\)/g, '')
        .replace(/<img[^>]*src=["']data:[^"']*["'][^>]*\/?>/g, '')
        .replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g, '')
        .trim();
}

(async () => {
    const db = new Database(path.join(__dirname, '../prisma/dev.db'));
    db.pragma('busy_timeout = 5000');

    const admin = db.prepare("SELECT id FROM User WHERE email = 'admin@localhost'").get();
    if (!admin) { console.error('未找到 admin@localhost'); process.exit(1); }

    const candidates = db.prepare(`
        SELECT e.id, e.questionText, e.gradeSemester, s.name AS subjectName
        FROM ErrorItem e JOIN Subject s ON e.subjectId = s.id
        WHERE e.userId = ? AND e.questionText IS NOT NULL AND TRIM(e.questionText) != ''
        ORDER BY s.name, e.createdAt
    `).all(admin.id);
    const targets = argvLimit > 0 ? candidates.slice(0, argvLimit) : candidates;
    log(`=== 知识点批量替换开始：候选 ${candidates.length} 题，本次处理 ${targets.length} 题（串行） ===`);

    // 备份旧标签（仅首次运行时全量备份）
    const backupFiles = fs.readdirSync(__dirname).filter(f => f.startsWith('tags-backup-'));
    if (backupFiles.length === 0 && argvLimit === 0) {
        const backupPath = path.join(__dirname, `tags-backup-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.json`);
        const all = db.prepare("SELECT id, knowledgePoints FROM ErrorItem WHERE userId = ?").all(admin.id);
        const rels = db.prepare(`
            SELECT r.A AS itemId, r.B AS tagId FROM _ErrorItemToKnowledgeTag r
            JOIN ErrorItem e ON e.id = r.A WHERE e.userId = ?
        `).all(admin.id);
        const byItem = {};
        for (const it of all) byItem[it.id] = { knowledgePoints: it.knowledgePoints, tagIds: [] };
        for (const rel of rels) byItem[rel.itemId]?.tagIds.push(rel.tagId);
        fs.writeFileSync(backupPath, JSON.stringify(byItem));
        log(`已备份 ${Object.keys(byItem).length} 题旧标签到 ${path.basename(backupPath)}`);
    }

    // 断点续跑：跳过已完成
    const processed = new Set(
        fs.existsSync(STATE_FILE)
            ? fs.readFileSync(STATE_FILE, 'utf8').split('\n').map(l => l.trim()).filter(Boolean)
            : []
    );

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/login`);
    await page.locator('input[name="email"]').fill(E2E_EMAIL);
    await page.locator('input[name="password"]').fill(E2E_PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 30000 });
    log('e2e 会话登录成功');

    const findTagStmt = db.prepare(
        "SELECT id FROM KnowledgeTag WHERE name = ? AND (isSystem = 1 OR userId = ?) LIMIT 1"
    );
    const insertTagStmt = db.prepare(`
        INSERT INTO KnowledgeTag (id, name, subject, "order", code, isSystem, userId, parentId, createdAt, updatedAt)
        VALUES (?, ?, ?, 0, NULL, 0, ?, ?, ?, ?)
    `);
    const deleteRelsStmt = db.prepare("DELETE FROM _ErrorItemToKnowledgeTag WHERE A = ?");
    const insertRelStmt = db.prepare("INSERT INTO _ErrorItemToKnowledgeTag (A, B) VALUES (?, ?)");
    const updateItemStmt = db.prepare("UPDATE ErrorItem SET knowledgePoints = ?, updatedAt = ? WHERE id = ?");

    let ok = 0, fail = 0, empty = 0, skipped = 0;
    const durations = [];

    for (let i = 0; i < targets.length; i++) {
        const item = targets[i];
        if (processed.has(item.id)) { skipped++; continue; }
        const t0 = Date.now();
        try {
            const questionText = cleanQuestionText(item.questionText || '');
            if (!questionText) {
                empty++;
                log(`[${i + 1}/${targets.length}] id=${item.id} nb=${item.subjectName} SKIP 清洗后题目文本为空`);
                continue;
            }
            const subjectKey = inferSubjectFromName(item.subjectName) || undefined;

            const fetchTags = () => page.evaluate(async ({ questionText, subjectKey, gradeSemester }) => {
                const res = await fetch('/api/ai/tags', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ questionText, subject: subjectKey, gradeSemester: gradeSemester || undefined }),
                    signal: AbortSignal.timeout(240000),
                });
                const json = await res.json().catch(() => null);
                return { status: res.status, knowledgePoints: json?.knowledgePoints, message: json?.message };
            }, { questionText, subjectKey, gradeSemester: item.gradeSemester });

            let result = await fetchTags();
            if (result.status !== 200 || !Array.isArray(result.knowledgePoints) || result.knowledgePoints.length === 0) {
                // 空结果/瞬时错误：立即重试一次
                result = await fetchTags();
            }

            const tags = Array.isArray(result.knowledgePoints) ? result.knowledgePoints : [];
            if (result.status !== 200 || tags.length === 0) {
                fail++;
                log(`[${i + 1}/${targets.length}] id=${item.id} nb=${item.subjectName} FAIL status=${result.status} ${result.message || ''}`.trim());
                continue;
            }

            const secs = ((Date.now() - t0) / 1000).toFixed(1);
            const tx = db.transaction(() => {
                const now = Date.now();
                const tagIds = tags.map((tagName) => {
                    let tag = findTagStmt.get(tagName, admin.id);
                    if (!tag) {
                        const rowSubject = tagRowSubject(item.subjectName);
                        const parentId = findParentTagIdForGrade(db, item.gradeSemester, rowSubject);
                        const newId = genId();
                        insertTagStmt.run(newId, tagName, rowSubject, admin.id, parentId, now, now);
                        tag = { id: newId };
                    }
                    return tag.id;
                });
                deleteRelsStmt.run(item.id);
                for (const tagId of new Set(tagIds)) insertRelStmt.run(item.id, tagId);
                updateItemStmt.run(JSON.stringify(tags), now, item.id);
            });
            tx();

            ok++;
            durations.push(Number(secs));
            log(`[${i + 1}/${targets.length}] id=${item.id} nb=${item.subjectName} OK secs=${secs} tags=[${tags.join('、')}]`);
            fs.appendFileSync(STATE_FILE, item.id + '\n');
        } catch (error) {
            fail++;
            const secs = ((Date.now() - t0) / 1000).toFixed(1);
            log(`[${i + 1}/${targets.length}] id=${item.id} nb=${item.subjectName} FAIL secs=${secs} ${error.message}`);
        }
    }

    const avg = durations.length ? (durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(1) : '-';
    log(`=== 批量替换结束：成功 ${ok}，失败 ${fail}，跳过空文本 ${empty}，续跑跳过 ${skipped}；平均 ${avg}s/题 ===`);

    await browser.close();
    db.close();
})().catch((e) => { console.error(e); process.exit(1); });
