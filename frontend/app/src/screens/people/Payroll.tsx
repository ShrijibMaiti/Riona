import { useMemo, useState } from 'react';
import { DataTable, Mono, PersonCell, Status, downloadCsv, type Column } from '../../components/DataTable';
import { ConfirmDialog } from '../../components/Dialogs';
import { FilterBar } from '../../components/FilterBar';
import { PageHeader, Tabs } from '../../components/PageHeader';
import { ErrorState, Est, SkeletonRows } from '../../components/ui';
import * as api from '../../data/repositories';
import { form16Projection, ptFor, runLines, runTotals } from '../../data/selectors/payroll';
import type { PayrollRun, SalaryComponent, SalaryStructure } from '../../data/types';
import { useAllAttendance, useAllSalaryEvents, useEmployees, useMe } from '../../hooks/data';
import { dmy, inr, lakh, monthLabel } from '../../lib/format';
import { all, invalidate, useQuery } from '../../lib/query';
import { go, useApp } from '../../state/store';

const VIEWS = [
  { label: 'Runs', href: '/app/people/payroll' },
  { label: 'Salary structures', href: '/app/people/payroll/structures' },
  { label: 'Statutory', href: '/app/people/payroll/statutory' },
];
const TDS_EST = 'TDS is projected from this month’s salary × 12 under the new regime; declarations are not applied.';
const STAGES = ['Inputs', 'Review', 'Approved', 'Disbursed'] as const;

function usePayrollData() {
  const me = useMe();
  return all({ me, runs: useQuery(['payroll', 'runs'], api.getPayrollRuns), emps: useEmployees(), events: useAllSalaryEvents(), att: useAllAttendance(me.data?.today) });
}
const statusOf = (r: PayrollRun) => (r.stage === 'Disbursed' ? 'Disbursed' : r.stage === 'Inputs' ? 'Review inputs' : r.stage === 'Review' ? 'In review' : 'Approved');

export function PayrollRuns() {
  const q = usePayrollData();
  type Row = { run: PayrollRun; t: ReturnType<typeof runTotals> };
  const rows = useMemo(() => q.data?.runs.map((run) => ({ run, t: runTotals(runLines(run, q.data!.emps, q.data!.events, q.data!.att)) })), [q.data]);
  const current = q.data?.runs.find((r) => r.stage !== 'Disbursed');
  const cols: Column<Row>[] = [
    { key: 'p', header: 'Period', render: (r) => <span style={{ fontWeight: 500 }}>{monthLabel(r.run.month)}</span>, sort: (r) => r.run.month, mobile: true },
    { key: 'e', header: 'Employees', align: 'right', render: (r) => <span className="num">{r.t.employees}</span> },
    { key: 'g', header: 'Gross', align: 'right', render: (r) => <span className="num">{inr(r.t.gross)}</span>, sort: (r) => r.t.gross },
    { key: 'd', header: 'Deductions', align: 'right', render: (r) => <span className="num">{inr(r.t.deductions)}<Est basis={TDS_EST} /></span> },
    { key: 'n', header: 'Net', align: 'right', render: (r) => <span className="num">{inr(r.t.net)}</span>, mobile: true },
    { key: 's', header: 'Status', render: (r) => <Status label={statusOf(r.run)} colour={r.run.stage === 'Disbursed' ? 'green' : 'amber'} />, mobile: true },
  ];
  if (q.error) return <div className="wrap page"><ErrorState error={q.error} retry={q.refetch} /></div>;
  return (
    <div className="wrap page" style={{ paddingBottom: 140 }}>
      <PageHeader title="Payroll" desc={current ? 'Runs lock on the 25th. ' + monthLabel(current.month).split(' ')[0] + ' is ' + statusOf(current).toLowerCase() + '.' : 'Runs lock on the 25th.'}
        primary={current ? { label: 'Open ' + monthLabel(current.month).split(' ')[0] + ' run', href: '/app/people/payroll/runs/' + current.id } : undefined}
        views={VIEWS} current="/app/people/payroll" />
      <div style={{ marginTop: 24 }}><DataTable rows={rows} columns={cols} rowKey={(r) => r.run.id} onOpen={(r) => go('/app/people/payroll/runs/' + r.run.id)} /></div>
    </div>
  );
}

