// ECDICT 词典查询层（dictionaries/ecdict.db，约 1GB，gitignore，只读访问）
// 查词 fallback 链：精确 → 小写 → 短语空白归一 → 后缀剥离 → exchange 反查原型
// 词典文件缺失或损坏时优雅降级（lookupWord 返回 null，不抛错）
import Database from "better-sqlite3";
import { existsSync } from "fs";
import path from "path";

export interface DictEntry {
    word: string;
    phonetic: string | null; // 音标
    translation: string | null; // 中文释义（每行一条）
    definition: string | null; // 英文释义（每行一条）
    pos: string | null; // 词性占比，如 "n:46/v:54"
    collins: number | null; // 柯林斯星级 1~5
    oxford: number | null; // 是否牛津三千核心词汇
    tags: string | null; // 考试标签 zk/gk/cet4/cet6/kaoyan/toefl/ielts/gre 空格分割
    exchange: string | null; // 词形变化 p:过去式/d:过去分词/i:现在分词/3:三单/s:复数/0:原型
}

export interface DictHandle {
    db: Database.Database;
    table: string;
}

interface DictRow {
    word: string;
    phonetic?: string | null;
    translation?: string | null;
    definition?: string | null;
    pos?: string | null;
    collins?: number | null;
    oxford?: number | null;
    tag?: string | null;
    exchange?: string | null;
}

const SELECT_COLUMNS =
    "word, phonetic, translation, definition, pos, collins, oxford, tag, exchange";

// globalThis 单例：防止 dev 热重载重复打开 1GB 文件
const globalStore = globalThis as unknown as { __ecdict?: DictHandle | null };

export function resolveTableName(db: Database.Database): string | null {
    const row = db
        .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name LIMIT 1"
        )
        .get() as { name: string } | undefined;
    return row?.name ?? null;
}

function getDictionary(): DictHandle | null {
    if (globalStore.__ecdict !== undefined) return globalStore.__ecdict;
    const file = path.join(process.cwd(), "dictionaries", "ecdict.db");
    let handle: DictHandle | null = null;
    if (existsSync(file)) {
        try {
            const db = new Database(file, { readonly: true, fileMustExist: true });
            const table = resolveTableName(db);
            if (table) handle = { db, table };
            else db.close();
        } catch {
            handle = null;
        }
    }
    globalStore.__ecdict = handle;
    return handle;
}

export function isDictionaryAvailable(): boolean {
    return getDictionary() !== null;
}

function toEntry(row: DictRow): DictEntry {
    return {
        word: row.word,
        phonetic: row.phonetic ?? null,
        translation: row.translation ?? null,
        definition: row.definition ?? null,
        pos: row.pos ?? null,
        collins: row.collins ?? null,
        oxford: row.oxford ?? null,
        tags: row.tag ?? null,
        exchange: row.exchange ?? null,
    };
}

export function queryExact(
    db: Database.Database,
    table: string,
    word: string
): DictEntry | null {
    const row = db
        .prepare(`SELECT ${SELECT_COLUMNS} FROM ${table} WHERE word = ?`)
        .get(word) as DictRow | undefined;
    return row ? toEntry(row) : null;
}

// 去掉重叠辅音（stopped → stop, running 的 stem running→runn → run）
function undouble(stem: string): string {
    if (stem.length >= 3) {
        const last = stem[stem.length - 1];
        const prev = stem[stem.length - 2];
        if (last === prev && /[a-z]/.test(last) && !"aeiou".includes(last)) {
            return stem.slice(0, -1);
        }
    }
    return stem;
}

// 生成后缀剥离候选词（顺序即优先级），所有候选都会再经字典验证，误剥离只会 miss 不会错配
export function stripSuffixCandidates(word: string): string[] {
    const out: string[] = [];
    const push = (s: string) => {
        if (s && s !== word && !out.includes(s)) out.push(s);
    };
    if (word.length < 4) return out;
    if (word.endsWith("ies") && word.length > 4) push(word.slice(0, -3) + "y"); // studies → study
    if (word.endsWith("ied") && word.length > 4) push(word.slice(0, -3) + "y"); // studied → study
    if (word.endsWith("es")) {
        push(word.slice(0, -2)); // boxes → box
        push(word.slice(0, -1)); // handles → handle
    }
    if (word.endsWith("ed")) {
        const stem = word.slice(0, -2);
        push(stem); // walked → walk
        push(stem + "e"); // hoped → hope
        push(undouble(stem)); // stopped → stop
    }
    if (word.endsWith("ing")) {
        const stem = word.slice(0, -3);
        push(stem); // walk → walking
        push(stem + "e"); // making → make
        push(undouble(stem)); // running → run
    }
    if (word.endsWith("est") && word.length > 5) {
        push(word.slice(0, -3)); // largest → larg
        push(word.slice(0, -3) + "e"); // nicest → nice
    }
    if (word.endsWith("er") && word.length > 4) {
        push(word.slice(0, -2)); // larger → larg
        push(word.slice(0, -2) + "e"); // nicer → nice
    }
    if (word.endsWith("s") && !word.endsWith("ss")) {
        push(word.slice(0, -1)); // cats → cat
    }
    return out;
}

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// exchange 反查：在所有词条的词形变化字段中找指定形式（含不规则变化，如 went → go）
function reverseLookupByExchange(
    db: Database.Database,
    table: string,
    word: string
): DictEntry | null {
    // 过短或含数字等非字母形式不值得全表扫描
    if (word.length < 2 || /[^a-z' -]/.test(word)) return null;
    const escaped = word.replace(/[\\%_]/g, (c) => "\\" + c);
    const rows = db
        .prepare(
            `SELECT ${SELECT_COLUMNS} FROM ${table}
             WHERE exchange LIKE '%:' || ? || '%' ESCAPE '\\' LIMIT 20`
        )
        .all(escaped) as DictRow[];
    // exchange 格式 "p:went/d:gone"，字段码为单字符（0/1/3/p/d/i/s/r/t），
    // LIKE 结果需二次校验形式词是完整 token（避免 "go" 误配 "gogo"）
    const tokenRe = new RegExp(
        `[013pdisrt]:${escapeRegExp(word)}(?=$|/)`
    );
    for (const row of rows) {
        if (row.exchange && tokenRe.test(row.exchange)) {
            const base = queryExact(db, table, row.word);
            if (base) return base;
        }
    }
    return null;
}

// 查词主入口。dict 参数用于单测注入 :memory: 数据库；生产走懒单例
export function lookupWord(
    raw: string,
    dict: DictHandle | null = getDictionary()
): DictEntry | null {
    if (!dict) return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const { db, table } = dict;
    const exact = queryExact(db, table, trimmed);
    if (exact) return exact;
    const lower = trimmed.toLowerCase();
    if (lower !== trimmed) {
        const byLower = queryExact(db, table, lower);
        if (byLower) return byLower;
    }
    const normalized = lower.replace(/\s+/g, " ");
    if (normalized !== lower) {
        const byNorm = queryExact(db, table, normalized);
        if (byNorm) return byNorm;
    }
    for (const candidate of stripSuffixCandidates(normalized)) {
        const hit = queryExact(db, table, candidate);
        if (hit) return hit;
    }
    return reverseLookupByExchange(db, table, normalized);
}
