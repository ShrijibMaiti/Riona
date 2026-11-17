import { useMemo, useState } from 'react';
import { BlocksCell, DataTable, Status, TextCell, type Column } from '../../components/DataTable';
import { DocumentTable } from '../../components/DocumentTable';
import { FilterBar } from '../../components/FilterBar';
import { KanbanBoard } from '../../components/KanbanBoard';
import { PageHeader, Tabs } from '../../components/PageHeader';
import { DetailPanel } from '../../components/Panels';
import { TimelineGantt } from '../../components/TimelineGantt';
import { ErrorState, Est, SkeletonRows, StatusLabel } from '../../components/ui';
import * as api from '../../data/repositories';
import { profitability } from '../../data/selectors/profitability';
import type { Employee, Project, Task, TaskStatus } from '../../data/types';
import { useAllEntries, useAllExpenses, useAllInvoices, useAllSalaryEvents, useClients, useEmployees, useMe, useProjects } from '../../hooks/data';
import { SC, ago, dm, dmy, hours, initials, lakh } from '../../lib/format';
import { all, invalidate, useQuery } from '../../lib/query';
import { go, useApp } from '../../state/store';

const COLS: { key: TaskStatus; label: string; wip?: number }[] = [
  { key: 'todo', label: 'To do' }, { key: 'progress', label: 'In progress', wip: 3 }, { key: 'review', label: 'In review' }, { key: 'done', label: 'Done' },
];
const PRI: Record<string, string> = { Urgent: SC.red, High: SC.red, Medium: SC.amber, Low: SC.gray };
const COLC: Record<TaskStatus, string> = { todo: SC.gray, progress: SC.blue, review: SC.amber, done: SC.green };
const EST = 'Spend and margin use estimated loaded cost rates (CTC × 1.4 ÷ 12 ÷ 140 h).';

function useWorkData() {
  return all({ me: useMe(), projects: useProjects(), clients: useClients(), emps: useEmployees(), entries: useAllEntries(), invoices: useAllInvoices(), expenses: useAllExpenses(), salaryEvents: useAllSalaryEvents() });
}
function useProfit(d: ReturnType<typeof useWorkData>['data']) {
  return useMemo(() => (d ? profitability(d) : null), [d]);
}

export function ProjectsList() {
  const { role } = useApp();
  const q = useWorkData();
  const tasks = useQuery(['tasks', 'all'], () => api.getTasks());
  const prof = useProfit(q.data);
  const [search, setSearch] = useState('');
  const [f, setF] = useState({ health: '', model: '', client: '' });
  if (q.error) return <div className="wrap page"><ErrorState error={q.error} retry={q.refetch} /></div>;
  const d = q.data;
  const meId = d?.me.employee.id;
  const cName = (id: string) => d?.clients.find((c) => c.id === id)?.name ?? '';
  // Employees see projects they work on; everyone else sees all.
  const rows = d?.projects.filter((p) => (role !== 'Employee' || p.team.some((m) => m.employeeId === meId)) && (!search || (p.name + cName(p.clientId)).toLowerCase().includes(search.toLowerCase())) &&
    (!f.health || p.health === f.health) && (!f.model || p.model === f.model) && (!f.client || cName(p.clientId) === f.client));
  const progress = (p: Project) => { const ts = tasks.data?.filter((t) => t.projectId === p.id) ?? []; return ts.length ? Math.round((ts.filter((t) => t.status === 'done').length / ts.length) * 100) : 0; };
  const used = (p: Project) => { const r = prof?.projects.find((x) => x.projectId === p.id); return r ? Math.round(((r.labour + r.expenses) / p.budget) * 100) : 0; };
  const cols: Column<Project>[] = [
    { key: 'p', header: 'Project', render: (p) => <TextCell text={<b style={{ fontWeight: 500 }}>{p.name}</b>} sub={cName(p.clientId) + ' · ' + p.id} />, sort: (p) => p.name, mobile: true },
    { key: 'm', header: 'Manager', render: (p) => <span className="nowrap">{d!.emps.find((e) => e.id === p.managerId)?.name}</span> },
    { key: 'd', header: 'Dates', render: (p) => <span className="nowrap">{dm(p.start)} – {dmy(p.end)}</span>, sort: (p) => p.end },
    { key: 'pr', header: 'Progress', render: (p) => <BlocksCell pct={progress(p)} text={progress(p) + '%'} />, sort: progress },
    { key: 'b', header: 'Budget used', render: (p) => <span style={{ display: 'flex', alignItems: 'center' }}><BlocksCell pct={used(p)} text={used(p) + '%'} />{role !== 'Employee' && <Est basis={EST} />}</span>, sort: used, mobile: true },
    { key: 'h', header: 'Health', render: (p) => <Status label={p.health} />, sort: (p) => p.health, mobile: true },
    { key: 'bl', header: 'Billing', render: (p) => p.model },
  ];
  const active = d?.projects.filter((p) => p.status === 'Active').length ?? 0;
  return (
    <div className="wrap page" style={{ paddingBottom: 140 }}>
      <PageHeader title="Projects" desc={active + ' active engagements, ' + ((d?.projects.length ?? 0) - active) + ' completed. Health is set weekly by each project manager.'} />
      <FilterBar search={search} onSearch={setSearch} filters={[
        { key: 'c', label: 'Clients', options: d?.clients.map((c) => c.name) ?? [], value: f.client, onChange: (v) => setF({ ...f, client: v }) },
        { key: 'h', label: 'Health', options: ['On track', 'At risk', 'Off track', 'Completed'], value: f.health, onChange: (v) => setF({ ...f, health: v }) },
        { key: 'm', label: 'Billing models', options: ['T&M', 'Fixed fee'], value: f.model, onChange: (v) => setF({ ...f, model: v }) },
      ]} />
      <DataTable rows={rows} columns={role === 'Employee' ? cols.filter((c) => c.key !== 'b') : cols} rowKey={(p) => p.id} onOpen={(p) => go('/app/work/projects/' + p.id)} initialSort={{ key: 'd', dir: 'asc' }}
        empty={{ title: 'No projects match.', onClear: () => { setSearch(''); setF({ health: '', model: '', client: '' }); } }} />
    </div>
  );
}

