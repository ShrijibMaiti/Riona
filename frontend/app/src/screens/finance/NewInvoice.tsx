import { useMemo, useState } from 'react';
import { ErrorState, Est, SkeletonRows } from '../../components/ui';
import * as api from '../../data/repositories';
import { HOME_STATE, invoiceTotals } from '../../data/selectors/finance';
import { makeCostRates } from '../../data/selectors/payroll';
import type { ExpenseClaim, TimesheetEntry } from '../../data/types';
import { useAllExpenses, useAllInvoices, useAllSalaryEvents, useClients, useEmployees, useMe, useProjects } from '../../hooks/data';
import { addDays } from '../../lib/dates';
import { dmy, hours, inr, initials, pct } from '../../lib/format';
import { all, invalidate, useQuery } from '../../lib/query';
import { go, useApp } from '../../state/store';

type Person = { key: string; employeeId: string; entries: TimesheetEntry[]; h: number; rate: number; amt: number };

type Data = NonNullable<ReturnType<typeof useInvoiceData>['data']>;
function useInvoiceData() {
  return all({
    me: useMe(), clients: useClients(), projects: useProjects(), emps: useEmployees(), invoices: useAllInvoices(), expenses: useAllExpenses(), salary: useAllSalaryEvents(),
    entries: useQuery(['entries', 'approved-billable'], () => api.getTimesheetEntries({ status: 'Approved', billable: true })),
  });
}
/** Approved, billable, T&M time not yet on a live invoice, grouped project → person. */
function unbilled(d: Data | undefined, billed: Set<string>, cid: string) {
  if (!d) return [];
  const ps = d.projects.filter((p) => p.clientId === cid && p.model === 'T&M');
  return ps.map((p) => {
    const es = d.entries.filter((e) => e.projectId === p.id && !billed.has(e.id));
    const by = new Map<string, TimesheetEntry[]>();
    for (const e of es) by.set(e.employeeId, [...(by.get(e.employeeId) ?? []), e]);
    const people: Person[] = [...by].map(([eid, list]) => {
      const rate = d.emps.find((x) => x.id === eid)?.billRate ?? 0;
      const h = list.reduce((a, e) => a + e.hours, 0);
      return { key: p.id + '|' + eid, employeeId: eid, entries: list.sort((a, b) => a.date.localeCompare(b.date)), h, rate, amt: Math.round(h * rate) };
    }).sort((a, b) => b.amt - a.amt);
    return { project: p, people };
  }).filter((g) => g.people.length);
}
function billableExpenses(d: Data | undefined, billed: Set<string>, cid: string): ExpenseClaim[] {
  return d ? d.expenses.filter((x) => x.clientId === cid && x.billable && (x.status === 'Approved' || x.status === 'Reimbursed') && !billed.has(x.id)) : [];
}

