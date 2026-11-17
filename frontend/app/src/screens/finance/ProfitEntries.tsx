import { useMemo } from 'react';
import { DataTable, Mono, downloadCsv, type Column } from '../../components/DataTable';
import { ErrorState, Est, SkeletonRows } from '../../components/ui';
import { PERIODS, drill, inPeriod } from '../../data/selectors/profitability';
import { useAllEntries, useAllExpenses, useAllInvoices, useAllSalaryEvents, useClients, useEmployees, useProjects } from '../../hooks/data';
import { dmy, hours, inr } from '../../lib/format';
import { all } from '../../lib/query';

type Row = ReturnType<typeof drill>['rows'][number];
const MEASURE: Record<string, string> = { revenue: 'Revenue billed', labour: 'Labour cost', margin: 'Gross margin' };

/** The timesheet entries behind any profitability figure, with the arithmetic that reaches it. */
export default function ProfitEntries({ query }: { query: URLSearchParams }) {
  const q = all({ clients: useClients(), projects: useProjects(), emps: useEmployees(), entries: useAllEntries(), invoices: useAllInvoices(), expenses: useAllExpenses(), salaryEvents: useAllSalaryEvents() });
  const clientId = query.get('client') ?? undefined, projectId = query.get('project') ?? undefined, employeeId = query.get('employee') ?? undefined;
  const scope = useMemo(() => ({ clientId, projectId, employeeId }), [clientId, projectId, employeeId]);
  const measure = query.get('measure') ?? 'margin';
  const period = PERIODS.find((p) => p.key === query.get('period')) ?? PERIODS[0];
  const d = useMemo(() => (q.data ? drill(inPeriod(q.data, period), scope) : null), [q.data, period, scope]);

  if (q.error) return <div className="wrap page"><ErrorState error={q.error} retry={q.refetch} /></div>;
  const x = q.data;
  const proj = (id: string) => x?.projects.find((p) => p.id === id);
  const client = scope.clientId ? x?.clients.find((c) => c.id === scope.clientId)?.name : scope.projectId ? x?.clients.find((c) => c.id === proj(scope.projectId!)?.clientId)?.name : undefined;
  const person = scope.employeeId ? x?.emps.find((e) => e.id === scope.employeeId)?.name : undefined;
  const chips = [client && ['Client', client], scope.projectId && ['Project', proj(scope.projectId)?.name], person && ['Person', person], ['Period', period.label], ['Figure', MEASURE[measure]]].filter(Boolean) as [string, string][];
  const back = '/app/finance/profitability?' + new URLSearchParams({ period: period.key, view: scope.employeeId && !scope.projectId ? 'employee' : scope.projectId && !scope.clientId ? 'project' : 'client' }).toString();
  const value = d ? (measure === 'revenue' ? d.totals.revenue : measure === 'labour' ? d.totals.labour : d.totals.margin) : 0;
  const rows = d ? (measure === 'revenue' ? d.rows.filter((r) => r.revenue > 0) : d.rows) : undefined;
  const cols: Column<Row>[] = [
    { key: 'date', header: 'Date', render: (r) => <span className="nowrap">{dmy(r.entry.date)}</span>, sort: (r) => r.entry.date, mobile: true },
    { key: 'id', header: 'Entry', render: (r) => <Mono>{r.entry.id}</Mono>, sort: (r) => r.entry.id },
    { key: 'who', header: 'Person', render: (r) => <span className="nowrap">{x?.emps.find((e) => e.id === r.entry.employeeId)?.name}</span>, sort: (r) => r.entry.employeeId, mobile: true },
    { key: 'proj', header: 'Project · task', render: (r) => <div style={{ minWidth: 0 }}><div className="nowrap">{proj(r.entry.projectId)?.name}</div><div className="cell-sub">{r.entry.note}{r.entry.billable ? '' : ' · internal'}</div></div>, sort: (r) => r.entry.projectId },
    { key: 'h', header: 'Hours', align: 'right', render: (r) => <span className="num">{hours(r.entry.hours)}</span>, sort: (r) => r.entry.hours, mobile: true },
    { key: 'rate', header: 'Cost rate', align: 'right', render: (r) => <span className="num" style={{ color: 'var(--ink-3)' }}>{inr(r.costRate)}</span>, sort: (r) => r.costRate },
    { key: 'cost', header: 'Cost', align: 'right', render: (r) => <span className="num">{inr(r.cost)}</span>, sort: (r) => r.cost },
    { key: 'rev', header: 'Revenue', align: 'right', render: (r) => <span className="num">{r.invoiced ? inr(r.revenue) : <span style={{ color: 'var(--faint)' }}>not billed</span>}</span>, sort: (r) => r.revenue },
    { key: 'm', header: 'Margin', align: 'right', render: (r) => <span className="num" style={{ color: r.margin < 0 ? 'var(--red)' : undefined }}>{inr(r.margin)}</span>, sort: (r) => r.margin },
  ];
  const exportIt = () => d && downloadCsv('entries.csv', ['Date', 'Entry', 'Person', 'Project', 'Task', 'Hours', 'Cost rate (est.)', 'Cost (est.)', 'Revenue', 'Margin'],
    d.rows.map((r) => [r.entry.date, r.entry.id, x?.emps.find((e) => e.id === r.entry.employeeId)?.name ?? '', proj(r.entry.projectId)?.name ?? '', r.entry.note, r.entry.hours, Math.round(r.costRate), Math.round(r.cost), Math.round(r.revenue), Math.round(r.margin)]));
  return (
    <div className="wrap page" style={{ paddingBottom: 140 }}>
      <a href={'#' + back} className="back-link">← Back to profitability</a>
      <div className="ph" style={{ marginTop: 12 }}>
        <div>
          <h1 className="display">{MEASURE[measure]} · {d ? inr(value) : '…'}{measure !== 'revenue' && <Est basis="Cost uses estimated loaded cost rates (CTC × 1.4 ÷ 12 ÷ 140 h)." />}</h1>
          <p className="ph-desc">The timesheet entries behind this figure. Each entry’s revenue is its share, by hours, of the invoice line that billed it; its cost is hours × that person’s loaded cost rate in the month it was logged.</p>
        </div>
        <button className="btn-line" onClick={exportIt}>Export entries</button>
      </div>
      <div className="fband" aria-label="Filters applied">
        {chips.map(([k, v]) => <span key={k}><i>{k}</i>{v}</span>)}
      </div>
      {!d ? <div className="card" style={{ marginTop: 24 }}><SkeletonRows /></div> : (
        <>
          <div className="recon">
            <div><span>{d.rows.length.toLocaleString('en-IN')} entries · {hours(d.totals.hours)}</span><span /></div>
            <div><span>Revenue attributed to these entries</span><span className="num">{inr(d.totals.entryRevenue)}</span></div>
            {measure !== 'labour' && d.other.length > 0 && <div><span>+ Revenue not tied to hours ({d.other.length} {d.other.length === 1 ? 'line' : 'lines'})</span><span className="num">{inr(d.other.reduce((a, o) => a + o.amount, 0))}</span></div>}
            {measure !== 'revenue' && <div><span>− Labour cost of these entries<Est basis="Hours × loaded cost rate" /></span><span className="num">{inr(d.totals.labour)}</span></div>}
            {measure === 'margin' && d.expenses.length > 0 && <div><span>− Expenses ({d.expenses.length} {d.expenses.length === 1 ? 'claim' : 'claims'})</span><span className="num">{inr(d.totals.expenses)}</span></div>}
            <div className="tot"><span>= {MEASURE[measure]}</span><span className="num">{inr(value)}</span></div>
          </div>
          <DataTable rows={rows} columns={cols} rowKey={(r) => r.entry.id} pageSize={50} initialSort={{ key: 'date', dir: 'desc' }} empty={{ title: 'No entries in this scope and period.' }} />
          {measure !== 'labour' && d.other.length > 0 && (
            <div style={{ marginTop: 32 }}>
              <div className="section-title">Revenue not tied to hours</div>
              {d.other.map((o, i) => <div key={i} className="kv" style={{ gridTemplateColumns: '120px 1fr auto' }}><span className="mono">{o.ref}</span><span>{o.label}</span><span className="num">{inr(o.amount)}</span></div>)}
            </div>
          )}
          {measure === 'margin' && d.expenses.length > 0 && (
            <div style={{ marginTop: 32 }}>
              <div className="section-title">Expenses in this scope</div>
              {d.expenses.map((e) => <a key={e.id} href={'#/app/finance/expenses/' + e.id} className="kv" style={{ gridTemplateColumns: '120px 1fr auto' }}><span className="mono">{e.id}</span><span>{e.description}</span><span className="num">{inr(e.amount)}</span></a>)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
