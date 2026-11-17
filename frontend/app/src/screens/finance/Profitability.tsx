import { useMemo, useState } from 'react';
import { downloadCsv } from '../../components/DataTable';
import { ErrorState, Est, SkeletonRows } from '../../components/ui';
import { PERIODS, inPeriod, profitability, type Figures } from '../../data/selectors/profitability';
import { useAllEntries, useAllExpenses, useAllInvoices, useAllSalaryEvents, useClients, useEmployees, useProjects } from '../../hooks/data';
import { eachDay, isWeekend } from '../../lib/dates';
import { SC, hours, inr, lakh, initials } from '../../lib/format';
import { all } from '../../lib/query';
import { go, useApp } from '../../state/store';

type View = 'client' | 'project' | 'employee';
const EST = 'Labour cost uses estimated loaded cost rates: CTC × 1.4 ÷ 12 ÷ 140 productive hours.';

export default function Profitability({ initial }: { initial: URLSearchParams }) {
  const { say } = useApp();
  const q = all({ clients: useClients(), projects: useProjects(), emps: useEmployees(), entries: useAllEntries(), invoices: useAllInvoices(), expenses: useAllExpenses(), salaryEvents: useAllSalaryEvents() });
  const [view, setView] = useState<View>((initial.get('view') as View) || 'client');
  const [period, setPeriod] = useState(initial.get('period') || 'all');
  const [client, setClient] = useState(initial.get('client') || 'All');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const P = PERIODS.find((p) => p.key === period)!;
  const prof = useMemo(() => (q.data ? profitability(inPeriod(q.data, P)) : null), [q.data, P]);

  if (q.error) return <div className="wrap page"><ErrorState error={q.error} retry={q.refetch} /></div>;
  const d = q.data;
  const cName = (id: string) => d?.clients.find((c) => c.id === id)?.name ?? id;
  const pOf = (id: string) => d?.projects.find((p) => p.id === id);
  const eOf = (id: string) => d?.emps.find((e) => e.id === id);
  const clients = prof?.clients.filter((c) => client === 'All' || c.clientId === client && true) ?? [];
  const T = clients.reduce((a, c) => ({ revenue: a.revenue + c.revenue, labour: a.labour + c.labour, expenses: a.expenses + c.expenses, margin: a.margin + c.margin }), { revenue: 0, labour: 0, expenses: 0, margin: 0 });
  const drillHref = (scope: Record<string, string>, measure: string) => '/app/finance/profitability/entries?' + new URLSearchParams({ ...scope, measure, period }).toString();

  type Row = Figures & { key: string; name: string; sub: string; depth: number; expandable: boolean; scope: Record<string, string>; weight: number };
  const rows: Row[] = [];
  if (prof && d) {
    const projRow = (pr: (typeof prof.projects)[number], depth: number, sub?: string): Row => {
      const p = pOf(pr.projectId)!;
      return { ...pr, key: pr.projectId, name: p.name, sub: sub ?? p.model + ' · ' + Math.round(pr.hours).toLocaleString('en-IN') + ' h · ' + p.health, depth, expandable: true, scope: { project: pr.projectId }, weight: depth ? 500 : 600 };
    };
    const people = (pr: (typeof prof.projects)[number], depth: number) => {
      pr.people.forEach((pp) => {
        const e = eOf(pp.employeeId);
        rows.push({ ...pp, key: pp.key, name: e?.name ?? pp.employeeId, sub: Math.round(pp.hours) + ' h · bill ' + inr(e?.billRate ?? 0) + '/h', depth, expandable: false, scope: { project: pr.projectId, employee: pp.employeeId }, weight: 400 });
      });
      if (pr.other.revenue || pr.other.expenses) rows.push({ ...emptyFig(), revenue: pr.other.revenue, expenses: pr.other.expenses, margin: pr.other.revenue - pr.other.expenses, pct: 0, key: pr.projectId + '|other', name: 'Not tied to hours', sub: 'Milestones without logged hours, rebilled expenses, claims', depth, expandable: false, scope: { project: pr.projectId }, weight: 400 });
    };
    if (view === 'client') {
      for (const c of clients) {
        const n = c.projects.filter((x) => x.hours || x.revenue).length;
        rows.push({ ...c, key: c.clientId, name: cName(c.clientId), sub: n + (n === 1 ? ' project' : ' projects') + ' · ' + Math.round(c.hours).toLocaleString('en-IN') + ' h', depth: 0, expandable: true, scope: { client: c.clientId }, weight: 600 });
        if (open[c.clientId]) for (const pr of c.projects.filter((x) => x.hours || x.revenue)) {
          rows.push(projRow(pr, 1));
          if (open[pr.projectId]) people(pr, 2);
        }
      }
    } else if (view === 'project') {
      for (const pr of prof.projects.filter((x) => (client === 'All' || x.clientId === client) && (x.hours || x.revenue))) {
        const p = pOf(pr.projectId)!;
        rows.push(projRow(pr, 0, cName(p.clientId) + ' · ' + p.model + ' · ' + Math.round(pr.hours) + ' h'));
        if (open[pr.projectId]) people(pr, 1);
      }
    }
  }
  const pctOf = (f: { margin: number; revenue: number }) => (f.revenue ? (f.margin / f.revenue) * 100 : 0);
  const neg = Math.max(0, ...clients.map((x) => -x.margin)), pos = Math.max(0, ...clients.map((x) => x.margin)), span = neg + pos || 1, zero = (neg / span) * 100;
  const capacity = eachDay(P.from, P.to > '2026-11-06' ? '2026-11-06' : P.to).filter((x) => !isWeekend(x)).length * 8;
  const exportIt = () => {
    if (!prof) return;
    const list = view === 'employee' ? prof.employees.map((e) => [eOf(e.employeeId)?.name ?? '', Math.round(e.hours), Math.round(e.revenue), Math.round(e.labour), Math.round(e.margin)]) : rows.map((r) => ['  '.repeat(r.depth) + r.name, Math.round(r.hours), Math.round(r.revenue), Math.round(r.labour), Math.round(r.margin)]);
    downloadCsv('profitability-' + period + '.csv', ['Name', 'Hours', 'Revenue billed', 'Labour cost (estimated)', 'Margin'], list);
    say('Profitability · ' + P.label + ' exported as CSV');
  };
  const Fig = ({ v, scope, measure, className }: { v: number; scope: Record<string, string>; measure: string; className?: string }) => (
    <button className={'fig-link ' + (className ?? '')} title="See the timesheet entries behind this figure" onClick={() => go(drillHref(scope, measure))}>{inr(v)}</button>
  );

  return (
    <div className="wrap page" style={{ paddingBottom: 140 }}>
      <div className="ph">
        <div>
          <h1 className="display">Profitability</h1>
          <p className="ph-desc" style={{ maxWidth: 640 }}>Revenue billed, minus the fully loaded cost of every hour logged against it. Click any revenue, cost or margin figure to see the timesheet entries behind it.</p>
        </div>
        <button className="btn-dark" onClick={exportIt}>Export report</button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginTop: 32 }}>
        <div className="viewseg" style={{ marginTop: 0 }} role="tablist">
          {(['client', 'project', 'employee'] as View[]).map((v) => <button key={v} role="tab" aria-selected={view === v} className={view === v ? 'active' : ''} onClick={() => setView(v)}>By {v}</button>)}
        </div>
        <div style={{ flex: 1 }} />
        <select className="fselect" style={{ height: 38, maxWidth: 240 }} value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Period">{PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select>
        <select className="fselect" style={{ height: 38 }} value={client} onChange={(e) => setClient(e.target.value)} aria-label="Client"><option value="All">All clients</option>{d?.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      </div>
      <div className="sumband">
        {[['Revenue billed', lakh(T.revenue)], ['Labour cost', lakh(T.labour), true], ['Expenses', lakh(T.expenses)], ['Gross margin', lakh(T.margin), true], ['Margin', pctOf(T).toFixed(1) + '%', true]].map(([k, v, est]) => (
          <div key={k as string}><div className="k">{k}</div><div className="v">{prof ? v : '—'}{prof && est && <Est basis={EST} />}</div></div>
        ))}
      </div>
      {!prof && <div className="card" style={{ marginTop: 32 }}><SkeletonRows /></div>}
      {prof && view !== 'employee' && (
        <>
          <div className="card" style={{ marginTop: 32, padding: '24px 28px' }}>
            <div style={{ fontSize: 16, fontWeight: 600 }}>Margin by client</div>
            <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3 }}>Lowest first. Red is losing money.</div>
            <div style={{ marginTop: 20, display: 'grid', gap: 10 }}>
              {clients.map((c) => {
                const w = (Math.abs(c.margin) / span) * 100;
                return (
                  <div key={c.clientId} className="mchart">
                    <span className="ell">{cName(c.clientId)}</span>
                    <div style={{ position: 'relative', height: 16 }}>
                      <span style={{ position: 'absolute', left: zero + '%', top: -4, bottom: -4, borderLeft: '1px solid var(--line-strong)' }} />
                      <div style={{ position: 'absolute', left: (c.margin < 0 ? zero - w : zero) + '%', width: w + '%', top: 2, height: 12, borderRadius: 3, background: c.margin < 0 ? SC.red : '#3B4234' }} />
                    </div>
                    <span className="num" style={{ textAlign: 'right', color: c.margin < 0 ? SC.red : 'var(--ink-2)' }}>{lakh(c.margin)}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="card" style={{ marginTop: 16, overflowX: 'auto' }}>
            <div style={{ minWidth: 900 }}>
              <div className="pr-row pr-head"><span>Name</span><span className="r">Revenue billed</span><span className="r">Labour cost<Est basis={EST} /></span><span className="r">Expenses</span><span className="r">Gross margin</span><span>Margin %</span></div>
              {rows.map((r) => {
                const pc = r.revenue ? (r.margin / r.revenue) * 100 : 0;
                return (
                  <div key={r.key} className="pr-row">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingLeft: r.depth * 28, minWidth: 0 }}>
                      {r.expandable ? <button className="pr-exp" aria-label={(open[r.key] ? 'Collapse ' : 'Expand ') + r.name} aria-expanded={!!open[r.key]} onClick={() => setOpen({ ...open, [r.key]: !open[r.key] })}>{open[r.key] ? '−' : '+'}</button> : <span style={{ width: 24, flex: 'none', textAlign: 'center', color: 'var(--line-strong)' }}>·</span>}
                      <div style={{ minWidth: 0 }}><div style={{ fontWeight: r.weight, whiteSpace: 'nowrap' }}>{r.name}</div><div className="cell-sub">{r.sub}</div></div>
                    </div>
                    <Fig v={r.revenue} scope={r.scope} measure="revenue" />
                    <Fig v={r.labour} scope={r.scope} measure="labour" />
                    <span className="num r" style={{ color: 'var(--ink-3)' }}>{r.expenses ? inr(r.expenses) : '—'}</span>
                    <Fig v={r.margin} scope={r.scope} measure="margin" className={r.margin < 0 ? 'neg' : ''} />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div className="pr-bar"><div style={{ width: Math.min(100, (Math.abs(pc) / 60) * 100) + '%', background: pc < 0 ? SC.red : 'var(--violet)' }} /></div>
                      <span className="num" style={{ fontSize: 13, color: pc < 0 ? SC.red : 'var(--violet)', width: 52, textAlign: 'right' }}>{r.revenue ? pc.toFixed(1) + '%' : '—'}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
      {prof && view === 'employee' && (
        <>
          <div style={{ marginTop: 32, fontSize: 14, color: 'var(--ink-3)', maxWidth: 680, lineHeight: 1.55 }}>Capacity and utilisation, not a ranking. Listed alphabetically; capacity is {capacity.toLocaleString('en-IN')} hours for {P.label.replace(/^.*· /, '')}. Non-billable time is real work — hiring, guilds, pre-sales — and is costed the same way.</div>
          <div className="card" style={{ marginTop: 20, overflowX: 'auto' }}>
            <div style={{ minWidth: 940 }}>
              <div className="pe-row pr-head"><span>Person</span><span className="r">Hours</span><span>Billable · internal</span><span>Utilisation</span><span className="r">Revenue</span><span className="r">Loaded cost<Est basis={EST} /></span><span className="r">Contribution</span></div>
              {[...prof.employees].filter((e) => client === 'All' || d!.entries.some((x) => x.employeeId === e.employeeId && x.clientId === client)).sort((a, b) => (eOf(a.employeeId)?.name ?? '').localeCompare(eOf(b.employeeId)?.name ?? '')).map((e) => {
                const emp = eOf(e.employeeId);
                const util = (e.billableHours / capacity) * 100;
                return (
                  <div key={e.key} className="pe-row">
                    <span className="pcell"><span className="pcell-av">{initials(emp?.name)}</span><span><span style={{ display: 'block', fontWeight: 500 }}>{emp?.name}</span><span style={{ fontSize: 12, color: 'var(--muted)' }}>{emp?.title}</span></span></span>
                    <span className="num r">{hours(e.hours)}</span>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 5 }}><span className="pr-bar" style={{ height: 6, background: '#D6D9CD', flex: 'none' }}><span style={{ display: 'block', height: '100%', width: (e.billableHours / Math.max(1, e.hours)) * 100 + '%', background: SC.green }} /></span><span style={{ fontSize: 12, color: 'var(--muted)' }}>{Math.round(e.billableHours)} / {Math.round(e.hours - e.billableHours)} h</span></span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span className="pr-bar"><span style={{ display: 'block', height: '100%', width: Math.min(100, util) + '%', background: util > 95 ? SC.amber : 'var(--violet)' }} /></span><span style={{ fontSize: 12.5, width: 36, textAlign: 'right' }}>{Math.round(util)}%</span></span>
                    <Fig v={e.revenue} scope={{ employee: e.employeeId }} measure="revenue" />
                    <Fig v={e.labour} scope={{ employee: e.employeeId }} measure="labour" />
                    <Fig v={e.margin} scope={{ employee: e.employeeId }} measure="margin" className={e.margin < 0 ? 'neg' : ''} />
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
      <div className="pr-foot">
        <span style={{ fontWeight: 600, color: 'var(--ink)' }}>One timesheet entry, three destinations</span>
        <a href="#/app/people/payroll">Payroll cost →</a>
        <a href="#/app/finance/invoices/new">Client invoice line →</a>
        <a href="#/app/work/projects">Project margin →</a>
      </div>
    </div>
  );
}
const emptyFig = (): Figures => ({ revenue: 0, labour: 0, expenses: 0, margin: 0, pct: 0, hours: 0, billableHours: 0 });
