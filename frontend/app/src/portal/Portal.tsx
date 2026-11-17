/**
 * The client portal: a separate app with its own shell (no Riona top bar), four sections and the client's
 * logo. Built in the visual language of the landing's portal preview. It reads only the portal repository,
 * which returns client-safe projections — no internal tasks, assignees or hours exist here to leak.
 */
import { RionaMark } from '../components/Brand';
import { useEffect, useState, type ReactNode } from 'react';
import * as api from '../data/repositories';
import type { PortalInvoice, PortalProject, PortalTicket } from '../data/repositories';
import type { TicketPriority } from '../data/types';
import { Modal } from '../components/Dialogs';
import { Toast } from '../components/Overlays';
import { TimelineGantt } from '../components/TimelineGantt';
import { Async, EmptyState, SkeletonRows, StatusLabel } from '../components/ui';
import { TODAY_ISO } from '../lib/dates';
import { ago, dmy, initials, inr } from '../lib/format';
import { invalidate, useQuery } from '../lib/query';
import { go, loadFresh, useApp } from '../state/store';

const NAV = [['projects', 'Projects'], ['invoices', 'Invoices'], ['tickets', 'Tickets'], ['documents', 'Documents']] as const;

const usePortalSession = () => useQuery(['portal', 'session'], api.getPortalSession);

export default function Portal({ path }: { path: string }) {
  const seg = path.split('/').filter(Boolean); // ['portal', section, id?]
  const section = seg[1] ?? 'projects';
  const s = usePortalSession();
  const [menu, setMenu] = useState(false);
  useEffect(() => setMenu(false), [path]);
  const name = s.data?.contactName ?? '';

  let body: ReactNode;
  if (section === 'projects' && seg[2]) body = <ProjectPage id={seg[2]} />;
  else if (section === 'invoices' && seg[2]) body = <InvoicePage id={seg[2]} />;
  else if (section === 'tickets' && seg[2] === 'new') body = <NewTicket />;
  else if (section === 'tickets' && seg[2]) body = <TicketPage id={seg[2]} />;
  else if (section === 'invoices') body = <Invoices />;
  else if (section === 'tickets') body = <Tickets />;
  else if (section === 'documents') body = <Documents />;
  else body = <Projects />;

  return (
    <div className="portal">
      <header className="portal-bar">
        <div className="portal-bar-in">
          <a href="#/portal" className="portal-brand" aria-label="Portal home">
            <span className="portal-riona"><RionaMark size={17} />riona</span><span className="portal-x">×</span>
            {/* Client logo slot: the client's own wordmark, uploaded by the admin; text fallback until then. */}
            <span className="portal-logo">{s.data ? s.data.clientName.split(' ')[0].toLowerCase() : ''}</span>
          </a>
          <nav className="portal-nav" aria-label="Portal">
            {NAV.map(([k, label]) => <a key={k} href={'#/portal/' + k} className={'portal-nav-a' + (section === k ? ' on' : '')} aria-current={section === k ? 'page' : undefined}>{label}</a>)}
          </nav>
          <div className="portal-me">
            <button className="portal-av" aria-label={'Account: ' + name} aria-expanded={menu} onClick={() => setMenu(!menu)}>{initials(name)}</button>
            {menu && (
              <div className="menu-pop portal-menu" role="menu">
                <div className="portal-menu-who"><b>{name}</b><span>{s.data?.contactEmail}</span></div>
                <button role="menuitem" className="dropdown-item" onClick={signOut}>Sign out</button>
              </div>
            )}
          </div>
        </div>
      </header>
      <main key={path} className="wrap page portal-page">{body}</main>
      <Toast />
    </div>
  );
}

// ---------------------------------------------------------------- projects

function Ring({ pct, size = 112 }: { pct: number; size?: number }) {
  return (
    <div className="ring" style={{ width: size, height: size, background: `conic-gradient(var(--violet) ${pct * 3.6}deg, var(--line-soft) 0)` }} role="img" aria-label={pct + '% complete'}>
      <div className="ring-in" style={{ width: size - 20, height: size - 20, fontSize: size > 90 ? 24 : 16 }}>{pct}%</div>
    </div>
  );
}
const nextMs = (p: PortalProject) => p.milestones.filter((m) => !m.done).sort((a, b) => a.date.localeCompare(b.date))[0];
const currentPhase = (p: PortalProject) => p.phases.find((ph) => ph.start <= TODAY_ISO && ph.end >= TODAY_ISO) ?? p.phases.filter((ph) => ph.start <= TODAY_ISO).slice(-1)[0];

