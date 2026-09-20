/*
 * 批量 OCR：为题目文本为空、仅有图片的题目生成题目文本（questionText）
 * 复刻 /api/ocr/paddle 的外部服务调用逻辑（飞桨 AI Studio，逐题串行）。
 * - 候选：admin@localhost 名下 questionText 为空且有 originalImageUrl 的题目
 * - 可断点续跑：候选查询天然排除已填写的题目
 * - 单题失败记录日志后跳过，不中断批次
 * 用法：node scripts/ocr-batch-fill.js [--limit N]
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const JOB_URL = 'https://paddleocr.aistudio-app.com/api/v2/ocr/jobs';
const POLL_INTERVAL_MS = 5000;
const MAX_POLL_MS = 300000;

const argvLimit = (() => {
    const i = process.argv.indexOf('--limit');
    return i > -1 ? Number(process.argv[i + 1]) : 0;
})();

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/app-config.json'), 'utf8'));
const token = cfg.paddleOcr?.token;
const ocrModel = cfg.paddleOcr?.model || 'PaddleOCR-VL-1.6';
if (!token) { console.error('未配置飞桨 OCR token'); process.exit(1); }

const db = new Database(path.join(__dirname, '../prisma/dev.db'));
db.pragma('busy_timeout = 5000');

const LOG_FILE = path.join(__dirname, 'ocr-batch-progress.log');
const log = (msg) => {
    const line = `[${new Date().toISOString()}] ${msg}`;
    console.log(line);
    fs.appendFileSync(LOG_FILE, line + '\n');
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const IMAGE_MIME_BY_EXT = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' };
function mimeForImage(refPath, contentType) {
    const ext = refPath.slice(refPath.lastIndexOf('.') + 1).toLowerCase();
    if (IMAGE_MIME_BY_EXT[ext]) return IMAGE_MIME_BY_EXT[ext];
    if (contentType?.startsWith('image/')) return contentType.split(';')[0];
    return 'image/jpeg';
}

async function toInlineDataUrl(refPath, value) {
    if (value.startsWith('data:')) return value;
    if (/^https?:\/\//.test(value)) {
        try {
            const res = await fetch(value);
            if (res.ok) {
                const buf = Buffer.from(await res.arrayBuffer());
                return `data:${mimeForImage(refPath, res.headers.get('content-type'))};base64,${buf.toString('base64')}`;
            }
        } catch { /* 下载失败交由剔除逻辑移除 */ }
        return value;
    }
    return `data:${mimeForImage(refPath)};base64,${value}`;
}

async function inlineImages(text, images) {
    let result = text;
    for (const [p, image] of Object.entries(images || {})) {
        if (typeof image !== 'string' || !image) continue;
        result = result.split(p).join(await toInlineDataUrl(p, image));
    }
    result = result.replace(/!\[[^\]]*\]\((?!data:)[^)]*\)/g, '');
    result = result.replace(/<img[^>]*src=["'](?!data:)[^"']*["'][^>]*\/?>/g, '');
    return result.trim();
}

async function ocrImage(dataUrl) {
    const match = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl);
    if (!match) throw new Error('无效的图片数据');
    const bytes = Buffer.from(match[2], 'base64');
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: match[1] }), 'original-image');
    form.append('model', ocrModel);
    form.append('optionalPayload', JSON.stringify({
        useDocOrientationClassify: false,
        useDocUnwarping: false,
        useChartRecognition: false,
    }));
    const submitResponse = await fetch(JOB_URL, {
        method: 'POST',
        headers: { Authorization: `bearer ${token}` },
        body: form,
    });
    if (!submitResponse.ok) {
        const detail = await submitResponse.text().catch(() => '');
        throw new Error(`提交失败(${submitResponse.status}): ${detail.slice(0, 120)}`);
    }
    const submitted = await submitResponse.json();
    const jobId = submitted?.data?.jobId;
    if (!jobId) throw new Error('提交失败：未返回任务ID');

    const deadline = Date.now() + MAX_POLL_MS;
    let jsonUrl = '';
    while (Date.now() < deadline) {
        await sleep(POLL_INTERVAL_MS);
        const st = await (await fetch(`${JOB_URL}/${jobId}`, { headers: { Authorization: `bearer ${token}` } })).json();
        const state = st?.data?.state;
        if (state === 'done') { jsonUrl = st?.data?.resultUrl?.jsonUrl || ''; break; }
        if (state === 'failed') throw new Error(`识别失败: ${st?.data?.errorMsg || '未知原因'}`);
    }
    if (!jsonUrl) throw new Error('识别超时(>300s)');

    const jsonl = await (await fetch(jsonUrl)).text();
    const pages = [];
    for (const line of jsonl.trim().split('\n')) {
        if (!line.trim()) continue;
        const parsed = JSON.parse(line);
        for (const page of parsed?.result?.layoutParsingResults || []) {
            const text = page?.markdown?.text || '';
            if (text) pages.push(await inlineImages(text, page?.markdown?.images));
        }
    }
    return pages.join('\n\n');
}

(async () => {
    const candidates = db.prepare(`
        SELECT e.id, e.originalImageUrl, s.name AS notebook
        FROM ErrorItem e JOIN Subject s ON e.subjectId = s.id JOIN User u ON e.userId = u.id
        WHERE u.email = 'admin@localhost'
          AND (e.questionText IS NULL OR TRIM(e.questionText) = '')
          AND e.originalImageUrl IS NOT NULL AND e.originalImageUrl != ''
        ORDER BY s.name, e.createdAt
    `).all();
    const targets = argvLimit > 0 ? candidates.slice(0, argvLimit) : candidates;
    log(`=== 批量OCR开始：候选 ${candidates.length} 题，本次处理 ${targets.length} 题（串行） ===`);

    let ok = 0, fail = 0, empty = 0;
    const durations = [];
    for (let i = 0; i < targets.length; i++) {
        const item = targets[i];
        const t0 = Date.now();
        try {
            const markdown = await ocrImage(item.originalImageUrl);
            const secs = ((Date.now() - t0) / 1000).toFixed(1);
            if (!markdown || !markdown.trim()) {
                empty++;
                log(`[${i + 1}/${targets.length}] id=${item.id} nb=${item.notebook} EMPTY_TEXT secs=${secs}`);
                continue;
            }
            db.prepare('UPDATE ErrorItem SET questionText = ? WHERE id = ?').run(markdown, item.id);
            ok++;
            durations.push(Number(secs));
            log(`[${i + 1}/${targets.length}] id=${item.id} nb=${item.notebook} OK secs=${secs} chars=${markdown.length}`);
        } catch (error) {
            fail++;
            const secs = ((Date.now() - t0) / 1000).toFixed(1);
            log(`[${i + 1}/${targets.length}] id=${item.id} nb=${item.notebook} FAIL secs=${secs} ${error.message}`);
        }
    }

    const avg = durations.length ? (durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(1) : '-';
    log(`=== 批量OCR结束：成功 ${ok}，空结果 ${empty}，失败 ${fail}；平均 ${avg}s/题 ===`);
    if (argvLimit === 0 && candidates.length > targets.length) {
        const remaining = candidates.length - targets.length;
        log(`提示：候选中另有 ${remaining} 题未在本批处理（--limit 截断）`);
    }
    db.close();
})().catch((e) => { console.error(e); process.exit(1); });
