import { describe, it, expect, beforeAll } from "vitest";
import Database from "better-sqlite3";
import {
    lookupWord,
    resolveTableName,
    stripSuffixCandidates,
    type DictHandle,
} from "@/lib/vocab/dictionary";

// :memory: 小型 fixture，模拟 ECDICT stardict 表结构
const FIXTURE: Record<string, Partial<import("@/lib/vocab/dictionary").DictEntry>> = {
    apple: {
        phonetic: "'æpl",
        translation: "n. 苹果\nvt. 苹果公司产品",
        definition: "n. fruit with red or yellow or green skin",
        pos: "n:90/v:10",
        collins: 3,
        oxford: 1,
        tags: "zk gk cet4",
    },
    study: {
        phonetic: "'stʌdi",
        translation: "n. 学习，研究\nvt. 学习；考虑",
        exchange: "p:studied/d:studied/i:studying/3:studies/s:studies/0:study",
    },
    run: {
        phonetic: "'rʌn",
        translation: "vt. 跑；经营\nvi. 跑",
        exchange: "p:ran/d:run/i:running/3:runs/s:runs/0:run",
    },
    make: {
        phonetic: "'meɪk",
        translation: "vt. 制作；使得",
        exchange: "p:made/d:made/i:making/3:makes/s:makes/0:make",
    },
    go: {
        phonetic: "'gəʊ",
        translation: "vi. 走；去",
        exchange: "p:went/d:gone/i:going/3:goes/s:goes/0:go",
    },
    "give up": {
        translation: "放弃；投降",
    },
};

let dict: DictHandle;

beforeAll(() => {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE stardict (
        word TEXT PRIMARY KEY,
        phonetic TEXT,
        translation TEXT,
        definition TEXT,
        pos TEXT,
        collins INTEGER,
        oxford INTEGER,
        tag TEXT,
        exchange TEXT
    )`);
    const insert = db.prepare(
        `INSERT INTO stardict (word, phonetic, translation, definition, pos, collins, oxford, tag, exchange)
         VALUES (@word, @phonetic, @translation, @definition, @pos, @collins, @oxford, @tag, @exchange)`
    );
    for (const [word, fields] of Object.entries(FIXTURE)) {
        // fixture 用 DictEntry 的 tags 字段名，表中列名为 tag
        insert.run({
            word,
            phonetic: null,
            translation: null,
            definition: null,
            pos: null,
            collins: null,
            oxford: null,
            tag: fields.tags ?? null,
            exchange: null,
            ...fields,
        });
    }
    dict = { db, table: "stardict" };
});

describe("resolveTableName", () => {
    it("找到非系统表名", () => {
        expect(resolveTableName(dict.db)).toBe("stardict");
    });
});

describe("lookupWord 五级 fallback", () => {
    it("1. 精确匹配返回完整词条", () => {
        const entry = lookupWord("apple", dict);
        expect(entry).not.toBeNull();
        expect(entry!.word).toBe("apple");
        expect(entry!.phonetic).toBe("'æpl");
        expect(entry!.translation).toContain("苹果");
        expect(entry!.collins).toBe(3);
        expect(entry!.oxford).toBe(1);
        expect(entry!.tags).toBe("zk gk cet4");
    });

    it("2. 大小写归一：Apple → apple", () => {
        expect(lookupWord("Apple", dict)?.word).toBe("apple");
    });

    it("3. 短语空白归一：'give  up' → give up", () => {
        expect(lookupWord("give  up", dict)?.word).toBe("give up");
    });

    it("4a. 后缀 -ies → y：studies → study", () => {
        expect(lookupWord("studies", dict)?.word).toBe("study");
    });

    it("4b. 后缀 -ing +e：making → make", () => {
        expect(lookupWord("making", dict)?.word).toBe("make");
    });

    it("4c. 双写辅音还原：running → run", () => {
        expect(lookupWord("running", dict)?.word).toBe("run");
    });

    it("5. exchange 反查不规则变化：went → go", () => {
        expect(lookupWord("went", dict)?.word).toBe("go");
    });

    it("完全未命中返回 null", () => {
        expect(lookupWord("zzzqqx", dict)).toBeNull();
    });

    it("空字符串返回 null", () => {
        expect(lookupWord("   ", dict)).toBeNull();
    });
});

describe("降级与边界", () => {
    it("词典不可用（null）时返回 null 不抛错", () => {
        expect(lookupWord("apple", null)).toBeNull();
    });

    it("反查避免子串误配：go 不应误配 gogo", () => {
        // fixture 中 gogo 不存在；go 自身经 exchange 反查路径也可能命中自己，
        // 此处验证 token 校验逻辑：查 "o"（过短）不做反查
        expect(lookupWord("o", dict)?.word).not.toBe("go");
    });

    it("stripSuffixCandidates 顺序与去重", () => {
        // stopped: stem="stopp" → push "stopp", push "stoppe", push undouble→"stop"
        expect(stripSuffixCandidates("stopped")).toEqual(["stopp", "stoppe", "stop"]);
    });

    it("stripSuffixCandidates 短词不做剥离", () => {
        expect(stripSuffixCandidates("us")).toEqual([]);
    });
});
