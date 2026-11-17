/**
 * Uploaded files. The bytes go to the file store (a directory, STORAGE_DIR) under a random key; the `files` row
 * records the name, type, size and SHA-256. Nothing in the store is served directly: a download is a short-lived
 * link signed with the server's secret (GET /files/:id?exp&sig), handed out only after the caller has been shown
 * to have access to the record the file belongs to.
 */
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { Kysely, Transaction } from 'kysely';
import { config } from '../config';
import type { DB } from '../db/schema';
import { ApiError, unprocessable } from '../lib/errors';
import { newId } from '../lib/ids';

type Q = Kysely<DB> | Transaction<DB>;

/** What may be uploaded: documents, spreadsheets, images, text and archives. Never HTML, scripts or executables. */
const ALLOWED: Record<string, string[]> = {
  'application/pdf': ['pdf'],
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/webp': ['webp'],
  'text/plain': ['txt'],
  'text/csv': ['csv'],
  'application/zip': ['zip'],
  'application/msword': ['doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
  'application/vnd.ms-excel': ['xls'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['pptx'],
};
const BY_EXT = new Map(Object.entries(ALLOWED).flatMap(([type, exts]) => exts.map((e) => [e, type] as const)));

const root = () => (isAbsolute(config.storage.dir) ? config.storage.dir : resolve(process.cwd(), config.storage.dir));

export const humanSize = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** A safe display name: no path, no control characters, at most 200 characters. */
function cleanName(raw: string) {
  const base = raw.split(/[\\/]/).pop() ?? '';
  const name = base.replace(/[\u0000-\u001f\u007f"<>|:*?]/g, '').trim().slice(0, 200);
  return name || 'file';
}

export type StoredFile = { id: string; filename: string; contentType: string; size: number; sizeLabel: string };

/**
 * Stores an upload and records it. The type is decided by the file's extension, which must agree with what the
 * browser declared (when it declared something specific); anything not on the list is refused.
 */
export async function saveFile(q: Q, input: { bytes: Buffer; filename: string; declaredType?: string; uploadedBy: string | null }): Promise<StoredFile> {
  const filename = cleanName(input.filename);
  const ext = filename.includes('.') ? filename.split('.').pop()!.toLowerCase() : '';
  const contentType = BY_EXT.get(ext);
  if (!contentType) throw unprocessable('That kind of file can’t be uploaded. Use PDF, an image, a Word, Excel or PowerPoint file, text, CSV or ZIP.', { file: 'Type not allowed' }, 'upload.type');
  const declared = (input.declaredType ?? '').split(';')[0].trim().toLowerCase();
  if (declared && declared !== 'application/octet-stream' && declared !== contentType && !(ALLOWED[declared] ?? []).includes(ext)) {
    throw unprocessable('The file’s type doesn’t match its name.', { file: 'Type mismatch' }, 'upload.type');
  }
  if (!input.bytes.length) throw unprocessable('That file is empty.', { file: 'Empty' }, 'upload.empty');
  if (input.bytes.length > config.storage.maxBytes) throw new ApiError(413, `Files can be up to ${humanSize(config.storage.maxBytes)}.`, 'payload_too_large');

  const id = newId('F');
  const now = new Date();
  const storageKey = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}`;
  const path = join(root(), storageKey);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, input.bytes, { flag: 'wx' });
  const sha256 = createHash('sha256').update(input.bytes).digest('hex');
  await q.insertInto('files').values({ id, storageKey, filename, contentType, sizeBytes: input.bytes.length, sha256, uploadedBy: input.uploadedBy }).execute();
  return { id, filename, contentType, size: input.bytes.length, sizeLabel: humanSize(input.bytes.length) };
}

export async function fileRecord(q: Q, id: string) {
  return q.selectFrom('files').selectAll().where('id', '=', id).executeTakeFirst();
}

/** The stored bytes, checked against the recorded hash (a tampered or truncated file is not served). */
export async function readStored(rec: { storageKey: string; sha256: string }) {
  const bytes = await readFile(join(root(), rec.storageKey));
  if (createHash('sha256').update(bytes).digest('hex') !== rec.sha256) throw new ApiError(500, 'This file is damaged. Upload it again.', 'file.damaged');
  return bytes;
}

// ---------------- signed download links ----------------

const LINK_SECONDS = 5 * 60;
const sign = (id: string, exp: number, name: string) => createHmac('sha256', config.session.secret).update(`file:${id}:${exp}:${name}`).digest('base64url');

/** A link valid for five minutes, downloading the file under `downloadName`. */
export function signedUrl(id: string, downloadName: string) {
  const exp = Math.floor(Date.now() / 1000) + LINK_SECONDS;
  const name = cleanName(downloadName);
  return `${config.apiPrefix}/files/${encodeURIComponent(id)}?exp=${exp}&name=${encodeURIComponent(name)}&sig=${sign(id, exp, name)}`;
}

export function verifySignature(id: string, exp: number, name: string, sig: string) {
  if (!Number.isFinite(exp) || exp < Date.now() / 1000) return false;
  const want = Buffer.from(sign(id, exp, name));
  const got = Buffer.from(sig);
  return got.length === want.length && timingSafeEqual(got, want);
}
