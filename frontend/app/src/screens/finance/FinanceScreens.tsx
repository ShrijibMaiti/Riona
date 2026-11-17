import { useMemo, useState } from 'react';
import { ApprovalQueue, ApprovalTrail } from '../../components/ApprovalQueue';
import { BlocksCell, DataTable, Mono, PersonCell, Status, TextCell, downloadCsv, type Column } from '../../components/DataTable';
import { Modal } from '../../components/Dialogs';
import { FilterBar } from '../../components/FilterBar';
import { PageHeader } from '../../components/PageHeader';
import { KVList } from '../../components/Panels';
import { ErrorState, SkeletonRows, StatusLabel } from '../../components/ui';
import * as api from '../../data/repositories';
import { AGEING, ageingOf, daysOverdue, invoiceTotals, isSpent, receivables, type AgeingBucket } from '../../data/selectors/finance';
import type { ExpenseCategory, ExpenseClaim, Invoice, InvoiceLine } from '../../data/types';
import { useAllExpenses, useAllInvoices, useApprovals, useClients, useEmployees, useMe, useProjects } from '../../hooks/data';
import { APPROVAL_DOMAINS } from '../../hooks/actions';
import { dmy, hours, inr, lakh } from '../../lib/format';
import { all, invalidate, useQuery } from '../../lib/query';
import { go, useApp } from '../../state/store';

const EXP_VIEWS = [{ label: 'All claims', href: '/app/finance/expenses' }, { label: 'Approvals', href: '/app/finance/expenses/approvals' }];

// ---------------- invoices ----------------
export function Invoices() {
  const { role } = useApp();
  const q = all({ me: useMe(), invoices: useAllInvoices(), clients: useClients() });
  const [search, setSearch] = useState('');
  const [band, setBand] = useState<AgeingBucket | ''>('');
  const [f, setF] = useState({ client: '', status: '' });
  if (q.error) return <div className="wrap page"><ErrorState error={q.error} retry={q.refetch} /></div>;
  const d = q.data;
  const cl = (id: string) => d?.clients.find((c) => c.id === id);
  const rec = d ? receivables(d.invoices, d.clients, d.me.today) : null;
  const rows = d?.invoices.filter((i) => (!search || (i.number + cl(i.clientId)?.name).toLowerCase().includes(search.toLowerCase())) && (!band || ageingOf(i, d.me.today) === band) && (!f.client || cl(i.clientId)?.name === f.client) && (!f.status || i.status === f.status));
  const cols: Column<Invoice>[] = [
    { key: 'n', header: 'Invoice', render: (i) => <Mono>{i.number}</Mono>, sort: (i) => i.number, mobile: true },
    { key: 'c', header: 'Client', render: (i) => <span className="nowrap">{cl(i.clientId)?.name}</span>, sort: (i) => cl(i.clientId)?.name ?? '', mobile: true },
    { key: 'i', header: 'Issued', render: (i) => <span className="nowrap">{dmy(i.issued)}</span>, sort: (i) => i.issued },
    { key: 'd', header: 'Due', render: (i) => <span className="nowrap">{dmy(i.due)}</span>, sort: (i) => i.due },
    { key: 'a', header: 'Amount', align: 'right', render: (i) => <span className="num">{inr(invoiceTotals(i, cl(i.clientId)).total)}</span>, sort: (i) => invoiceTotals(i, cl(i.clientId)).total, mobile: true },
    { key: 'p', header: 'Paid', align: 'right', render: (i) => <span className="num">{inr(invoiceTotals(i, cl(i.clientId)).paid)}</span> },
    { key: 'ag', header: 'Ageing', render: (i) => ageingOf(i, d!.me.today) ?? '—' },
    { key: 's', header: 'Status', render: (i) => <Status label={i.status} />, sort: (i) => i.status, mobile: true },
  ];
  return (
    <div className="wrap page" style={{ paddingBottom: 140 }}>
      <PageHeader title="Invoices" desc={rec ? lakh(rec.outstanding) + ' outstanding across ' + rec.clientsOwing + ' clients.' : ' '} primary={role === 'Admin' ? { label: 'New invoice', href: '/app/finance/invoices/new' } : undefined}
        more={[{ label: 'Export CSV', run: () => rows && downloadCsv('invoices.csv', ['Invoice', 'Client', 'Issued', 'Due', 'Total', 'Paid', 'Status'], rows.map((i) => { const t = invoiceTotals(i, cl(i.clientId)); return [i.number, cl(i.clientId)?.name ?? '', i.issued, i.due, t.total, t.paid, i.status]; })) }]} />
      {rec && (
        <div className="band" role="group" aria-label="Ageing">
          {AGEING.map((b) => (
            <button key={b} className={band === b ? 'active' : ''} aria-pressed={band === b} onClick={() => setBand(band === b ? '' : b)}>
              <div className="k">{b === 'Current' ? 'Current' : b + ' days'}</div><div className="v">{lakh(rec.buckets[b].amount)}</div><div className="s">{rec.buckets[b].count} {rec.buckets[b].count === 1 ? 'invoice' : 'invoices'}</div>
            </button>
          ))}
        </div>
      )}
      <FilterBar search={search} onSearch={setSearch} filters={[
        { key: 'c', label: 'Clients', options: d?.clients.map((c) => c.name) ?? [], value: f.client, onChange: (v) => setF({ ...f, client: v }) },
        { key: 's', label: 'Statuses', options: ['Draft', 'Sent', 'Partially paid', 'Paid', 'Overdue'], value: f.status, onChange: (v) => setF({ ...f, status: v }) },
      ]} />
      <DataTable rows={rows} columns={cols} rowKey={(i) => i.id} onOpen={(i) => go('/app/finance/invoices/' + i.id)} initialSort={{ key: 'i', dir: 'desc' }}
        empty={{ title: 'No invoices match these filters.', onClear: () => { setSearch(''); setBand(''); setF({ client: '', status: '' }); } }} />
    </div>
  );
}

