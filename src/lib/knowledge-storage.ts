// 知识库 PDF 磁盘存储层：data/uploads/knowledge/<userId>/<uuid>.pdf
// 存储名一律由服务端生成（uuid），用户输入（filename/displayName）只进数据库不进路径，
// 路径穿越天然免疫。fs 具名导入以便单测 vi.mock
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { Readable } from "node:stream";
import path from "node:path";
import { randomUUID } from "node:crypto";

const PDF_EXTENSIONS = /\.pdf$/i;

export const KNOWLEDGE_DOC_TYPES = ["textbook", "guide", "exercise", "exam"] as const;
export type KnowledgeDocType = (typeof KNOWLEDGE_DOC_TYPES)[number];

export function getKnowledgeUploadRoot(): string {
    return process.env.KNOWLEDGE_UPLOAD_DIR || path.join(process.cwd(), "data", "uploads", "knowledge");
}

export function getDocPath(userId: string, storageName: string): string {
    if (!PDF_EXTENSIONS.test(storageName) || storageName.includes("/") || storageName.includes("\\")) {
        throw new Error("invalid storage name");
    }
    return path.join(getKnowledgeUploadRoot(), userId, storageName);
}

export function generateStorageName(): string {
    return randomUUID() + ".pdf";
}

export function isValidPdfFilename(filename: string): boolean {
    return PDF_EXTENSIONS.test(filename);
}

export async function ensureUserDir(userId: string): Promise<string> {
    const dir = path.join(getKnowledgeUploadRoot(), userId);
    await mkdir(dir, { recursive: true });
    return dir;
}

export async function savePdf(userId: string, data: Buffer | Uint8Array): Promise<string> {
    const dir = await ensureUserDir(userId);
    const storageName = generateStorageName();
    await writeFile(path.join(dir, storageName), data);
    return storageName;
}

export async function deletePdf(userId: string, storageName: string): Promise<void> {
    await unlink(getDocPath(userId, storageName));
}

export function pdfExists(userId: string, storageName: string): boolean {
    try {
        return existsSync(getDocPath(userId, storageName));
    } catch {
        return false;
    }
}

// web ReadableStream 供 NextResponse 直接消费（node:fs 在 vitest mock 下无法被路由侧可靠具名导入，
// 统一走本存储层）
export function openPdfStream(userId: string, storageName: string): ReadableStream<Uint8Array> {
    const nodeStream = createReadStream(getDocPath(userId, storageName));
    return Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;
}
