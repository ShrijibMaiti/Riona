/**
 * Record a salary change (HR and Admin, Profile › Compensation): a revision, promotion, bonus, deduction or a
 * retro correction. The ledger is append-only, so this always adds an event; it never edits one. The server checks
 * every rule (repositories → POST /employees/:id/salary-events) and its message is shown as is.
 */
import { useState } from 'react';
import { Modal } from '../../components/Dialogs';
import * as api from '../../data/repositories';
import type { Employee, SalaryEvent } from '../../data/types';
import { monthLabel } from '../../lib/format';
import { invalidate } from '../../lib/query';
import { useApp } from '../../state/store';

type Kind = 'Revised' | 'Promotion' | 'Bonus' | 'Deduction' | 'Correction';
const KINDS: [Kind, string][] = [
  ['Revised', 'Salary revision'],
  ['Promotion', 'Promotion'],
  ['Bonus', 'Bonus'],
  ['Deduction', 'Deduction (recovery)'],
  ['Correction', 'Correction to past months'],
];
const HINT: Record<Kind, string> = {
  Revised: 'A new annual CTC from the chosen month.',
  Promotion: 'A new title and annual CTC from the chosen month.',
  Bonus: 'A one-off payment in the chosen month.',
  Deduction: 'A one-off recovery in the chosen month.',
  Correction: 'A monthly amount that was missed in months already paid. It is paid as arrears in the next run, and those months show it “as corrected”.',
};

const nextMonth = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};
function monthsFromTo(from: string, to: string) {
  const out: string[] = [];
  for (let m = from; m <= to && out.length < 24; m = nextMonth(m)) out.push(m);
  return out;
}

export function SalaryEventForm({ e, today, onClose }: { e: Employee; today: string; onClose: () => void }) {
  const { say } = useApp();
  const thisMonth = today.slice(0, 7);
  const [kind, setKind] = useState<Kind>('Revised');
  const [month, setMonth] = useState(thisMonth);
  const [ctc, setCtc] = useState('');
  const [amount, setAmount] = useState('');
  const [title, setTitle] = useState(e.title);
  const [from, setFrom] = useState(thisMonth);
  const [to, setTo] = useState(thisMonth);
  const [component, setComponent] = useState<'HRA' | 'Special allowance'>('HRA');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const usesCtc = kind === 'Revised' || kind === 'Promotion';
  const months = kind === 'Correction' ? monthsFromTo(from, to) : [];

  const save = async () => {
    setErr('');
    if (!note.trim()) return setErr('Add a note: it shows on the ledger and in the audit log.');
    if (kind === 'Correction' && !months.length) return setErr('The last month is before the first.');
    const base = { employeeId: e.id, note: note.trim() };
    const ev: Omit<SalaryEvent, 'id' | 'recorded' | 'actorId'> = usesCtc
      ? { ...base, type: kind, effective: month + '-01', ctc: Number(ctc), ...(kind === 'Promotion' ? { title: title.trim() } : {}) }
      : kind === 'Correction'
        ? { ...base, type: kind, effective: thisMonth + '-01', amount: Number(amount), appliesTo: months, component }
        : { ...base, type: kind, effective: month + '-01', amount: Number(amount) };
    setBusy(true);
    try {
      await api.appendSalaryEvent(ev);
      invalidate('salary', 'audit', 'payroll');
      say(KINDS.find((k) => k[0] === kind)![1] + ' recorded for ' + e.name.split(' ')[0]);
      onClose();
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal title={'Record a salary change · ' + e.name} onClose={onClose}>
      <p style={{ fontSize: 13.5, color: 'var(--ink-3)', margin: '8px 0 0' }}>{HINT[kind]}</p>
      {err && <div className="err-banner" role="alert" style={{ marginTop: 14 }}>{err}</div>}
      <div className="form-grid" style={{ marginTop: 18, gridTemplateColumns: '1fr 1fr' }}>
        <label className="field"><span>Change</span>
          <select value={kind} onChange={(x) => { setKind(x.target.value as Kind); setErr(''); }}>{KINDS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select>
        </label>
        {kind !== 'Correction'
          ? <label className="field"><span>{usesCtc ? 'Effective from' : 'Paid in'}</span><input type="month" value={month} onChange={(x) => setMonth(x.target.value)} /></label>
          : <label className="field"><span>Component</span><select value={component} onChange={(x) => setComponent(x.target.value as typeof component)}><option value="HRA">House rent allowance</option><option value="Special allowance">Special allowance</option></select></label>}
        {usesCtc && <label className="field"><span>New annual CTC (₹)</span><input inputMode="numeric" value={ctc} onChange={(x) => setCtc(x.target.value.replace(/[^\d]/g, ''))} /></label>}
        {kind === 'Promotion' && <label className="field"><span>New title</span><input value={title} onChange={(x) => setTitle(x.target.value)} /></label>}
        {!usesCtc && <label className="field"><span>{kind === 'Correction' ? 'Amount per month (₹)' : 'Amount (₹)'}</span><input inputMode="numeric" value={amount} onChange={(x) => setAmount(x.target.value.replace(/[^\d]/g, ''))} /></label>}
        {kind === 'Correction' && <div />}
        {kind === 'Correction' && <label className="field"><span>From month</span><input type="month" value={from} max={thisMonth} onChange={(x) => setFrom(x.target.value)} /></label>}
        {kind === 'Correction' && <label className="field"><span>To month</span><input type="month" value={to} max={thisMonth} onChange={(x) => setTo(x.target.value)} /></label>}
        <label className="field" style={{ gridColumn: '1 / -1' }}><span>Note</span><input value={note} onChange={(x) => setNote(x.target.value)} placeholder="Why, for the ledger" /></label>
      </div>
      {kind === 'Correction' && months.length > 0 && (
        <div className="threshold-band" style={{ marginTop: 16 }}>
          {months.length} {months.length === 1 ? 'month' : 'months'} ({monthLabel(months[0])}{months.length > 1 ? ' – ' + monthLabel(months[months.length - 1]) : ''}) · arrears of <b className="num">₹{(Number(amount || 0) * months.length).toLocaleString('en-IN')}</b>
        </div>
      )}
      <div className="modal-actions"><button className="btn-line" onClick={onClose}>Cancel</button><button className="btn-dark" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Add to the ledger'}</button></div>
    </Modal>
  );
}
