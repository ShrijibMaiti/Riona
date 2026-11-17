import { useEffect, useMemo, useRef, useState } from 'react';
import { PageHeader } from '../../components/PageHeader';
import { ErrorState, SkeletonRows } from '../../components/ui';
import { orgTree, type OrgNode } from '../../data/selectors/people';
import { useEmployees } from '../../hooks/data';
import { initials } from '../../lib/format';
import { go } from '../../state/store';

const W = 200, H = 76, GX = 24, GY = 64;
type Placed = { node: OrgNode; x: number; y: number; parent?: Placed };

/** Lay out a tidy tree: leaves left to right, parents centred over their visible children. */
function layout(roots: OrgNode[], collapsed: Set<string>) {
  const out: Placed[] = [];
  let cursor = 0;
  const walk = (n: OrgNode, depth: number, parent?: Placed): Placed => {
    const p: Placed = { node: n, x: 0, y: depth * (H + GY), parent };
    out.push(p);
    const kids = collapsed.has(n.emp.id) ? [] : n.reports.map((r) => walk(r, depth + 1, p));
    if (!kids.length) { p.x = cursor; cursor += W + GX; }
    else p.x = (kids[0].x + kids[kids.length - 1].x) / 2;
    return p;
  };
  roots.forEach((r) => walk(r, 0));
  return out;
}

export default function OrgChart() {
  const emps = useEmployees();
  const roots = useMemo(() => (emps.data ? orgTree(emps.data.filter((e) => e.status !== 'Inactive')) : []), [emps.data]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [view, setView] = useState({ x: 40, y: 40, k: 0.8 });
  const [q, setQ] = useState('');
  const [focus, setFocus] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);

  // Start with deep branches collapsed below the second level.
  useEffect(() => {
    if (!roots.length) return;
    const c = new Set<string>();
    const walk = (n: OrgNode, d: number) => { if (d >= 2 && n.reports.length) c.add(n.emp.id); n.reports.forEach((r) => walk(r, d + 1)); };
    roots.forEach((r) => walk(r, 0));
    setCollapsed(c);
  }, [roots]);
  const placed = useMemo(() => layout(roots, collapsed), [roots, collapsed]);

  const centreOn = (id: string) => {
    // Expand every ancestor, then centre after layout.
    const anc = new Set(collapsed);
    let e = emps.data?.find((x) => x.id === id);
    while (e?.managerId) { anc.delete(e.managerId); e = emps.data?.find((x) => x.id === e!.managerId); }
    setCollapsed(anc);
    setFocus(id);
  };
  useEffect(() => {
    if (!focus || !box.current) return;
    const p = placed.find((x) => x.node.emp.id === focus);
    if (!p) return;
    const r = box.current.getBoundingClientRect();
    setView((v) => ({ ...v, x: r.width / 2 - (p.x + W / 2) * v.k, y: r.height / 2 - (p.y + H / 2) * v.k }));
  }, [focus, placed]);

  const matches = q.trim() ? (emps.data ?? []).filter((e) => (e.name + ' ' + e.title).toLowerCase().includes(q.toLowerCase())).slice(0, 6) : [];
  const zoom = (f: number) => setView((v) => ({ ...v, k: Math.max(0.3, Math.min(1.6, v.k * f)) }));
  const width = Math.max(...placed.map((p) => p.x + W), 0), height = Math.max(...placed.map((p) => p.y + H), 0);

  if (emps.error) return <div className="wrap page"><ErrorState error={emps.error} retry={emps.refetch} /></div>;
  return (
    <div className="wrap page" style={{ paddingBottom: 60 }}>
      <PageHeader title="Org chart" desc="Reporting lines across the company. Drag to pan, ⌘/Ctrl + scroll or the buttons to zoom, and click a branch’s count to open or fold it."
        views={[{ label: 'Table', href: '/app/people/directory' }, { label: 'Org chart', href: '/app/people/org-chart' }]} current="/app/people/org-chart" />
      <div className="fbar">
        <div className="fsearch" style={{ position: 'relative' }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#6F7268" strokeWidth="1.6" aria-hidden><circle cx="7" cy="7" r="5" /><path d="M11 11l3.5 3.5" /></svg>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a person" aria-label="Find a person"
            onKeyDown={(e) => { if (e.key === 'Enter' && matches[0]) { centreOn(matches[0].id); setQ(''); } }} />
          {matches.length > 0 && (
            <div className="picker" style={{ top: 42, left: 0 }}>
              {matches.map((m) => <button key={m.id} className="picker-row" onClick={() => { centreOn(m.id); setQ(''); }}><span className="pcell-av" style={{ width: 26, height: 26, fontSize: 11 }}>{initials(m.name)}</span><span><b>{m.name}</b><span>{m.title}</span></span></button>)}
            </div>
          )}
        </div>
        <div className="fspacer" />
        <div className="viewseg" style={{ marginTop: 0 }}>
          <button onClick={() => zoom(1 / 1.2)} aria-label="Zoom out">−</button>
          <button onClick={() => setView({ x: 40, y: 40, k: 0.8 })}>Fit</button>
          <button onClick={() => zoom(1.2)} aria-label="Zoom in">+</button>
        </div>
        <button className="btn-line" onClick={() => setCollapsed(new Set())}>Expand all</button>
      </div>
      {!emps.data ? <div className="card" style={{ marginTop: 16 }}><SkeletonRows /></div> : (
        <div ref={box} className="org-canvas card"
          onPointerDown={(e) => { if ((e.target as HTMLElement).closest('button,a')) return; drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }}
          onPointerMove={(e) => { if (drag.current) setView((v) => ({ ...v, x: drag.current!.vx + e.clientX - drag.current!.x, y: drag.current!.vy + e.clientY - drag.current!.y })); }}
          onPointerUp={() => (drag.current = null)}
          onWheel={(e) => { if (e.ctrlKey || e.metaKey) zoom(e.deltaY > 0 ? 1 / 1.08 : 1.08); }}>
          <div className="org-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`, width, height }}>
            <svg width={width} height={height} style={{ position: 'absolute', inset: 0, overflow: 'visible' }} aria-hidden>
              {placed.filter((p) => p.parent).map((p) => {
                const a = p.parent!, x1 = a.x + W / 2, y1 = a.y + H, x2 = p.x + W / 2, y2 = p.y, my = y1 + GY / 2;
                return <path key={p.node.emp.id} d={`M${x1},${y1} V${my} H${x2} V${y2}`} fill="none" stroke="#C3C7B8" />;
              })}
            </svg>
            {placed.map((p) => {
              const e = p.node.emp;
              const folded = collapsed.has(e.id);
              return (
                <div key={e.id} className={'org-node' + (focus === e.id ? ' focus' : '')} style={{ left: p.x, top: p.y, width: W, height: H }}>
                  <a href={'#/app/people/directory/' + e.id} onClick={(ev) => { ev.preventDefault(); go('/app/people/directory/' + e.id); }} className="org-main">
                    <span className="pcell-av" style={{ width: 30, height: 30, fontSize: 11 }}>{initials(e.name)}</span>
                    <span style={{ minWidth: 0 }}><b>{e.name}</b><i>{e.title}</i></span>
                  </a>
                  {p.node.reports.length > 0 && (
                    <button className="org-toggle" aria-expanded={!folded} aria-label={(folded ? 'Show ' : 'Hide ') + (p.node.size - 1) + ' people under ' + e.name}
                      onClick={() => { const c = new Set(collapsed); if (folded) c.delete(e.id); else c.add(e.id); setCollapsed(c); }}>
                      {folded ? '+' + (p.node.size - 1) : '−'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