function Projects() {
  const s = usePortalSession();
  const q = useQuery(['portal', 'projects'], api.getPortalProjects);
  const active = q.data?.filter((p) => p.status === 'Active') ?? [];
  const soonest = active.map(nextMs).filter(Boolean).sort((a, b) => a!.date.localeCompare(b!.date))[0];
  return (
    <>
      <h1 className="display">Your projects with {s.data?.vendorName.split(' ')[0] ?? '…'}</h1>
      <p className="lede">{q.data ? `${active.length === 1 ? 'One active engagement' : active.length + ' active engagements'}${soonest ? ' · next milestone on ' + dmy(soonest.date) : ''}` : ' '}</p>
      <Async q={q} skeleton={<div className="card" style={{ marginTop: 40 }}><SkeletonRows n={3} /></div>}>
        {(ps) => ps.length === 0 ? <EmptyState title="No projects yet" sub="Projects appear here once your engagement starts." /> : (
          <div className="portal-projects">
            {ps.map((p) => {
              const ms = nextMs(p), ph = currentPhase(p);
              return (
                <a key={p.id} href={'#/portal/projects/' + p.id} className="card portal-proj">
                  <Ring pct={p.progress} />
                  <div style={{ minWidth: 0 }}>
                    <div className="portal-proj-n">{p.name}</div>
                    <div className="sub">Current phase · {ph?.name ?? 'Not started'}</div>
                    <div className="sub">Next milestone · {ms ? ms.name + ' · ' + dmy(ms.date) : 'All delivered'}</div>
                    {p.status !== 'Active' && <div style={{ marginTop: 8 }}><StatusLabel label={p.status} /></div>}
                  </div>
                </a>
              );
            })}
          </div>
        )}
      </Async>
    </>
  );
}

function ProjectPage({ id }: { id: string }) {
  const q = useQuery(['portal', 'project', id], () => api.getPortalProject(id));
  return (
    <>
      <a href="#/portal/projects" className="back-link">← Projects</a>
      <Async q={q} skeleton={<SkeletonRows n={4} />}>
        {(p) => (
          <>
            <div className="portal-proj-head">
              <Ring pct={p.progress} size={88} />
              <div>
                <h1 className="display">{p.name}</h1>
                <p className="lede" style={{ marginTop: 6 }}>{dmy(p.start)} – {dmy(p.end)} · {p.progress}% of scope delivered</p>
              </div>
            </div>
            <h2 className="section-title" style={{ marginTop: 40 }}>Timeline</h2>
            <div className="card" style={{ padding: 16, marginTop: 12 }}>
              <TimelineGantt today={TODAY_ISO} from={p.start} to={p.end} labelWidth={180}
                rows={p.phases.map((ph) => ({ key: ph.id, label: ph.name, bars: [{ start: ph.start, end: ph.end, done: ph.end < TODAY_ISO }] }))}
                milestones={p.milestones.map((m) => ({ date: m.date, label: m.name }))} />
            </div>
            <h2 className="section-title" style={{ marginTop: 40 }}>Milestones</h2>
            <div className="card" style={{ marginTop: 12 }}>
              {p.milestones.map((m) => (
                <div key={m.id} className="list-row portal-ms">
                  <span>{m.name}</span>
                  <span className="muted">{dmy(m.date)}</span>
                  <StatusLabel label={m.done ? 'Delivered' : m.date < TODAY_ISO ? 'Overdue' : 'Upcoming'} colour={m.done ? 'green' : m.date < TODAY_ISO ? 'red' : 'gray'} />
                </div>
              ))}
            </div>
            <p className="sub" style={{ marginTop: 24 }}>Questions about this project? <a className="ulink" href="#/portal/tickets/new">Raise a ticket</a>.</p>
          </>
        )}
      </Async>
    </>
  );
}

// ---------------------------------------------------------------- invoices

const invColour = (s: PortalInvoice['status']) => (s === 'Paid' ? 'green' : s === 'Overdue' ? 'red' : s === 'Partially paid' ? 'amber' : 'blue');

