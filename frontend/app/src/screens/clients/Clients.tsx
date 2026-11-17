import { useMemo, useState } from 'react';
import { DataTable, Mono, PersonCell, Status, TextCell, type Column } from '../../components/DataTable';
import { DocumentTable } from '../../components/DocumentTable';
import { FilterBar } from '../../components/FilterBar';
import { KanbanBoard } from '../../components/KanbanBoard';
import { PageHeader, Tabs } from '../../components/PageHeader';
import { ActivityFeed, KVList, type FeedItem } from '../../components/Panels';
import { ErrorState, Est, SkeletonRows, StatusLabel } from '../../components/ui';
import * as api from '../../data/repositories';
import { ageingOf, invoiceTotals } from '../../data/selectors/finance';
import { profitability } from '../../data/selectors/profitability';
import type { Client, Contract, Lead, LeadStage, Ticket } from '../../data/types';
import { useAllEntries, useAllExpenses, useAllInvoices, useAllSalaryEvents, useClients, useEmployees, useMe, useProjects } from '../../hooks/data';
import { NOW, daysBetween } from '../../lib/dates';
import { SC, ago, dm, dmy, inr, lakh, pct, timeOf } from '../../lib/format';
import { all, invalidate, useQuery } from '../../lib/query';
import { go, useApp } from '../../state/store';

function useClientData() {
  return all({ me: useMe(), clients: useClients(), projects: useProjects(), emps: useEmployees(), invoices: useAllInvoices(), entries: useAllEntries(), expenses: useAllExpenses(), salaryEvents: useAllSalaryEvents(), tickets: useQuery(['tickets', 'all'], () => api.getTickets()) });
}
const healthOf = (c: Client, d: NonNullable<ReturnType<typeof useClientData>['data']>) => {
  const late = d.invoices.filter((i) => i.clientId === c.id && (ageingOf(i, d.me.today) === '61–90' || ageingOf(i, d.me.today) === '90+'));
  const breached = d.tickets.filter((t) => t.clientId === c.id && t.status !== 'Resolved' && t.slaDue < NOW);
  return late.length ? 'At risk' : breached.length ? 'Needs attention' : 'Healthy';
};

export function Accounts() {
  const q = useClientData();
  const [search, setSearch] = useState('');
  const [ind, setInd] = useState('');
  if (q.error) return <div className="wrap page"><ErrorState error={q.error} retry={q.refetch} /></div>;
  const d = q.data;
  const stateOf = (id: string) => d?.clients.find((c) => c.id === id);
  const ltv = (c: Client) => d!.invoices.filter((i) => i.clientId === c.id && i.status !== 'Void').reduce((a, i) => a + invoiceTotals(i, c).subtotal, 0);
  const owed = (c: Client) => d!.invoices.filter((i) => i.clientId === c.id && i.status !== 'Draft' && i.status !== 'Void').reduce((a, i) => a + invoiceTotals(i, stateOf(i.clientId)).balance, 0);
  const rows = d?.clients.filter((c) => (!search || c.name.toLowerCase().includes(search.toLowerCase())) && (!ind || c.industry === ind));
  const cols: Column<Client>[] = [
    { key: 'c', header: 'Client', render: (c) => <PersonCell name={c.name} sub={c.industry + ' · ' + c.city} />, sort: (c) => c.name, mobile: true },
    { key: 'o', header: 'Owner', render: (c) => d!.emps.find((e) => e.id === c.ownerId)?.name },
    { key: 'p', header: 'Active projects', align: 'right', render: (c) => <span className="num">{d!.projects.filter((p) => p.clientId === c.id && p.status === 'Active').length}</span> },
    { key: 'l', header: 'Lifetime value', align: 'right', render: (c) => <span className="num">{inr(ltv(c))}</span>, sort: ltv, mobile: true },
    { key: 'ow', header: 'Outstanding', align: 'right', render: (c) => <span className="num">{inr(owed(c))}</span>, sort: owed },
    { key: 'h', header: 'Health', render: (c) => <Status label={healthOf(c, d!)} colour={healthOf(c, d!) === 'Healthy' ? 'green' : healthOf(c, d!) === 'At risk' ? 'red' : 'amber'} />, mobile: true },
  ];
  return (
    <div className="wrap page" style={{ paddingBottom: 140 }}>
      <PageHeader title="Accounts" desc={(d?.clients.filter((c) => c.status === 'Active').length ?? '—') + ' active clients. Lifetime value is everything invoiced, before tax.'} />
      <FilterBar search={search} onSearch={setSearch} filters={[{ key: 'i', label: 'Industries', options: [...new Set(d?.clients.map((c) => c.industry))].sort(), value: ind, onChange: setInd }]} />
      <DataTable rows={rows} columns={cols} rowKey={(c) => c.id} onOpen={(c) => go('/app/clients/accounts/' + c.id)} />
    </div>
  );
}

