// 一次性转换脚本：牛津高阶第10版 MDX → dictionaries/oxford10.db
// 运行时应用只读 oxford10.db（better-sqlite3），本脚本仅在重转词典时使用
// 用法：node scripts/mdx-to-sqlite.js [--dump word1,word2]（dump 模式仅打印样例不写库）
const fs = require("fs");
const path = require("path");
const { MDX } = require("js-mdict");
const Database = require("better-sqlite3");

const MDX_PATH = path.join(__dirname, "..", "dictionaries", "牛津高阶英汉双解词典（第10版）V3.mdx");
const OUT_PATH = path.join(__dirname, "..", "dictionaries", "oxford10.db");
const DUMP_WORDS = (process.argv.includes("--dump") &&
    process.argv[process.argv.indexOf("--dump") + 1]?.split(",")) || [
    "abandon",
    "go",
    "running",
    "went",
];

// ---------- HTML 清洗 ----------

// 纯文本化：剥全部标签 + 常见实体解码
const ENTITIES = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&apos;": "'",
    "&#39;": "'",
    "&nbsp;": " ",
};
function toText(s) {
    if (!s) return "";
    let out = s.replace(/<[^>]+>/g, "");
    for (const [ent, ch] of Object.entries(ENTITIES)) {
        out = out.split(ent).join(ch);
    }
    return out.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).trim();
}

// 词典 HTML 清洗：去脚本/样式/资源引用/音频按钮，保留排版结构
function cleanHtml(html) {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<link[^>]*>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
        .replace(/<img[^>]*>/gi, "")
        .replace(/<audio-wr>[\s\S]*?<\/audio-wr>/gi, "")
        .replace(/<a[^>]*href="sound:\/\/[^"]*"[^>]*>[\s\S]*?<\/a>/gi, "")
        // O10 为排版图标标记，无内容价值
        .replace(/<O10><\/O10>/g, "")
        // 事件属性
        .replace(/\son\w+="[^"]*"/gi, "");
}

// ---------- 结构化提取 ----------

// 音标：仅取词条头部英/美音标块（phons_br / phons_n_am）。
// 词形变化表（wordforms/Verb Forms）里屈折形式也用同名 phons 块，
// 但其 wd="屈折形式" 与本词不同 → 按 wd 属性过滤（个别无 wd 时回退取前两个）
function extractPhonetic(html, word) {
    const target = (word || "").toLowerCase();
    const re = /<div\s+class="phons_(?:br|n_am)"([^>]*)>[\s\S]*?<span class="phon"[^>]*>([\s\S]*?)<\/span>/g;
    const all = [];
    const matched = [];
    let m;
    while ((m = re.exec(html)) !== null) {
        const text = toText(m[2]);
        if (!text) continue;
        all.push(text);
        const wd = /(?:^|\s)wd="([^"]*)"/.exec(m[1]);
        if (wd && wd[1].toLowerCase() === target && !matched.includes(text)) matched.push(text);
    }
    const picked = matched.length ? matched : all;
    return picked.slice(0, 2).join(" / ").slice(0, 200) || null;
}

// 例句：examples 列表内每个 li 一条（span.x 英文 + chn 中文成对）
// 用 li 子串定位规避 span 嵌套导致的正则截断
function extractExamples(html, max = 15) {
    const out = [];
    const ulRe = /<ul class="examples"[^>]*>([\s\S]*?)<\/ul>/g;
    let ul;
    while ((ul = ulRe.exec(html)) !== null && out.length < max) {
        const block = ul[1];
        const liParts = block.split(/<li[\s>]/).slice(1);
        for (const li of liParts) {
            if (out.length >= max) break;
            const xIdx = li.indexOf('<span class="x"');
            if (xIdx === -1) continue;
            const enStart = li.indexOf(">", xIdx) + 1;
            const chnIdx = li.indexOf("<chn>", enStart);
            if (chnIdx === -1) continue; // 无中文翻译的例句不成对，跳过
            const en = toText(li.slice(enStart, chnIdx));
            const zhStart = chnIdx + "<chn>".length;
            const zhEnd = li.indexOf("</chn>", zhStart);
            const zh = toText(li.slice(zhStart, zhEnd));
            if (en && zh) out.push({ en, zh });
        }
    }
    return out;
}

// 中文释义摘要：defT>chn（仅义项定义，非例句），取前几条供列表预览/搜索
function extractSummary(html, maxSenses = 3, maxLen = 120) {
    const out = [];
    const re = /<defT>\s*<chn>([\s\S]*?)<\/chn>/g;
    let m;
    while ((m = re.exec(html)) !== null && out.length < maxSenses) {
        const text = toText(m[1]);
        if (text && !out.includes(text)) out.push(text);
    }
    const joined = out.join("；");
    return joined ? joined.slice(0, maxLen) : null;
}

// ---------- 转换主流程 ----------