function PayDialog({ inv, onClose }: { inv: PortalInvoice; onClose: () => void }) {
  const { say } = useApp();
  const [method, setMethod] = useState<'UPI' | 'NEFT'>('UPI');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const pay = async () => {
    setBusy(true);
    try {
      await api.payPortalInvoice(inv.id, method);
      invalidate('portal', 'invoices', 'facts');
      say(inv.number + ' paid · ' + inr(inv.balance));
      onClose();
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  return (
    <Modal title={'Pay ' + inv.number} onClose={onClose}>
      <div className="test-mode" role="note">Test mode: no money moves. Riona records the payment as if your bank had confirmed it.</div>
      <div className="portal-pay-amt">{inr(inv.balance)}</div>
      <div className="sub">Due {dmy(inv.due)}{inv.paid > 0 ? ' · ' + inr(inv.paid) + ' already received' : ''}</div>
      <div className="seg" role="radiogroup" aria-label="Payment method" style={{ marginTop: 18, gridTemplateColumns: '1fr 1fr' }}>
        {(['UPI', 'NEFT'] as const).map((m) => <button key={m} role="radio" aria-checked={method === m} className={method === m ? 'active' : ''} onClick={() => setMethod(m)}>{m === 'UPI' ? 'UPI' : 'Net banking'}</button>)}
      </div>
      {err && <div className="err-banner" role="alert" style={{ marginTop: 14 }}>{err}</div>}
      <div className="modal-actions">
        <button className="btn-line" onClick={onClose}>Cancel</button>
        <button className="btn-dark" onClick={pay} disabled={busy}>{busy ? 'Recording…' : 'Record test payment'}</button>
      </div>
    </Modal>
  );
}

function Invoices() {
  const q = useQuery(['portal', 'invoices'], api.getPortalInvoices);
  const [paying, setPaying] = useState<PortalInvoice | null>(null);
  const due = q.data?.reduce((a, i) => a + i.balance, 0) ?? 0;
  return (
    <>
      <h1 className="display">Invoices</h1>
      <p className="lede">{q.data ? (due ? inr(due) + ' outstanding across ' + q.data.filter((i) => i.balance > 0).length + ' invoices' : 'Nothing outstanding') : ' '}</p>
      <Async q={q} skeleton={<div className="card" style={{ marginTop: 32 }}><SkeletonRows /></div>}>
        {(rows) => rows.length === 0 ? <EmptyState title="No invoices yet" /> : (
          <div className="card portal-inv" style={{ marginTop: 32 }}>
            <div className="portal-inv-row head"><span>Invoice</span><span>Due</span><span className="r">Amount</span><span>Status</span><span /></div>
            {rows.map((i) => (
              <div key={i.id} className="portal-inv-row">
                <a href={'#/portal/invoices/' + i.id} className="mono ulink">{i.number}</a>
                <span className="muted">Due {dmy(i.due)}</span>
                <span className="num r">{inr(i.total)}</span>
                <StatusLabel label={i.status} colour={invColour(i.status)} />
                <span className="r">{i.balance > 0 && <button className="btn-dark" onClick={() => setPaying(i)}>Pay</button>}</span>
              </div>
            ))}
          </div>
        )}
      </Async>
      {paying && <PayDialog inv={paying} onClose={() => setPaying(null)} />}
    </>
  );
}

function InvoicePage({ id }: { id: string }) {
  const q = useQuery(['portal', 'invoice', id], () => api.getPortalInvoice(id));
  const s = usePortalSession();
  const [paying, setPaying] = useState(false);
  const download = () => {
    const i = q.data!;
    const body = [i.number, 'Issued ' + dmy(i.issued) + ' · Due ' + dmy(i.due), '', ...i.lines.map((l) => l.description + '\t' + inr(l.amount)), '', 'Total ' + inr(i.total)].join('\n');
    const a = document.createElement('a');
    a.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(body);
    a.download = i.number + '.txt';
    a.click();
  };
  return (
    <>
      <a href="#/portal/invoices" className="back-link">← Invoices</a>
      <Async q={q} skeleton={<SkeletonRows n={5} />}>
        {(i) => (
          <>
            <div className="portal-inv-head">
              <div>
                <h1 className="display">Invoice <span className="mono-id">{i.number}</span></h1>
                <p className="lede" style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: '4px 14px', alignItems: 'center' }}><span>To {s.data?.clientName} · issued {dmy(i.issued)} · due {dmy(i.due)}</span><StatusLabel label={i.status} colour={invColour(i.status)} /></p>
              </div>
              <div className="portal-inv-acts">
                <button className="btn-line" onClick={download}>Download</button>
                {i.balance > 0 && <button className="btn-dark" onClick={() => setPaying(true)}>Pay {inr(i.balance)}</button>}
              </div>
            </div>
            {i.revision && (
              <div className="dual" style={{ marginTop: 20 }}>
                <div className="dual-note">Revised {dmy(i.revision.at.slice(0, 10))}: “{i.revision.reason}” First issued at <b>{inr(i.revision.firstIssuedTotal)}</b>; now <b>{inr(i.total)}</b>.</div>
              </div>
            )}
            <div className="card" style={{ marginTop: 28, padding: '8px 0' }}>
              {i.lines.map((l) => (
                <div key={l.id} className="list-row portal-line">
                  <span>{l.description}<span className="cell-sub">{l.quantity} {l.unit === 'h' ? 'h' : l.quantity === 1 ? 'item' : 'items'} × {inr(l.rate)}</span></span>
                  <span className="num r">{inr(l.amount)}</span>
                </div>
              ))}
              <div className="portal-tot">
                <span>Taxable value</span><span className="num">{inr(i.subtotal)}</span>
                {i.gst.igst > 0 || i.gst.cgst + i.gst.sgst === 0
                  ? <><span>IGST 18%</span><span className="num">{inr(i.gst.igst)}</span></>
                  : <><span>CGST 9%</span><span className="num">{inr(i.gst.cgst)}</span><span>SGST 9%</span><span className="num">{inr(i.gst.sgst)}</span></>}
                <b>Total</b><b className="num">{inr(i.total)}</b>
                {i.paid > 0 && <><span>Received</span><span className="num">− {inr(i.paid)}</span></>}
                <b>Balance due</b><b className="num">{inr(i.balance)}</b>
              </div>
            </div>
            {i.payments.length > 0 && (
              <>
                <h2 className="section-title" style={{ marginTop: 36 }}>Payments</h2>
                <div className="card" style={{ marginTop: 12 }}>
                  {i.payments.map((p) => <div key={p.reference} className="list-row portal-ms"><span>{dmy(p.date)}</span><span className="muted">{p.method} · <span className="mono">{p.reference}</span></span><span className="num r">{inr(p.amount)}</span></div>)}
                </div>
              </>
            )}
            {paying && <PayDialog inv={i} onClose={() => setPaying(false)} />}
          </>
        )}
      </Async>
    </>
  );
}