const ACC_TABS = ['overview', 'contacts', 'projects', 'invoices', 'documents', 'activity'] as const;
export function Account({ id, tab: raw }: { id: string; tab?: string }) {
  const { role } = useApp();
  const q = useClientData();
  const cq = useQuery(['clients', 'one', id], () => api.getClient(id));
  const prof = useMemo(() => (q.data ? profitability(q.data) : null), [q.data]);
  const tab = (ACC_TABS as readonly string[]).includes(raw ?? '') ? raw! : 'overview';
  if (cq.error) return <div className="wrap page"><ErrorState error={cq.error} retry={cq.refetch} /></div>;
  if (q.error) return <div className="wrap page"><ErrorState error={q.error} retry={q.refetch} /></div>;
  const d = cq.data ? q.data : undefined;
  const c = cq.data;
  const invs = d?.invoices.filter((i) => i.clientId === id) ?? [];
  const owed = invs.filter((i) => i.status !== 'Draft').reduce((a, i) => a + invoiceTotals(i, c).balance, 0);
  const fig = prof?.clients.find((x) => x.clientId === id);
  const feed: FeedItem[] = d && c ? [
    ...invs.map((i) => ({ id: i.id, at: i.issued, who: d.emps.find((e) => e.id === 'E-0124')?.name ?? 'Finance', text: i.number + ' issued · ' + inr(invoiceTotals(i, c).total), href: '/app/finance/invoices/' + i.id })),
    ...invs.flatMap((i) => i.payments.map((p) => ({ id: p.id, at: p.date, who: c.contacts[0].name, text: 'Paid ' + inr(p.amount) + ' against ' + i.number + ' · ' + p.method, href: '/app/finance/invoices/' + i.id }))),
    ...d.tickets.filter((t) => t.clientId === id).map((t) => ({ id: t.id, at: t.opened.slice(0, 10), who: c.contacts[0].name, text: t.id + ' raised · ' + t.subject, href: '/app/clients/tickets/' + t.id })),
  ].sort((a, b) => b.at.localeCompare(a.at)).map((x) => ({ ...x, at: dmy(x.at) })) : [];
  return (
    <div className="wrap page" style={{ paddingBottom: 140 }}>
      {!c || !d ? <SkeletonRows /> : (
        <>
          <div className="ph">
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}><h1 className="pf-name">{c.name}</h1><StatusLabel label={healthOf(c, d)} colour={healthOf(c, d) === 'Healthy' ? 'green' : healthOf(c, d) === 'At risk' ? 'red' : 'amber'} /></div>
              <div className="pf-meta"><span>{c.industry}</span><span>{c.city}, {c.state}</span><span className="mono" style={{ fontSize: 13 }}>{c.gstin}</span><span>Client since {dmy(c.since)}</span></div>
            </div>
            {role === 'Admin' && <a className="btn-dark" href={'#/app/finance/invoices/new?client=' + id}>New invoice</a>}
          </div>
          <div className="pj-strip">
            <div><span>Invoiced to date</span><b>{fig ? lakh(fig.revenue) : '—'}</b></div>
            <div><span>Outstanding</span><b>{lakh(owed)}</b><i>{invs.filter((i) => i.status === 'Overdue').length} overdue</i></div>
            {role === 'Admin' && <div><span>Margin<Est basis="Labour at estimated loaded cost rates" /></span><b>{fig ? pct(fig.pct) : '—'}</b><i>{fig && <a className="ulink" href={'#/app/finance/profitability/entries?client=' + id + '&measure=margin&period=all'}>{lakh(fig.margin)}</a>}</i></div>}
            <div><span>Open tickets</span><b>{d.tickets.filter((t) => t.clientId === id && t.status !== 'Resolved').length}</b></div>
          </div>
          <Tabs current={tab} tabs={ACC_TABS.map((t) => ({ key: t, label: t[0].toUpperCase() + t.slice(1), href: '/app/clients/accounts/' + id + (t === 'overview' ? '' : '/' + t) }))} />
          {tab === 'overview' && (
            <div className="pf-grid">
              <div><div className="section-title">Account</div><KVList rows={[['Owner', d.emps.find((e) => e.id === c.ownerId)?.name], ['Payment terms', 'Net ' + c.paymentTermsDays], ['GSTIN', <Mono key="g">{c.gstin}</Mono>], ['Place of supply', c.state]]} /></div>
              <div><div className="section-title">Primary contact</div><KVList rows={[['Name', c.contacts[0].name], ['Title', c.contacts[0].title], ['Email', c.contacts[0].email], ['Phone', c.contacts[0].phone]]} /></div>
              <div><div className="section-title">Active projects</div>{d.projects.filter((p) => p.clientId === id && p.status === 'Active').map((p) => <a key={p.id} href={'#/app/work/projects/' + p.id} className="kv" style={{ gridTemplateColumns: '1fr auto' }}><span style={{ color: 'var(--ink)' }}>{p.name}</span><StatusLabel label={p.health} /></a>)}</div>
            </div>
          )}
          {tab === 'contacts' && (
            <div style={{ marginTop: 24 }}><DataTable rows={c.contacts} rowKey={(k) => k.id} columns={[
              { key: 'n', header: 'Name', render: (k) => <PersonCell name={k.name} sub={k.primary ? 'Primary contact' : undefined} />, mobile: true },
              { key: 't', header: 'Title', render: (k) => k.title, mobile: true },
              { key: 'e', header: 'Email', render: (k) => <a className="ulink" href={'mailto:' + k.email}>{k.email}</a>, mobile: true },
              { key: 'p', header: 'Phone', render: (k) => <span className="nowrap">{k.phone}</span> },
            ]} /></div>
          )}
          {tab === 'projects' && (
            <div style={{ marginTop: 24 }}><DataTable rows={d.projects.filter((p) => p.clientId === id)} rowKey={(p) => p.id} onOpen={(p) => go('/app/work/projects/' + p.id)} columns={[
              { key: 'n', header: 'Project', render: (p) => <TextCell text={<b style={{ fontWeight: 500 }}>{p.name}</b>} sub={p.id} />, mobile: true },
              { key: 'm', header: 'Billing', render: (p) => p.model },
              { key: 'd', header: 'Dates', render: (p) => dm(p.start) + ' – ' + dmy(p.end) },
              { key: 'r', header: 'Invoiced', align: 'right', render: (p) => <span className="num">{inr(prof?.projects.find((x) => x.projectId === p.id)?.revenue ?? 0)}</span>, mobile: true },
              { key: 'h', header: 'Health', render: (p) => <Status label={p.health} />, mobile: true },
            ]} /></div>
          )}
          {tab === 'invoices' && (
            <div style={{ marginTop: 24 }}><DataTable rows={[...invs].sort((a, b) => b.issued.localeCompare(a.issued))} rowKey={(i) => i.id} onOpen={(i) => go('/app/finance/invoices/' + i.id)} columns={[
              { key: 'n', header: 'Invoice', render: (i) => <Mono>{i.number}</Mono>, mobile: true },
              { key: 'i', header: 'Issued', render: (i) => dmy(i.issued) },
              { key: 'd', header: 'Due', render: (i) => dmy(i.due) },
              { key: 't', header: 'Total', align: 'right', render: (i) => <span className="num">{inr(invoiceTotals(i, c).total)}</span>, mobile: true },
              { key: 'b', header: 'Balance', align: 'right', render: (i) => <span className="num">{inr(invoiceTotals(i, c).balance)}</span> },
              { key: 's', header: 'Status', render: (i) => <Status label={i.status} />, mobile: true },
            ]} /></div>
          )}
          {tab === 'documents' && <div style={{ marginTop: 24 }}><DocumentTable ownerType="client" ownerId={id} /></div>}
          {tab === 'activity' && <div style={{ marginTop: 24, maxWidth: 760 }}><ActivityFeed items={feed} /></div>}
        </>
      )}
    </div>
  );
}