function main() {
    if (!fs.existsSync(MDX_PATH)) {
        console.error("MDX 文件不存在:", MDX_PATH);
        process.exit(1);
    }

    console.time("load mdx");
    const mdx = new MDX(MDX_PATH);
    console.timeEnd("load mdx");

    if (process.argv.includes("--dump")) {
        for (const word of DUMP_WORDS) {
            const e = mdx.lookup(word.trim());
            if (!e || !e.definition) {
                console.log(`=== ${word}: 未命中 ===`);
                continue;
            }
            console.log(`\n===== ${word} =====`);
            console.log("keys len:", mdx.keywordList.length);
            console.log("phonetic:", extractPhonetic(e.definition, word));
            console.log("summary:", extractSummary(e.definition));
            console.log("examples:", JSON.stringify(extractExamples(e.definition).slice(0, 5), null, 1));
            console.log("--- cleaned html (first 1200 chars) ---");
            console.log(cleanHtml(e.definition).slice(0, 1200));
        }
        return;
    }

    // 按 recordStartOffset 去重（283k keys → 实际词条数）
    console.time("dedupe keys");
    const keyList = mdx.keywordList;
    const records = new Map(); // offset -> { word, aliases[] }
    for (const k of keyList) {
        const rec = records.get(k.recordStartOffset);
        if (rec) {
            rec.aliases.push(k.keyText);
            // 取最短的 key 作为展示词（通常为规范形）
            if (k.keyText.length < rec.word.length) rec.word = k.keyText;
        } else {
            records.set(k.recordStartOffset, { word: k.keyText, aliases: [k.keyText] });
        }
    }
    console.timeEnd("dedupe keys");
    console.log(`keys: ${keyList.length}, records: ${records.size}`);

    if (fs.existsSync(OUT_PATH)) fs.unlinkSync(OUT_PATH);
    const db = new Database(OUT_PATH);
    db.pragma("journal_mode = OFF"); // 一次性构建，追求写入速度
    db.exec(`
        CREATE TABLE entry (
            record_id INTEGER PRIMARY KEY,
            word TEXT NOT NULL,
            phonetic TEXT,
            html TEXT NOT NULL,
            examples TEXT,
            summary TEXT
        );
        CREATE TABLE alias (
            key TEXT PRIMARY KEY,
            record_id INTEGER NOT NULL REFERENCES entry(record_id)
        );
        CREATE INDEX idx_entry_word ON entry(word);
    `);

    const insertEntry = db.prepare(
        "INSERT INTO entry (record_id, word, phonetic, html, examples, summary) VALUES (?, ?, ?, ?, ?, ?)"
    );
    const insertAlias = db.prepare("INSERT OR IGNORE INTO alias (key, record_id) VALUES (?, ?)");
    const upsertEntryWord = db.prepare("UPDATE entry SET word = ? WHERE record_id = ?");

    let done = 0;
    let withExamples = 0;
    let withSummary = 0;
    let aliasRows = 0;
    const BATCH = 2000;
    const total = records.size;
    console.time("convert");

    const runBatch = db.transaction((batch) => {
        for (const [recordId, rec] of batch) {
            const entry = mdx.lookup(rec.word);
            if (!entry || !entry.definition) continue;
            const html = cleanHtml(entry.definition);
            const examples = extractExamples(html);
            const summary = extractSummary(html);
            const phonetic = extractPhonetic(html, rec.word);
            insertEntry.run(
                recordId,
                rec.word,
                phonetic,
                html,
                examples.length ? JSON.stringify(examples) : null,
                summary
            );
            if (examples.length) withExamples++;
            if (summary) withSummary++;
            for (const alias of rec.aliases) {
                insertAlias.run(alias, recordId);
                aliasRows++;
            }
            done++;
            if (done % 20000 === 0) {
                console.log(`progress: ${done}/${total} (${((done / total) * 100).toFixed(0)}%)`);
            }
        }
    });

    let batch = [];
    for (const [recordId, rec] of records) {
        batch.push([recordId, rec]);
        if (batch.length >= BATCH) {
            runBatch(batch);
            batch = [];
        }
    }
    if (batch.length) runBatch(batch);

    console.timeEnd("convert");
    const stats = db
        .prepare("SELECT COUNT(*) AS entries, SUM(LENGTH(html)) AS htmlBytes FROM entry")
        .get();
    console.log("=== 转换完成 ===");
    console.log(`词条: ${stats.entries}, 别名: ${aliasRows}`);
    console.log(`例句提取率: ${((withExamples / stats.entries) * 100).toFixed(1)}%`);
    console.log(`释义摘要率: ${((withSummary / stats.entries) * 100).toFixed(1)}%`);
    console.log(`html 总量: ${(stats.htmlBytes / 1024 / 1024).toFixed(0)} MB`);
    console.log(`输出: ${OUT_PATH} (${(fs.statSync(OUT_PATH).size / 1024 / 1024).toFixed(0)} MB)`);
    db.close();
}

main();
