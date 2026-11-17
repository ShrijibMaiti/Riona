import { useEffect, useMemo, useRef, useState } from 'react';
import { DataTable, Mono, PersonCell, Status, TextCell, type Column } from '../../components/DataTable';
import { Modal, PersonPicker } from '../../components/Dialogs';
import { FilterBar } from '../../components/FilterBar';
import { PageHeader } from '../../components/PageHeader';
import { KVList } from '../../components/Panels';
import { ErrorState, SkeletonRows, StatusLabel } from '../../components/ui';
import * as api from '../../data/repositories';
import type { Asset, InventoryItem, KbArticle, Visitor } from '../../data/types';
import { useEmployees, useMe } from '../../hooks/data';
import { NOW, addDays, daysBetween } from '../../lib/dates';
import { SC, ddm, dm, dmy, inr } from '../../lib/format';
import { all, invalidate, useQuery } from '../../lib/query';
import { go, useApp } from '../../state/store';

// ---------------- assets ----------------
export function Assets() {
  const q = all({ assets: useQuery(['assets'], api.getAssets), emps: useEmployees() });
  const [search, setSearch] = useState('');
  const [f, setF] = useState({ cat: '', status: '' });
  if (q.error) return <div className="wrap page"><ErrorState error={q.error} retry={q.refetch} /></div>;
  const holder = (a: Asset) => a.allocations.find((x) => !x.to)?.employeeId;
  const nm = (id?: string) => (id ? q.data?.emps.find((e) => e.id === id)?.name ?? id : '');
  const rows = q.data?.assets.filter((a) => (!search || (a.tag + a.name + a.serial + nm(holder(a))).toLowerCase().includes(search.toLowerCase())) && (!f.cat || a.category === f.cat) && (!f.status || a.status === f.status));
  const cols: Column<Asset>[] = [
    { key: 't', header: 'Tag', render: (a) => <Mono>{a.tag}</Mono>, sort: (a) => a.tag, mobile: true },
    { key: 'c', header: 'Category', render: (a) => a.category, sort: (a) => a.category },
    { key: 'm', header: 'Make and model', render: (a) => <span className="nowrap">{a.name}</span>, sort: (a) => a.name, mobile: true },
    { key: 's', header: 'Serial', render: (a) => <Mono>{a.serial}</Mono> },
    { key: 'h', header: 'Assigned to', render: (a) => (holder(a) ? <PersonCell name={nm(holder(a))} /> : '—'), sort: (a) => nm(holder(a)) },
    { key: 'cd', header: 'Condition', render: (a) => (a.status === 'Under repair' ? 'At vendor' : daysBetween(a.purchased, '2026-11-06') > 700 ? 'Fair' : 'Good') },
    { key: 'st', header: 'Status', render: (a) => <Status label={a.status} />, sort: (a) => a.status, mobile: true },
  ];
  return (
    <div className="wrap page" style={{ paddingBottom: 140 }}>
      <PageHeader title="Assets" desc={(q.data?.assets.length ?? '—') + ' tracked items. Each keeps the full history of who held it.'} />
      <FilterBar search={search} onSearch={setSearch} filters={[
        { key: 'c', label: 'Categories', options: ['Laptop', 'Monitor', 'Phone', 'Accessory', 'Furniture', 'Licence'], value: f.cat, onChange: (v) => setF({ ...f, cat: v }) },
        { key: 's', label: 'Statuses', options: ['Allocated', 'Available', 'Under repair', 'Retired'], value: f.status, onChange: (v) => setF({ ...f, status: v }) },
      ]} />
      <DataTable rows={rows} columns={cols} rowKey={(a) => a.id} onOpen={(a) => go('/app/workplace/assets/' + a.id)} />
    </div>
  );
}