// ---------------- leads ----------------
const STAGES: LeadStage[] = ['New', 'Qualified', 'Proposal sent', 'Negotiation', 'Won', 'Lost'];
export function Leads({ board }: { board?: boolean }) {
  const { say } = useApp();
  const q = all({ me: useMe(), leads: useQuery(['leads'], api.getLeads), emps: useEmployees() });
  const [search, setSearch] = useState('');
  if (q.error) return <div className="wrap page"><ErrorState error={q.error} retry={q.refetch} /></div>;
  const d = q.data;
  const rows = d?.leads.filter((l) => !search || (l.company + l.contact).toLowerCase().includes(search.toLowerCase()));
  const open = d?.leads.filter((l) => l.stage !== 'Won' && l.stage !== 'Lost') ?? [];
  const inStage = (l: Lead) => (d ? daysBetween(l.stageSince, d.me.today) : 0);
  const move = async (id: string, stage: string) => { const l = d?.leads.find((x) => x.id === id); if (!l || l.stage === stage) return; await api.moveLead(id, stage as LeadStage); invalidate('leads', 'audit'); say(l.company + ' moved to ' + stage); };
  return (
    <div className="wrap page" style={{ paddingBottom: 140, maxWidth: board ? 1440 : undefined }}>
      <PageHeader title="Leads" desc={open.length + ' deals in play, ' + lakh(open.reduce((a, l) => a + l.value, 0)) + ' in total.'}
        views={[{ label: 'Table', href: '/app/clients/leads' }, { label: 'Board', href: '/app/clients/leads/board' }]} current={board ? '/app/clients/leads/board' : '/app/clients/leads'} />
      <div className="funnel" aria-label="Pipeline by stage">
        {STAGES.map((s) => {
          const ls = d?.leads.filter((l) => l.stage === s) ?? [];
          const v = ls.reduce((a, l) => a + l.value, 0);
          return <div key={s} className={s === 'Lost' ? 'lost' : ''}><span>{s}</span><b>{lakh(v)}</b><i>{ls.length} {ls.length === 1 ? 'deal' : 'deals'}</i></div>;
        })}
      </div>
      <FilterBar search={search} onSearch={setSearch} />
      {board ? (!rows ? <SkeletonRows /> : (
        <KanbanBoard columns={STAGES.map((s) => ({ key: s, label: s }))} items={rows} colOf={(l) => l.stage} idOf={(l) => l.id} onMove={move} onOpen={(l) => go('/app/clients/leads/' + l.id)} minColWidth={210}
          hint="Drag deals between stages, or focus a card and use ← →."
          render={(l) => (
            <>
              <div className="kc-top"><span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{l.source}</span><span className="num" style={{ fontSize: 12.5, fontWeight: 500 }}>{lakh(l.value)}</span></div>
              <div className="kc-title">{l.company}</div>
              <div className="kc-foot"><span style={{ color: inStage(l) > 21 && l.stage !== 'Won' && l.stage !== 'Lost' ? SC.amber : undefined }}>{inStage(l)} days in stage</span><span style={{ flex: 1 }} /><span>{l.probability}%</span></div>
            </>
          )} />
      )) : (
        <DataTable rows={rows} rowKey={(l) => l.id} onOpen={(l) => go('/app/clients/leads/' + l.id)} columns={[
          { key: 'c', header: 'Company', render: (l) => <PersonCell name={l.company} sub={l.contact} />, sort: (l) => l.company, mobile: true },
          { key: 's', header: 'Stage', render: (l) => <Status label={l.stage} />, sort: (l) => STAGES.indexOf(l.stage), mobile: true },
          { key: 'v', header: 'Value', align: 'right', render: (l) => <span className="num">{inr(l.value)}</span>, sort: (l) => l.value, mobile: true },
          { key: 'o', header: 'Owner', render: (l) => d!.emps.find((e) => e.id === l.ownerId)?.name },
          { key: 'p', header: 'Probability', align: 'right', render: (l) => <span className="num">{l.probability}%</span> },
          { key: 'i', header: 'In stage', render: (l) => <Status label={inStage(l) + ' days'} colour={l.stage === 'Won' || l.stage === 'Lost' ? 'gray' : inStage(l) > 21 ? 'amber' : 'gray'} />, sort: inStage },
        ]} />
      )}
    </div>
  );
}

