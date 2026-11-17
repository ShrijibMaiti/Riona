import { useState } from 'react';
import { HUBS, ROLE_NAV } from '../config/hubs';
import { describeApproval } from '../data/selectors/approvals';
import { useDecide } from '../hooks/actions';
import { useApprovals, useEmployees } from '../hooks/data';
import { go, useApp } from '../state/store';

/** Below 1024px the hubs collapse into a full-screen menu. */
export function MobileMenu() {
  const { role } = useApp();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="mobile-menu">
      <div className="mm-hub">
        <button className="mm-toggle" onClick={() => go('/app')}>
          <span className="t">Dashboard</span><span className="s">→</span>
        </button>
      </div>
      {ROLE_NAV[role].filter((k) => k !== 'dashboard').map((k) => {
        const H = HUBS[k];
        const isOpen = open === k;
        return (
          <div key={k} className="mm-hub">
            <button className="mm-toggle" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : k)}>
              <span className="t">{H.label}</span><span className="s">{isOpen ? '−' : '+'}</span>
            </button>
            {isOpen && (
              <div className="mm-links">
                <a href={'#' + H.path}>Overview</a>
                {H.modules.map((m) => (
                  <a key={m.href} href={'#' + m.href}>{m.name} <span>— {m.tagline}</span></a>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Rejecting always needs a reason; it's shared with the requester. */
export function RejectModal() {
  const { rejectFor, askReject } = useApp();
  const { decide } = useDecide();
  const aps = useApprovals(), emps = useEmployees();
  const [text, setText] = useState('');
  const raw = aps.data?.find((x) => x.id === rejectFor);
  if (!raw || !emps.data) return null;
  const a = describeApproval(raw, emps.data);
  const ok = text.trim().length > 2;
  const cancel = () => { setText(''); askReject(null); };
  return (
    <div className="overlay modal-wrap">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="rej-title">
        <h2 id="rej-title">Reject request</h2>
        <div className="sub">{a.who} · {a.detail}</div>
        <label htmlFor="rej-reason">Reason — required, shared with {a.who.split(' ')[0]}</label>
        <textarea id="rej-reason" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="What would make this approvable?" autoFocus />
        <div className="modal-actions">
          <button className="btn-line" onClick={cancel}>Cancel</button>
          <button className="btn-danger" disabled={!ok} onClick={async () => { if (await decide(a.id, false, a.who, a.type, text)) { setText(''); askReject(null); } }}>Reject</button>
        </div>
      </div>
    </div>
  );
}

export function Toast() {
  const { toast } = useApp();
  return toast ? <div className="toast" role="status">{toast}</div> : null;
}
