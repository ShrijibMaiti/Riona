/**
 * FIG. 01: one real timesheet entry (TE-00176 in the demo organisation) drawn as an isometric slab resting on the
 * three ledgers it feeds: payroll cost, the invoice line and the margin. Every number is computed from the entry.
 */
import { inr } from './content';

/** The entry and its rates, as recorded in the Kestrel Digital demo data. */
export const ENTRY = {
  id: 'TE-00176',
  person: 'Aarav Shah',
  title: 'Senior Engineer',
  project: 'Fleet Ops Portal',
  client: 'Northwind Logistics',
  date: '29 Sep 2026',
  iso: '2026-09-29',
  task: 'Spec writing',
  hours: 7,
  costRate: 1655, // ₹19,86,000 CTC × 1.4 overhead ÷ 12 ÷ 140 productive hours
  billRate: 2600,
  invoice: 'INV-2026-0151',
};

type P = [number, number];
const EX: P = [0.866, 0.5];
const EY: P = [-0.866, 0.5];
const add = (p: P, k: number, d: P): P => [p[0] + k * d[0], p[1] + k * d[1]];
const down = (p: P, h: number): P => [p[0], p[1] + h];
const pts = (ps: P[]) => ps.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');

function slab(back: P, w: number, h: number) {
  const right = add(back, w, EX), left = add(back, w, EY), front = add(right, w, EY);
  return { back, right, left, front, top: [back, right, front, left], lf: [left, front, down(front, h), down(left, h)], rf: [front, right, down(right, h), down(front, h)] };
}

const MONO = { fontFamily: "'IBM Plex Mono', ui-monospace, monospace" };
const SANS = { fontFamily: "'Geist', system-ui, sans-serif" };