export function LeadDetail({ id }: { id: string }) {
  const { say } = useApp();
  const q = all({ me: useMe(), lead: useQuery(['leads', id], () => api.getLead(id)), emps: useEmployees() });
  if (q.error) return <div className="wrap page"><ErrorState error={q.error} retry={q.refetch} /></div>;
  const l = q.data?.lead;
  const move = async (s: LeadStage) => { if (!l) return; await api.moveLead(l.id, s); invalidate('leads', 'audit'); say(l.company + ' moved to ' + s); };
  const nm = (eid: string) => q.data?.emps.find((e) => e.id === eid)?.name ?? eid;
  return (
    <div className="wrap page" style={{ paddingBottom: 140, maxWidth: 960 }}>
      {!l || !q.data ? <SkeletonRows /> : (
        <>
          <PageHeader title={l.company} desc={l.contact + ' · ' + l.source + ' · created ' + dmy(l.created)} aside={<StatusLabel label={l.stage} />} />
          <div className="pj-strip">
            <div><span>Value</span><b>{inr(l.value)}</b></div>
            <div><span>Probability</span><b>{l.probability}%</b><i>weighted {lakh((l.value * l.probability) / 100)}</i></div>
            <div><span>In stage</span><b>{daysBetween(l.stageSince, q.data.me.today)} days</b><i>since {dm(l.stageSince)}</i></div>
            <div><span>Owner</span><b style={{ fontSize: 16 }}>{nm(l.ownerId)}</b></div>
          </div>
          <div className="section-title" style={{ marginTop: 32 }}>Move to stage</div>
          <div className="viewseg" style={{ marginTop: 8 }}>{STAGES.map((s) => <button key={s} className={l.stage === s ? 'active' : ''} aria-pressed={l.stage === s} onClick={() => move(s)}>{s}</button>)}</div>
          <div className="section-title" style={{ marginTop: 32 }}>Notes</div>
          <p style={{ fontSize: 14, lineHeight: 1.55, margin: 0 }}>{l.notes}</p>
          <div className="section-title" style={{ marginTop: 32 }}>Activity</div>
          <ActivityFeed items={[...l.activity].reverse().map((a, i) => ({ id: String(i), at: dmy(a.at), who: nm(a.byId), text: a.text }))} />
        </>
      )}
    </div>
  );
}

