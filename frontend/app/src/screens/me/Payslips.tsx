/**
 * My payslips: published months by financial year, each rendered as the payslip document,
 * with the as-corrected / as-paid views where a correction changed that month. Form 16 for the year.
 */
import { useMemo, useState } from 'react';
import { PageHeader } from '../../components/PageHeader';
import { ErrorState, Est, SkeletonRows } from '../../components/ui';
import * as api from '../../data/repositories';
import { form16Projection, lopDays, payslip, type PayslipMode } from '../../data/selectors/payroll';
import { useMe } from '../../hooks/data';
import { monthEnd } from '../../lib/dates';
import { dmy, inr, monthLabel, monthShort } from '../../lib/format';
import { all, useQuery } from '../../lib/query';
import { go } from '../../state/store';

const TDS_EST = 'TDS is projected from this month’s salary × 12 under the new regime; your declarations are not applied.';
const fyOf = (ym: string) => (+ym.slice(5, 7) >= 4 ? +ym.slice(0, 4) : +ym.slice(0, 4) - 1);
const fyLabel = (y: number) => 'FY ' + y + '–' + String(y + 1).slice(2);
const maskPan = (pan: string) => 'XXXXX' + pan.slice(5);

export function MyPayslips({ query }: { query: URLSearchParams }) {
  const me = useMe();
  const id = me.data?.employee.id;
  const q = all({
    me,
    runs: useQuery(['payroll', 'runs'], api.getPayrollRuns),
    events: useQuery(['salary', id], () => api.getSalaryEvents(id!), { enabled: !!id }),
  });
  const published = useMemo(() => (q.data ? q.data.runs.filter((r) => r.stage === 'Disbursed').map((r) => r.month).sort().reverse() : []), [q.data]);
  const years = [...new Set(published.map(fyOf))];
  const fy = +(query.get('fy') ?? '') || years[0];
  const inYear = published.filter((m) => fyOf(m) === fy);
  const month = query.get('m') && inYear.includes(query.get('m')!) ? query.get('m')! : inYear[0];
  const att = useQuery(['attendance', id, month], () => api.getAttendance({ employeeId: id!, from: month + '-01', to: monthEnd(month) }), { enabled: !!id && !!month });
  const [mode, setMode] = useState<PayslipMode>('corrected');
  const nav = (p: Record<string, string>) => go('/app/me/payslips?' + new URLSearchParams({ fy: String(fy), ...(month ? { m: month } : {}), ...p }).toString());

  if (q.error) return <div className="wrap page"><ErrorState error={q.error} retry={q.refetch} /></div>;
  if (!q.data) return <div className="wrap page"><SkeletonRows /></div>;
  const { employee: e, today, orgName } = q.data.me;
  const events = q.data.events;
  const f16 = fy ? form16Projection(e, events, today, fy + '-04-01', fy + 1 + '-03-31') : null;

  return (
    <div className="wrap page" style={{ paddingBottom: 140 }}>
      <PageHeader title="My payslips" desc="Every published month, itemised, with the statutory breakdown. Your Form 16 for the year is below." />
      <div className="me-bar">
        <label className="field" style={{ width: 180 }}><span>Financial year</span>
          <select value={fy} onChange={(ev) => go('/app/me/payslips?fy=' + ev.target.value)}>{years.map((y) => <option key={y} value={y}>{fyLabel(y)}</option>)}</select>
        </label>
        <div className="viewseg me-months" role="tablist" aria-label="Month">
          {inYear.map((m) => <button key={m} role="tab" aria-selected={m === month} className={m === month ? 'active' : ''} onClick={() => nav({ m })}>{monthShort(m).split(' ')[0]}</button>)}
        </div>
      </div>
      {!month ? <div className="empty"><div className="empty-t">No payslips published for {fyLabel(fy)} yet.</div></div> : !att.data ? <SkeletonRows n={6} /> : (
        <PayslipDoc month={month} mode={mode} setMode={setMode} orgName={orgName} e={e} events={events} lop={lopDays(att.data, month)} />
      )}

      {f16 && (
        <section className="card f16 me-f16" aria-label="Form 16">
          <div className="section-title">Form 16 · Part B · {fyLabel(fy)}</div>
          <p className="sub-p">{f16.final ? 'Issued from the filed Form 24Q returns.' : 'The final Form 16 is issued after 31 March from the filed 24Q returns. Until then this is a projection: ' + f16.actual + ' of 12 months paid, the rest at your current salary.'}</p>
          <div className="kv" style={{ gridTemplateColumns: '1fr auto' }}><span>Gross salary</span><span className="num">{inr(f16.gross)}{!f16.final && <Est basis={f16.actual + ' months paid, the rest projected at the current salary'} />}</span></div>
          <div className="kv" style={{ gridTemplateColumns: '1fr auto' }}><span>Standard deduction</span><span className="num">− {inr(f16.standardDeduction)}</span></div>
          <div className="kv" style={{ gridTemplateColumns: '1fr auto' }}><span>Taxable income</span><span className="num">{inr(f16.taxable)}{!f16.final && <Est basis="Follows the projected gross salary" />}</span></div>
          <div className="kv" style={{ gridTemplateColumns: '1fr auto' }}><span>Tax with cess (new regime)</span><span className="num">{inr(f16.tax)}<Est basis="Projected for the full year; declarations and other income not included" /></span></div>
          <div className="kv" style={{ gridTemplateColumns: '1fr auto' }}><span>TDS deducted so far</span><span className="num">{inr(f16.tdsSoFar)}</span></div>
          <div className="kv" style={{ gridTemplateColumns: '1fr auto' }}><span>Your PF (80C, old regime only)</span><span className="num">{inr(f16.pf)}</span></div>
          <div className="kv" style={{ gridTemplateColumns: '1fr auto' }}><span>PAN · UAN</span><span className="mono">{maskPan(e.pan)} · {e.uan}</span></div>
        </section>
      )}
    </div>
  );
}

