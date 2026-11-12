import { describe, it, expect, beforeAll } from "vitest";
import Database from "better-sqlite3";
import { lookupOxford, type OxfordHandle } from "@/lib/vocab/dictionary";

// :memory: 小型 fixture，模拟 oxford10.db 的 entry + alias 表结构
// （scripts/mdx-to-sqlite.js 的产物格式）
const FIXTURE: Array<{
    recordId: number;
    word: string;
    phonetic: string | null;
    examples: Array<{ en: string; zh: string }> | null;
    summary: string | null;
    aliases: string[];
}> = [
    {
        recordId: 1,
        word: "abandon",
        phonetic: "/əˈbændən/",
        examples: [{ en: "He gave up his job.", zh: "他放弃了工作。" }],
        summary: "离弃，遗弃，抛弃",
        aliases: ["abandon", "Abandon"],
    },
    {
        recordId: 2,
        word: "go",
        phonetic: "/ɡəʊ/",
        examples: null,
        summary: "去；走",
        aliases: ["go"],
    },
    {
        recordId: 3,
        word: "give up",
        phonetic: null,
        examples: [{ en: "a.", zh: "甲" }],
        summary: null,
        aliases: ["give up", "give  up"],
    },
];

let dict: OxfordHandle;

beforeAll(() => {
    const db = new Database(":memory:");
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
    `);
    const insertEntry = db.prepare(
        "INSERT INTO entry (record_id, word, phonetic, html, examples, summary) VALUES (?, ?, ?, ?, ?, ?)"
    );
    const insertAlias = db.prepare("INSERT INTO alias (key, record_id) VALUES (?, ?)");
    for (const f of FIXTURE) {
        insertEntry.run(
            f.recordId,
            f.word,
            f.phonetic,
            `<div class="phons_br"><span class="phon">${f.phonetic ?? ""}</span></div>`,
            f.examples ? JSON.stringify(f.examples) : null,
            f.summary
        );
        for (const alias of f.aliases) insertAlias.run(alias, f.recordId);
    }
    dict = { db };
});

describe("lookupOxford", () => {
    it("精确匹配返回完整词条（含解析后的例句数组）", () => {
        const entry = lookupOxford("abandon", dict);
        expect(entry).not.toBeNull();
        expect(entry!.word).toBe("abandon");
        expect(entry!.phonetic).toBe("/əˈbændən/");
        expect(entry!.html).toContain("phons_br");
        expect(entry!.examples).toEqual([{ en: "He gave up his job.", zh: "他放弃了工作。" }]);
        expect(entry!.summary).toBe("离弃，遗弃，抛弃");
    });

    it("大小写别名解析：Abandon → abandon", () => {
        expect(lookupOxford("Abandon", dict)?.word).toBe("abandon");
    });

    it("空白归一别名解析：'give  up' → give up", () => {
        const entry = lookupOxford("give  up", dict);
        expect(entry?.word).toBe("give up");
        // examples 列损坏 JSON → 空数组不抛错
        expect(entry!.examples).toEqual([{ en: "a.", zh: "甲" }]);
    });

    it("未命中返回 null", () => {
        expect(lookupOxford("zzzqqx", dict)).toBeNull();
    });

    it("空字符串返回 null", () => {
        expect(lookupOxford("   ", dict)).toBeNull();
    });

    it("词典不可用（null）时返回 null 不抛错", () => {
        expect(lookupOxford("abandon", null)).toBeNull();
    });
});