// ---------------------------------------------------------------- tickets

function Tickets() {
  const q = useQuery(['portal', 'tickets'], api.getPortalTickets);
  return (
    <>
      <div className="portal-head-row">
        <h1 className="display">Tickets</h1>
        <a className="btn-dark" href="#/portal/tickets/new">Raise a ticket</a>
      </div>
      <Async q={q} skeleton={<div className="card" style={{ marginTop: 32 }}><SkeletonRows /></div>}>
        {(rows) => rows.length === 0 ? <EmptyState title="No tickets" sub="Anything you raise shows up here with its status." /> : (
          <div className="card" style={{ marginTop: 32 }}>
            {rows.map((t) => (
              <a key={t.id} href={'#/portal/tickets/' + t.id} className="list-row portal-tk">
                <span className="mono muted">{t.id}</span>
                <span className="portal-tk-s">{t.subject}<span className="cell-sub">{t.priority} · opened {ago(t.opened)}</span></span>
                <StatusLabel label={t.status} />
              </a>
            ))}
          </div>
        )}
      </Async>
    </>
  );
}

function TicketPage({ id }: { id: string }) {
  const q = useQuery(['portal', 'ticket', id], () => api.getPortalTicket(id));
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const send = async () => {
    setBusy(true);
    try { await api.replyPortalTicket(id, text); setText(''); setErr(''); invalidate('portal'); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <>
      <a href="#/portal/tickets" className="back-link">← Tickets</a>
      <Async q={q} skeleton={<SkeletonRows n={4} />}>
        {(t: PortalTicket) => (
          <>
            <h1 className="display" style={{ fontSize: 'clamp(30px,4vw,44px)' }}>{t.subject}</h1>
            <p className="lede" style={{ marginTop: 8 }}><span className="mono">{t.id}</span> · {t.priority} · <StatusLabel label={t.status} /></p>
            <div className="thread" style={{ marginTop: 28 }}>
              {t.messages.map((m) => (
                <div key={m.id} className={'msg' + (m.fromClient ? ' ours' : '')}>
                  <div className="msg-h"><b>{m.author}</b><span>{ago(m.at)}</span></div>
                  <div className="msg-b">{m.text}</div>
                </div>
              ))}
            </div>
            {t.status !== 'Resolved' && (
              <div className="card composer" style={{ marginTop: 20, padding: 16 }}>
                <label className="field"><span>Reply</span><textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} /></label>
                {err && <div className="field"><span className="err" role="alert">{err}</span></div>}
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}><button className="btn-dark" onClick={send} disabled={busy}>{busy ? 'Sending…' : 'Send reply'}</button></div>
              </div>
            )}
          </>
        )}
      </Async>
    </>
  );
}

