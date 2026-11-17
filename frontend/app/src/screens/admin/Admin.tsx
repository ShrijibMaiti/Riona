import { Fragment, useMemo, useRef, useState } from 'react';
import { DataTable, Mono, PersonCell, Status, downloadCsv, type Column } from '../../components/DataTable';
import { ConfirmDialog } from '../../components/Dialogs';
import { FilterBar } from '../../components/FilterBar';
import { PageHeader, Tabs } from '../../components/PageHeader';
import { ErrorState, SkeletonRows } from '../../components/ui';
import * as api from '../../data/repositories';
import type { AppUser, AuditEvent, Permission, Workflow, WorkflowNode, WorkflowNodeKind } from '../../data/types';
import { useEmployees, useMe } from '../../hooks/data';
import { ago, dmy, timeOf } from '../../lib/format';
import { all, invalidate, useQuery } from '../../lib/query';
import { go, useApp } from '../../state/store';

const adminOnly = (role: string) => role !== 'Admin' ? <div className="wrap page"><h1 className="display">Admins only</h1><p className="lede">This part of Admin is visible to administrators.</p></div> : null;

// ---------------- users ----------------
export function Users() {
  const { role, say } = useApp();
  const q = all({ users: useQuery(['users'], api.getUsers, { enabled: role === 'Admin' }), emps: useEmployees(), roles: useQuery(['roles'], api.getRoles, { enabled: role === 'Admin' }) });
  const [search, setSearch] = useState('');
  const [f, setF] = useState({ role: '', status: '' });
  const [inv, setInv] = useState<{ name: string; email: string; role: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<AppUser | null>(null);
  const gate = adminOnly(role);
  if (gate) return gate;
  if (q.error) return <div className="wrap page"><ErrorState error={q.error} retry={q.refetch} /></div>;
  const rows = q.data?.users.filter((u) => (!search || (u.name + u.email).toLowerCase().includes(search.toLowerCase())) && (!f.role || u.role === f.role) && (!f.status || u.status === f.status));
  const dept = (u: AppUser) => q.data?.emps.find((e) => e.id === u.employeeId)?.dept ?? '—';
  const cols: Column<AppUser>[] = [
    { key: 'n', header: 'Name', render: (u) => <PersonCell name={u.name} sub={u.email} />, sort: (u) => u.name, mobile: true },
    { key: 'r', header: 'Role', render: (u) => <select className="tl-sel" value={u.role} onClick={(e) => e.stopPropagation()} onChange={async (e) => { try { await api.updateUser(u.id, { role: e.target.value }); say(u.name + ' is now ' + e.target.value); } catch (x) { say((x as Error).message); } invalidate('users', 'audit'); }} aria-label={'Role for ' + u.name}>{q.data!.roles.map((r) => <option key={r.id}>{r.name}</option>)}</select>, sort: (u) => u.role, mobile: true },
    { key: 'd', header: 'Department', render: dept, sort: dept },
    { key: 'l', header: 'Last active', render: (u) => (u.lastActive ? ago(u.lastActive) : 'Never'), sort: (u) => u.lastActive ?? '' },
    { key: 's', header: 'Status', render: (u) => <Status label={u.status === 'Deactivated' ? 'Inactive' : u.status} />, sort: (u) => u.status, mobile: true },
  ];
  const invite = async () => {
    if (!inv) return;
    try { await api.inviteUser(inv); invalidate('users', 'audit'); say('Invite sent to ' + inv.email); setInv(null); setErr(null); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div className="wrap page" style={{ paddingBottom: 140 }}>
      <PageHeader title="Users" desc={(q.data?.users.length ?? '—') + ' accounts. Deactivated users keep their audit history.'} primary={{ label: 'Invite user', onClick: () => setInv({ name: '', email: '', role: 'Employee' }) }}
        more={[{ label: 'Export CSV', run: () => rows && downloadCsv('users.csv', ['Name', 'Email', 'Role', 'Status'], rows.map((u) => [u.name, u.email, u.role, u.status])) }]} />
      {inv && (
        <div className="card addtask">
          <input className="input" autoFocus placeholder="Full name" value={inv.name} onChange={(e) => setInv({ ...inv, name: e.target.value })} aria-label="Name" />
          <input className="input" placeholder="Work email" value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} aria-label="Email" />
          <select className="input" value={inv.role} onChange={(e) => setInv({ ...inv, role: e.target.value })} aria-label="Role" style={{ flex: '0 1 160px' }}>{q.data?.roles.map((r) => <option key={r.id}>{r.name}</option>)}</select>
          <button className="btn-dark" disabled={!inv.name.trim() || !inv.email.trim()} onClick={invite}>Send invite</button><button className="btn-line" onClick={() => { setInv(null); setErr(null); }}>Cancel</button>
          {err && <span style={{ width: '100%', color: 'var(--red)', fontSize: 13 }} role="alert">{err}</span>}
        </div>
      )}
      <FilterBar search={search} onSearch={setSearch} filters={[
        { key: 'r', label: 'Roles', options: q.data?.roles.map((r) => r.name) ?? [], value: f.role, onChange: (v) => setF({ ...f, role: v }) },
        { key: 's', label: 'Statuses', options: ['Active', 'Invited', 'Deactivated'], value: f.status, onChange: (v) => setF({ ...f, status: v }) },
      ]} />
      <DataTable rows={rows} columns={cols} rowKey={(u) => u.id} onOpen={(u) => u.employeeId && go('/app/people/directory/' + u.employeeId)}
        rowMenu={(u) => [
          { label: 'Deactivate', run: () => setConfirm(u), danger: true, hidden: u.status !== 'Active' },
          { label: 'Reactivate', run: async () => { try { await api.updateUser(u.id, { status: 'Active' }); invalidate('users', 'audit'); say(u.name + ' reactivated'); } catch (x) { say((x as Error).message); } }, hidden: u.status !== 'Deactivated' },
          { label: 'Resend invite', run: async () => { try { await api.resendInvite(u.id); invalidate('audit'); say('Invite resent to ' + u.email); } catch (x) { say((x as Error).message); } }, hidden: u.status !== 'Invited' },
        ]} />
      {confirm && <ConfirmDialog title={'Deactivate ' + confirm.name + '?'} danger confirm="Deactivate" body="They lose access immediately. Their records and audit history stay." onCancel={() => setConfirm(null)}
        onConfirm={async () => { try { await api.updateUser(confirm.id, { status: 'Deactivated' }); invalidate('users', 'audit'); say(confirm.name + ' deactivated'); } catch (x) { say((x as Error).message); } setConfirm(null); }} />}
    </div>
  );
}

// ---------------- roles ----------------
const PERMS: Permission[] = ['none', 'view', 'edit', 'approve'];
const PERM_LABEL: Record<Permission, string> = { none: '—', view: 'View', edit: 'Edit', approve: 'Approve' };
export function Roles() {
  const { role, say } = useApp();
  const q = useQuery(['roles'], api.getRoles, { enabled: role === 'Admin' });
  // Read as a table of words; switch to the dropdowns only when changing something.
  const [editing, setEditing] = useState(false);
  const gate = adminOnly(role);
  if (gate) return gate;
  if (q.error) return <div className="wrap page"><ErrorState error={q.error} retry={q.refetch} /></div>;
  const modules = q.data ? Object.keys(q.data[0].permissions) : [];
  const set = async (rid: string, m: string, p: Permission) => { await api.setPermission(rid, m, p); invalidate('roles', 'audit'); say(q.data!.find((r) => r.id === rid)?.name + ' · ' + m + ' → ' + p); };
  return (
    <div className="wrap page wide" style={{ paddingBottom: 140 }}>
      <PageHeader title="Roles & permissions" desc="What each role can do in each module. Changes are saved and written to the audit log; enforcing edited roles is coming, so today the five built-in roles decide access."
        primary={q.data ? { label: editing ? 'Done' : 'Edit permissions', onClick: () => setEditing(!editing) } : undefined} />
      {!q.data ? <SkeletonRows /> : (
        <div className="card" style={{ marginTop: 28, overflowX: 'auto' }}>
          <table className="matrix">
            <thead><tr><th>Module</th>{q.data.map((r) => <th key={r.id}><b>{r.name}</b><i>{r.seeded ? 'Seeded' : 'Custom'}</i></th>)}</tr></thead>
            <tbody>
              {modules.map((m) => (
                <tr key={m}><td className="mx-mod">{m}</td>{q.data!.map((r) => (
                  <td key={r.id}>{editing ? <select className={'perm p-' + r.permissions[m]} value={r.permissions[m]} onChange={(e) => set(r.id, m, e.target.value as Permission)} aria-label={r.name + ' · ' + m}>{PERMS.map((p) => <option key={p} value={p}>{p === 'none' ? '—' : p[0].toUpperCase() + p.slice(1)}</option>)}</select> : <span className={'perm-t p-' + r.permissions[m]}>{PERM_LABEL[r.permissions[m]]}</span>}</td>
                ))}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 16 }}>View reads; Edit creates and changes; Approve also decides requests in that module. Nothing grants deleting audit history.</p>
    </div>
  );
}

// ---------------- workflows ----------------
export function Workflows() {
  const { role } = useApp();
  const q = useQuery(['workflows'], api.getWorkflows);
  const gate = adminOnly(role);
  if (gate) return gate;
  if (q.error) return <div className="wrap page"><ErrorState error={q.error} retry={q.refetch} /></div>;
  return (
    <div className="wrap page" style={{ paddingBottom: 140 }}>
      <PageHeader title="Approval workflows" desc="The engine every approval in Riona runs on. Open one to edit it on the canvas and dry-run it." />
      <div style={{ marginTop: 24 }}>
        <DataTable rows={q.data} rowKey={(w) => w.id} onOpen={(w) => go('/app/admin/workflows/' + w.id)} columns={[
          { key: 'n', header: 'Workflow', render: (w) => <span style={{ fontWeight: 500 }}>{w.name}</span>, sort: (w) => w.name, mobile: true },
          { key: 'm', header: 'Module', render: (w) => w.module, mobile: true },
          { key: 's', header: 'Steps', align: 'right', render: (w) => <span className="num">{w.nodes.length}</span> },
          { key: 'a', header: 'Active', render: (w) => <Status label={w.status === 'Active' ? 'On' : w.status} colour={w.status === 'Active' ? 'green' : 'amber'} />, mobile: true },
          { key: 'l', header: 'Last modified', render: (w) => dmy(w.updated), sort: (w) => w.updated },
        ]} />
      </div>
    </div>
  );
}

const NW = 180, NH = 64;
const KINDS: WorkflowNodeKind[] = ['Trigger', 'Condition', 'Approver', 'Notification', 'Outcome'];
const KCOL: Record<WorkflowNodeKind, string> = { Trigger: '#252823', Condition: '#A86F12', Approver: '#D4421F', Notification: '#2F5FA8', Outcome: '#557A3E' };
/** The same hues darkened for small text, so node labels meet 4.5:1 (the dots and edges keep the status colours). */
const KTEXT: Record<WorkflowNodeKind, string> = { Trigger: '#252823', Condition: '#8D5D18', Approver: '#A8351A', Notification: '#2A5596', Outcome: '#3F5C2C' };

/** Dry run: walk from the trigger, evaluating conditions against sample input. */
export function dryRun(w: Workflow, input: Record<string, string>) {
  const nodes: string[] = [], edges: string[] = [];
  let cur = w.nodes.find((n) => n.kind === 'Trigger');
  const seen = new Set<string>();
  const log: string[] = [];
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    nodes.push(cur.id);
    const out = w.edges.filter((e) => e.from === cur!.id);
    let next: (typeof out)[number] | undefined = out[0];
    if (cur.kind === 'Condition') {
      const v = +(input[cur.config.field] ?? 0), t = +cur.config.value;
      const ok = cur.config.op === '>' ? v > t : cur.config.op === '<' ? v < t : cur.config.op === '>=' ? v >= t : v === t;
      log.push(cur.label + ' ' + (ok ? 'yes' : 'no') + ' (' + cur.config.field + ' = ' + v + ')');
      next = out.find((e) => (e.label ?? 'Yes') === (ok ? 'Yes' : 'No')) ?? (ok ? out[0] : undefined);
      if (!next && !ok) { log.push('No “No” branch — the request skips ahead'); next = undefined; const after = w.edges.find((e) => e.from === out[0]?.to); if (after) { nodes.push(out[0].to); edges.push(out[0].id); next = after; } }
    } else if (cur.kind === 'Approver') log.push('Waits on ' + (cur.config.approver ?? cur.label) + (cur.config.sla ? ' · SLA ' + cur.config.sla + (cur.config.onTimeout === 'approve' ? ', then approved automatically' : ', then a reminder') : ''));
    else if (cur.kind === 'Notification') log.push('Notifies ' + (cur.config.to ?? '') + ' by ' + (cur.config.channel ?? ''));
    else if (cur.kind === 'Outcome') log.push('Ends: ' + cur.label);
    if (!next) break;
    edges.push(next.id);
    cur = w.nodes.find((n) => n.id === next.to);
  }
  return { nodes, edges, log };
}

export function WorkflowBuilder({ id }: { id: string }) {
  const { role, say } = useApp();
  const q = useQuery(['workflows', id], () => api.getWorkflow(id));
  const [w, setW] = useState<Workflow | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [link, setLink] = useState<{ from: string; x: number; y: number } | null>(null);
  const [test, setTest] = useState<Record<string, string>>({ days: '3', amount: '18400', total: '1462500' });
  const [run, setRun] = useState<ReturnType<typeof dryRun> | null>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const gate = adminOnly(role);
  if (gate) return gate;
  if (q.error) return <div className="wrap page"><ErrorState error={q.error} retry={q.refetch} /></div>;
  const wf = w ?? q.data ?? null;
  if (!wf) return <div className="wrap page"><SkeletonRows /></div>;
  const edit = (next: Workflow) => { setW(next); setRun(null); };
  const node = wf.nodes.find((n) => n.id === sel);
  const pt = (e: React.PointerEvent) => { const r = canvas.current!.getBoundingClientRect(); return { x: e.clientX - r.left + canvas.current!.scrollLeft, y: e.clientY - r.top + canvas.current!.scrollTop }; };
  const addNode = (kind: WorkflowNodeKind) => {
    const nid = wf.id + '-N' + Date.now().toString(36);
    const maxX = Math.max(...wf.nodes.map((n) => n.x), 0);
    edit({ ...wf, nodes: [...wf.nodes, { id: nid, kind, label: 'New ' + kind.toLowerCase(), x: maxX + 220, y: 120, config: kind === 'Condition' ? { field: 'days', op: '>', value: '0' } : kind === 'Approver' ? { approver: 'Reporting manager', sla: '48h' } : kind === 'Notification' ? { channel: 'email', to: 'Requester' } : kind === 'Outcome' ? { result: 'approve' } : { event: '' } }] });
    setSel(nid);
  };
  const removeNode = (nid: string) => { edit({ ...wf, nodes: wf.nodes.filter((n) => n.id !== nid), edges: wf.edges.filter((e) => e.from !== nid && e.to !== nid) }); setSel(null); };
  const errors = [
    wf.nodes.filter((n) => n.kind === 'Trigger').length !== 1 && 'A workflow needs exactly one trigger.',
    !wf.nodes.some((n) => n.kind === 'Outcome') && 'Add at least one outcome.',
    ...wf.nodes.filter((n) => n.kind !== 'Outcome' && !wf.edges.some((e) => e.from === n.id)).map((n) => '“' + n.label + '” leads nowhere.'),
  ].filter(Boolean) as string[];
  const save = async () => { await api.saveWorkflow(wf); invalidate('workflows', 'audit'); setW(null); say(wf.name + ' saved'); };
  const fields = [...new Set(wf.nodes.filter((n) => n.kind === 'Condition').map((n) => n.config.field))];
  const width = Math.max(...wf.nodes.map((n) => n.x + NW), 800) + 120, height = Math.max(...wf.nodes.map((n) => n.y + NH), 320) + 80;
  const centre = (n: WorkflowNode, side: 'in' | 'out') => ({ x: n.x + (side === 'out' ? NW : 0), y: n.y + NH / 2 });
  return (
    <div className="wrap page wide" style={{ paddingBottom: 120 }}>
      <a className="back-link" href="#/app/admin/workflows">← Approval workflows</a>
      <PageHeader title={wf.name} desc={wf.module + ' · ' + wf.nodes.length + ' steps · last saved ' + dmy(wf.updated)}
        aside={w ? <button className="btn-line" onClick={() => { setW(null); setRun(null); }}>Discard</button> : undefined}
        primary={{ label: w ? 'Save workflow' : 'Saved', onClick: save, disabled: !w || errors.length > 0 }} />
      <div className="wf-palette" aria-label="Add a step">
        {KINDS.map((k) => <button key={k} onClick={() => addNode(k)}><i style={{ background: KCOL[k] }} />{k}</button>)}
        <span>Drag steps to arrange them. Drag from a step’s right-hand port to another step to connect.</span>
      </div>
      <div className="wf-wrap">
        <div className="wf-canvas card" ref={canvas}
          onPointerMove={(e) => { const p = pt(e); if (drag.current) { const d = drag.current; edit({ ...wf, nodes: wf.nodes.map((n) => (n.id === d.id ? { ...n, x: Math.max(0, Math.round((p.x - d.dx) / 10) * 10), y: Math.max(0, Math.round((p.y - d.dy) / 10) * 10) } : n)) }); } if (link) setLink({ ...link, x: p.x, y: p.y }); }}
          onPointerUp={(e) => {
            drag.current = null;
            if (link) {
              const p = pt(e);
              const target = wf.nodes.find((n) => p.x >= n.x && p.x <= n.x + NW && p.y >= n.y && p.y <= n.y + NH && n.id !== link.from);
              if (target && !wf.edges.some((x) => x.from === link.from && x.to === target.id)) {
                const fromNode = wf.nodes.find((n) => n.id === link.from)!;
                const existing = wf.edges.filter((x) => x.from === link.from).length;
                edit({ ...wf, edges: [...wf.edges, { id: wf.id + '-E' + Date.now().toString(36), from: link.from, to: target.id, label: fromNode.kind === 'Condition' ? (existing ? 'No' : 'Yes') : undefined }] });
              }
              setLink(null);
            }
          }}>
          <div style={{ position: 'relative', width, height }}>
            <svg width={width} height={height} style={{ position: 'absolute', inset: 0 }}>
              <defs><marker id="wfa" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#8D9184" /></marker><marker id="wfa2" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#D4421F" /></marker></defs>
              {wf.edges.map((e) => {
                const a = wf.nodes.find((n) => n.id === e.from), b = wf.nodes.find((n) => n.id === e.to);
                if (!a || !b) return null;
                const p1 = centre(a, 'out'), p2 = centre(b, 'in');
                const lit = run?.edges.includes(e.id);
                const mx = (p1.x + p2.x) / 2;
                return (
                  <g key={e.id}>
                    <path d={`M${p1.x},${p1.y} C${mx},${p1.y} ${mx},${p2.y} ${p2.x - 4},${p2.y}`} fill="none" stroke={lit ? '#D4421F' : '#C3C7B8'} strokeWidth={lit ? 2.5 : 1.5} markerEnd={lit ? 'url(#wfa2)' : 'url(#wfa)'} />
                    {e.label && <text x={mx} y={(p1.y + p2.y) / 2 - 6} fontSize="11" fill="#676A61" textAnchor="middle">{e.label}</text>}
                    <circle cx={mx} cy={(p1.y + p2.y) / 2 + 8} r="7" fill="#fff" stroke="#D3D6CA" style={{ cursor: 'pointer' }} onClick={() => edit({ ...wf, edges: wf.edges.filter((x) => x.id !== e.id) })}><title>Remove connection</title></circle>
                  </g>
                );
              })}
              {link && (() => { const a = wf.nodes.find((n) => n.id === link.from)!; const p1 = centre(a, 'out'); return <path d={`M${p1.x},${p1.y} L${link.x},${link.y}`} stroke="#D4421F" strokeDasharray="4 4" fill="none" />; })()}
            </svg>
            {wf.nodes.map((n) => (
              <div key={n.id} className={'wf-node' + (sel === n.id ? ' sel' : '') + (run?.nodes.includes(n.id) ? ' lit' : run ? ' dim' : '')} style={{ left: n.x, top: n.y, width: NW, height: NH, ['--k' as string]: KCOL[n.kind] }}
                onPointerDown={(e) => { if ((e.target as HTMLElement).classList.contains('wf-port')) return; const p = pt(e); drag.current = { id: n.id, dx: p.x - n.x, dy: p.y - n.y }; setSel(n.id); }}
                tabIndex={0} role="button" aria-label={n.kind + ': ' + n.label} onKeyDown={(e) => e.key === 'Enter' && setSel(n.id)}>
                <i style={{ color: KTEXT[n.kind] }}>{n.kind}</i><b>{n.label}</b>
                {n.kind !== 'Outcome' && <span className="wf-port" title="Drag to connect" onPointerDown={(e) => { e.stopPropagation(); const p = pt(e); setLink({ from: n.id, x: p.x, y: p.y }); }} />}
              </div>
            ))}
          </div>
        </div>
        <aside className="wf-side">
          {node ? (
            <div className="card" style={{ padding: 18 }}>
              <div className="section-title" style={{ color: KCOL[node.kind] }}>{node.kind}</div>
              <label className="field"><span>Label</span><input value={node.label} onChange={(e) => edit({ ...wf, nodes: wf.nodes.map((x) => (x.id === node.id ? { ...x, label: e.target.value } : x)) })} /></label>
              {Object.entries(node.config).filter(([k]) => k !== 'onTimeout').map(([k, v]) => (
                <label key={k} className="field" style={{ marginTop: 10 }}><span>{k}</span>
                  {k === 'op' ? <select value={v} onChange={(e) => edit({ ...wf, nodes: wf.nodes.map((x) => (x.id === node.id ? { ...x, config: { ...x.config, [k]: e.target.value } } : x)) })}>{['>', '<', '>=', '='].map((o) => <option key={o}>{o}</option>)}</select>
                    : <input value={v} onChange={(e) => edit({ ...wf, nodes: wf.nodes.map((x) => (x.id === node.id ? { ...x, config: { ...x.config, [k]: e.target.value } } : x)) })} />}
                </label>
              ))}
              {node.kind === 'Approver' && (
                <label className="field" style={{ marginTop: 10 }}><span>When the SLA passes</span>
                  <select value={node.config.onTimeout === 'approve' ? 'approve' : 'remind'} onChange={(e) => edit({ ...wf, nodes: wf.nodes.map((x) => (x.id === node.id ? { ...x, config: { ...x.config, onTimeout: e.target.value } } : x)) })} aria-label="When the SLA passes">
                    <option value="remind">Remind the approver</option>
                    <option value="approve">Approve automatically</option>
                  </select>
                </label>
              )}
              {node.kind === 'Condition' && <p style={{ fontSize: 12, color: 'var(--muted)' }}>The first connection out is “Yes”, the second “No”.</p>}
              <button className="link-btn" style={{ color: 'var(--red)', marginTop: 14 }} onClick={() => removeNode(node.id)}>Remove this step</button>
            </div>
          ) : <div className="card empty-s" style={{ padding: 18 }}>Select a step to configure it.</div>}
          <div className="card" style={{ padding: 18, marginTop: 12 }}>
            <div className="section-title">Dry run</div>
            {fields.map((k) => <label key={k} className="field" style={{ marginTop: 8 }}><span>Sample {k}</span><input inputMode="numeric" value={test[k] ?? ''} onChange={(e) => { setTest({ ...test, [k]: e.target.value }); setRun(null); }} /></label>)}
            {!fields.length && <p style={{ fontSize: 13, color: 'var(--muted)', margin: '4px 0 0' }}>No conditions — every request takes the same path.</p>}
            <button className="btn-dark" style={{ marginTop: 12, height: 36 }} onClick={() => setRun(dryRun(wf, test))}>Run test</button>
            {run && <ol className="wf-log">{run.log.map((l, i) => <li key={i}>{l}</li>)}</ol>}
          </div>
          {errors.length > 0 && <div className="err-banner" style={{ marginTop: 12 }}>{errors.map((e) => <div key={e}>{e}</div>)}</div>}
        </aside>
      </div>
    </div>
  );
}

// ---------------- notifications ----------------
export function NotificationRules() {
  const { role, say } = useApp();
  const q = all({ rules: useQuery(['rules'], api.getNotificationRules, { enabled: role === 'Admin' }), jobs: useQuery(['systemJobs'], api.getSystemJobs, { enabled: role === 'Admin' }) });
  const gate = adminOnly(role);
  if (gate) return gate;
  if (q.error) return <div className="wrap page"><ErrorState error={q.error} retry={q.refetch} /></div>;
  const mods = [...new Set(q.data?.rules.map((r) => r.module))];
  return (
    <div className="wrap page" style={{ paddingBottom: 140, maxWidth: 960 }}>
      <PageHeader title="Notification rules" desc="Which events reach people, and on which channel. In-app notices are delivered today; email and the 8 am digest follow these rules once delivery is switched on." />
      {q.data?.jobs.filter((j) => j.status === 'Failed').map((j) => <div key={j.id} className="threshold-band over" style={{ marginTop: 20 }}><b>{j.name} failed</b> at {timeOf(j.lastRun)}: {j.detail}.</div>)}
      {!q.data ? <SkeletonRows /> : (
        <div className="card" style={{ marginTop: 24, overflowX: 'auto' }}>
          <table className="matrix">
            <thead><tr><th>Event</th><th><b>In-app</b></th><th><b>Email</b></th><th><b>Digest</b></th></tr></thead>
            <tbody>
              {mods.map((m) => (
                <Fragment key={m}>
                  <tr><td colSpan={4} className="mx-group">{m}</td></tr>
                  {q.data!.rules.filter((r) => r.module === m).map((r) => (
                    <tr key={r.id}><td className="mx-mod">{r.event}</td>{(['inApp', 'email', 'digest'] as const).map((ch) => (
                      <td key={ch}><input type="checkbox" checked={r.channels[ch]} aria-label={r.event + ' · ' + ch} onChange={async (e) => { await api.setNotificationChannel(r.id, ch, e.target.checked); invalidate('rules'); say(r.event + ' · ' + (ch === 'inApp' ? 'in-app' : ch) + (e.target.checked ? ' on' : ' off')); }} /></td>
                    ))}</tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------- audit ----------------
export function Audit() {
  const { role } = useApp();
  const me = useMe();
  const [search, setSearch] = useState('');
  const [entity, setEntity] = useState('');
  const q = useQuery(['audit', 'list', search, entity], () => api.getAuditEvents({ search, entity: entity || undefined, pageSize: 1000 }), { enabled: role === 'Admin' });
  const [open, setOpen] = useState<string | null>(null);
  const gate = adminOnly(role);
  const entities = useMemo(() => [...new Set(q.data?.items.map((a) => a.entity))].sort(), [q.data]);
  if (gate) return gate;
  if (q.error) return <div className="wrap page"><ErrorState error={q.error} retry={q.refetch} /></div>;
  const cols: Column<AuditEvent>[] = [
    { key: 't', header: 'Timestamp', render: (a) => <Mono>{dmy(a.at.slice(0, 10))} {timeOf(a.at)}</Mono>, sort: (a) => a.at, mobile: true },
    { key: 'a', header: 'Actor', render: (a) => <PersonCell name={a.actor} />, sort: (a) => a.actor, mobile: true },
    { key: 'ac', header: 'Action', render: (a) => <span>{a.action}{a.changes.length > 0 && <button className="link-btn" style={{ marginLeft: 8 }} onClick={(e) => { e.stopPropagation(); setOpen(open === a.id ? null : a.id); }}>{open === a.id ? 'Hide' : a.changes.length + (a.changes.length === 1 ? ' change' : ' changes')}</button>}{open === a.id && <span className="diff">{a.changes.map((c) => <span key={c.field}><b>{c.field}</b><del>{c.before ?? '∅'}</del>→<ins>{c.after ?? '∅'}</ins></span>)}</span>}</span>, mobile: true },
    { key: 'e', header: 'Entity type', render: (a) => a.entity, sort: (a) => a.entity },
    { key: 'id', header: 'Entity', render: (a) => <Mono>{a.entityId}</Mono> },
    { key: 'ip', header: 'IP address', render: (a) => <Mono>{a.ip}</Mono> },
  ];
  return (
    <div className="wrap page" style={{ paddingBottom: 140 }}>
      <PageHeader title="Audit log" desc="Read-only and permanent. Every change, by whom, from where. There is no delete." primary={{ label: 'Export CSV', onClick: () => q.data && downloadCsv('audit.csv', ['At', 'Actor', 'Action', 'Entity', 'Entity ID', 'Changes', 'IP'], q.data.items.map((a) => [a.at, a.actor, a.action, a.entity, a.entityId, a.changes.map((c) => c.field + ': ' + c.before + ' → ' + c.after).join('; '), a.ip])) }} />
      <FilterBar search={search} onSearch={setSearch} filters={[{ key: 'e', label: 'Entity types', options: entities, value: entity, onChange: setEntity }]} />
      <DataTable rows={q.data?.items} columns={cols} rowKey={(a) => a.id} pageSize={50} total={q.data?.total} />
      <p style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 12 }}>Signed in as {me.data?.employee.name}. Viewing the log is itself recorded.</p>
    </div>
  );
}

// ---------------- masters ----------------
export function Masters() {
  const { role, say } = useApp();
  const q = useQuery(['masters'], api.getMasters);
  const [tab, setTab] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ id?: string; values: string[]; active: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const gate = adminOnly(role);
  if (gate) return gate;
  if (q.error) return <div className="wrap page"><ErrorState error={q.error} retry={q.refetch} /></div>;
  const list = q.data ? q.data.find((m) => m.id === (tab ?? q.data![0].id)) : undefined;
  const save = async () => {
    if (!list || !edit) return;
    try { await api.saveMasterRow(list.id, edit); invalidate('masters', 'audit'); say(list.name + ' updated'); setEdit(null); setErr(null); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div className="wrap page" style={{ paddingBottom: 140 }}>
      <PageHeader title="Masters" desc="Reference data every module reads. Rows are deactivated, never deleted, so old records keep their meaning." primary={list ? { label: 'Add row', onClick: () => setEdit({ values: list.columns.map(() => ''), active: true }) } : undefined} />
      {q.data && <Tabs current={list?.id ?? ''} tabs={q.data.map((m) => ({ key: m.id, label: m.name, onClick: () => { setTab(m.id); setEdit(null); } }))} />}
      {!list ? <SkeletonRows /> : (
        <div className="card" style={{ marginTop: 20, overflowX: 'auto' }}>
          <table className="dt" style={{ minWidth: 600 }}>
            <thead><tr>{list.columns.map((c) => <th key={c}>{c}</th>)}<th>Status</th><th style={{ width: 160 }} /></tr></thead>
            <tbody>
              {edit && !edit.id && (
                <tr><>{edit.values.map((v, i) => <td key={i}><input className="input" style={{ height: 34 }} autoFocus={i === 0} value={v} onChange={(e) => setEdit({ ...edit, values: edit.values.map((x, j) => (j === i ? e.target.value : x)) })} aria-label={list.columns[i]} /></td>)}</><td>New</td><td className="acts"><button className="btn-sm dark" onClick={save}>Save</button> <button className="btn-sm line" onClick={() => setEdit(null)}>Cancel</button></td></tr>
              )}
              {list.rows.map((r) => edit?.id === r.id ? (
                <tr key={r.id}>{edit.values.map((v, i) => <td key={i}><input className="input" style={{ height: 34 }} value={v} onChange={(e) => setEdit({ ...edit, values: edit.values.map((x, j) => (j === i ? e.target.value : x)) })} aria-label={list.columns[i]} /></td>)}<td><label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} />Active</label></td><td className="acts"><button className="btn-sm dark" onClick={save}>Save</button> <button className="btn-sm line" onClick={() => setEdit(null)}>Cancel</button></td></tr>
              ) : (
                <tr key={r.id} style={{ opacity: r.active ? 1 : 0.5 }}>{r.values.map((v, i) => <td key={i}>{v}</td>)}<td><Status label={r.active ? 'Active' : 'Inactive'} /></td><td className="acts"><button className="btn-sm line" onClick={() => setEdit({ id: r.id, values: [...r.values], active: r.active })}>Edit</button></td></tr>
              ))}
            </tbody>
          </table>
          {err && <div className="err-banner" role="alert" style={{ margin: 12 }}>{err}</div>}
        </div>
      )}
    </div>
  );
}