// ---------------- contracts ----------------
export function Contracts() {
  const q = all({ me: useMe(), contracts: useQuery(['contracts'], api.getContracts), clients: useClients() });
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('');
  if (q.error) return <div className="wrap page"><ErrorState error={q.error} retry={q.refetch} /></div>;
  const today = q.data?.me.today ?? '';
  const cName = (id: string) => q.data?.clients.find((c) => c.id === id)?.name ?? '';
  const days = (c: Contract) => daysBetween(today, c.end);
  const marker = (c: Contract) => {
    const n = days(c);
    if (n < 0 || c.status === 'Expired') return <Status label={'Expired ' + dm(c.end)} colour="red" />;
    if (n <= 30) return <Status label={'Ends in ' + n + ' days'} colour="red" />;
    if (n <= 60) return <Status label={'Ends in ' + n + ' days'} colour="amber" />;
    return <Status label="Active" colour="green" />;
  };
  const rows = q.data?.contracts.filter((c) => (!search || (cName(c.clientId) + c.title).toLowerCase().includes(search.toLowerCase())) && (!kind || c.kind === kind)).sort((a, b) => a.end.localeCompare(b.end));
  return (
    <div className="wrap page" style={{ paddingBottom: 140 }}>
      <PageHeader title="Contracts" desc="Sorted by expiry, soonest first. Amber within 60 days, red within 30 or lapsed." />
      <FilterBar search={search} onSearch={setSearch} filters={[{ key: 'k', label: 'Types', options: ['MSA', 'SOW', 'AMC', 'NDA'], value: kind, onChange: setKind }]} />
      <DataTable rows={rows} rowKey={(c) => c.id} onOpen={(c) => go('/app/clients/accounts/' + c.clientId + '/documents')} rowClass={(c) => (days(c) <= 30 ? 'row-red' : days(c) <= 60 ? 'row-amber' : '')} columns={[
        { key: 'c', header: 'Client', render: (c) => <span className="nowrap" style={{ fontWeight: 500 }}>{cName(c.clientId)}</span>, sort: (c) => cName(c.clientId), mobile: true },
        { key: 't', header: 'Contract', render: (c) => <TextCell text={c.title} sub={'SLA ' + c.slaResponseHours + ' h response · ' + c.slaResolutionHours + ' h resolution'} /> },
        { key: 'k', header: 'Type', render: (c) => c.kind },
        { key: 'v', header: 'Value', align: 'right', render: (c) => <span className="num">{c.value ? inr(c.value) : '—'}</span> },
        { key: 'e', header: 'Ends', render: (c) => dmy(c.end), sort: (c) => c.end, mobile: true },
        { key: 'a', header: 'Auto-renew', render: (c) => (c.autoRenew ? 'Yes' : 'No') },
        { key: 's', header: 'Status', render: marker, mobile: true },
      ]} />
    </div>
  );
}