export function PayrollRunScreen({ id }: { id: string }) {
  const { say, role } = useApp();
  const q = usePayrollData();
  const runQ = useQuery(['payroll', 'run', id], () => api.getPayrollRun(id));
  const [peek, setPeek] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [dept, setDept] = useState('');
  const [search, setSearch] = useState('');
  const run = runQ.data;
  const lines = useMemo(() => (run && q.data ? runLines(run, q.data.emps, q.data.events, q.data.att) : undefined), [run, q.data]);
  if (runQ.error) return <div className="wrap page"><ErrorState error={runQ.error} retry={runQ.refetch} /></div>;
  if (q.error) return <div className="wrap page"><ErrorState error={q.error} retry={q.refetch} /></div>;
  if (!q.data || !run || !lines) return <div className="wrap page"><SkeletonRows /></div>;
  const t = runTotals(lines);
  const at = STAGES.indexOf(run.stage);
  const view = peek ?? run.stage;
  const vi = STAGES.indexOf(view as (typeof STAGES)[number]);
  const nm = (eid: string) => q.data!.emps.find((e) => e.id === eid)?.name ?? eid;
  const monthEvents = q.data.events.filter((e) => run.employeeIds.includes(e.employeeId) && (e.effective.startsWith(run.month) || e.recorded.startsWith(run.month)));
  const late = monthEvents.filter((e) => !run.salaryEventIds.includes(e.id));
  const joiners = q.data.emps.filter((e) => e.joined.startsWith(run.month));
  const lop = lines.filter((l) => l.lop > 0);
  const canAct = role === 'Admin' || role === 'HR';
  const advance = async () => {
    try { await api.advancePayrollRun(run.id); invalidate('payroll', 'audit'); setPeek(null); say(monthLabel(run.month) + ' run moved to ' + STAGES[at + 1]); } catch (e) { say((e as Error).message); }
    setConfirm(false);
  };
  // Riona records the disbursement; the money itself moves through the bank (direct bank payouts are on the roadmap).
  const next = ['Lock inputs and review', 'Approve run', 'Mark as disbursed'][at];
  const rows = lines.filter((l) => (!dept || l.dept === dept) && (!search || l.name.toLowerCase().includes(search.toLowerCase())));
  type L = (typeof lines)[number];
  const cols: Column<L>[] = [
    { key: 'n', header: 'Employee', render: (l) => <PersonCell name={l.name} sub={l.dept} />, sort: (l) => l.name, mobile: true },
    { key: 'g', header: 'Gross', align: 'right', render: (l) => <span className="num">{inr(l.slip.gross)}</span>, sort: (l) => l.slip.gross },
    { key: 'pf', header: 'PF', align: 'right', render: (l) => <span className="num">{inr(l.pf)}</span> },
    { key: 'esi', header: 'ESI', align: 'right', render: (l) => <span className="num">{l.esi ? inr(l.esi) : '—'}</span> },
    { key: 'pt', header: 'PT', align: 'right', render: (l) => <span className="num">{inr(l.pt)}</span> },
    { key: 'tds', header: 'TDS', align: 'right', render: (l) => <span className="num">{inr(l.tds)}<Est basis={TDS_EST} /></span>, sort: (l) => l.tds },
    { key: 'lop', header: 'LOP', align: 'right', render: (l) => <span className="num">{l.lop || '—'}</span>, sort: (l) => l.lop },
    { key: 'net', header: 'Net', align: 'right', render: (l) => <span className="num" style={{ fontWeight: 500 }}>{inr(l.net)}</span>, sort: (l) => l.net, mobile: true },
  ];
  return (
    <div className="wrap page" style={{ paddingBottom: 140 }}>
      <PageHeader title={monthLabel(run.month) + ' payroll'} desc={run.employeeIds.length + ' employees · inputs lock ' + dmy(run.lockDate) + (run.disbursedOn ? ' · disbursed ' + dmy(run.disbursedOn) : '')}
        primary={canAct && at < 3 && vi === at ? { label: next, onClick: () => setConfirm(true) } : undefined}
        more={[{ label: 'Export register', run: () => downloadCsv('payroll-' + run.month + '.csv', ['Employee', 'Gross', 'PF', 'ESI', 'PT', 'TDS (est.)', 'LOP days', 'Net'], lines.map((l) => [l.name, l.slip.gross, l.pf, l.esi, l.pt, l.tds, l.lop, l.net])) }]} />
      <ol className="stepper" aria-label="Run stages">
        {STAGES.map((s, i) => (
          <li key={s} className={(i < at ? 'done' : i === at ? 'current' : '') + (i === vi ? ' viewing' : '')}>
            <button disabled={i > at} onClick={() => setPeek(i === at ? null : s)} aria-current={i === vi ? 'step' : undefined}><span>{i < at ? '✓' : i + 1}</span>{s}</button>
          </li>
        ))}
      </ol>
      {vi < at && <div className="threshold-band" style={{ marginTop: 16 }}>You are looking at the {view.toLowerCase()} stage, which is complete. <button className="link-btn" onClick={() => setPeek(null)}>Back to the current stage</button></div>}
      <div className="sumband">
        {[['Gross', lakh(t.gross)], ['PF', lakh(t.pf)], ['ESI', inr(t.esi)], ['PT', inr(t.pt)], ['TDS', lakh(t.tds), true], ['Net to bank', lakh(t.net), true]].map(([k, v, e]) => <div key={k as string}><div className="k">{k}</div><div className="v">{v}{e && <Est basis={TDS_EST} />}</div></div>)}
      </div>

      {view === 'Inputs' && (
        <div className="run-grid">
          <section>
            <div className="section-title">Salary changes this month</div>
            {monthEvents.filter((e) => run.salaryEventIds.includes(e.id)).map((e) => <div key={e.id} className="kv" style={{ gridTemplateColumns: '1fr auto' }}><span style={{ color: 'var(--ink)' }}>{nm(e.employeeId)} · {e.type}<span className="cell-sub">{e.note}</span></span><span className="num">{e.ctc ? 'CTC ' + inr(e.ctc) : inr((e.amount ?? 0) * (e.appliesTo?.length ?? 1))}</span></div>)}
            {!monthEvents.some((e) => run.salaryEventIds.includes(e.id)) && <div className="empty-s">No revisions, bonuses or corrections this month.</div>}
            {late.length > 0 && <div className="threshold-band over" style={{ marginTop: 12 }}>{late.length} {late.length === 1 ? 'event was' : 'events were'} recorded after the lock and will reach the next run: {late.map((e) => nm(e.employeeId) + ' (' + e.type.toLowerCase() + ')').join(', ')}.</div>}
          </section>
          <section>
            <div className="section-title">Loss of pay from attendance</div>
            {lop.map((l) => <div key={l.employeeId} className="kv" style={{ gridTemplateColumns: '1fr auto' }}><a href={'#/app/people/directory/' + l.employeeId + '/attendance'} style={{ color: 'var(--ink)' }}>{l.name}</a><span className="num">{l.lop} {l.lop === 1 ? 'day' : 'days'}</span></div>)}
            {!lop.length && <div className="empty-s">No absences in {monthLabel(run.month).split(' ')[0]}.</div>}
            <div className="section-title" style={{ marginTop: 28 }}>Joiners</div>
            {joiners.map((e) => <div key={e.id} className="kv" style={{ gridTemplateColumns: '1fr auto' }}><span>{e.name}</span><span>Joined {dmy(e.joined)} · prorated</span></div>)}
            {!joiners.length && <div className="empty-s">No one joined this month.</div>}
          </section>
        </div>
      )}
      {view === 'Review' && (
        <>
          <FilterBar search={search} onSearch={setSearch} filters={[{ key: 'd', label: 'Departments', options: [...new Set(lines.map((l) => l.dept ?? ''))].sort(), value: dept, onChange: setDept }]} />
          <DataTable rows={rows} columns={cols} rowKey={(l) => l.employeeId} onOpen={(l) => go('/app/people/directory/' + l.employeeId + '/compensation')} minWidth={900} />
        </>
      )}
      {view === 'Approved' && (
        <div className="run-grid">
          <section>
            <div className="section-title">Bank file</div>
            <div className="kv"><span>Transfers</span><span className="num">{lines.length}</span></div>
            <div className="kv"><span>Total to bank</span><span className="num">{inr(t.net)}</span></div>
            <div className="kv"><span>Debit account</span><span>HDFC Bank · ··4417</span></div>
            <button className="btn-line" style={{ marginTop: 16 }} onClick={() => downloadCsv('bank-file-' + run.month + '.csv', ['Employee ID', 'Name', 'Amount'], lines.map((l) => [l.employeeId, l.name, l.net]))}>Download bank file</button>
          </section>
          <section>
            <div className="section-title">Statutory due from this run</div>
            {[['PF (employee + employer)', t.pf * 2], ['ESI', t.esi], ['Professional tax', t.pt], ['TDS', t.tds]].map(([k, v]) => <div key={k as string} className="kv" style={{ gridTemplateColumns: '1fr auto' }}><span>{k}{k === 'TDS' && <Est basis={TDS_EST} />}</span><span className="num">{inr(v as number)}</span></div>)}
          </section>
        </div>
      )}
      {view === 'Disbursed' && (
        <div className="run-grid">
          <section>
            <div className="section-title">Disbursement</div>
            <div className="kv"><span>Credited on</span><span>{dmy(run.disbursedOn)}</span></div>
            <div className="kv"><span>Payslips</span><span>Published to {lines.length} employees · <a className="ulink" href="#/app/me/payslips">see yours</a></span></div>
            <div className="kv"><span>Net paid</span><span className="num">{inr(t.net)}</span></div>
          </section>
          <section>
            <div className="section-title">Bank file issues</div>
            {run.bankFileIssues.map((b) => <div key={b.employeeId} className="kv" style={{ gridTemplateColumns: '1fr auto' }}><a href={'#/app/people/directory/' + b.employeeId} style={{ color: 'var(--ink)' }}>{nm(b.employeeId)}</a><Status label={b.issue} colour="red" /></div>)}
            {!run.bankFileIssues.length && <div className="empty-s">Every transfer went through.</div>}
          </section>
        </div>
      )}
      {confirm && (
        <ConfirmDialog title={next + '?'} confirm={next}
          body={at === 0 ? 'Inputs lock. Salary events recorded from now reach next month’s run, and appear in “As paid at the time” views accordingly.' : at === 1 ? 'The run is approved for disbursement. Payslips are generated but not yet published.' : 'Records the run as paid and publishes payslips to every employee in it. Riona doesn’t move money: make the transfers from your bank first.'}
          onCancel={() => setConfirm(false)} onConfirm={advance} />
      )}
    </div>
  );
}

