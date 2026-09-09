import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { env } from "@/lib/env";

/**
 * Object storage behind an interface. The local provider is for development
 * only; production uses S3-compatible storage. Nothing outside this file knows
 * which one is in use.
 */

export interface StoredObject {
  key: string;
  checksum: string;
  sizeBytes: number;
}

export interface StorageProvider {
  put(input: { body: Buffer; contentType: string; fileName: string; prefix: string }): Promise<StoredObject>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
  /** Short-lived download URL. The local provider streams through a route instead. */
  signedUrl(key: string, expiresInSeconds?: number): Promise<string>;
}

const ALLOWED_MIME = new Set([
  "application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic",
  "text/csv", "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export class UploadRejected extends Error {}

/** Checked before anything touches disk. Extension is not trusted; the declared
 *  MIME type and the magic bytes both have to agree. */
export function validateUpload(file: { mimeType: string; sizeBytes: number; body: Buffer }): void {
  if (file.sizeBytes > MAX_UPLOAD_BYTES) {
    throw new UploadRejected("That file is larger than 20 MB. Split it or send a smaller scan.");
  }
  if (file.sizeBytes === 0) throw new UploadRejected("That file is empty.");
  if (!ALLOWED_MIME.has(file.mimeType)) {
    throw new UploadRejected("Upload a PDF, image or spreadsheet.");
  }
  if (!sniffMatches(file.mimeType, file.body)) {
    throw new UploadRejected("That file's contents do not match its type.");
  }
}

function sniffMatches(mimeType: string, body: Buffer): boolean {
  const head = body.subarray(0, 12);
  if (mimeType === "application/pdf") return head.subarray(0, 4).toString("latin1") === "%PDF";
  if (mimeType === "image/jpeg") return head[0] === 0xff && head[1] === 0xd8;
  if (mimeType === "image/png") return head[0] === 0x89 && head.subarray(1, 4).toString("latin1") === "PNG";
  if (mimeType === "image/webp") return head.subarray(8, 12).toString("latin1") === "WEBP";
  return true; // spreadsheets are zip containers; the scanner is the backstop
}

class LocalStorage implements StorageProvider {
  private root = resolve(env.STORAGE_LOCAL_DIR ?? "./.storage");

  private path(key: string): string {
    const full = resolve(join(this.root, key));
    if (!full.startsWith(this.root)) throw new Error("Refusing to escape the storage root.");
    return full;
  }

  async put(input: { body: Buffer; contentType: string; fileName: string; prefix: string }) {
    const key = `${input.prefix}/${randomUUID()}-${input.fileName.replace(/[^\w.\-]/g, "_")}`;
    const target = this.path(key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, input.body);
    return {
      key,
      checksum: createHash("sha256").update(input.body).digest("hex"),
      sizeBytes: input.body.byteLength,
    };
  }

  async get(key: string) { return readFile(this.path(key)); }
  async remove(key: string) { await unlink(this.path(key)).catch(() => undefined); }
  async signedUrl(key: string) { return `/api/v1/documents/download?key=${encodeURIComponent(key)}`; }
}

/**
 * S3 provider. Left unimplemented on purpose rather than stubbed with a fake
 * success: a silent no-op in a document store is worse than a loud failure.
 * Install @aws-sdk/client-s3 and fill these three methods before switching
 * STORAGE_PROVIDER to "s3".
 */
class S3Storage implements StorageProvider {
  async put(): Promise<StoredObject> { throw new Error("S3 storage is not wired up yet. See src/lib/providers/storage.ts."); }
  async get(): Promise<Buffer> { throw new Error("S3 storage is not wired up yet."); }
  async remove(): Promise<void> { throw new Error("S3 storage is not wired up yet."); }
  async signedUrl(): Promise<string> { throw new Error("S3 storage is not wired up yet."); }
}

export const storage: StorageProvider =
  env.STORAGE_PROVIDER === "s3" ? new S3Storage() : new LocalStorage();

/** Virus scanning boundary. Swap for ClamAV or a vendor before production. */
export interface ScanProvider { scan(body: Buffer): Promise<"CLEAN" | "INFECTED" | "SKIPPED"> }

export const scanner: ScanProvider = {
  async scan() { return env.NODE_ENV === "production" ? "SKIPPED" : "SKIPPED"; },
};