// ---------------- tickets ----------------
export const slaLeft = (t: Ticket) => {
  if (t.status === 'Resolved') return { label: 'Met', colour: 'green' as const, mins: Infinity };
  const m = Math.round((Date.parse(t.slaDue) - Date.parse(NOW)) / 6e4);
  if (m < 0) return { label: 'Breached ' + fmtMins(-m) + ' ago', colour: 'red' as const, mins: m };
  return { label: fmtMins(m) + ' left', colour: m < 120 ? ('amber' as const) : ('gray' as const), mins: m };
};
const fmtMins = (m: number) => (m >= 1440 ? Math.floor(m / 1440) + 'd ' + Math.floor((m % 1440) / 60) + 'h' : m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + 'm');

export function Tickets() {
  const q = all({ tickets: useQuery(['tickets', 'all'], () => api.getTickets()), clients: useClients(), emps: useEmployees() });
  const [search, setSearch] = useState('');
  const [f, setF] = useState({ client: '', priority: '', status: '' });
  if (q.error) return <div className="wrap page"><ErrorState error={q.error} retry={q.refetch} /></div>;
  const cName = (id: string) => q.data?.clients.find((c) => c.id === id)?.name ?? '';
  const rows = q.data?.tickets.filter((t) => (!search || (t.id + t.subject).toLowerCase().includes(search.toLowerCase())) && (!f.client || cName(t.clientId) === f.client) && (!f.priority || t.priority === f.priority) && (!f.status || t.status === f.status));
  const openN = q.data?.tickets.filter((t) => t.status !== 'Resolved').length ?? 0;
  return (
    <div className="wrap page" style={{ paddingBottom: 140 }}>
      <PageHeader title="Tickets" desc={openN + ' open. SLA clocks run against each client’s contract.'} />
      <FilterBar search={search} onSearch={setSearch} filters={[
        { key: 'c', label: 'Clients', options: q.data?.clients.map((c) => c.name) ?? [], value: f.client, onChange: (v) => setF({ ...f, client: v }) },
        { key: 'p', label: 'Priorities', options: ['Urgent', 'High', 'Medium', 'Low'], value: f.priority, onChange: (v) => setF({ ...f, priority: v }) },
        { key: 's', label: 'Statuses', options: ['Open', 'In progress', 'Waiting on client', 'Resolved'], value: f.status, onChange: (v) => setF({ ...f, status: v }) },
      ]} />
      <DataTable rows={rows} rowKey={(t) => t.id} onOpen={(t) => go('/app/clients/tickets/' + t.id)} initialSort={{ key: 'sla', dir: 'asc' }} columns={[
        { key: 'id', header: 'ID', render: (t) => <Mono>{t.id}</Mono>, sort: (t) => t.id },
        { key: 's', header: 'Subject', render: (t) => <TextCell text={t.subject} />, mobile: true },
        { key: 'c', header: 'Client', render: (t) => <span className="nowrap">{cName(t.clientId)}</span>, sort: (t) => cName(t.clientId) },
        { key: 'p', header: 'Priority', render: (t) => <Status label={t.priority} />, sort: (t) => ['Urgent', 'High', 'Medium', 'Low'].indexOf(t.priority) },
        { key: 'a', header: 'Assignee', render: (t) => <span className="nowrap">{q.data!.emps.find((e) => e.id === t.assigneeId)?.name}</span> },
        { key: 'sla', header: 'SLA', render: (t) => <Status label={slaLeft(t).label} colour={slaLeft(t).colour} />, sort: (t) => slaLeft(t).mins, mobile: true },
        { key: 'st', header: 'Status', render: (t) => <Status label={t.status} />, mobile: true },
      ]} />
    </div>
  );
}