export function InvoiceDetail({ id }: { id: string }) {
  const { say, role } = useApp();
  const q = all({ me: useMe(), inv: useQuery(['invoices', id], () => api.getInvoice(id)), clients: useClients(), emps: useEmployees(), aps: useApprovals() });
  const [pay, setPay] = useState(false);
  const [view, setView] = useState<'current' | 'issued'>('current');
  const [open, setOpen] = useState<string | null>(null);
  const entries = useQuery(['entries', 'ids', open], () => api.getTimesheetEntries({ ids: q.data?.inv.lines.find((l) => l.id === open)?.entryIds ?? [] }), { enabled: !!open });
  if (q.error) return <div className="wrap page"><ErrorState error={q.error} retry={q.refetch} /></div>;
  if (!q.data) return <div className="wrap page"><SkeletonRows /></div>;
  const { inv, clients, emps } = q.data;
  const c = clients.find((x) => x.id === inv.clientId)!;
  const revised = inv.revisions.length > 1;
  const lines: InvoiceLine[] = view === 'issued' && revised ? inv.revisions[0].lines : inv.lines;
  const t = invoiceTotals({ ...inv, lines, discount: view === 'issued' && revised ? inv.revisions[0].discount : inv.discount }, c);
  const cur = invoiceTotals(inv, c), first = revised ? invoiceTotals({ ...inv, lines: inv.revisions[0].lines, discount: inv.revisions[0].discount }, c) : cur;
  const approval = q.data.aps.find((a) => a.id === inv.approvalId);
  const send = async () => { await api.sendInvoice(inv.id); invalidate('invoices', 'audit'); say(inv.number + ' sent to ' + c.contacts[0].name); };
  const taxes = t.intraState ? [['CGST · 9%', t.cgst], ['SGST · 9%', t.sgst]] : [['IGST · 18%', t.igst]];
  return (
    <div className="wrap page" style={{ paddingBottom: 140 }}>
      <PageHeader title={inv.number} desc={<>{c.name} · issued {dmy(inv.issued)} · due {dmy(inv.due)}{inv.status === 'Overdue' ? ' · ' + daysOverdue(inv, q.data.me.today) + ' days overdue' : ''}</>}
        aside={<StatusLabel label={inv.status} />}
        primary={role === 'Admin' ? (inv.status === 'Draft' && !approval ? { label: 'Send to client', onClick: send } : cur.balance > 0 && inv.status !== 'Draft' ? { label: 'Record a payment', onClick: () => setPay(true) } : undefined) : undefined}
        more={role === 'Admin' && ['Sent', 'Overdue', 'Partially paid'].includes(inv.status) ? [{ label: 'Revise invoice', run: () => go('/app/finance/invoices/' + inv.id + '/revise') }] : undefined} />
      {revised && (
        <div className="dual">
          <div className="viewseg" style={{ marginTop: 0 }}>
            <button className={view === 'current' ? 'active' : ''} onClick={() => setView('current')}>As revised</button>
            <button className={view === 'issued' ? 'active' : ''} onClick={() => setView('issued')}>As first issued</button>
          </div>
          <div className="dual-note">Revised {dmy(inv.revisions[inv.revisions.length - 1].at)}: “{inv.revisions[inv.revisions.length - 1].reason.replace(/^Revised: /, '')}” First issued at <b>{inr(first.total)}</b>; now <b>{inr(cur.total)}</b> — a difference of <b>{inr(first.total - cur.total)}</b>.</div>
        </div>
      )}
      <div style={{ display: 'flex', gap: 40, flexWrap: 'wrap', marginTop: 28, alignItems: 'flex-start' }}>
        <div className="inv-doc" style={{ flex: '1 1 560px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' }}>
            <div><div style={{ fontWeight: 600, letterSpacing: '0.2em', fontSize: 13 }}>KESTREL DIGITAL</div><div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 6, lineHeight: 1.5 }}>4th Floor, 80 Feet Road, Koramangala<br />Bengaluru, Karnataka 560034<br />GSTIN 29AAKCK4417R1Z2</div></div>
            <div style={{ textAlign: 'right' }}><div style={{ fontWeight: 300, fontSize: 36, lineHeight: 1 }}>Tax invoice</div><div className="mono" style={{ marginTop: 8 }}>{inv.number}</div></div>
          </div>
          <div style={{ display: 'flex', gap: 48, marginTop: 36, fontSize: 13, flexWrap: 'wrap' }}>
            <div><div className="section-title" style={{ fontSize: 11 }}>Bill to</div><div style={{ fontWeight: 600 }}>{c.name}</div><div style={{ color: 'var(--ink-3)' }}>{c.city}, {c.state}</div><div className="mono" style={{ fontSize: 11 }}>GSTIN {c.gstin}</div></div>
            <div><div className="section-title" style={{ fontSize: 11 }}>Issued</div>{dmy(inv.issued)}</div>
            <div><div className="section-title" style={{ fontSize: 11 }}>Due</div>{dmy(inv.due)}</div>
          </div>
          <div style={{ marginTop: 32, borderTop: '1px solid var(--ink)' }}>
            {lines.map((l) => (
              <div key={l.id}>
                <div className="inv-line">
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{l.description}</div>
                    <div className="inv-sub"><span>{l.unit === 'h' ? hours(l.quantity) + ' × ' + inr(l.rate) : l.kind === 'milestone' ? 'Milestone' : l.kind === 'expense' ? 'Rebilled expense' : 'Manual line'}</span>{l.entryIds.length > 0 && <button onClick={() => setOpen(open === l.id ? null : l.id)}>↳ {l.entryIds.length} timesheet entries</button>}</div>
                  </div>
                  <span className="num" style={{ fontSize: 14 }}>{inr(l.amount)}</span>
                </div>
                {open === l.id && (
                  <div className="inv-ents" style={{ minWidth: 0, paddingLeft: 20 }}>
                    {!entries.data ? <SkeletonRows n={2} /> : entries.data.map((e) => <div key={e.id}><span>{dmy(e.date)}</span><span>{emps.find((x) => x.id === e.employeeId)?.name} · {e.note}</span><span className="mono" style={{ fontSize: 11.5, color: 'var(--label)' }}>{e.id}</span><span className="num" style={{ textAlign: 'right' }}>{hours(e.hours)}</span></div>)}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="inv-totals" style={{ maxWidth: 320 }}>
            <div><span>Subtotal</span><span className="num">{inr(t.subtotal)}</span></div>
            {t.discount > 0 && <div><span>Discount</span><span className="num">− {inr(t.discount)}</span></div>}
            {taxes.map(([k, v]) => <div key={k as string}><span>{k}</span><span className="num">{inr(v as number)}</span></div>)}
            <div style={{ borderTop: '1px solid var(--ink)', fontWeight: 600, fontSize: 15, marginTop: 6 }}><span style={{ color: 'var(--ink)' }}>Total</span><span className="num">{inr(t.total)}</span></div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 28, lineHeight: 1.6 }}>{inv.notes}</div>
        </div>
        <aside style={{ flex: '0 1 320px', minWidth: 260 }}>
          <div className="section-title">Balance</div>
          <KVList w={110} rows={[['Total', inr(cur.total)], ['Paid', inr(cur.paid)], ['Balance', <b key="b" className="num">{inr(cur.balance)}</b>]]} />
          <div className="section-title" style={{ marginTop: 28 }}>Payments</div>
          {inv.payments.map((p) => <div key={p.id} className="kv" style={{ gridTemplateColumns: '1fr auto' }}><span>{dmy(p.date)} · {p.method}<span className="cell-sub">{p.reference}</span></span><span className="num">{inr(p.amount)}</span></div>)}
          {!inv.payments.length && <div className="empty-s">No payments yet.</div>}
          {approval && (<><div className="section-title" style={{ marginTop: 28 }}>Sign-off</div><ApprovalTrail a={approval} emps={emps} meId={q.data.me.employee.id} /></>)}
        </aside>
      </div>
      {pay && <RecordPayment inv={inv} balance={cur.balance} total={cur.total} today={q.data.me.today} onClose={() => setPay(false)} />}
    </div>
  );
}

/** One of the three permitted modals. */
function RecordPayment({ inv, balance, total, today, onClose }: { inv: Invoice; balance: number; total: number; today: string; onClose: () => void }) {
  const { say } = useApp();
  const [amount, setAmount] = useState(String(Math.round(balance)));
  const [date, setDate] = useState(today);
  const [method, setMethod] = useState<Invoice['payments'][number]['method']>('NEFT');
  const [ref, setRef] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!(+amount > 0)) return setErr('Enter an amount above zero.');
    if (+amount > balance + 1) return setErr('That is more than the ' + inr(balance) + ' still owed.');
    if (!ref.trim()) return setErr('Add the UTR or cheque number so this can be reconciled.');
    setBusy(true);
    try { await api.recordPayment(inv.id, { date, amount: +amount, method, reference: ref.trim() }, total); invalidate('invoices', 'audit'); say(inr(+amount) + ' recorded against ' + inv.number); onClose(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal title={'Record a payment · ' + inv.number} onClose={onClose}>
      {err && <div className="err-banner" role="alert" style={{ marginTop: 14 }}>{err}</div>}
      <div className="form-grid" style={{ marginTop: 18, gridTemplateColumns: '1fr 1fr' }}>
        <label className="field"><span>Amount (₹)</span><input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))} /></label>
        <label className="field"><span>Received on</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="field"><span>Method</span><select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>{['NEFT', 'RTGS', 'Cheque', 'UPI'].map((m) => <option key={m}>{m}</option>)}</select></label>
        <label className="field"><span>Reference</span><input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="UTR or cheque no." /></label>
      </div>
      <div className="modal-actions"><button className="btn-line" onClick={onClose}>Cancel</button><button className="btn-dark" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Record payment'}</button></div>
    </Modal>
  );
}