// ---------------- structures: formula builder ----------------
const TOKENS = ['CTC', 'MONTHLY', 'BASIC', 'HRA', 'EMPLOYER_PF', 'SPECIAL', 'STATE_PT', 'MIN(', 'MAX(', '+', '−', '×', '÷', '(', ')', ','];
const codeOf = (c: SalaryComponent) => ({ Basic: 'BASIC', 'House rent allowance': 'HRA', 'Employer PF': 'EMPLOYER_PF', 'Special allowance': 'SPECIAL', 'Provident fund': 'PF', 'Professional tax': 'PT' } as Record<string, string>)[c.name] ?? c.name.toUpperCase().replace(/[^A-Z0-9]+/g, '_');

/** Evaluate a formula over known variables. Only numbers, operators, MIN/MAX and known names are allowed. */
export function evaluate(formula: string, vars: Record<string, number>): { value: number } | { error: string } {
  const src = formula.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
  const tokens = src.match(/[A-Z_]+|\d+(?:\.\d+)?|[-+*/(),]|\S/g) ?? [];
  for (const t of tokens) {
    if (/^\d/.test(t) || /^[-+*/(),]$/.test(t) || t === 'MIN' || t === 'MAX') continue;
    if (/^[A-Z_]+$/.test(t)) { if (!(t in vars)) return { error: 'Unknown name ' + t }; continue; }
    return { error: 'Unexpected “' + t + '”' };
  }
  try {
    const expr = tokens.map((t) => (t === 'MIN' ? 'Math.min' : t === 'MAX' ? 'Math.max' : /^[A-Z_]+$/.test(t) ? 'v.' + t : t)).join(' ');
    const v = new Function('v', 'return (' + expr + ')')(vars) as number;
    return Number.isFinite(v) ? { value: Math.round(v) } : { error: 'Does not produce a number' };
  } catch {
    return { error: 'Incomplete formula' };
  }
}
function computeStructure(s: SalaryStructure, ctc: number, state = 'Karnataka') {
  const vars: Record<string, number> = { CTC: ctc, MONTHLY: ctc / 12, STATE_PT: ptFor(state), BASIC: 0, HRA: 0, EMPLOYER_PF: 0, SPECIAL: 0, GROSS: 0 };
  return s.components.map((c) => {
    const r = evaluate(c.formula, vars);
    if ('value' in r) vars[codeOf(c)] = r.value;
    return { c, r };
  });
}

