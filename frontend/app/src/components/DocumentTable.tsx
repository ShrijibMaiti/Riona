import { useState } from 'react';
import * as api from '../data/repositories';
import type { Document } from '../data/types';
import { useEmployees } from '../hooks/data';
import { dmy } from '../lib/format';
import { invalidate, useQuery } from '../lib/query';
import { useApp } from '../state/store';
import { ErrorState, SkeletonRows } from './ui';

/** Documents with version history. Each row downloads its latest version; expand to see and fetch earlier ones. */
export function DocumentTable({ ownerType, ownerId, clientView = false, canUpload = true }: { ownerType: Document['ownerType']; ownerId: string; clientView?: boolean; canUpload?: boolean }) {
  const { say } = useApp();
  const q = useQuery(['documents', ownerType, ownerId], () => api.getDocuments(ownerType, ownerId));
  const emps = useEmployees();
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  const docs = (q.data ?? []).filter((d) => !clientView || d.visibleToClient);
  const download = async (d: Document, v?: number) => {
    const r = await api.getDocumentUrl(d.id, v);
    const a = document.createElement('a');
    a.href = r.url;
    a.download = r.filename;
    a.click();
    say('Downloading ' + r.filename);
  };
  const upload = async (d: Document, file: File, lastVersion: number) => {
    setBusy(d.id);
    try {
      const f = await api.uploadFile(file);
      await api.uploadVersion(d.id, file.name, f.id);
      invalidate('documents');
      say('Version ' + (lastVersion + 1) + ' of ' + d.name + ' uploaded');
    } catch (e) {
      say((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const name = (id: string) => emps.data?.find((e) => e.id === id)?.name ?? '—';
  return (
    <div className="card doc-table">
      <div className="doc-row head"><span>Document</span><span>Type</span><span>Uploaded</span><span>{ownerType === 'employee' ? 'Expires' : 'Versions'}</span><span /></div>
      {!q.data && <SkeletonRows n={4} />}
      {docs.map((d) => {
        const last = d.versions[d.versions.length - 1];
        const isOpen = open === d.id;
        return (
          <div key={d.id}>
            <div className="doc-row">
              <span style={{ fontWeight: 500 }}>
                {d.name}
                {d.versions.length > 1 && <button className="link-btn" style={{ marginLeft: 10 }} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : d.id)}>v{last.version} · history</button>}
              </span>
              <span className="muted">{d.type}</span>
              <span className="muted">{dmy(last.uploaded)}</span>
              <span className="muted">{ownerType === 'employee' ? (d.expires ? dmy(d.expires) : '—') : d.versions.length}</span>
              <span style={{ justifySelf: 'end', display: 'flex', gap: 14 }}>
                {canUpload && !clientView && (
                  <label className="link-btn" style={{ cursor: busy === d.id ? 'progress' : 'pointer' }}>
                    {busy === d.id ? 'Uploading…' : 'Upload'}
                    <input type="file" hidden disabled={busy === d.id} aria-label={'Upload a new version of ' + d.name} accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv,.zip,.doc,.docx,.xls,.xlsx,.pptx" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(d, f, last.version); }} />
                  </label>
                )}
                <button className="link-btn" onClick={() => download(d)}>Download</button>
              </span>
            </div>
            {isOpen && (
              <div className="doc-versions">
                {[...d.versions].reverse().map((v) => (
                  <div key={v.version} className="doc-ver">
                    <span className="mono">v{v.version}</span>
                    <span>{dmy(v.uploaded)} · {name(v.byId)} · {v.size}{v.note ? ' · ' + v.note : ''}</span>
                    <button className="link-btn" onClick={() => download(d, v.version)}>Download</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {q.data && !docs.length && <div className="empty"><div className="empty-t">No documents yet.</div></div>}
    </div>
  );
}