export function AssetDetail({ id }: { id: string }) {
  const { say, role } = useApp();
  const q = all({ me: useMe(), a: useQuery(['assets', id], () => api.getAsset(id)), emps: useEmployees() });
  const [pick, setPick] = useState(false);
  if (q.error) return <div className="wrap page"><ErrorState error={q.error} retry={q.refetch} /></div>;
  if (!q.data) return <div className="wrap page"><SkeletonRows /></div>;
  const { a, emps, me } = q.data;
  const nm = (eid: string) => emps.find((e) => e.id === eid)?.name ?? eid;
  const open = a.allocations.find((x) => !x.to);
  const start = a.purchased, end = me.today;
  const span = Math.max(1, daysBetween(start, end));
  const pos = (d: string) => (daysBetween(start, d) / span) * 100;
  const canEdit = role === 'Admin' || role === 'HR';
  const allocate = async (eid: string | null) => { await api.allocateAsset(a.id, eid, eid ? 'Issued' : 'Returned to store'); invalidate('assets', 'audit'); say(eid ? a.tag + ' issued to ' + nm(eid) : a.tag + ' returned to store'); setPick(false); };
  return (
    <div className="wrap page" style={{ paddingBottom: 140, maxWidth: 1100 }}>
      <PageHeader title={a.name} desc={<><span className="mono">{a.tag}</span> · {a.category} · serial <span className="mono">{a.serial}</span></>} aside={<StatusLabel label={a.status} />}
        primary={canEdit ? (open ? { label: 'Return to store', onClick: () => allocate(null) } : { label: 'Allocate', onClick: () => setPick(true) }) : undefined} />
      {pick && <div style={{ position: 'relative' }}><div style={{ position: 'absolute', right: 0, top: 8, zIndex: 70 }}><PersonPicker people={emps.filter((e) => e.status !== 'Inactive')} onPick={(e) => allocate(e.id)} onClose={() => setPick(false)} label="Allocate to…" /></div></div>}
      <div className="section-title" style={{ marginTop: 36 }}>Allocation timeline</div>
      <div className="card asset-tl">
        <div className="atl-axis"><span>Purchased {dmy(start)}</span><span>Today</span></div>
        <div className="atl-track">
          {a.allocations.map((al, i) => (
            <div key={i} className={'atl-bar' + (al.to ? '' : ' open')} style={{ left: pos(al.from) + '%', width: Math.max(1.5, pos(al.to ?? end) - pos(al.from)) + '%' }} title={nm(al.employeeId) + ' · ' + dmy(al.from) + ' – ' + (al.to ? dmy(al.to) : 'now')}>
              <span>{nm(al.employeeId)}</span>
            </div>
          ))}
          {!a.allocations.length && <span className="empty-s" style={{ position: 'absolute', left: 12, top: 12 }}>Never allocated.</span>}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 48, flexWrap: 'wrap', marginTop: 32 }}>
        <div style={{ flex: '1 1 320px' }}><div className="section-title">Item</div><KVList rows={[['Purchased', dmy(a.purchased)], ['Cost', inr(a.cost)], ['Held by', open ? nm(open.employeeId) : 'In store'], ['Since', open ? dmy(open.from) : '—']]} /></div>
        <div style={{ flex: '1.2 1 380px' }}>
          <div className="section-title">History</div>
          {[...a.allocations].reverse().map((al, i) => <div key={i} className="kv" style={{ gridTemplateColumns: '1fr auto' }}><a href={'#/app/people/directory/' + al.employeeId} style={{ color: 'var(--ink)' }}>{nm(al.employeeId)}<span className="cell-sub">{al.note}</span></a><span>{dm(al.from)} – {al.to ? dmy(al.to) : 'now'}</span></div>)}
        </div>
      </div>
    </div>
  );
}