export function TicketDetail({ id }: { id: string }) {
  const { say } = useApp();
  const q = all({ t: useQuery(['tickets', id], () => api.getTicket(id)), clients: useClients(), emps: useEmployees() });
  const [text, setText] = useState('');
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  if (q.error) return <div className="wrap page"><ErrorState error={q.error} retry={q.refetch} /></div>;
  const t = q.data?.t;
  const client = q.data?.clients.find((c) => c.id === t?.clientId);
  const send = async () => {
    if (!t || !text.trim()) return;
    setBusy(true);
    try { await api.replyToTicket(t.id, text.trim(), internal); invalidate('tickets'); setText(''); say(internal ? 'Internal note added' : 'Reply sent to ' + client?.contacts[0].name); } finally { setBusy(false); }
  };
  const setStatus = async (s: Ticket['status']) => { if (!t) return; await api.setTicketStatus(t.id, s); invalidate('tickets'); say(t.id + ' · ' + s); };
  return (
    <div className="wrap page" style={{ paddingBottom: 140, maxWidth: 1100 }}>
      {!t || !q.data ? <SkeletonRows /> : (
        <>
          <PageHeader title={t.subject} desc={<><span className="mono">{t.id}</span> · <a className="ulink" href={'#/app/clients/accounts/' + t.clientId}>{client?.name}</a> · opened {ago(t.opened)}</>} />
          <div style={{ display: 'flex', gap: 40, flexWrap: 'wrap', marginTop: 32, alignItems: 'flex-start' }}>
            <div style={{ flex: '1 1 520px', minWidth: 0 }}>
              <div className="thread">
                {t.messages.map((m) => (
                  <div key={m.id} className={'msg' + (m.internal ? ' internal' : '') + (m.authorId ? ' ours' : '')}>
                    <div className="msg-h"><b>{m.authorId ? q.data!.emps.find((e) => e.id === m.authorId)?.name ?? m.author : m.author}</b><span>{dmy(m.at.slice(0, 10))} · {timeOf(m.at)}{m.internal ? ' · internal note, not visible to the client' : ''}</span></div>
                    <div className="msg-b">{m.text}</div>
                  </div>
                ))}
              </div>
              {t.status !== 'Resolved' && (
                <div className={'composer' + (internal ? ' internal' : '')}>
                  <div className="viewseg" style={{ marginTop: 0 }} role="group" aria-label="Reply visibility">
                    <button className={!internal ? 'active' : ''} aria-pressed={!internal} onClick={() => setInternal(false)}>Reply to client</button>
                    <button className={internal ? 'active' : ''} aria-pressed={internal} onClick={() => setInternal(true)}>Internal note</button>
                  </div>
                  <textarea className="input" rows={4} style={{ height: 'auto', padding: '10px 12px', marginTop: 10 }} value={text} onChange={(e) => setText(e.target.value)} placeholder={internal ? 'Only your team sees this.' : 'Write to ' + client?.contacts[0].name + '…'} aria-label="Message" />
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}><button className="btn-dark" disabled={busy || !text.trim()} onClick={send}>{internal ? 'Add note' : 'Send reply'}</button></div>
                </div>
              )}
            </div>
            <aside style={{ flex: '0 1 300px', minWidth: 240 }}>
              <div className="section-title">Ticket</div>
              <KVList w={100} rows={[['SLA', <StatusLabel key="s" label={slaLeft(t).label} colour={slaLeft(t).colour} />], ['Due', dmy(t.slaDue.slice(0, 10)) + ' · ' + timeOf(t.slaDue)], ['Priority', <StatusLabel key="p" label={t.priority} />], ['Assignee', q.data.emps.find((e) => e.id === t.assigneeId)?.name], ['Status', t.status]]} />
              <div className="section-title" style={{ marginTop: 24 }}>Set status</div>
              <div style={{ display: 'grid', gap: 6 }}>{(['Open', 'In progress', 'Waiting on client', 'Resolved'] as const).map((s) => <button key={s} className="btn-line" style={{ textAlign: 'left' }} disabled={t.status === s} onClick={() => setStatus(s)}>{s}</button>)}</div>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
