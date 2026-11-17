/**
 * File uploads and signed downloads.
 *
 * POST /uploads — the request body is the file itself (any content type), its name in X-Filename (URI-encoded).
 *   Signed-in staff only. Answers { id, filename, contentType, size, sizeLabel }; the id is then attached to a
 *   record (e.g. POST /documents/:id/versions { note, fileId }).
 * GET /files/:id?exp&name&sig — the download behind a signed link. No session needed: the signature is the
 *   permission, and it expires after five minutes.
 */
import type { FastifyPluginAsync } from 'fastify';
import { config } from '../../config';
import { db } from '../../db/client';
import { ApiError, forbidden, notFound, unprocessable } from '../../lib/errors';
import { requireSession } from '../plugins/session';
import { fileRecord, readStored, saveFile, verifySignature } from '../../storage/files';

const uploadsRoutes: FastifyPluginAsync = async (app) => {
  // In this route group every body is raw bytes (a .json upload is a file, not a request).
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: config.storage.maxBytes }, (_req, body, done) => done(null, body));

  app.post('/uploads', { onRequest: requireSession, bodyLimit: config.storage.maxBytes }, async (req) => {
    if (!req.actor!.employeeId) throw forbidden('This account can’t upload files.');
    const raw = req.headers['x-filename'];
    if (typeof raw !== 'string' || !raw) throw unprocessable('Name the file (X-Filename).', { file: 'Missing name' });
    let filename: string;
    try {
      filename = decodeURIComponent(raw);
    } catch {
      throw unprocessable('The file name isn’t valid.', { file: 'Bad name' });
    }
    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    return saveFile(db, { bytes, filename, declaredType: req.headers['content-type'], uploadedBy: req.actor!.employeeId });
  });

  app.get<{ Params: { id: string }; Querystring: { exp?: string; name?: string; sig?: string } }>('/files/:id', async (req, reply) => {
    const { exp, name, sig } = req.query;
    if (!exp || !name || !sig || !verifySignature(req.params.id, Number(exp), name, sig)) throw new ApiError(403, 'This download link has expired. Download the file again.', 'file.link_expired');
    const rec = await fileRecord(db, req.params.id);
    if (!rec) throw notFound('File not found');
    const bytes = await readStored(rec);
    return reply
      .header('Content-Type', rec.contentType)
      .header('Content-Length', bytes.length)
      .header('Content-Disposition', `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(name)}`)
      .header('Cache-Control', 'private, no-store')
      .send(bytes);
  });
};

export default uploadsRoutes;
