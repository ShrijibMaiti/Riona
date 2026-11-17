/**
 * Revise an issued invoice: change quantities, rates or descriptions, drop lines, adjust the discount.
 * The server keeps the earlier state, so the invoice then shows "as revised" and "as first issued".
 */
import { useState } from 'react';
import { PageHeader } from '../../components/PageHeader';
import { ErrorState, SkeletonRows } from '../../components/ui';
import * as api from '../../data/repositories';
import { invoiceTotals } from '../../data/selectors/finance';
import type { InvoiceLine } from '../../data/types';
import { useClients } from '../../hooks/data';
import { hours, inr } from '../../lib/format';
import { all, invalidate, useQuery } from '../../lib/query';
import { go, useApp } from '../../state/store';

type Draft = { id: string; line: InvoiceLine; description: string; quantity: string; rate: string; removed: boolean };
const num = (s: string) => (s.trim() === '' ? NaN : +s);

export default function ReviseInvoice({ id }: { id: string }) {
  const { say, role } = useApp();
  const q = all({ inv: useQuery(['invoices', id], () => api.getInvoice(id)), clients: useClients() });
  const [rows, setRows] = useState<Draft[] | null>(null);
  const [discount, setDiscount] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  if (q.error) return <div className="wrap page"><ErrorState error={q.error} retry={q.refetch} /></div>;
  if (!q.data) return <div className="wrap page"><SkeletonRows /></div>;
  const { inv, clients } = q.data;
  const client = clients.find((c) => c.id === inv.clientId);
  const back = '/app/finance/invoices/' + inv.id;
  if (role !== 'Admin' || inv.status === 'Draft' || inv.status === 'Void' || inv.status === 'Paid') {
    return (
      <div className="wrap page">
        <div className="empty" role="alert" style={{ marginTop: 48 }}>
          <div className="empty-t">{inv.number} can’t be revised.</div>
          <div className="empty-s">{inv.status === 'Draft' ? 'It hasn’t been issued yet — edit it before sending.' : inv.status === 'Paid' ? 'It’s fully paid. Raise a credit note instead.' : inv.status === 'Void' ? 'It has been voided.' : 'Only Finance admins revise invoices.'}</div>
          <a href={'#' + back} className="btn-dark" style={{ marginTop: 20 }}>Back to {inv.number}</a>
        </div>
      </div>
    );
  }
  const R: Draft[] = rows ?? inv.lines.map((l) => ({ id: l.id, line: l, description: l.description, quantity: String(l.quantity), rate: String(l.rate), removed: false }));
  const disc = discount ?? String(inv.discount);
  const nextLines: InvoiceLine[] = R.filter((r) => !r.removed).map((r) => ({ ...r.line, description: r.description, quantity: num(r.quantity), rate: num(r.rate), amount: Math.round(num(r.quantity) * num(r.rate)) || 0 }));
  const before = invoiceTotals(inv, client);
  const after = invoiceTotals({ lines: nextLines.map((l) => ({ ...l, amount: Number.isFinite(l.amount) ? l.amount : 0 })), discount: +disc || 0, payments: inv.payments }, client);
  const set = (i: number, patch: Partial<Draft>) => setRows(R.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const changed = R.some((r) => r.removed || r.description !== r.line.description || num(r.quantity) !== r.line.quantity || num(r.rate) !== r.line.rate) || (+disc || 0) !== inv.discount;
  const submit = async () => {
    if (nextLines.some((l) => !(l.quantity > 0) || !(l.rate > 0))) return setErr('Every line needs a quantity and a rate above zero. Remove a line instead of zeroing it.');
    setBusy(true);
    try {
      await api.reviseInvoice(inv.id, reason, nextLines, +disc || 0);
      invalidate('invoices', 'entries', 'facts', 'audit');
      say(inv.number + ' revised · now ' + inr(after.total));
      go(back);
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  const diff = after.total - before.total;
  return (
    <div className="wrap page" style={{ paddingBottom: 140, maxWidth: 1100 }}>
      <a className="back-link" href={'#' + back}>← {inv.number}</a>
      <PageHeader title={'Revise ' + inv.number} desc={<>{client?.name} · the invoice as issued is kept, and both versions stay visible on the invoice.</>} />
      {err && <div className="err-banner" role="alert" style={{ marginTop: 20 }}>{err}</div>}
      <div className="card rv-table" style={{ marginTop: 28 }}>
        <div className="rv-row head"><span>Line</span><span className="r">Qty</span><span className="r">Rate</span><span className="r">Amount</span><span /></div>
        {R.map((r, i) => {
          const amt = Math.round(num(r.quantity) * num(r.rate)) || 0;
          const was = r.line.amount;
          return (
            <div key={r.id} className={'rv-row' + (r.removed ? ' removed' : '')}>
              <span>
                <input className="input" value={r.description} disabled={r.removed} onChange={(e) => set(i, { description: e.target.value })} aria-label="Description" />
                <span className="cell-sub">{r.line.kind === 'time' ? r.line.entryIds.length + ' timesheet entries · ' + hours(r.line.quantity) + ' as issued' : r.line.kind === 'expense' ? 'Rebilled expense' : r.line.kind === 'milestone' ? 'Milestone' : 'Manual line'}{r.removed && r.line.entryIds.length ? ' · these hours become unbilled again' : ''}</span>
              </span>
              <input className="input num r" inputMode="decimal" value={r.quantity} disabled={r.removed} onChange={(e) => set(i, { quantity: e.target.value.replace(/[^\d.]/g, '') })} aria-label="Quantity" />
              <input className="input num r" inputMode="numeric" value={r.rate} disabled={r.removed} onChange={(e) => set(i, { rate: e.target.value.replace(/[^\d.]/g, '') })} aria-label="Rate" />
              <span className="num r">{r.removed ? <s>{inr(was)}</s> : inr(amt)}{!r.removed && amt !== was && <span className="cell-sub">was {inr(was)}</span>}</span>
              <button className="link-btn" onClick={() => set(i, { removed: !r.removed })}>{r.removed ? 'Restore' : 'Remove'}</button>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', marginTop: 24, alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 360px', display: 'grid', gap: 16 }}>
          <label className="field" style={{ maxWidth: 220 }}><span>Discount (₹)</span><input inputMode="numeric" value={disc} onChange={(e) => setDiscount(e.target.value.replace(/[^\d]/g, ''))} /></label>
          <label className="field"><span>Reason for the revision</span><textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. 6 h logged to the wrong project were removed" /><span className="hint">Shown to the client with the revised invoice, and kept in the audit log.</span></label>
        </div>
        <div className="card" style={{ flex: '0 1 340px', padding: '18px 22px' }}>
          <div className="section-title">Effect</div>
          <div className="kv" style={{ gridTemplateColumns: '1fr auto' }}><span>As issued</span><span className="num">{inr(before.total)}</span></div>
          <div className="kv" style={{ gridTemplateColumns: '1fr auto' }}><span>As revised</span><b className="num">{inr(after.total)}</b></div>
          <div className="kv" style={{ gridTemplateColumns: '1fr auto' }}><span>Difference</span><span className="num">{diff === 0 ? '—' : (diff > 0 ? '+' : '−') + inr(Math.abs(diff))}</span></div>
          <div className="kv" style={{ gridTemplateColumns: '1fr auto' }}><span>{after.intraState ? 'CGST + SGST' : 'IGST'}</span><span className="num">{inr(after.tax)}</span></div>
          <div className="kv" style={{ gridTemplateColumns: '1fr auto' }}><span>Already paid</span><span className="num">{inr(after.paid)}</span></div>
          <div className="kv" style={{ gridTemplateColumns: '1fr auto' }}><span>Balance after</span><b className="num">{inr(Math.max(0, after.total - after.paid))}</b></div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 28 }}>
        <button className="btn-dark" disabled={busy || !changed} onClick={submit}>{busy ? 'Saving…' : 'Issue revision'}</button>
        <a className="btn-line" style={{ display: 'inline-flex', alignItems: 'center' }} href={'#' + back}>Cancel</a>
      </div>
    </div>
  );
}