// ---------------- inventory ----------------
export function Inventory() {
  const q = useQuery(['inventory'], api.getInventory);
  const [move, setMove] = useState<{ item: InventoryItem; kind: 'in' | 'out' } | null>(null);
  const [search, setSearch] = useState('');
  if (q.error) return <div className="wrap page"><ErrorState error={q.error} retry={q.refetch} /></div>;
  const statusOf = (i: InventoryItem) => (i.stock < i.reorderLevel ? 'Below reorder' : i.stock < i.reorderLevel * 1.4 ? 'Reorder soon' : 'In stock');
  const rows = q.data?.filter((i) => !search || i.name.toLowerCase().includes(search.toLowerCase())).sort((a, b) => (a.stock / a.reorderLevel) - (b.stock / b.reorderLevel));
  const cols: Column<InventoryItem>[] = [
    { key: 'n', header: 'Item', render: (i) => <TextCell text={<b style={{ fontWeight: 500 }}>{i.name}</b>} sub={i.location} />, mobile: true },
    { key: 'u', header: 'Unit', render: (i) => i.unit },
    { key: 's', header: 'In stock', align: 'right', render: (i) => <span className="num" style={{ color: i.stock < i.reorderLevel ? SC.red : undefined, fontWeight: i.stock < i.reorderLevel ? 600 : 400 }}>{i.stock}</span>, mobile: true },
    { key: 'r', header: 'Reorder at', align: 'right', render: (i) => <span className="num">{i.reorderLevel}</span> },
    { key: 'l', header: 'Last restocked', render: (i) => dmy([...i.movements].reverse().find((m) => m.kind === 'in')?.date) },
    { key: 'st', header: 'Status', render: (i) => <Status label={statusOf(i)} />, mobile: true },
    { key: 'a', header: '', render: (i) => <span style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }} onClick={(e) => e.stopPropagation()}><button className="btn-sm line" onClick={() => setMove({ item: i, kind: 'in' })}>Stock in</button><button className="btn-sm line" onClick={() => setMove({ item: i, kind: 'out' })}>Issue</button></span> },
  ];
  return (
    <div className="wrap page" style={{ paddingBottom: 140 }}>
      <PageHeader title="Inventory" desc="Consumables. Items below their reorder level sort to the top and are marked red." />
      <FilterBar search={search} onSearch={setSearch} />
      <DataTable rows={rows} columns={cols} rowKey={(i) => i.id} rowClass={(i) => (i.stock < i.reorderLevel ? 'row-red' : '')} />
      {move && <StockMove item={move.item} kind={move.kind} onClose={() => setMove(null)} />}
    </div>
  );
}

/** One of the three permitted modals: stock in / out. */
function StockMove({ item, kind, onClose }: { item: InventoryItem; kind: 'in' | 'out'; onClose: () => void }) {
  const { say } = useApp();
  const [qty, setQty] = useState('');
  const [note, setNote] = useState(kind === 'in' ? 'Restock' : 'Issued to floor');
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    try { await api.moveStock(item.id, kind, +qty, note); invalidate('inventory'); say((kind === 'in' ? 'Received ' : 'Issued ') + qty + ' ' + item.unit + ' · ' + item.name); onClose(); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <Modal title={(kind === 'in' ? 'Stock in · ' : 'Issue · ') + item.name} onClose={onClose}>
      <div className="sub">{item.stock} {item.unit} in stock · reorder at {item.reorderLevel}</div>
      {err && <div className="err-banner" role="alert" style={{ marginTop: 14 }}>{err}</div>}
      <div className="form-grid" style={{ marginTop: 18, gridTemplateColumns: '120px 1fr' }}>
        <label className="field"><span>Quantity</span><input autoFocus inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d]/g, ''))} /></label>
        <label className="field"><span>Note</span><input value={note} onChange={(e) => setNote(e.target.value)} /></label>
      </div>
      <div className="modal-actions"><button className="btn-line" onClick={onClose}>Cancel</button><button className="btn-dark" disabled={!(+qty > 0)} onClick={save}>{kind === 'in' ? 'Record receipt' : 'Record issue'}</button></div>
    </Modal>
  );
}