function PayslipDoc({ month, mode, setMode, orgName, e, events, lop }: {
  month: string; mode: PayslipMode; setMode: (m: PayslipMode) => void; orgName: string; lop: number;
  e: Parameters<typeof payslip>[0] & { id: string; name: string; title: string; dept: string; pan: string; uan: string; bank: { name: string; accountLast4: string }; joined: string };
  events: Parameters<typeof payslip>[1];
}) {
  const corrected = payslip(e, events, month, 'corrected', lop);
  const asPaid = payslip(e, events, month, 'asPaid', lop);
  const differs = corrected.net !== asPaid.net;
  const slip = differs && mode === 'asPaid' ? asPaid : corrected;
  const tds = slip.deductions.find((d) => d.key === 'tds');
  const download = () => {
    const lines = [orgName.toUpperCase(), 'Payslip · ' + monthLabel(month) + (differs ? (mode === 'asPaid' ? ' · as paid at the time' : ' · as corrected') : ''), e.name + ' · ' + e.id + ' · PAN ' + maskPan(e.pan), '',
      'EARNINGS', ...slip.earnings.map((x) => x.label.padEnd(32) + inr(x.amount)), 'Gross'.padEnd(32) + inr(slip.gross), '',
      'DEDUCTIONS', ...slip.deductions.map((x) => x.label.padEnd(32) + '- ' + inr(x.amount) + (x.estimated ? ' (est.)' : '')), '', 'NET PAY'.padEnd(32) + inr(slip.net)];
    const a = document.createElement('a');
    a.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(lines.join('\n'));
    a.download = 'Payslip-' + month + '-' + e.id + '.txt';
    a.click();
  };
  return (
    <>
      {differs && (
        <div className="dual">
          <div className="viewseg" style={{ marginTop: 0 }} role="tablist" aria-label="Which version of the payslip">
            <button role="tab" className={mode === 'corrected' ? 'active' : ''} aria-selected={mode === 'corrected'} onClick={() => setMode('corrected')}>As corrected</button>
            <button role="tab" className={mode === 'asPaid' ? 'active' : ''} aria-selected={mode === 'asPaid'} onClick={() => setMode('asPaid')}>As paid at the time</button>
          </div>
          <div className="dual-note">A correction recorded after this month’s payroll locked changes it: as corrected, net pay is <b>{inr(corrected.net)}</b>; as paid at the time it was <b>{inr(asPaid.net)}</b>. The difference reaches you as arrears in a later run.</div>
        </div>
      )}
      <article className="card payslip-doc" aria-label={'Payslip for ' + monthLabel(month)}>
        <header className="pd-head">
          <div><div className="pd-org">{orgName.toUpperCase()}</div><div className="pd-sub">Payslip · {monthLabel(month)}{differs && mode === 'asPaid' ? ' · as paid at the time' : ''}</div></div>
          <button className="btn-line" onClick={download}>Download</button>
        </header>
        <div className="pd-who">
          <div><span>Employee</span><b>{e.name}</b></div>
          <div><span>Employee ID</span><b className="mono">{e.id}</b></div>
          <div><span>Designation</span><b>{e.title}</b></div>
          <div><span>PAN</span><b className="mono">{maskPan(e.pan)}</b></div>
          <div><span>UAN</span><b className="mono">{e.uan}</b></div>
          <div><span>Paid to</span><b>{e.bank.name} ••••{e.bank.accountLast4}</b></div>
          <div><span>Loss of pay</span><b>{lop ? lop + (lop === 1 ? ' day' : ' days') : 'None'}</b></div>
          <div><span>Annual CTC</span><b className="num">{inr(slip.ctc)}</b></div>
        </div>
        <div className="pd-cols">
          <div>
            <div className="pd-h">Earnings</div>
            {slip.earnings.map((x) => <div key={x.key} className="slip-row"><span>{x.label}</span><span className="num">{inr(x.amount)}</span></div>)}
            <div className="slip-row total"><span>Gross earnings</span><span className="num">{inr(slip.gross)}</span></div>
          </div>
          <div>
            <div className="pd-h">Deductions</div>
            {slip.deductions.map((x) => <div key={x.key} className="slip-row"><span>{x.label}{x.estimated && <Est basis={x.estimated.basis || TDS_EST} />}</span><span className="num">− {inr(x.amount)}</span></div>)}
            <div className="slip-row total"><span>Total deductions</span><span className="num">− {inr(slip.totalDeductions)}</span></div>
          </div>
        </div>
        <div className="pd-note">{slip.esiNote}</div>
        <div className="slip-net"><span>Net pay{tds && <Est basis="Net pay depends on the estimated TDS above." />}</span><span>{inr(slip.net)}</span></div>
        <div className="pd-foot">Computer-generated from the salary ledger; no signature required. Joined {dmy(e.joined)} · {e.dept}.</div>
      </article>
    </>
  );
}