export function Structures() {
  const { say, role } = useApp();
  const q = useQuery(['structures'], api.getSalaryStructures);
  const [sel, setSel] = useState<string | null>(null);
  const [draft, setDraft] = useState<SalaryStructure | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const [ctc, setCtc] = useState(1800000);
  if (q.error) return <div className="wrap page"><ErrorState error={q.error} retry={q.refetch} /></div>;
  const s = draft ?? (q.data ? q.data.find((x) => x.id === (sel ?? q.data![0].id)) : undefined);
  const results = s ? computeStructure(s, ctc) : [];
  const bad = results.some((x) => 'error' in x.r);
  const editable = role === 'Admin' || role === 'HR';
  const setFormula = (i: number, f: string) => s && setDraft({ ...s, components: s.components.map((c, j) => (j === i ? { ...c, formula: f } : c)) });
  const insert = (tok: string) => { if (focus === null || !s) return; const f = s.components[focus].formula; setFormula(focus, (f + ' ' + tok).replace(/\(\s/g, '(').trim()); };
  const earn = results.filter((x) => x.c.kind === 'Earning').reduce((a, x) => a + ('value' in x.r ? x.r.value : 0), 0);
  const ded = results.filter((x) => x.c.kind === 'Deduction').reduce((a, x) => a + ('value' in x.r ? x.r.value : 0), 0);
  return (
    <div className="wrap page" style={{ paddingBottom: 140 }}>
      <PageHeader title="Salary structures" desc="Components and the formulas behind them. Edit a formula and the preview recomputes for the sample CTC." views={VIEWS} current="/app/people/payroll/structures" />
      {!q.data || !s ? <div className="card" style={{ marginTop: 24 }}><SkeletonRows /></div> : (
        <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', marginTop: 32, alignItems: 'flex-start' }}>
          <div style={{ flex: '0 1 240px', minWidth: 200 }}>
            {q.data.map((x) => <button key={x.id} className={'struct-pick' + (x.id === s.id ? ' on' : '')} onClick={() => { setSel(x.id); setDraft(null); setFocus(null); }}><b>{x.name}</b><span>{x.appliesTo}</span></button>)}
          </div>
          <div style={{ flex: '1 1 560px', minWidth: 0 }}>
            <div className="card" style={{ padding: '20px 24px' }}>
              <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                <label className="field" style={{ flex: '1 1 260px' }}><span>Sample annual CTC · {inr(ctc)}</span><input type="range" min={300000} max={6000000} step={60000} value={ctc} onChange={(e) => setCtc(+e.target.value)} style={{ height: 'auto', padding: 0, border: 'none' }} /></label>
                <div style={{ fontSize: 13, color: 'var(--ink-3)', fontVariantNumeric: 'tabular-nums' }}>Monthly {inr(ctc / 12)} · earnings {inr(earn)} · take-home before TDS {inr(earn - ded)}</div>
              </div>
            </div>
            {editable && (
              <div className="tokens" aria-label="Insert into the focused formula">
                {TOKENS.map((t) => <button key={t} disabled={focus === null} onClick={() => insert(t)}>{t}</button>)}
                <span>{focus === null ? 'Click a formula to insert tokens.' : 'Inserting into ' + s.components[focus].name}</span>
              </div>
            )}
            <div className="card" style={{ marginTop: 12 }}>
              {results.map(({ c, r }, i) => (
                <div key={c.id} className="formula-row">
                  <div><b>{c.name}</b><span>{c.kind}{c.taxable ? ' · taxable' : ''} · <code>{codeOf(c)}</code></span></div>
                  <input className={'input mono' + ('error' in r ? ' bad' : '')} value={c.formula} readOnly={!editable} onFocus={() => setFocus(i)} onChange={(e) => setFormula(i, e.target.value.toUpperCase())} aria-label={c.name + ' formula'} aria-invalid={'error' in r} />
                  <span className="num" style={{ textAlign: 'right' }}>{'value' in r ? inr(r.value) : <span style={{ color: 'var(--red)', fontSize: 12.5 }}>{r.error}</span>}</span>
                </div>
              ))}
            </div>
            {editable && draft && (
              <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                <button className="btn-dark" disabled={bad} onClick={async () => { await api.saveSalaryStructure(draft); invalidate('structures', 'audit'); setDraft(null); say(draft.name + ' saved'); }}>Save structure</button>
                <button className="btn-line" onClick={() => setDraft(null)}>Discard changes</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- statutory ----------------
export function Statutory() {
  const q = usePayrollData();
  const filings = useQuery(['filings'], api.getFilings);
  const [tab, setTab] = useState<'PF' | 'ESI' | 'PT' | 'TDS'>('PF');
  const [f16, setF16] = useState('E-0112');
  if (q.error || filings.error) return <div className="wrap page"><ErrorState error={(q.error ?? filings.error)!} retry={q.refetch} /></div>;
  const ready = q.data && filings.data;
  const current = q.data?.runs.find((r) => r.stage !== 'Disbursed') ?? q.data?.runs[0];
  const t = ready && current ? runTotals(runLines(current, q.data!.emps, q.data!.events, q.data!.att)) : null;
  const list = filings.data?.filter((x) => x.kind === tab) ?? [];
  const liab = t ? { PF: t.pf * 2, ESI: t.esi, PT: t.pt, TDS: t.tds }[tab] : 0;
  const desc = { PF: 'Employee and employer contributions at 12% of basic, capped at ₹1,800 a month each. Due on the 15th.', ESI: '0.75% employee and 3.25% employer, for gross up to ₹21,000. Due on the 15th.', PT: 'State professional tax, deducted monthly and filed by state.', TDS: 'Income tax deducted at source, filed quarterly on Form 24Q. Form 16 is issued after the year closes.' }[tab];
  // Form 16 Part B, projected for FY 2026–27.
  const form16 = (() => {
    if (!q.data) return null;
    const e = q.data.emps.find((x) => x.id === f16);
    if (!e) return null;
    return { e, ...form16Projection(e, q.data.events.filter((x) => x.employeeId === f16), q.data.me.today) };
  })();
  return (
    <div className="wrap page" style={{ paddingBottom: 140 }}>
      <PageHeader title="Statutory" desc="Filings, what is due from the current run, and Form 16." views={VIEWS} current="/app/people/payroll/statutory" />
      <Tabs current={tab} tabs={(['PF', 'ESI', 'PT', 'TDS'] as const).map((k) => ({ key: k, label: k, onClick: () => setTab(k) }))} />
      <p className="ph-desc" style={{ marginTop: 20 }}>{desc}</p>
      {current && t && <div className="threshold-band" style={{ marginTop: 16 }}>From the {monthLabel(current.month)} run: <b className="num">{inr(liab)}</b>{tab === 'TDS' && <Est basis={TDS_EST} />} due {tab === 'TDS' ? 'with the Q3 return' : 'by the 15th of next month'}.</div>}
      <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', alignItems: 'flex-start', marginTop: 8 }}>
        <div style={{ flex: '1 1 520px', minWidth: 0 }}>
          <DataTable rows={ready ? list : undefined} rowKey={(x) => x.id} columns={[
            { key: 'p', header: 'Period', render: (x) => <span style={{ fontWeight: 500 }}>{/^\d{4}-\d{2}$/.test(x.period) ? monthLabel(x.period) : x.period}</span>, mobile: true },
            { key: 'd', header: 'Due', render: (x) => dmy(x.due), sort: (x) => x.due },
            { key: 'f', header: 'Filed', render: (x) => dmy(x.filedOn), mobile: true },
            { key: 'r', header: 'Reference', render: (x) => <Mono>{x.reference ?? '—'}</Mono> },
            { key: 's', header: 'Status', render: (x) => <Status label={x.filedOn ? 'Filed' : x.due < (q.data?.me.today ?? '') ? 'Overdue' : 'Due'} colour={x.filedOn ? 'green' : x.due < (q.data?.me.today ?? '') ? 'red' : 'amber'} />, mobile: true },
          ]} />
        </div>
        {tab === 'TDS' && form16 && (
          <aside className="card f16" aria-label="Form 16">
            <div className="section-title">Form 16 · Part B · FY 2026–27</div>
            <select className="fselect" style={{ maxWidth: 'none', width: '100%', marginBottom: 12 }} value={f16} onChange={(e) => setF16(e.target.value)} aria-label="Employee">{q.data!.emps.filter((e) => e.type === 'Full-time').map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
            <div className="kv" style={{ gridTemplateColumns: '1fr auto' }}><span>Gross salary</span><span className="num">{inr(form16.gross)}<Est basis={form16.actual + ' months paid, the rest projected at the current salary'} /></span></div>
            <div className="kv" style={{ gridTemplateColumns: '1fr auto' }}><span>Standard deduction</span><span className="num">− {inr(75000)}</span></div>
            <div className="kv" style={{ gridTemplateColumns: '1fr auto' }}><span>Taxable income</span><span className="num">{inr(form16.taxable)}</span></div>
            <div className="kv" style={{ gridTemplateColumns: '1fr auto' }}><span>Tax with cess (new regime)</span><span className="num">{inr(form16.tax)}<Est basis="Projected for the full year; declarations and other income not included" /></span></div>
            <div className="kv" style={{ gridTemplateColumns: '1fr auto' }}><span>TDS deducted so far</span><span className="num">{inr(form16.tdsSoFar)}</span></div>
            <div className="kv" style={{ gridTemplateColumns: '1fr auto' }}><span>Employee PF (80C, old regime only)</span><span className="num">{inr(form16.pf)}</span></div>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 12 }}>The final Form 16 is generated after 31 March from the filed 24Q returns.</p>
          </aside>
        )}
      </div>
    </div>
  );
}
