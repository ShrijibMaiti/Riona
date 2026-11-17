import { HUBS, LABELS } from '../config/hubs';

/** Any /app path that no screen answers: says so and offers the way back to the hub. */
export function NotFound({ seg }: { seg: string[] }) {
  const hub = HUBS[seg[1]];
  return (
    <div className="wrap page">
      <div className="empty" role="alert" style={{ marginTop: 48 }}>
        <div className="empty-t">There’s nothing at this address.</div>
        <div className="empty-s">The link may be old, or the record may have been removed. <span className="mono">#/{seg.join('/')}</span></div>
        <a href={'#' + (hub ? hub.path : '/app')} className="btn-dark" style={{ marginTop: 20 }}>Back to {hub ? hub.label : 'the dashboard'}</a>
      </div>
    </div>
  );
}

/** Breadcrumbs; `names` resolves record ids (E-0112, P-214…) to display names. */
export function Breadcrumbs({ seg, names }: { seg: string[]; names?: Record<string, string> }) {
  let acc = '/app';
  const rest = seg.slice(1);
  return (
    <nav className="wrap crumbs" aria-label="Breadcrumb">
      {rest.map((x, i) => {
        acc += '/' + x;
        let label = LABELS[x] || x;
        label = names?.[x] ?? label;
        if (seg[1] === 'me' && i > 0 && ['leave', 'attendance', 'expenses', 'assets'].includes(x)) label = 'My ' + label.toLowerCase();
        const last = i === rest.length - 1;
        return (
          <span key={acc} style={{ display: 'flex', gap: 8 }}>
            {i > 0 && <span className="sep">/</span>}
            {last ? <span className="here" aria-current="page">{label}</span> : <a href={'#' + acc}>{label}</a>}
          </span>
        );
      })}
    </nav>
  );
}