// ---------------- expenses ----------------
export function Expenses() {
  const { role } = useApp();
  const q = all({ me: useMe(), exps: useAllExpenses(), emps: useEmployees(), projects: useProjects(), clients: useClients() });
  const [search, setSearch] = useState('');
  const [f, setF] = useState({ cat: '', status: '' });
  if (q.error) return <div className="wrap page"><ErrorState error={q.error} retry={q.refetch} /></div>;
  const d = q.data;
  const meId = d?.me.employee.id;
  const nm = (id: string) => d?.emps.find((e) => e.id === id)?.name ?? id;
  const rows = d?.exps.filter((x) => (role === 'Admin' || x.employeeId === meId || (role === 'Manager' && d.emps.find((e) => e.id === x.employeeId)?.managerId === meId)) &&
    (!search || (x.id + x.description + nm(x.employeeId)).toLowerCase().includes(search.toLowerCase())) && (!f.cat || x.category === f.cat) && (!f.status || x.status === f.status));
  const cols: Column<ExpenseClaim>[] = [
    { key: 'id', header: 'Claim', render: (x) => <Mono>{x.id}</Mono>, sort: (x) => x.id },
    { key: 'e', header: 'Employee', render: (x) => <PersonCell name={nm(x.employeeId)} sub={d!.emps.find((e) => e.id === x.employeeId)?.dept} />, sort: (x) => nm(x.employeeId), mobile: true },
    { key: 'c', header: 'Category', render: (x) => <TextCell text={x.category} sub={x.description.replace(x.category + ' · ', '')} /> },
    { key: 'a', header: 'Amount', align: 'right', render: (x) => <span className="num">{inr(x.amount)}</span>, sort: (x) => x.amount, mobile: true },
    { key: 'd', header: 'Date', render: (x) => <span className="nowrap">{dmy(x.date)}</span>, sort: (x) => x.date },
    { key: 'p', header: 'Project or client', render: (x) => (x.projectId ? (d!.projects.find((p) => p.id === x.projectId)?.name ?? '') + (x.billable ? ' · billable' : '') : 'Internal') },
    { key: 'r', header: 'Receipt', render: (x) => <Status label={x.receipt ? 'Uploaded' : 'Missing'} /> },
    { key: 's', header: 'Status', render: (x) => <Status label={x.revisions.length ? x.status + ' · reopened' : x.status} colour={x.status === 'Reimbursed' ? 'green' : undefined} />, sort: (x) => x.status, mobile: true },
  ];
  return (
    <div className="wrap page" style={{ paddingBottom: 140 }}>
      <PageHeader title="Expenses" desc="Claims with receipts. Billable claims reach the client’s next invoice." primary={{ label: 'Submit claim', href: '/app/finance/expenses/submit' }} views={EXP_VIEWS} current="/app/finance/expenses" />
      <FilterBar search={search} onSearch={setSearch} filters={[
        { key: 'c', label: 'Categories', options: ['Travel', 'Meals', 'Software', 'Hardware', 'Training', 'Client entertainment', 'Office'], value: f.cat, onChange: (v) => setF({ ...f, cat: v }) },
        { key: 's', label: 'Statuses', options: ['Pending', 'Approved', 'Rejected', 'Reimbursed'], value: f.status, onChange: (v) => setF({ ...f, status: v }) },
      ]} />
      <DataTable rows={rows} columns={cols} rowKey={(x) => x.id} onOpen={(x) => go('/app/finance/expenses/' + x.id)} initialSort={{ key: 'd', dir: 'desc' }} />
    </div>
  );
}