// ---------------- rooms ----------------
const START = 9 * 60, END = 19 * 60;
const toMin = (hm: string) => +hm.slice(0, 2) * 60 + +hm.slice(3);
const toHm = (m: number) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
export function Rooms() {
  const { say } = useApp();
  const me = useMe();
  const [day, setDay] = useState<string | null>(null);
  const date = day ?? me.data?.today ?? '';
  const q = all({ rooms: useQuery(['rooms'], api.getRooms), bookings: useQuery(['bookings', date], () => api.getBookings(date), { enabled: !!date }), emps: useEmployees() });
  const [draft, setDraft] = useState<{ roomId: string; start: number; end: number; title: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (q.error) return <div className="wrap page"><ErrorState error={q.error} retry={q.refetch} /></div>;
  const nowMin = date === me.data?.today ? toMin(NOW.slice(11, 16)) : -1;
  const slots = Array.from({ length: (END - START) / 30 }, (_, i) => START + i * 30);
  const pct = (m: number) => ((m - START) / (END - START)) * 100;
  const book = async () => {
    if (!draft || !draft.title.trim()) return;
    try { await api.createBooking({ roomId: draft.roomId, date, start: toHm(draft.start), end: toHm(draft.end), title: draft.title.trim() }); invalidate('bookings'); say(q.data?.rooms.find((r) => r.id === draft.roomId)?.name + ' booked ' + toHm(draft.start) + '–' + toHm(draft.end)); setDraft(null); setErr(null); }
    catch (e) { setErr((e as Error).message); }
  };
  return (
    <div className="wrap page wide" style={{ paddingBottom: 140 }}>
      <PageHeader title="Rooms" desc="A day view of every room. Click an empty half-hour to book it; booked spans can’t be clicked." />
      <div className="fbar">
        <div className="weekpick" style={{ height: 36 }}><button aria-label="Previous day" onClick={() => setDay(addDays(date, -1))}>‹</button><div style={{ minWidth: 150 }}>{date && ddm(date)}</div><button aria-label="Next day" onClick={() => setDay(addDays(date, 1))}>›</button></div>
        {date !== me.data?.today && <button className="btn-line" style={{ height: 36 }} onClick={() => setDay(null)}>Today</button>}
      </div>
      {draft && (
        <div className="card addtask">
          <b style={{ fontSize: 14 }}>{q.data?.rooms.find((r) => r.id === draft.roomId)?.name}</b>
          <select className="input" style={{ width: 110, flex: 'none' }} value={draft.start} onChange={(e) => setDraft({ ...draft, start: +e.target.value, end: Math.max(+e.target.value + 30, draft.end) })} aria-label="Start">{slots.map((s) => <option key={s} value={s}>{toHm(s)}</option>)}</select>
          <select className="input" style={{ width: 110, flex: 'none' }} value={draft.end} onChange={(e) => setDraft({ ...draft, end: +e.target.value })} aria-label="End">{slots.map((s) => s + 30).filter((s) => s > draft.start).map((s) => <option key={s} value={s}>{toHm(s)}</option>)}</select>
          <input className="input" autoFocus placeholder="What is it for?" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && book()} aria-label="Booking title" />
          <button className="btn-dark" disabled={!draft.title.trim()} onClick={book}>Book</button><button className="btn-line" onClick={() => { setDraft(null); setErr(null); }}>Cancel</button>
          {err && <span className="err" style={{ width: '100%', fontSize: 13, color: 'var(--red)' }}>{err}</span>}
        </div>
      )}
      {!q.data ? <SkeletonRows /> : (
        <div className="card rooms" style={{ marginTop: 16 }}>
          <div className="rooms-inner">
            <div className="rooms-row rooms-head"><span /><div style={{ position: 'relative' }}>{slots.filter((s) => s % 60 === 0).map((s) => <span key={s} className="rooms-hr" style={{ left: pct(s) + '%' }}>{toHm(s)}</span>)}</div></div>
            {q.data.rooms.map((r) => {
              const bs = q.data!.bookings.filter((b) => b.roomId === r.id);
              return (
                <div key={r.id} className="rooms-row">
                  <div className="rooms-name"><b>{r.name}</b><i>Floor {r.floor} · {r.capacity} seats{r.equipment.length ? ' · ' + r.equipment.join(', ') : ''}</i></div>
                  <div className="rooms-track">
                    {slots.map((s) => {
                      const busy = bs.some((b) => toMin(b.start) < s + 30 && toMin(b.end) > s);
                      const past = nowMin >= 0 && s + 30 <= nowMin;
                      return busy || past ? null : <button key={s} className="rooms-free" style={{ left: pct(s) + '%', width: (30 / (END - START)) * 100 + '%' }} aria-label={'Book ' + r.name + ' at ' + toHm(s)} onClick={() => setDraft({ roomId: r.id, start: s, end: s + 60 <= END && !bs.some((b) => toMin(b.start) < s + 60 && toMin(b.end) > s + 30) ? s + 60 : s + 30, title: '' })} />;
                    })}
                    {bs.map((b) => (
                      <div key={b.id} className="rooms-busy" aria-disabled="true" style={{ left: pct(toMin(b.start)) + '%', width: pct(toMin(b.end)) - pct(toMin(b.start)) + '%' }} title={b.title + ' · ' + b.start + '–' + b.end + ' · ' + q.data!.emps.find((e) => e.id === b.bookedById)?.name}>
                        <span>{b.title}</span>
                      </div>
                    ))}
                    {nowMin > START && nowMin < END && <span className="gantt-today" style={{ left: pct(nowMin) + '%' }} />}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- announcements ----------------
export function Announcements() {
  const { say, role } = useApp();
  const q = all({ me: useMe(), list: useQuery(['announcements'], api.getAnnouncements), emps: useEmployees() });
  if (q.error) return <div className="wrap page"><ErrorState error={q.error} retry={q.refetch} /></div>;
  const meId = q.data?.me.employee.id ?? '';
  const ack = async (id: string) => { await api.acknowledge(id); invalidate('announcements'); say('Acknowledged'); };
  const list = q.data ? [...q.data.list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.posted.localeCompare(a.posted)) : [];
  return (
    <div className="wrap page" style={{ paddingBottom: 140, maxWidth: 860 }}>
      <PageHeader title="Announcements" desc="Company news. Some posts ask you to acknowledge that you have read them." />
      {!q.data ? <SkeletonRows /> : list.filter((a) => a.audienceIds.includes(meId) || role === 'Admin' || role === 'HR').map((a) => {
        const acked = a.ackIds.includes(meId);
        const pc = Math.round((a.ackIds.length / a.audienceIds.length) * 100);
        return (
          <article key={a.id} className="card ann">
            <div className="ann-h">{a.pinned && <span className="pill" style={{ fontSize: 11.5, padding: '2px 9px' }}>Pinned</span>}<span>{q.data!.emps.find((e) => e.id === a.authorId)?.name} · {dmy(a.posted)} · {a.audience}</span></div>
            <h2>{a.title}</h2>
            <p>{a.body}</p>
            {a.requiresAck && (
              <div className="ann-f">
                {acked ? <StatusLabel label="You acknowledged this" colour="green" /> : <button className="btn-dark" style={{ height: 36 }} onClick={() => ack(a.id)}>Acknowledge</button>}
                {(role === 'Admin' || role === 'HR') && <span style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--ink-3)' }}><span className="pr-bar" style={{ width: 120, flex: 'none' }}><span style={{ display: 'block', height: '100%', width: pc + '%', background: 'var(--violet)' }} /></span>{a.ackIds.length} of {a.audienceIds.length} · {pc}%</span>}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

// ---------------- knowledge base ----------------
export function KbHome() {
  const q = all({ arts: useQuery(['kb'], api.getKbArticles), emps: useEmployees() });
  const [search, setSearch] = useState('');
  if (q.error) return <div className="wrap page"><ErrorState error={q.error} retry={q.refetch} /></div>;
  const hits = q.data?.arts.filter((a) => !search || (a.title + a.category + a.sections.map((s) => s.heading + s.body.join(' ')).join(' ')).toLowerCase().includes(search.toLowerCase()));
  const cats = [...new Set(hits?.map((a) => a.category))].sort();
  return (
    <div className="wrap page" style={{ paddingBottom: 140, maxWidth: 960 }}>
      <PageHeader title="Knowledge base" desc="Policies, SOPs and how-tos, written to be read." />
      <FilterBar search={search} onSearch={setSearch} placeholder="Search articles" />
      {!q.data ? <SkeletonRows /> : cats.map((c) => (
        <section key={c} style={{ marginTop: 32 }}>
          <div className="section-title">{c}</div>
          {hits!.filter((a) => a.category === c).map((a) => (
            <a key={a.id} href={'#/app/workplace/kb/' + a.slug} className="kb-row"><b>{a.title}</b><span>{a.sections.map((s) => s.heading).slice(0, 3).join(' · ')}</span><i>Updated {dmy(a.updated)}</i></a>
          ))}
        </section>
      ))}
      {q.data && !hits!.length && <div className="empty"><div className="empty-t">No articles match “{search}”.</div></div>}
    </div>
  );
}

/** 720px reading column with a right-hand table of contents (the one permitted side rail). */
export function KbArticleView({ slug }: { slug: string }) {
  const q = all({ a: useQuery(['kb', slug], () => api.getKbArticle(slug)), emps: useEmployees() });
  const [active, setActive] = useState('s0');
  const refs = useRef<Record<string, HTMLElement | null>>({});
  useEffect(() => {
    if (!q.data) return;
    const obs = new IntersectionObserver((es) => { const v = es.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]; if (v) setActive(v.target.id); }, { rootMargin: '-80px 0px -60% 0px' });
    Object.values(refs.current).forEach((el) => el && obs.observe(el));
    return () => obs.disconnect();
  }, [q.data]);
  if (q.error) return <div className="wrap page"><ErrorState error={q.error} retry={q.refetch} /></div>;
  const a: KbArticle | undefined = q.data?.a;
  return (
    <div className="wrap page" style={{ paddingBottom: 160 }}>
      {!a ? <SkeletonRows /> : (
        <div className="kb-layout">
          <article className="kb-article">
            <div className="section-title">{a.category}</div>
            <h1 className="display" style={{ fontSize: 'clamp(34px, 4.5vw, 48px)' }}>{a.title}</h1>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 12 }}>Updated {dmy(a.updated)} by {q.data!.emps.find((e) => e.id === a.authorId)?.name}</div>
            {a.sections.map((s) => (
              <section key={s.id} id={s.id} ref={(el) => (refs.current[s.id] = el)}>
                <h2>{s.heading}</h2>
                {s.body.map((p, i) => <p key={i}>{p}</p>)}
              </section>
            ))}
          </article>
          <nav className="kb-toc" aria-label="On this page">
            <div className="section-title">On this page</div>
            {a.sections.map((s) => <a key={s.id} href={'#/app/workplace/kb/' + slug} onClick={(e) => { e.preventDefault(); document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} className={active === s.id ? 'on' : ''} aria-current={active === s.id ? 'true' : undefined}>{s.heading}</a>)}
          </nav>
        </div>
      )}
    </div>
  );
}

// ---------------- visitors ----------------
export function Visitors() {
  const { say } = useApp();
  const q = all({ me: useMe(), vs: useQuery(['visitors', 'all'], () => api.getVisitors()), emps: useEmployees() });
  const [pre, setPre] = useState(false);
  const [form, setForm] = useState({ name: '', company: '', hostId: '', purpose: '', date: '', expected: '10:00' });
  if (q.error) return <div className="wrap page"><ErrorState error={q.error} retry={q.refetch} /></div>;
  const today = q.data?.me.today ?? '';
  const rows = q.data?.vs.filter((v) => v.date >= today).sort((a, b) => a.date.localeCompare(b.date) || a.expected.localeCompare(b.expected));
  const statusOf = (v: Visitor) => (v.checkedOut ? 'Left' : v.checkedIn ? 'On site' : v.date > today ? 'Expected' : 'Expected');
  const cols: Column<Visitor>[] = [
    { key: 'v', header: 'Visitor', render: (v) => <PersonCell name={v.name} sub={v.company} />, sort: (v) => v.name, mobile: true },
    { key: 'h', header: 'Host', render: (v) => <span className="nowrap">{q.data!.emps.find((e) => e.id === v.hostId)?.name}</span> },
    { key: 'p', header: 'Purpose', render: (v) => <TextCell text={v.purpose} sub={v.date === today ? 'Today ' + v.expected : ddm(v.date) + ' ' + v.expected} /> },
    { key: 'i', header: 'In', render: (v) => <Mono>{v.checkedIn ?? '—'}</Mono>, mobile: true },
    { key: 'o', header: 'Out', render: (v) => <Mono>{v.checkedOut ?? '—'}</Mono> },
    { key: 'b', header: 'Badge', render: (v) => <Mono>{v.badge ?? '—'}</Mono> },
    { key: 's', header: 'Status', render: (v) => <Status label={statusOf(v)} colour={statusOf(v) === 'On site' ? 'green' : statusOf(v) === 'Left' ? 'gray' : 'blue'} />, mobile: true },
    { key: 'a', header: '', render: (v) => <span onClick={(e) => e.stopPropagation()}>{!v.checkedIn && v.date === today ? <button className="btn-sm line" onClick={async () => { await api.checkVisitor(v.id, 'in'); invalidate('visitors'); say(v.name + ' checked in'); }}>Check in</button> : v.checkedIn && !v.checkedOut ? <button className="btn-sm line" onClick={async () => { await api.checkVisitor(v.id, 'out'); invalidate('visitors'); say(v.name + ' checked out'); }}>Check out</button> : null}</span> },
  ];
  const register = async () => {
    if (!form.name.trim() || !form.hostId) return;
    await api.registerVisitor({ ...form, date: form.date || today }, false);
    invalidate('visitors'); say(form.name + ' pre-registered'); setPre(false); setForm({ name: '', company: '', hostId: '', purpose: '', date: '', expected: '10:00' });
  };
  return (
    <div className="wrap page" style={{ paddingBottom: 140 }}>
      <PageHeader title="Visitors" desc={today ? 'Today, ' + ddm(today) + '. ' + (q.data?.vs.filter((v) => v.date === today && v.checkedIn && !v.checkedOut).length ?? 0) + ' on site now.' : ' '}
        primary={{ label: 'Pre-register visitor', onClick: () => setPre(true) }} aside={<a className="btn-line" style={{ display: 'inline-flex', alignItems: 'center' }} href="#/app/workplace/visitors/kiosk">Open kiosk</a>} />
      {pre && (
        <div className="card addtask">
          <input className="input" placeholder="Visitor name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-label="Visitor name" />
          <input className="input" placeholder="Company" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} aria-label="Company" />
          <select className="input" value={form.hostId} onChange={(e) => setForm({ ...form, hostId: e.target.value })} aria-label="Host"><option value="">Host…</option>{q.data?.emps.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
          <input className="input" type="date" value={form.date || today} min={today} onChange={(e) => setForm({ ...form, date: e.target.value })} aria-label="Date" />
          <input className="input" type="time" value={form.expected} onChange={(e) => setForm({ ...form, expected: e.target.value })} aria-label="Expected at" style={{ flex: '0 1 120px' }} />
          <input className="input" placeholder="Purpose" value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} aria-label="Purpose" />
          <button className="btn-dark" disabled={!form.name.trim() || !form.hostId} onClick={register}>Register</button><button className="btn-line" onClick={() => setPre(false)}>Cancel</button>
        </div>
      )}
      <div style={{ marginTop: 24 }}><DataTable rows={rows} columns={cols} rowKey={(v) => v.id} /></div>
    </div>
  );
}

/** Front-desk kiosk: find yourself, or sign in as a walk-in. Large targets, no navigation chrome inside. */
export function Kiosk() {
  const q = all({ me: useMe(), vs: useQuery(['visitors', 'all'], () => api.getVisitors()), emps: useEmployees() });
  const [step, setStep] = useState<'find' | 'walkin' | 'done'>('find');
  const [search, setSearch] = useState('');
  const [walk, setWalk] = useState({ name: '', company: '', hostId: '', purpose: '' });
  const [done, setDone] = useState<Visitor | null>(null);
  const today = q.data?.me.today ?? '';
  const expected = useMemo(() => q.data?.vs.filter((v) => v.date === today && !v.checkedIn && (!search || v.name.toLowerCase().includes(search.toLowerCase()))) ?? [], [q.data, today, search]);
  const host = (id: string) => q.data?.emps.find((e) => e.id === id)?.name;
  const checkIn = async (v: Visitor) => { const r = await api.checkVisitor(v.id, 'in'); invalidate('visitors'); setDone(r); setStep('done'); };
  const walkIn = async () => { if (!walk.name.trim() || !walk.hostId) return; const r = await api.registerVisitor({ ...walk, date: today, expected: NOW.slice(11, 16) }, true); invalidate('visitors'); setDone(r); setStep('done'); };
  useEffect(() => { if (step !== 'done') return; const t = setTimeout(() => { setStep('find'); setSearch(''); setDone(null); setWalk({ name: '', company: '', hostId: '', purpose: '' }); }, 8000); return () => clearTimeout(t); }, [step]);
  if (q.error) return <div className="wrap page"><ErrorState error={q.error} retry={q.refetch} /></div>;
  return (
    <div className="kiosk">
      <div className="kiosk-in">
        <div className="wordmark" style={{ color: 'var(--ink)' }}>KESTREL DIGITAL</div>
        {step === 'find' && (
          <>
            <h1>Welcome. Who are you here to see?</h1>
            <input className="kiosk-input" autoFocus placeholder="Type your name" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Your name" />
            <div className="kiosk-list">
              {!q.data && <SkeletonRows n={3} />}
              {expected.map((v) => <button key={v.id} onClick={() => checkIn(v)}><b>{v.name}</b><span>{v.company} · to see {host(v.hostId)} at {v.expected}</span></button>)}
              {q.data && !expected.length && <div className="empty-s" style={{ padding: 20 }}>We don’t have you on today’s list.</div>}
            </div>
            <button className="kiosk-alt" onClick={() => setStep('walkin')}>I’m not on the list</button>
          </>
        )}
        {step === 'walkin' && (
          <>
            <h1>Sign in as a visitor</h1>
            <div className="form-grid" style={{ marginTop: 24 }}>
              <label className="field"><span>Your name</span><input autoFocus value={walk.name} onChange={(e) => setWalk({ ...walk, name: e.target.value })} /></label>
              <label className="field"><span>Company</span><input value={walk.company} onChange={(e) => setWalk({ ...walk, company: e.target.value })} /></label>
              <label className="field"><span>Here to see</span><select value={walk.hostId} onChange={(e) => setWalk({ ...walk, hostId: e.target.value })}><option value="">Choose…</option>{q.data?.emps.filter((e) => e.status !== 'Inactive').map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
              <label className="field"><span>Purpose</span><input value={walk.purpose} onChange={(e) => setWalk({ ...walk, purpose: e.target.value })} /></label>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 24 }}><button className="btn-dark" style={{ height: 52, padding: '0 28px', fontSize: 16 }} disabled={!walk.name.trim() || !walk.hostId} onClick={walkIn}>Sign in</button><button className="btn-line" style={{ height: 52 }} onClick={() => setStep('find')}>Back</button></div>
          </>
        )}
        {step === 'done' && done && (
          <>
            <h1>Thanks, {done.name.split(' ')[0]}.</h1>
            <p style={{ fontSize: 18, color: 'var(--ink-3)' }}>{host(done.hostId)} has been told you’re here. Please collect badge <b className="mono" style={{ fontSize: 18 }}>{done.badge}</b> from the desk.</p>
          </>
        )}
      </div>
      <a href="#/app/workplace/visitors" className="kiosk-exit">Exit kiosk</a>
    </div>
  );
}
