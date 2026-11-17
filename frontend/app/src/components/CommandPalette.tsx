import { shortcutLabel } from './Brand';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as api from '../data/repositories';
import { awaitingMe } from '../data/selectors/approvals';
import { useApprovals, useClients, useEmployees, useMe, useProjects } from '../hooks/data';
import { useQuery } from '../lib/query';
import { go } from '../state/store';
import { Shimmer } from './ui';

type Entry = [label: string, sub: string, target: string];

/** ⌘K — search people, projects, clients, invoices, tickets, articles, or run an action. */
export function CommandPalette({ close }: { close: () => void }) {
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const me = useMe(), emps = useEmployees(), projects = useProjects(), clients = useClients(), aps = useApprovals();
  const invoices = useQuery(['invoices', 'all-p'], () => api.getInvoices({ pageSize: 1000 }).then((p) => p.items));
  const tickets = useQuery(['tickets', 'all'], () => api.getTickets());
  const kb = useQuery(['kb'], api.getKbArticles);
  const ready = emps.data && projects.data && clients.data && invoices.data && tickets.data && kb.data && aps.data && me.data;

  const sources: [string, Entry[]][] = useMemo(() => {
    if (!ready) return [];
    const cname = (id: string) => clients.data!.find((c) => c.id === id)?.name ?? '';
    const pending = aps.data!.filter((a) => awaitingMe(a, me.data!.employee.id)).length;
    return [
      ['Actions', [
        ['Apply for leave', 'Action · My Space', '/app/me/leave'],
        ['Create invoice', 'Action · Finance', '/app/finance/invoices/new'],
        ['Submit expense claim', 'Action · Finance', '/app/finance/expenses/submit'],
        ['Start timer', 'Action · writes to this week’s timesheet', '/app/work/timesheets?timer=start'],
        ['Log time', 'Action · Timesheets', '/app/work/timesheets'],
        ['Review approvals', pending + ' waiting', '/app/approvals'],
        ['Raise ticket', 'Action · Clients', '/app/clients/tickets'],
        ['Book a room', 'Action · Workplace', '/app/workplace/rooms'],
      ]],
      ['People', emps.data!.map((p) => [p.name, p.title + ' · ' + p.dept, '/app/people/directory/' + p.id])],
      ['Projects', projects.data!.map((p) => [p.name, cname(p.clientId) + ' · ' + p.id, '/app/work/projects/' + p.id])],
      ['Clients', clients.data!.map((c) => [c.name, c.industry + ' · ' + c.city, '/app/clients/accounts/' + c.id])],
      ['Invoices', invoices.data!.map((i) => [i.number, cname(i.clientId) + ' · ' + i.status, '/app/finance/invoices/' + i.id])],
      ['Tickets', tickets.data!.map((t) => [t.id + ' ' + t.subject, cname(t.clientId), '/app/clients/tickets/' + t.id])],
      ['Articles', kb.data!.map((a) => [a.title, 'Knowledge base · ' + a.category, '/app/workplace/kb/' + a.slug])],
    ];
  }, [ready, emps.data, projects.data, clients.data, invoices.data, tickets.data, kb.data, aps.data, me.data]);

  const term = q.trim().toLowerCase();
  const groups = sources
    .map(([label, items]) => {
      let f = term
        ? items.filter((i) => (i[0] + ' ' + i[1]).toLowerCase().includes(term))
        : label === 'Actions' ? items.slice(0, 5) : label === 'People' ? items.slice(3, 6) : label === 'Projects' ? items.slice(0, 2) : [];
      f = f.slice(0, label === 'Actions' ? 8 : 5);
      return { label, items: f };
    })
    .filter((g) => g.items.length);
  const flat = groups.flatMap((g) => g.items);

  const run = (e: Entry) => {
    close();
    go(e[2]);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(flat.length - 1, i + 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
    if (e.key === 'Enter' && flat[idx]) run(flat[idx]);
  };

  let n = -1;
  return (
    <div className="overlay palette-wrap" onClick={close}>
      <div className="palette" role="dialog" aria-label="Search" onClick={(e) => e.stopPropagation()} onKeyDown={onKey}>
        <div className="palette-input">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#676A61" strokeWidth="1.6" aria-hidden><circle cx="7" cy="7" r="5" /><path d="M11 11l3.5 3.5" /></svg>
          <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setIdx(0); }} placeholder="Search people, projects, clients, invoices — or type an action" aria-label="Search" />
          <span className="kbd">esc</span>
        </div>
        <div className="palette-body">
          {!ready && <div style={{ padding: 16, display: 'grid', gap: 14 }}><Shimmer w="40%" /><Shimmer w="70%" /><Shimmer w="55%" /></div>}
          {groups.map((g) => (
            <div key={g.label}>
              <div className="eyebrow palette-group">{g.label}</div>
              {g.items.map((it) => {
                const i = ++n;
                return (
                  <div key={g.label + it[0] + it[2]} className={'palette-item' + (i === idx ? ' active' : '')} onMouseEnter={() => setIdx(i)} onClick={() => run(it)}>
                    <div className="l"><b>{it[0]}</b><span>{it[1]}</span></div>
                    <span className="enter">↵</span>
                  </div>
                );
              })}
            </div>
          ))}
          {ready && !flat.length && <div className="palette-empty">Nothing matches “{q}”.</div>}
        </div>
        <div className="palette-foot"><span>↑↓ to move</span><span>↵ to open</span><span>{shortcutLabel()} to toggle</span></div>
      </div>
    </div>
  );
}
