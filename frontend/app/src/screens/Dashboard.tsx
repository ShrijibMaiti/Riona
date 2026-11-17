import { DASHBOARDS } from '../config/dashboards';
import { MetricGrid } from '../components/MetricCard';
import { ErrorState, Shimmer, SkeletonCards, SkeletonRows } from '../components/ui';
import { useFacts } from '../hooks/data';
import { SC, dmy } from '../lib/format';
import { useApp } from '../state/store';
import { BlockAnalytics } from './BlockAnalytics';

const weekday = (iso: string) => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(iso + 'T12:00:00').getDay()];

export default function Dashboard() {
  const { role, settings } = useApp();
  const q = useFacts();
  const D = DASHBOARDS[role];
  const f = q.data?.facts;
  if (q.error && !f) return <div className="wrap page"><ErrorState error={q.error} retry={q.refetch} /></div>;
  return (
    <>
      <div className="wrap">
        <header className="dash-head">
          <div>
            <h1>Welcome back, <span>{f ? f.me.name.split(' ')[0] + '.' : ''}</span></h1>
            <p>{f ? D.summary(f) : <span style={{ display: 'block', maxWidth: 420 }}><Shimmer h={12} /></span>}</p>
            {/* The data's own date, not the wall clock: the demo organisation is frozen at 6 Nov 2026. */}
            <div className="meta">{f ? weekday(f.today) + ', ' + dmy(f.today) + ' · ' + settings.orgName + ' · ' + D.line(f) : ' '}</div>
          </div>
          <a href={'#' + D.primary[1]} className="btn-dark">{D.primary[0]} <span aria-hidden>→</span></a>
        </header>
      </div>
      <div className="wrap dash-body">
        {f ? <MetricGrid metrics={D.metrics} facts={f} /> : <SkeletonCards />}
        <BlockAnalytics />
        <div className="brow">
          <div className="list-card">
            <h2>{D.listTitle}</h2>
            {!q.data && <SkeletonRows n={4} />}
            {q.data && q.data.dashboard.slice(0, 5).map((l) => (
              <a key={l.title + l.sub} href={'#' + l.href} className="list-row">
                <span className="dot" style={{ background: SC[l.colour] }} />
                <div className="body"><div className="t">{l.title}</div><div className="s">{l.sub}</div></div>
                <span className="w">{l.when}</span>
              </a>
            ))}
            {q.data && !q.data.dashboard.length && <div className="empty-s" style={{ padding: '14px 0' }}>Nothing needs you right now.</div>}
          </div>
        </div>
      </div>
    </>
  );
}