export function ExpenseApprovals() {
  return <ApprovalQueue type="Expense" title="Expense approvals" desc="Claims waiting on you. Billable claims flow into the next invoice." views={EXP_VIEWS} current="/app/finance/expenses/approvals" />;
}

const CATS: ExpenseCategory[] = ['Travel', 'Meals', 'Software', 'Hardware', 'Training', 'Client entertainment', 'Office'];
export function SubmitExpense({ back = '/app/finance/expenses' }: { back?: string }) {
  const { say } = useApp();
  const me = useMe();
  const projects = useProjects();
  const [f, setF] = useState({ category: 'Travel' as ExpenseCategory, description: '', amount: '', date: '', projectId: '', billable: false, receipt: false });
  const [err, setErr] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const mine = projects.data?.filter((p) => p.status === 'Active' && p.team.some((m) => m.employeeId === me.data?.employee.id)) ?? [];
  const date = f.date || me.data?.today || '';
  const errors = { description: !f.description.trim() ? 'Describe what it was for' : '', amount: !(+f.amount > 0) ? 'Enter the amount on the receipt' : '', receipt: +f.amount > 2000 && !f.receipt ? 'A GST invoice is required above ₹2,000' : '' };
  const submit = async () => {
    setTouched(true);
    if (Object.values(errors).some(Boolean)) return;
    setBusy(true); setErr(null);
    try {
      const x = await api.submitExpense({ category: f.category, description: f.category + ' · ' + f.description.trim(), amount: +f.amount, date, projectId: f.projectId || null, billable: !!f.projectId && f.billable, receipt: f.receipt });
      invalidate('expenses', ...APPROVAL_DOMAINS);
      say(x.id + ' submitted · ' + inr(x.amount));
      go(back === '/app/me/expenses' ? back : '/app/finance/expenses/' + x.id);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const E = (k: keyof typeof errors) => (touched && errors[k] ? <span className="err">{errors[k]}</span> : null);
  return (
    <div className="wrap page" style={{ maxWidth: 760, paddingBottom: 140 }}>
      <a className="back-link" href={'#' + back}>← Back</a>
      <PageHeader title="Submit a claim" desc="Your reporting manager approves, then Finance. Approved claims are paid with the next Thursday payout." />
      {err && <div className="err-banner" role="alert" style={{ marginTop: 20 }}>{err}</div>}
      <div className="form-grid" style={{ marginTop: 28 }}>
        <label className="field"><span>Category</span><select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as ExpenseCategory })}>{CATS.map((c) => <option key={c}>{c}</option>)}</select></label>
        <label className="field"><span>Date</span><input type="date" value={date} max={me.data?.today} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
        <label className="field" style={{ gridColumn: '1 / -1' }}><span>What was it for?</span><input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="e.g. Cab to the Northwind depot" />{E('description')}</label>
        <label className="field"><span>Amount (₹)</span><input inputMode="numeric" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d]/g, '') })} />{E('amount')}</label>
        <label className="field"><span>Project</span><select value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value })}><option value="">Internal — no project</option>{mine.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        {f.projectId && <label className="field"><span style={{ display: 'flex', gap: 10, alignItems: 'center', height: 40 }}><input type="checkbox" checked={f.billable} onChange={(e) => setF({ ...f, billable: e.target.checked })} />Rebill to the client</span></label>}
        <label className="field" style={{ gridColumn: '1 / -1' }}><span>Receipt</span><input type="file" accept="image/*,application/pdf" onChange={(e) => setF({ ...f, receipt: !!e.target.files?.length })} style={{ padding: '8px 12px' }} /><span className="hint">PDF or photo. Required above ₹2,000.</span>{E('receipt')}</label>
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 28 }}><button className="btn-dark" disabled={busy} onClick={submit}>{busy ? 'Submitting…' : 'Submit claim'}</button><a className="btn-line" style={{ display: 'inline-flex', alignItems: 'center' }} href={'#' + back}>Cancel</a></div>
    </div>
  );
}