export function EntryFigure() {
  const { hours, costRate, billRate } = ENTRY;
  const cost = hours * costRate, bill = hours * billRate, margin = bill - cost;
  const pct = ((margin / bill) * 100).toFixed(1);

  const CX = 330, TOP = 92, W = 200, GAP = 38;
  const ledgers = [0, 1, 2].map((i) => slab([CX, TOP + i * GAP], W, 12));
  const centre: P = [CX, TOP + W / 2]; // centre of the top ledger's face
  const eTop: P = [centre[0], centre[1] - 16];
  const entry = slab(add(add(eTop, -56, EX), -56, EY), 112, 16);

  // Leader lines: start on a face, run along an isometric axis, then level out to the label.
  const leaders = [
    { from: [410, 172] as P, dir: [0.866, -0.5] as P, k: 70, end: 492, side: 'r' as const, dot: '#D4421F' },
    { from: [200, 180] as P, dir: [-0.866, -0.5] as P, k: 80, end: 100, side: 'l' as const, dot: '#252823' },
    { from: [415.3, 287] as P, dir: [0.866, 0.5] as P, k: 60, end: 492, side: 'r' as const, dot: '#252823' },
    { from: [233.4, 318] as P, dir: [-0.866, 0.5] as P, k: 120, end: 100, side: 'l' as const, dot: '#252823' },
  ].map((l) => {
    const knee = add(l.from, l.k, l.dir);
    return { ...l, knee, d: `M${l.from[0]} ${l.from[1]} L${knee[0].toFixed(1)} ${knee[1].toFixed(1)} L${l.end} ${knee[1].toFixed(1)}`, y: knee[1] };
  });
  const lab = (i: number, k: string, v: string, f: string, vColour = '#252823') => {
    const L = leaders[i];
    const x = L.side === 'r' ? L.end + 6 : L.end - 6;
    const anchor = L.side === 'r' ? 'start' : 'end';
    return (
      <g className="fig-ann" key={k}>
        <text x={x} y={L.y - 14} textAnchor={anchor} style={MONO} fontSize="10.5" letterSpacing="0.8" fill="#676A61">{k}</text>
        <text x={x} y={L.y + 9} textAnchor={anchor} style={SANS} fontSize="21" fontWeight="550" letterSpacing="-0.8" fill={vColour}>{v}</text>
        <text x={x} y={L.y + 27} textAnchor={anchor} style={MONO} fontSize="10.5" fill="#676A61">{f}</text>
      </g>
    );
  };

  // A faint isometric grid behind the drawing.
  const grid: string[] = [];
  for (let i = -8; i <= 8; i++) {
    const y0 = 270 + i * 46;
    grid.push(`M40 ${(y0 - 290 * 0.577).toFixed(1)} L620 ${(y0 + 290 * 0.577).toFixed(1)}`);
    grid.push(`M40 ${(y0 + 290 * 0.577).toFixed(1)} L620 ${(y0 - 290 * 0.577).toFixed(1)}`);
  }

  return (
    <figure className="s-fig">
      <svg viewBox="0 0 660 480" role="img" aria-labelledby="fig1-t fig1-d">
        <title id="fig1-t">One timesheet entry, three figures</title>
        <desc id="fig1-d">{`${ENTRY.id}: ${ENTRY.person}, ${hours} hours on ${ENTRY.project} on ${ENTRY.date}. Payroll cost ${inr(cost)} at ${inr(costRate)} an hour. Invoice line ${inr(bill)} on ${ENTRY.invoice} at ${inr(billRate)} an hour. Margin ${inr(margin)}, ${pct}% of the line.`}</desc>
        <defs>
          <clipPath id="fig1-clip"><rect x="40" y="56" width="580" height="392" /></clipPath>
        </defs>
        <text className="fig-ann" x="330" y="30" textAnchor="middle" style={MONO} fontSize="11" letterSpacing="1.2" fill="#676A61">FIG. 01 — ONE ENTRY, THREE FIGURES</text>
        <g clipPath="url(#fig1-clip)" stroke="#E2E4DA" strokeWidth="1" strokeDasharray="2 5" fill="none">
          {grid.map((d) => <path key={d} d={d} />)}
        </g>

        {[2, 1, 0].map((i) => {
          const s = ledgers[i];
          return (
            <g key={i} stroke="#8A9281" strokeWidth="0.8" strokeLinejoin="round">
              <polygon points={pts(s.lf)} fill="#E1E5D6" />
              <polygon points={pts(s.rf)} fill="#CED6C0" />
              <polygon points={pts(s.top)} fill={i === 0 ? '#FBFCF6' : '#F1F3EA'} />
              {i === 0 && <polygon points={pts([add(add(s.back, 14, EX), 14, EY), add(add(s.right, -14, EX), 14, EY), add(add(s.front, -14, EX), -14, EY), add(add(s.left, 14, EX), -14, EY)])} fill="none" stroke="#C3C7B8" strokeDasharray="3 3" />}
            </g>
          );
        })}

        <g strokeLinejoin="round">
          <polygon points={pts(entry.lf)} fill="#B9361A" />
          <polygon points={pts(entry.rf)} fill="#D4421F" />
          <polygon points={pts(entry.top)} fill="#EF582E" />
          <polygon points={pts([add(add(entry.back, 12, EX), 12, EY), add(add(entry.right, -12, EX), 12, EY), add(add(entry.front, -12, EX), -12, EY), add(add(entry.left, 12, EX), -12, EY)])} fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="0.8" />
          <text className="fig-ann" transform={`matrix(0.866 0.5 -0.866 0.5 ${eTop[0]} ${eTop[1] + 4})`} textAnchor="middle" style={SANS} fontSize="17" fontWeight="600" letterSpacing="-0.4" fill="#FFFFFF">{hours.toFixed(1)} h</text>
          <text className="fig-ann" transform={`matrix(0.866 -0.5 0 1 ${(entry.front[0] + 9).toFixed(1)} ${(entry.front[1] + 6).toFixed(1)})`} style={MONO} fontSize="7" letterSpacing="0.6" fill="rgba(255,255,255,0.85)">{ENTRY.id}</text>
        </g>

        {leaders.map((l, i) => (
          <g key={i} className="fig-ann">
            <path d={l.d} pathLength={1} className="lead-line" fill="none" stroke={i === 0 ? '#D4421F' : '#3B3F37'} strokeWidth="1" style={{ animationDelay: 300 + i * 160 + 'ms' }} />
            <circle cx={l.from[0]} cy={l.from[1]} r="2.6" fill={l.dot} className="lead-dot" style={{ animationDelay: 200 + i * 160 + 'ms' }} />
          </g>
        ))}
        {lab(0, ENTRY.id, hours.toFixed(1) + ' h', ENTRY.person + ' · ' + ENTRY.date, '#D4421F')}
        {lab(1, 'PAYROLL COST', inr(cost), hours + ' h × ' + inr(costRate))}
        {lab(2, 'INVOICE LINE', inr(bill), ENTRY.invoice + ' · paid')}
        {lab(3, 'MARGIN', '+' + inr(margin), pct + '% of the line')}

        <line className="fig-ann" x1="140" y1="458" x2="220" y2="458" stroke="#DFE1D7" />
        <line className="fig-ann" x1="440" y1="458" x2="520" y2="458" stroke="#DFE1D7" />
        <text className="fig-ann" x="330" y="462" textAnchor="middle" style={MONO} fontSize="11" letterSpacing="1.2" fill="#676A61">{ENTRY.project.toUpperCase()} · {ENTRY.client.toUpperCase()}</text>
      </svg>
      <figcaption className="s-cap fig-cap">FIG. 01 — One entry, three figures · {ENTRY.project}, {ENTRY.client}</figcaption>
      <div className="fig-legend" aria-hidden="true">
        <div><span>{ENTRY.id} · {ENTRY.person} · {ENTRY.date}</span><b style={{ color: 'var(--signal)' }}>{hours.toFixed(1)} h</b></div>
        <div><span>Payroll cost · {hours} h × {inr(costRate)}</span><b>{inr(cost)}</b></div>
        <div><span>Invoice line · {ENTRY.invoice}</span><b>{inr(bill)}</b></div>
        <div><span>Margin · {pct}% of the line</span><b>+{inr(margin)}</b></div>
      </div>
    </figure>
  );
}
