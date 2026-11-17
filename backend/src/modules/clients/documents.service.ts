/**
 * Documents with their version history: an employee's (offer letter, ID proof), a project's, a client's.
 * - an employee's documents: that employee, HR and Admin (employees:edit)
 * - project and client documents: anyone with clients:view
 * A new version attaches an uploaded file (POST /uploads first); a download is a five-minute signed link.
 * Versions recorded before uploads existed have no file: their download is a text stand-in, as in the demo.
 */
import type { Document } from '@riona/shared';
import type { Kysely, Transaction } from 'kysely';
import { z } from 'zod';
import { db } from '../../db/client';
import type { DB } from '../../db/schema';
import { withTransaction } from '../../db/tx';
import { can, selfId } from '../../auth/rbac/authorize';
import type { Actor } from '../../http/plugins/session';
import { forbidden, notFound, unprocessable } from '../../lib/errors';
import { today } from '../../lib/dates';
import { fileRecord, humanSize, signedUrl } from '../../storage/files';

type Q = Kysely<DB> | Transaction<DB>;
const OWNER_TYPES = ['employee', 'project', 'client'] as const;

export const DocumentsQuery = z.object({ ownerType: z.enum(OWNER_TYPES, { errorMap: () => ({ message: 'Choose employee, project or client documents.' }) }), ownerId: z.string().max(40).optional() });
export const NewVersion = z.object({ note: z.string().max(500).default(''), fileId: z.string().max(60).optional() });

/** Whose documents of this kind the actor may see: null = all, or a list of owner ids. */
function readableOwners(actor: Actor, ownerType: Document['ownerType']): string[] | null {
  if (ownerType === 'employee') return can(actor, 'employees', 'edit') ? null : actor.employeeId ? [actor.employeeId] : [];
  return can(actor, 'clients', 'view') ? null : [];
}
const canWrite = (actor: Actor, ownerType: Document['ownerType'], ownerId: string) =>
  ownerType === 'employee' ? can(actor, 'employees', 'edit') || ownerId === actor.employeeId : can(actor, 'clients', 'edit') || can(actor, 'projects', 'edit');

async function load(q: Q, where: { ids?: string[]; ownerType?: string; ownerIds?: string[] | null; ownerId?: string }): Promise<Document[]> {
  let dq = q.selectFrom('documents').selectAll();
  if (where.ids) dq = dq.where('id', 'in', where.ids.length ? where.ids : ['-']);
  if (where.ownerType) dq = dq.where('ownerType', '=', where.ownerType);
  if (where.ownerId) dq = dq.where('ownerId', '=', where.ownerId);
  if (where.ownerIds) dq = dq.where('ownerId', 'in', where.ownerIds.length ? where.ownerIds : ['-']);
  const rows = await dq.orderBy(q.fn('length', ['id'])).orderBy('id').execute();
  if (!rows.length) return [];
  const versions = await q.selectFrom('documentVersions').selectAll().where('documentId', 'in', rows.map((r) => r.id)).orderBy('version').execute();
  return rows.map((d) => ({
    id: d.id, ownerType: d.ownerType as Document['ownerType'], ownerId: d.ownerId, name: d.name, type: d.type, expires: d.expires, visibleToClient: d.visibleToClient,
    versions: versions.filter((v) => v.documentId === d.id).map((v) => ({ version: v.version, uploaded: v.uploaded, byId: v.byId ?? '', size: v.size, note: v.note })),
  }));
}

/** GET /documents?ownerType&ownerId */
export async function listDocuments(actor: Actor, ownerType: Document['ownerType'], ownerId?: string): Promise<Document[]> {
  const owners = readableOwners(actor, ownerType);
  if (ownerId && owners && !owners.includes(ownerId)) return [];
  return load(db, { ownerType, ownerId, ownerIds: ownerId ? undefined : owners });
}

async function readable(q: Q, actor: Actor, id: string) {
  const [doc] = await load(q, { ids: [id] });
  const owners = doc ? readableOwners(actor, doc.ownerType) : [];
  if (!doc || (owners && !owners.includes(doc.ownerId))) throw notFound('Document not found');
  return doc;
}

/** POST /documents/:id/versions { note, fileId } — the file comes from POST /uploads. */
export async function uploadVersion(actor: Actor, id: string, note: string, fileId?: string): Promise<Document> {
  const me = selfId(actor);
  return withTransaction(actor, async (tx) => {
    const doc = await readable(tx.db, actor, id);
    if (!canWrite(actor, doc.ownerType, doc.ownerId)) throw forbidden('You can’t add versions to this document.');
    await tx.db.selectFrom('documents').select('id').where('id', '=', id).forUpdate().execute();
    if (!fileId) throw unprocessable('Choose a file to upload.', { file: 'Required' });
    const file = await fileRecord(tx.db, fileId);
    // Only the uploader's own, not-yet-attached file.
    if (!file || file.uploadedBy !== me) throw unprocessable('That upload wasn’t found. Upload the file again.', { file: 'Unknown' });
    const used = await tx.db.selectFrom('documentVersions').select('documentId').where('fileId', '=', fileId).executeTakeFirst();
    if (used) throw unprocessable('That file is already attached to a document.', { file: 'Already used' });
    const version = (doc.versions.at(-1)?.version ?? 0) + 1;
    await tx.db.insertInto('documentVersions').values({ documentId: id, version, uploaded: today(), byId: me, size: humanSize(Number(file.sizeBytes)), note: note.trim(), fileId }).execute();
    await tx.audit('Uploaded', 'Document', id, [{ field: 'version', before: String(version - 1), after: String(version) }, { field: 'file', before: null, after: file.filename }]);
    return (await load(tx.db, { ids: [id] }))[0];
  });
}

/** The download for a version (latest if none): a signed link to its file, or the stand-in for an old one. */
export async function versionDownload(q: Q, doc: { id: string; name: string }, version: { version: number; uploaded: string; fileId: string | null }) {
  const base = doc.name.replace(/[^A-Za-z0-9]+/g, '-') + '-v' + version.version;
  if (version.fileId) {
    const file = await fileRecord(q, version.fileId);
    if (file) {
      const ext = file.filename.includes('.') ? '.' + file.filename.split('.').pop() : '';
      const filename = base + ext;
      return { url: signedUrl(file.id, filename), filename };
    }
  }
  const body = `${doc.name}\nVersion ${version.version}\nUploaded ${version.uploaded}\n`;
  return { url: 'data:text/plain;charset=utf-8,' + encodeURIComponent(body), filename: base + '.txt' };
}

/** GET /documents/:id/versions/:version/download (version "latest" for the newest). */
export async function documentUrl(actor: Actor, id: string, version?: number) {
  const doc = await readable(db, actor, id);
  const v = version ?? doc.versions.at(-1)?.version;
  const row = await db.selectFrom('documentVersions').select(['version', 'uploaded', 'fileId']).where('documentId', '=', id).where('version', '=', v ?? 0).executeTakeFirst();
  if (!row) throw notFound('That version doesn’t exist.');
  return versionDownload(db, doc, row);
}