export function ExpenseDetail({ id }: { id: string }) {
  const { say } = useApp();
  const q = all({ me: useMe(), x: useQuery(['expenses', id], () => api.getExpense(id)), emps: useEmployees(), projects: useProjects(), aps: useApprovals() });
  const [view, setView] = useState<'current' | 'approved'>('current');
  const [reopen, setReopen] = useState(false);
  const [amt, setAmt] = useState('');
  const [why, setWhy] = useState('');
  if (q.error) return <div className="wrap page"><ErrorState error={q.error} retry={q.refetch} /></div>;
  if (!q.data) return <div className="wrap page"><SkeletonRows /></div>;
  const { x, emps } = q.data;
  const a = q.data.aps.find((y) => y.id === x.approvalId);
  const before = x.revisions.length ? x.revisions[0] : null;
  const shown = view === 'approved' && before ? { amount: before.amount, status: before.status } : { amount: x.amount, status: x.status };
  const canReopen = (x.status === 'Approved' || x.status === 'Reimbursed') && x.employeeId === q.data.me.employee.id;
  const doReopen = async () => {
    if (!(+amt > 0) || !why.trim()) return;
    await api.reopenExpense(x.id, why.trim(), +amt); invalidate('expenses'); setReopen(false); say(x.id + ' reopened for approval');
  };
  return (
    <div className="wrap page" style={{ paddingBottom: 140, maxWidth: 1100 }}>
      <PageHeader title={x.description} desc={<><span className="mono">{x.id}</span> · {emps.find((e) => e.id === x.employeeId)?.name} · {dmy(x.date)}</>} aside={<StatusLabel label={x.status} colour={x.status === 'Reimbursed' ? 'green' : undefined} />}
        primary={canReopen ? { label: 'Reopen claim', onClick: () => { setReopen(true); setAmt(String(x.amount)); } } : undefined} />
      {before && (
        <div className="dual">
          <div className="viewseg" style={{ marginTop: 0 }}><button className={view === 'current' ? 'active' : ''} onClick={() => setView('current')}>As reopened</button><button className={view === 'approved' ? 'active' : ''} onClick={() => setView('approved')}>As first approved</button></div>
          <div className="dual-note">{x.revisions[x.revisions.length - 1].reason} First approved at <b>{inr(before.amount)}</b>; now <b>{inr(x.amount)}</b> — <b>{inr(before.amount - x.amount)}</b> {before.amount > x.amount ? 'less' : 'more'}.</div>
        </div>
      )}
      {reopen && (
        <div className="card addtask" style={{ marginTop: 20 }}>
          <input className="input" inputMode="numeric" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^\d]/g, ''))} aria-label="Corrected amount" style={{ maxWidth: 160 }} />
          <input className="input" value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Why are you reopening it?" aria-label="Reason" />
          <button className="btn-dark" disabled={!(+amt > 0) || !why.trim()} onClick={doReopen}>Send for approval</button><button className="btn-line" onClick={() => setReopen(false)}>Cancel</button>
        </div>
      )}
      <div style={{ display: 'flex', gap: 48, flexWrap: 'wrap', marginTop: 32 }}>
        <div style={{ flex: '1 1 340px' }}>
          <div className="section-title">Claim</div>
          <KVList rows={[['Amount', <b key="a" className="num">{inr(shown.amount)}</b>], ['Category', x.category], ['Project', x.projectId ? q.data.projects.find((p) => p.id === x.projectId)?.name : 'Internal'], ['Billable', x.billable ? 'Yes — rebilled to the client' : 'No'], ['Receipt', x.receipt ? 'Uploaded' : 'Missing'], ['Submitted', dmy(x.submitted)], ['Reimbursed', dmy(x.reimbursedOn)], ['Status', shown.status]]} />
        </div>
        <div style={{ flex: '1.4 1 420px', minWidth: 0 }}>
          <div className="section-title" style={{ marginBottom: 14 }}>Approval trail</div>
          {a ? <ApprovalTrail a={a} emps={emps} meId={q.data.me.employee.id} /> : <div className="empty-s">Not submitted for approval yet.</div>}
        </div>
      </div>
    </div>
  );
}