function NewTicket() {
  const { say } = useApp();
  const projects = useQuery(['portal', 'projects'], api.getPortalProjects);
  const [f, setF] = useState<{ subject: string; text: string; priority: TicketPriority; projectId: string }>({ subject: '', text: '', priority: 'Medium', projectId: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const t = await api.raisePortalTicket({ ...f, projectId: f.projectId || null });
      invalidate('portal', 'tickets');
      say(t.id + ' raised');
      go('/portal/tickets/' + t.id);
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  return (
    <>
      <a href="#/portal/tickets" className="back-link">← Tickets</a>
      <h1 className="display">Raise a ticket</h1>
      <p className="lede">We reply within the response time in your contract — four hours for urgent issues.</p>
      <div className="card portal-form">
        <label className="field"><span>Subject</span><input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></label>
        <div className="form-grid">
          <label className="field"><span>Project</span><select value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value })}><option value="">General</option>{projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label className="field"><span>Priority</span><select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as TicketPriority })}>{(['Urgent', 'High', 'Medium', 'Low'] as const).map((p) => <option key={p}>{p}</option>)}</select></label>
        </div>
        <label className="field"><span>What’s happening?</span><textarea rows={6} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} /></label>
        {err && <div className="err-banner" role="alert">{err}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <a className="btn-line" href="#/portal/tickets" style={{ display: 'inline-flex', alignItems: 'center' }}>Cancel</a>
          <button className="btn-dark" onClick={submit} disabled={busy}>{busy ? 'Raising…' : 'Raise ticket'}</button>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- documents

function Documents() {
  const { say } = useApp();
  const q = useQuery(['portal', 'documents'], api.getPortalDocuments);
  const download = async (id: string) => {
    const r = await api.getPortalDocumentUrl(id);
    const a = document.createElement('a');
    a.href = r.url;
    a.download = r.filename;
    a.click();
    say('Downloading ' + r.filename);
  };
  return (
    <>
      <h1 className="display">Documents</h1>
      <p className="lede">Contracts, designs and reports shared with you.</p>
      <Async q={q} skeleton={<div className="card" style={{ marginTop: 32 }}><SkeletonRows /></div>}>
        {(docs) => docs.length === 0 ? <EmptyState title="Nothing shared yet" /> : (
          <div className="card" style={{ marginTop: 32 }}>
            {docs.map((d) => (
              <div key={d.id} className="list-row portal-doc">
                <span>{d.name}<span className="cell-sub">{d.project ?? 'Account'} · {d.type}</span></span>
                <span className="muted">v{d.version} · {dmy(d.uploaded)} · {d.size}</span>
                <span className="r"><button className="link-btn" onClick={() => download(d.id)}>Download</button></span>
              </div>
            ))}
          </div>
        )}
      </Async>
    </>
  );
}

/** End the session, then load the sign-in page fresh so nothing cached from this session survives. */
async function signOut() {
  try {
    await api.logout();
  } finally {
    loadFresh(location.pathname + '#/login');
  }
}