// ---------------- project detail ----------------
type Tab = 'board' | 'list' | 'timeline' | 'files' | 'team';

export function ProjectDetail({ id, tab: raw, taskId }: { id: string; tab?: string; taskId?: string }) {
  const { say, role } = useApp();
  const q = useWorkData();
  const pq = useQuery(['projects', 'one', id], () => api.getProject(id));
  const tasksQ = useQuery(['tasks', id], () => api.getTasks({ projectId: id }));
  const prof = useProfit(q.data);
  const [open, setOpen] = useState<string | null>(taskId ?? null);
  const [adding, setAdding] = useState(false);
  const [lanes, setLanes] = useState(false);
  const tab: Tab = (['board', 'list', 'timeline', 'files', 'team'] as const).includes(raw as Tab) ? (raw as Tab) : 'board';
  if (pq.error) return <div className="wrap page"><ErrorState error={pq.error} retry={pq.refetch} /></div>;
  if (q.error) return <div className="wrap page"><ErrorState error={q.error} retry={q.refetch} /></div>;
  const d = pq.data ? q.data : undefined;
  const p = pq.data;
  const client = p && d?.clients.find((c) => c.id === p.clientId);
  const fig = prof?.projects.find((x) => x.projectId === id);
  const tasks = tasksQ.data ?? [];
  const logged = (t: Task) => d?.entries.filter((e) => e.taskId === t.id).reduce((a, e) => a + e.hours, 0) ?? 0;
  const nm = (eid: string) => d?.emps.find((e) => e.id === eid)?.name ?? eid;
  const today = d?.me.today ?? '';
  const move = async (tid: string, col: string) => {
    const t = tasks.find((x) => x.id === tid);
    if (!t || t.status === col) return;
    await api.updateTask(tid, { status: col as TaskStatus });
    invalidate('tasks');
    say(tid + ' moved to ' + COLS.find((c) => c.key === col)!.label);
  };
  const isMgr = role !== 'Employee';
  return (
    <div className="wrap page wide" style={{ paddingBottom: 140 }}>
      {!p || !d ? <SkeletonRows /> : (
        <>
          <div className="ph">
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                <h1 className="pf-name">{p.name}</h1>
                <span className="pill"><span className="dot" style={{ background: SC[p.health === 'On track' || p.health === 'Completed' ? 'green' : p.health === 'At risk' ? 'amber' : 'red'] }} />{p.health}</span>
              </div>
              <div className="pf-meta">
                <a href={'#/app/clients/accounts/' + client?.id} className="ulink" style={{ fontSize: 14, color: 'var(--ink)' }}>{client?.name}</a><span>Managed by {nm(p.managerId)}</span><span>{dm(p.start)} – {dmy(p.end)}</span><span>{p.model === 'T&M' ? 'Time and materials' : 'Fixed fee'}</span>
              </div>
            </div>
            <button className="btn-dark" onClick={() => { setAdding(true); if (tab !== 'board') go('/app/work/projects/' + id); }}>Add task</button>
          </div>
          {isMgr && (
            <div className="pj-strip">
              <div><span>Budget</span><b>{lakh(p.budget)}</b></div>
              <div><span>Spent<Est basis={EST} /></span><b>{fig ? lakh(fig.labour + fig.expenses) : '—'}</b><i>{fig ? Math.round(((fig.labour + fig.expenses) / p.budget) * 100) + '% of budget' : ''}</i></div>
              <div><span>Hours logged</span><b>{fig ? Math.round(fig.hours).toLocaleString('en-IN') + ' h' : '—'}</b><i>across {p.team.length} people</i></div>
              <div><span>Margin<Est basis={EST} /></span><b>{fig ? fig.pct.toFixed(1) + '%' : '—'}</b><i>{fig ? <a href={'#/app/finance/profitability/entries?project=' + id + '&measure=margin&period=all'} className="ulink">{lakh(fig.margin)}</a> : ''}</i></div>
            </div>
          )}
          <Tabs current={tab} tabs={(['board', 'list', 'timeline', 'files', 'team'] as const).map((t) => ({ key: t, label: t[0].toUpperCase() + t.slice(1), href: '/app/work/projects/' + id + (t === 'board' ? '' : '/' + t) }))} />
          {adding && <AddTask project={p} emps={d.emps} onDone={() => setAdding(false)} />}
          {tab === 'board' && (
            <>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
                <div className="viewseg" style={{ marginTop: 0 }} role="group" aria-label="Swimlanes"><button className={!lanes ? 'active' : ''} onClick={() => setLanes(false)}>No swimlanes</button><button className={lanes ? 'active' : ''} onClick={() => setLanes(true)}>By assignee</button></div>
              </div>
              {!tasksQ.data ? <SkeletonRows /> : (
                <KanbanBoard columns={COLS} items={tasks} colOf={(t) => t.status} idOf={(t) => t.id} onMove={move} onOpen={(t) => setOpen(t.id)}
                  lanes={lanes ? [...new Set(tasks.map((t) => t.assigneeId))].map((a) => ({ key: a, label: nm(a) })) : undefined} laneOf={lanes ? (t) => t.assigneeId : undefined}
                  hint="Drag cards between columns, or focus one and press ← →. Click a card to open it beside the board."
                  render={(t) => {
                    const over = t.status !== 'done' && t.due < today;
                    const dn = t.subtasks.filter((s) => s.done).length;
                    return (
                      <>
                        <div className="kc-top"><span className="mono" style={{ fontSize: 11, color: 'var(--label)' }}>{t.id}</span><span className="status-label" style={{ fontSize: 11.5, color: 'var(--ink-3)' }}><span className="dot" style={{ background: PRI[t.priority] }} />{t.priority}</span></div>
                        <div className="kc-title">{t.title}</div>
                        <div className="kc-foot">
                          <span style={{ color: over ? SC.red : undefined }}>{over ? 'Overdue · ' : ''}{dm(t.due)}</span>
                          {t.subtasks.length > 0 && <span>{dn}/{t.subtasks.length} subtasks</span>}
                          <span>{t.estimateHours} h</span><span style={{ flex: 1 }} />
                          <span className="av24" title={nm(t.assigneeId)}>{initials(nm(t.assigneeId))}</span>
                        </div>
                      </>
                    );
                  }} />
              )}
            </>
          )}
          {tab === 'list' && (
            <div className="card" style={{ marginTop: 24, overflowX: 'auto' }}>
              <div style={{ minWidth: 860 }}>
                <div className="tl-row tl-head"><span>ID</span><span>Task</span><span>Status</span><span>Assignee</span><span>Due</span><span>Priority</span><span className="r">Logged / est.</span></div>
                {!tasksQ.data && <SkeletonRows />}
                {tasks.map((t) => {
                  const over = t.status !== 'done' && t.due < today;
                  return (
                    <div key={t.id} className="tl-row">
                      <span className="mono" style={{ fontSize: 12, color: 'var(--label)' }}>{t.id}</span>
                      <button className="tl-title" onClick={() => setOpen(t.id)}>{t.title}</button>
                      <select className="tl-sel" value={t.status} onChange={(e) => move(t.id, e.target.value)} aria-label={'Status of ' + t.id}>{COLS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span className="av24">{initials(nm(t.assigneeId))}</span>{nm(t.assigneeId)}</span>
                      <span style={{ color: over ? SC.red : 'var(--ink-3)', fontSize: 13 }}>{dm(t.due)}</span>
                      <span className="status-label" style={{ fontSize: 13 }}><span className="dot" style={{ background: PRI[t.priority] }} />{t.priority}</span>
                      <span className="num r" style={{ color: logged(t) > t.estimateHours ? SC.red : 'var(--ink-3)', fontSize: 13 }}>{hours(logged(t))} / {t.estimateHours} h</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {tab === 'timeline' && (
            <TimelineGantt today={today} from={p.start} to={p.end}
              rows={p.phases.map((ph) => ({ key: ph.id, label: ph.name, sub: dm(ph.start) + ' – ' + dm(ph.end), bars: [{ start: ph.start, end: ph.end, done: ph.end < today, colour: ph.end < today ? '#D9E0CC' : '#3B4234' }] }))}
              deps={p.phases.flatMap((ph) => ph.dependsOn.map((dep) => ({ from: dep, to: ph.id })))}
              milestones={p.milestones.map((m) => ({ date: m.date, label: m.name }))}
              note={'Grey bars are complete. Lines show what each phase waits on. Diamonds: ' + p.milestones.map((m) => m.name.toLowerCase() + ' (' + dm(m.date) + ')').join(', ') + '.'} />
          )}
          {tab === 'files' && <div style={{ marginTop: 24 }}><DocumentTable ownerType="project" ownerId={id} /></div>}
          {tab === 'team' && (
            <div style={{ marginTop: 24, maxWidth: 960 }}>
              {p.team.map((m) => {
                const e = d.emps.find((x) => x.id === m.employeeId);
                const h = d.entries.filter((x) => x.projectId === id && x.employeeId === m.employeeId).reduce((a, x) => a + x.hours, 0);
                return (
                  <div key={m.employeeId} className="team-row">
                    <a href={'#/app/people/directory/' + m.employeeId} className="pcell"><span className="pcell-av" style={{ width: 34, height: 34 }}>{initials(e?.name)}</span><span><span style={{ display: 'block', fontWeight: 500 }}>{e?.name}</span><span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{e?.title}</span></span></a>
                    <span style={{ color: 'var(--ink-3)' }}>{m.role}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span className="pr-bar"><span style={{ display: 'block', height: '100%', width: m.allocation + '%', background: 'var(--violet)' }} /></span><span style={{ fontSize: 12.5, color: 'var(--ink-3)', width: 36 }}>{m.allocation}%</span></span>
                    <span className="num" style={{ textAlign: 'right' }}>{hours(h)}</span>
                  </div>
                );
              })}
            </div>
          )}
          {open && (
            <DetailPanel id={open} fullPage={'/app/work/projects/' + id + '/task/' + open} onClose={() => setOpen(null)}>
              <PanelTask taskId={open} project={p} emps={d.emps} logged={logged} />
            </DetailPanel>
          )}
        </>
      )}
    </div>
  );
}

/** The board's side panel fetches the task by id, like the full task page. */
function PanelTask({ taskId, project, emps, logged }: { taskId: string; project: Project; emps: Employee[]; logged: (t: Task) => number }) {
  const q = useQuery(['tasks', 'one', taskId], () => api.getTask(taskId));
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  if (!q.data) return <SkeletonRows n={4} />;
  return <TaskBody task={q.data} project={project} emps={emps} logged={logged(q.data)} />;
}

function AddTask({ project, emps, onDone }: { project: Project; emps: Employee[]; onDone: () => void }) {
  const { say } = useApp();
  const [title, setTitle] = useState('');
  const [who, setWho] = useState(project.team[0]?.employeeId ?? '');
  const [due, setDue] = useState(project.end);
  const [est, setEst] = useState('4');
  const save = async () => {
    if (!title.trim()) return;
    const t = await api.createTask(project.id, { title: title.trim(), assigneeId: who, due, priority: 'Medium', estimateHours: +est || 1 });
    invalidate('tasks');
    say(t.id + ' added to To do');
    onDone();
  };
  return (
    <div className="card addtask">
      <input className="input" autoFocus placeholder="Task title" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} aria-label="Task title" />
      <select className="input" value={who} onChange={(e) => setWho(e.target.value)} aria-label="Assignee">{project.team.map((m) => <option key={m.employeeId} value={m.employeeId}>{emps.find((e) => e.id === m.employeeId)?.name}</option>)}</select>
      <input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due" />
      <input className="input" inputMode="numeric" value={est} onChange={(e) => setEst(e.target.value.replace(/[^\d]/g, ''))} aria-label="Estimate in hours" style={{ width: 90 }} />
      <button className="btn-dark" onClick={save} disabled={!title.trim()}>Add</button>
      <button className="btn-line" onClick={onDone}>Cancel</button>
    </div>
  );
}

export function TaskBody({ task, project, emps, logged }: { task: Task; project: Project; emps: Employee[]; logged: number }) {
  const [draft, setDraft] = useState('');
  const nm = (id: string) => emps.find((e) => e.id === id)?.name ?? id;
  const col = COLS.find((c) => c.key === task.status)!;
  const over = logged > task.estimateHours;
  const toggleSub = async (i: number) => { await api.updateTask(task.id, { subtasks: task.subtasks.map((s, j) => (j === i ? { ...s, done: !s.done } : s)) }); invalidate('tasks'); };
  const post = async () => { if (!draft.trim()) return; await api.addComment(task.id, draft.trim()); invalidate('tasks'); setDraft(''); };
  return (
    <>
      <h2 className="task-h">{task.title}</h2>
      <div className="task-meta">
        <span>Status</span><span className="status-label"><span className="dot" style={{ background: COLC[task.status] }} />{col.label}</span>
        <span>Assignee</span><span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span className="av24">{initials(nm(task.assigneeId))}</span>{nm(task.assigneeId)}</span>
        <span>Reporter</span><span>{nm(project.managerId)}</span>
        <span>Due</span><span>{dmy(task.due)}</span>
        <span>Priority</span><span className="status-label"><span className="dot" style={{ background: PRI[task.priority] }} />{task.priority}</span>
        <span>Time</span><span style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span className="pr-bar" style={{ maxWidth: 180 }}><span style={{ display: 'block', height: '100%', width: Math.min(100, (logged / task.estimateHours) * 100) + '%', background: over ? SC.red : 'var(--violet)' }} /></span><span className="num">{hours(logged)} of {task.estimateHours} h</span></span>
      </div>
      <div style={{ fontSize: 14.5, lineHeight: 1.6, color: '#3B3F37', marginTop: 28 }}>{task.description}</div>
      <div style={{ marginTop: 32 }}>
        <div className="section-title" style={{ display: 'flex', justifyContent: 'space-between' }}><span>Subtasks</span><span>{task.subtasks.filter((s) => s.done).length} of {task.subtasks.length}</span></div>
        {task.subtasks.map((s, i) => <label key={s.id} className="check-row"><input type="checkbox" checked={s.done} onChange={() => toggleSub(i)} /><span className={s.done ? 'done' : ''}>{s.title}</span></label>)}
        {!task.subtasks.length && <div className="empty-s">No subtasks.</div>}
      </div>
      <div style={{ marginTop: 28 }}>
        <div className="section-title" style={{ marginBottom: 12 }}>Comments</div>
        {task.comments.map((c) => (
          <div key={c.id} className="feed-item"><span className="avatar-chip" style={{ width: 28, height: 28, fontSize: 11 }}>{initials(nm(c.authorId))}</span><div><div style={{ fontSize: 13 }}><b style={{ fontWeight: 600 }}>{nm(c.authorId)}</b> <span style={{ color: 'var(--label)' }}>· {ago(c.at)}</span></div><div style={{ fontSize: 14, lineHeight: 1.5, marginTop: 4, color: '#3B3F37' }}>{c.text}</div></div></div>
        ))}
        <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'flex-end' }}>
          <textarea className="input" rows={2} style={{ height: 'auto', padding: '10px 12px', flex: 1 }} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Write a comment — @ to mention" aria-label="Comment" />
          <button className="btn-dark" onClick={post} disabled={!draft.trim()}>Post</button>
        </div>
      </div>
    </>
  );
}

export function TaskPage({ projectId, taskId }: { projectId: string; taskId: string }) {
  const q = all({ task: useQuery(['tasks', 'one', taskId], () => api.getTask(taskId)), project: useQuery(['projects', projectId], () => api.getProject(projectId)), emps: useEmployees(), entries: useAllEntries() });
  if (q.error) return <div className="wrap page"><ErrorState error={q.error} retry={q.refetch} /></div>;
  return (
    <div className="wrap page" style={{ maxWidth: 820, paddingBottom: 140 }}>
      <a className="back-link" href={'#/app/work/projects/' + projectId}>← {q.data?.project.name ?? 'Project'} board</a>
      {!q.data ? <SkeletonRows /> : (
        <div style={{ marginTop: 16 }}>
          <span className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>{taskId}</span>
          <TaskBody task={q.data.task} project={q.data.project} emps={q.data.emps} logged={q.data.entries.filter((e) => e.taskId === taskId).reduce((a, e) => a + e.hours, 0)} />
        </div>
      )}
    </div>
  );
}
export { StatusLabel };