// ---------------- budget ----------------
export function Budget() {
  const q = all({ budgets: useQuery(['budgets'], api.getBudgets), exps: useAllExpenses(), emps: useEmployees() });
  const rows = useMemo(() => q.data?.budgets.map((b) => {
    const spent = q.data!.exps.filter((x) => isSpent(x) && q.data!.emps.find((e) => e.id === x.employeeId)?.dept === b.dept && x.date >= '2026-04-01').reduce((a, x) => a + x.amount, 0);
    return { b, spent, remaining: b.planned - b.committed - spent, pct: Math.round(((b.committed + spent) / b.planned) * 100) };
  }).sort((a, b) => b.pct - a.pct), [q.data]);
  if (q.error) return <div className="wrap page"><ErrorState error={q.error} retry={q.refetch} /></div>;
  const T = rows?.reduce((a, r) => ({ planned: a.planned + r.b.planned, spent: a.spent + r.spent, committed: a.committed + r.b.committed }), { planned: 0, spent: 0, committed: 0 });
  return (
    <div className="wrap page" style={{ paddingBottom: 140 }}>
      <PageHeader title="Budget" desc="FY 2026–27, April to date. Spent is approved expense claims; committed is signed purchase orders. Amber above 90%, red above 100%." />
      {T && <div className="sumband">{[['Allocated', lakh(T.planned)], ['Spent', lakh(T.spent)], ['Committed', lakh(T.committed)], ['Remaining', lakh(T.planned - T.spent - T.committed)]].map(([k, v]) => <div key={k}><div className="k">{k}</div><div className="v">{v}</div></div>)}</div>}
      <div style={{ marginTop: 24 }}>
        <DataTable rows={rows} rowKey={(r) => r.b.id} columns={[
          { key: 'd', header: 'Department', render: (r) => <span style={{ fontWeight: 500 }}>{r.b.dept}</span>, sort: (r) => r.b.dept, mobile: true },
          { key: 'a', header: 'Allocated', align: 'right', render: (r) => <span className="num">{inr(r.b.planned)}</span> },
          { key: 's', header: 'Spent', align: 'right', render: (r) => <span className="num">{inr(r.spent)}</span> },
          { key: 'c', header: 'Committed', align: 'right', render: (r) => <span className="num">{inr(r.b.committed)}</span> },
          { key: 'r', header: 'Remaining', align: 'right', render: (r) => <span className="num" style={{ color: r.remaining < 0 ? 'var(--red)' : undefined }}>{inr(r.remaining)}</span>, sort: (r) => r.remaining, mobile: true },
          { key: 'u', header: 'Utilisation', render: (r) => <BlocksCell pct={r.pct} text={r.pct + '%'} />, sort: (r) => r.pct, mobile: true },
        ]} />
      </div>
    </div>
  );
}