export default function NewInvoice({ initialClient }: { initialClient?: string }) {
  const { say } = useApp();
  const q = useInvoiceData();
  const [chosen, setChosen] = useState<string | null>(initialClient ?? null);
  const [picked, setPicked] = useState<Record<string, boolean> | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [manual, setManual] = useState<{ desc: string; amt: string }[]>([]);
  const [discount, setDiscount] = useState('');
  const [terms, setTerms] = useState(30);
  const [notes, setNotes] = useState('Thank you for your business.');
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const d = q.data;
  const billed = useMemo(() => new Set(d?.invoices.filter((i) => i.status !== 'Void').flatMap((i) => i.lines.flatMap((l) => [...l.entryIds, ...l.expenseIds]))), [d?.invoices]);
  /** Approved, billable, T&M time not yet on a live invoice, grouped project → person. */
  const unbilledFor = (cid: string) => unbilled(d, billed, cid);
  const expFor = (cid: string) => billableExpenses(d, billed, cid);
  // Default: the client with the most unbilled time. Derived, not copied into state by an effect.
  const defaultClient = useMemo(() => {
    if (!d) return null;
    const best = [...d.clients].map((c) => ({ c, v: unbilled(d, billed, c.id).reduce((a, g) => a + g.people.reduce((b, x) => b + x.amt, 0), 0) })).sort((a, b) => b.v - a.v)[0];
    return best?.c.id ?? null;
  }, [d, billed]);
  const clientId = chosen ?? defaultClient;
  // `picked` null means "everything ticked" for the current client — the starting state whichever way the client was chosen.
  const allTicked = useMemo(() => {
    const p: Record<string, boolean> = {};
    if (!clientId) return p;
    unbilled(d, billed, clientId).forEach((g) => g.people.forEach((x) => (p[x.key] = true)));
    billableExpenses(d, billed, clientId).forEach((x) => (p[x.id] = true));
    return p;
  }, [d, billed, clientId]);
  const pk = picked ?? allTicked;
  const toggle = (k: string) => setPicked({ ...pk, [k]: !pk[k] });
  const choose = (cid: string) => {
    setChosen(cid);
    setPicked(null);
    setOpen({});
    setManual([]);
  };

  if (q.error) return <div className="wrap page"><ErrorState error={q.error} retry={q.refetch} /></div>;
  if (!d || !clientId) return <div className="wrap page"><h1 className="display">New invoice</h1><div style={{ marginTop: 40 }}><SkeletonRows /></div></div>;
  const client = d.clients.find((c) => c.id === clientId)!;
  const groups = unbilledFor(clientId);
  const exps = expFor(clientId);
  const intra = client.state === HOME_STATE;
  const cost = makeCostRates(d.salary);
  const pName = (id: string) => d.emps.find((e) => e.id === id)?.name ?? id;
  const pTitle = (id: string) => d.emps.find((e) => e.id === id)?.title ?? '';

  const lines: { key: string; desc: string; sub: string; amt: number; src?: string }[] = [];
  let availH = 0, availA = 0, pickedH = 0, labour = 0;
  const allDates: string[] = [];
  for (const g of groups) for (const x of g.people) {
    availH += x.h; availA += x.amt;
    x.entries.forEach((e) => allDates.push(e.date));
    if (pk[x.key]) {
      lines.push({ key: x.key, desc: g.project.name + ' — ' + pName(x.employeeId), sub: pTitle(x.employeeId) + ' · ' + hours(x.h) + ' × ' + inr(x.rate), amt: x.amt, src: x.entries.length + ' timesheet entries' });
      pickedH += x.h;
      labour += x.entries.reduce((a, e) => a + e.hours * cost(e.employeeId, e.date), 0);
    }
  }
  for (const x of exps) if (pk[x.id]) lines.push({ key: x.id, desc: x.description, sub: 'Billable expense · ' + x.id, amt: x.amount });
  const manualLines = manual.filter((m) => m.desc && +m.amt);
  const totals = invoiceTotals({ lines: [...lines.map((l) => ({ amount: l.amt })), ...manualLines.map((m) => ({ amount: +m.amt }))] as never, discount: +discount || 0, payments: [] }, client);
  const timeRevenue = lines.filter((l) => l.src).reduce((a, l) => a + l.amt, 0);
  const margin = timeRevenue - labour;
  const issued = d.me.today;
  const due = addDays(issued, terms);
  const nextNo = 'INV-2026-' + String(Math.max(0, ...d.invoices.map((i) => +i.number.slice(-4))) + 1).padStart(4, '0');
  const nLines = lines.length + manualLines.length;
  const sorted = allDates.sort();

  const create = async () => {
    if (!nLines) { say('Pick at least one entry or add a manual line'); return; }
    setBusy(true); setErr(null);
    try {
      const entryIds = groups.flatMap((g) => g.people.filter((x) => pk[x.key]).flatMap((x) => x.entries.map((e) => e.id)));
      const inv = await api.createInvoice({ clientId, issued, termsDays: terms, notes, discount: +discount || 0, entryIds, expenseIds: exps.filter((x) => pk[x.id]).map((x) => x.id), manual: manualLines.map((m) => ({ description: m.desc, amount: +m.amt })) });
      invalidate('invoices', 'entries', 'audit');
      say(inv.number + ' saved as draft · ' + inr(totals.total));
      go('/app/finance/invoices/' + inv.id);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  const LineList = () => (
    <>
      {lines.map((l) => (
        <div key={l.key} className="inv-line">
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 500 }}>{l.desc}</div>
            <div className="inv-sub"><span>{l.sub}</span>{l.src && !preview && <button onClick={() => setOpen({ ...open, [l.key]: !open[l.key] })}>↳ {l.src}</button>}</div>
          </div>
          <span className="num" style={{ fontSize: 14 }}>{inr(l.amt)}</span>
        </div>
      ))}
    </>
  );
  const taxes = intra ? [['CGST · 9%', totals.cgst], ['SGST · 9%', totals.sgst]] : [['IGST · 18%', totals.igst]];
  return (
    <div className="wrap page" style={{ paddingBottom: 140 }}>
      <div className="ph">
        <div>
          <h1 className="display">New invoice</h1>
          <p className="ph-desc">Assembled from approved, unbilled work — not typed from scratch. Every line points back to the hours behind it.</p>
        </div>
        <button className="btn-dark" style={{ height: 42, padding: '0 20px' }} onClick={create} disabled={busy}>{busy ? 'Creating…' : 'Create invoice'}</button>
      </div>
      {err && <div className="err-banner" role="alert" style={{ marginTop: 20 }}>{err}</div>}
      <div className="inv-pick">
        <label><span>1 · Client</span>
          <select className="fselect" style={{ height: 40, minWidth: 240, maxWidth: 'none', fontSize: 14 }} value={clientId} onChange={(e) => choose(e.target.value)}>
            {d.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <div><span>2 · Work dated</span><div className="inv-dates">{sorted.length ? <>{dmy(sorted[0])} <span style={{ color: 'var(--faint)' }}>→</span> {dmy(sorted[sorted.length - 1])}</> : '—'}</div></div>
        <div style={{ fontSize: 13.5, color: 'var(--ink-3)', paddingBottom: 10 }}>{hours(availH)} · {inr(availA)} approved and unbilled</div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 40, marginTop: 32, alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 640px', minWidth: 0 }}>
          {!preview ? (
            <>
              <div className="section-title" style={{ marginBottom: 12 }}>Approved, unbilled time</div>
              {!groups.length && <div className="dashed-note">{d.projects.some((p) => p.clientId === clientId && p.model === 'T&M') ? client.name + ' has no approved, unbilled hours right now.' : client.name + ' is billed on fixed-fee milestones, so there is no time-based work to pull in. Add the milestone as a manual line.'}</div>}
              {groups.map((g) => (
                <div key={g.project.id} className="card inv-group">
                  <div className="inv-ghead"><span>{g.project.name}</span><span className="mono" style={{ fontSize: 12, color: 'var(--label)' }}>{g.project.id}</span></div>
                  <div className="inv-scroll">
                    {g.people.map((x) => (
                      <div key={x.key} style={{ borderTop: '1px solid var(--line-faint)' }}>
                        <div className="inv-prow">
                          <input type="checkbox" aria-label={'Include ' + pName(x.employeeId)} checked={!!pk[x.key]} onChange={() => toggle(x.key)} />
                          <span className="pcell" style={{ minWidth: 0 }}><span className="pcell-av" style={{ width: 28, height: 28, fontSize: 11 }}>{initials(pName(x.employeeId))}</span><span style={{ minWidth: 0 }}><span style={{ display: 'block', fontWeight: 500, whiteSpace: 'nowrap' }}>{pName(x.employeeId)}</span><span style={{ display: 'block', fontSize: 12, color: 'var(--muted)' }}>{pTitle(x.employeeId)}</span></span></span>
                          <button className="ulink" style={{ justifySelf: 'start', border: 'none', background: 'none', padding: 0, fontSize: 12.5 }} onClick={() => setOpen({ ...open, [x.key]: !open[x.key] })}>{open[x.key] ? 'Hide entries' : x.entries.length + ' entries'}</button>
                          <span className="num" style={{ textAlign: 'right' }}>{hours(x.h)}</span>
                          <span className="num" style={{ textAlign: 'right', color: 'var(--ink-3)', fontSize: 13 }}>{inr(x.rate)}</span>
                          <span className="num" style={{ textAlign: 'right', fontWeight: 500 }}>{inr(x.amt)}</span>
                        </div>
                        {open[x.key] && (
                          <div className="inv-ents">
                            {x.entries.map((e) => <div key={e.id}><span>{dmy(e.date)}</span><span>{e.note}</span><span className="mono" style={{ fontSize: 11.5, color: 'var(--label)' }}>{e.id}</span><span className="num" style={{ textAlign: 'right' }}>{hours(e.hours)}</span></div>)}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {exps.length > 0 && (
                <>
                  <div className="section-title" style={{ margin: '28px 0 12px' }}>Billable expenses</div>
                  <div className="card">
                    {exps.map((x) => (
                      <div key={x.id} className="inv-erow">
                        <input type="checkbox" aria-label={'Include ' + x.id} checked={!!pk[x.id]} onChange={() => toggle(x.id)} />
                        <span className="mono" style={{ fontSize: 12, color: 'var(--label)' }}>{x.id}</span>
                        <span style={{ minWidth: 0 }}>{x.description}</span>
                        <span className="num" style={{ textAlign: 'right', fontWeight: 500 }}>{inr(x.amount)}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '40px 0 12px' }}>
                <span className="section-title" style={{ margin: 0 }}>Invoice lines</span>
                <button className="link-btn" style={{ fontSize: 13 }} onClick={() => setManual([...manual, { desc: '', amt: '' }])}>Add a manual line</button>
              </div>
              <div style={{ borderTop: '1px solid var(--ink)' }}>
                <LineList />
                {manual.map((m, i) => (
                  <div key={i} className="inv-manual">
                    <input className="input" value={m.desc} onChange={(e) => setManual(manual.map((x, j) => (j === i ? { ...x, desc: e.target.value } : x)))} placeholder="Description, e.g. Milestone 3 — UAT sign-off" aria-label="Line description" />
                    <input className="input" style={{ width: 140, textAlign: 'right' }} value={m.amt} onChange={(e) => /^\d*$/.test(e.target.value) && setManual(manual.map((x, j) => (j === i ? { ...x, amt: e.target.value } : x)))} placeholder="Amount ₹" inputMode="numeric" aria-label="Line amount" />
                    <button aria-label="Remove line" onClick={() => setManual(manual.filter((_, j) => j !== i))}>×</button>
                  </div>
                ))}
                {!nLines && !manual.length && <div style={{ padding: '28px 0', fontSize: 14, color: 'var(--muted)', borderBottom: '1px solid var(--line-soft)' }}>Tick time or expenses above and they’ll appear here as lines.</div>}
              </div>
              <div className="inv-totals">
                <div><span>Subtotal</span><span className="num">{inr(totals.subtotal)}</span></div>
                <div style={{ alignItems: 'center' }}><span>Discount</span><input className="input" style={{ width: 120, height: 32, textAlign: 'right' }} value={discount} onChange={(e) => /^\d*$/.test(e.target.value) && setDiscount(e.target.value)} placeholder="₹0" inputMode="numeric" aria-label="Discount" /></div>
                {taxes.map(([k, v]) => <div key={k as string}><span>{k}</span><span className="num">{inr(v as number)}</span></div>)}
                <div style={{ fontSize: 12, color: 'var(--label)', paddingTop: 0 }}>Place of supply: {client.state}{intra ? ' · intra-state, so CGST + SGST' : ' · inter-state, so IGST'}</div>
                <div className="inv-due"><span>Total due</span><span>{inr(totals.total)}</span></div>
              </div>
            </>
          ) : (
            <div className="inv-doc">
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' }}>
                <div><div style={{ fontWeight: 600, letterSpacing: '0.2em', fontSize: 13 }}>KESTREL DIGITAL</div><div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 6, lineHeight: 1.5 }}>4th Floor, 80 Feet Road, Koramangala<br />Bengaluru, Karnataka 560034<br />GSTIN 29AAKCK4417R1Z2</div></div>
                <div style={{ textAlign: 'right' }}><div style={{ fontWeight: 300, fontSize: 36, lineHeight: 1 }}>Tax invoice</div><div className="mono" style={{ marginTop: 8 }}>{nextNo}</div></div>
              </div>
              <div style={{ display: 'flex', gap: 56, marginTop: 40, fontSize: 13, flexWrap: 'wrap' }}>
                <div><div className="section-title" style={{ fontSize: 11 }}>Bill to</div><div style={{ fontWeight: 600 }}>{client.name}</div><div style={{ color: 'var(--ink-3)' }}>{client.city}, {client.state}</div><div className="mono" style={{ fontSize: 11 }}>GSTIN {client.gstin}</div></div>
                <div><div className="section-title" style={{ fontSize: 11 }}>Issued</div><div>{dmy(issued)}</div></div>
                <div><div className="section-title" style={{ fontSize: 11 }}>Due</div><div>{dmy(due)}</div></div>
              </div>
              <div style={{ marginTop: 36, borderTop: '1px solid var(--ink)' }}><LineList />{manualLines.map((m, i) => <div key={i} className="inv-line"><div style={{ fontWeight: 500, fontSize: 14 }}>{m.desc}</div><span className="num">{inr(+m.amt)}</span></div>)}</div>
              <div className="inv-totals" style={{ maxWidth: 300 }}>
                <div><span>Subtotal</span><span className="num">{inr(totals.subtotal)}</span></div>
                {totals.discount > 0 && <div><span>Discount</span><span className="num">− {inr(totals.discount)}</span></div>}
                {taxes.map(([k, v]) => <div key={k as string}><span>{k}</span><span className="num">{inr(v as number)}</span></div>)}
                <div style={{ borderTop: '1px solid var(--ink)', fontWeight: 600, fontSize: 15, marginTop: 6 }}><span>Total</span><span className="num">{inr(totals.total)}</span></div>
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 36, lineHeight: 1.6 }}>{notes}</div>
            </div>
          )}
        </div>
        <aside className="inv-aside">
          <div className="section-title">Invoice</div>
          <div className="aside-row"><span>Number</span><span className="mono" style={{ fontSize: 13 }}>{nextNo}</span></div>
          <div className="aside-row"><span>Issue date</span><span>{dmy(issued)}</span></div>
          <div className="aside-row" style={{ padding: '8px 0', alignItems: 'center' }}><span>Terms</span>
            <select className="fselect" style={{ height: 32, fontSize: 13.5 }} value={terms} onChange={(e) => setTerms(+e.target.value)} aria-label="Payment terms">{[15, 30, 45].map((t) => <option key={t} value={t}>Net {t}</option>)}</select></div>
          <div className="aside-row"><span>Due date</span><span>{dmy(due)}</span></div>
          <div style={{ padding: '12px 0', borderTop: '1px solid var(--line-soft)' }}><div style={{ fontSize: 14, color: 'var(--ink-3)', marginBottom: 8 }}>Notes</div><textarea className="input" rows={3} style={{ height: 'auto', padding: '10px 12px', lineHeight: 1.5 }} value={notes} onChange={(e) => setNotes(e.target.value)} aria-label="Notes" /></div>
          <button className="aside-row" style={{ width: '100%', border: 'none', borderTop: '1px solid var(--line-soft)', background: 'none' }} onClick={() => setPreview(!preview)} aria-pressed={preview}><span>Preview</span><span style={{ color: 'var(--ink)' }}>{preview ? 'On' : 'Off'}</span></button>
          <div className="inv-flow">
            <div style={{ fontSize: 12.5, fontWeight: 600 }}>Where this invoice comes from</div>
            <div><span>Timesheet entries</span><span className="num">{hours(pickedH)}</span></div>
            <div><span>Line items</span><span className="num">{nLines}</span></div>
            <div><span>Invoice total</span><span className="num">{inr(totals.total)}</span></div>
          </div>
          <div className="inv-flow" style={{ marginTop: 12, background: '#fff', border: '1px solid var(--line)' }}>
            <div style={{ fontSize: 12.5, fontWeight: 600 }}>The same {hours(pickedH)}, three ways</div>
            <div><span>Billed revenue</span><span className="num">{inr(timeRevenue)}</span></div>
            <div><span>Payroll cost<Est basis="Hours × each person’s loaded cost rate (CTC × 1.4 ÷ 12 ÷ 140 h)" /></span><span className="num">{inr(labour)}</span></div>
            <div><span>Margin on these hours</span><span className="num">{inr(margin)} · {pct(timeRevenue ? (margin / timeRevenue) * 100 : 0)}</span></div>
          </div>
        </aside>
      </div>
    </div>
  );
}
