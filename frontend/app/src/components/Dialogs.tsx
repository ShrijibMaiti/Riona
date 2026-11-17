import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Employee } from '../data/types';
import { initials } from '../lib/format';

/** Modal — only for confirmations, recording a payment, and stock in/out. */
export function Modal({ title, children, onClose, labelledBy = 'modal-title' }: { title: string; children: ReactNode; onClose: () => void; labelledBy?: string }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="overlay modal-wrap" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={labelledBy} onClick={(e) => e.stopPropagation()}>
        <h2 id={labelledBy}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({ title, body, confirm, danger, onConfirm, onCancel }: { title: string; body: ReactNode; confirm: string; danger?: boolean; onConfirm: () => void | Promise<void>; onCancel: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onCancel}>
      <div className="sub" style={{ marginTop: 10, lineHeight: 1.55 }}>{body}</div>
      <div className="modal-actions">
        <button className="btn-line" onClick={onCancel}>Cancel</button>
        <button className={danger ? 'btn-danger' : 'btn-dark'} disabled={busy} onClick={async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); } }}>{busy ? 'Working…' : confirm}</button>
      </div>
    </Modal>
  );
}

/** Inline person search (a popover, not a modal). */
export function PersonPicker({ people, onPick, onClose, label = 'Choose a person', exclude = [] }: { people: Employee[]; onPick: (e: Employee) => void; onClose: () => void; label?: string; exclude?: string[] }) {
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', off);
    return () => document.removeEventListener('mousedown', off);
  }, [onClose]);
  const list = people.filter((p) => !exclude.includes(p.id) && (p.name + ' ' + p.title + ' ' + p.dept).toLowerCase().includes(q.toLowerCase())).slice(0, 8);
  return (
    <div className="picker" ref={ref} role="dialog" aria-label={label}>
      <input autoFocus className="input" placeholder={label} value={q} onChange={(e) => { setQ(e.target.value); setI(0); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setI(Math.min(list.length - 1, i + 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setI(Math.max(0, i - 1)); }
          if (e.key === 'Enter' && list[i]) onPick(list[i]);
          if (e.key === 'Escape') onClose();
        }} />
      <div className="picker-list">
        {list.map((p, k) => (
          <button key={p.id} className={'picker-row' + (k === i ? ' on' : '')} onMouseEnter={() => setI(k)} onClick={() => onPick(p)}>
            <span className="pcell-av" style={{ width: 26, height: 26, fontSize: 11 }}>{initials(p.name)}</span>
            <span><b>{p.name}</b><span>{p.title} · {p.dept}</span></span>
          </button>
        ))}
        {!list.length && <div className="empty-s" style={{ padding: 12 }}>No one matches.</div>}
      </div>
    </div>
  );
}
