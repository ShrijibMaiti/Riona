import { HUBS } from '../config/hubs';
import { MetricGrid } from '../components/MetricCard';
import { ModuleCard } from '../components/Panels';
import { ErrorState, SkeletonCards, SkeletonRows } from '../components/ui';
import { useFacts } from '../hooks/data';
import { initials } from '../lib/format';
import { useApp } from '../state/store';

export default function Hub({ hubKey }: { hubKey: string }) {
  const { role } = useApp();
  const q = useFacts();
  const H = HUBS[hubKey];
  const modules = H.modules.filter((m) => !m.roles || m.roles.includes(role));
  const d = q.data;

  // What needs attention is computed on the server from live records (selectors/attention.ts).
  const att = d?.attention[hubKey] ?? [];

  return (
    <div className="wrap page">
      <h1 className="display">{H.label}</h1>
      <p className="lede">{H.desc}</p>
      {q.error && !d ? <ErrorState error={q.error} retry={q.refetch} /> : d ? <MetricGrid metrics={H.metrics} facts={d.facts} className="hub-metrics" /> : <div className="hub-metrics"><SkeletonCards n={H.metrics.length} /></div>}
      <div className="hub-cols">
        <div className="hub-modules">
          <div className="eyebrow">Modules</div>
          <div className="module-grid">
            {modules.map((m) => (
              <ModuleCard key={m.href} name={m.name} summary={m.summary} live={d ? m.live(d.facts) : '…'} href={m.href} />
            ))}
          </div>
        </div>
        <div className="hub-attention">
          <div className="eyebrow" style={{ marginBottom: 16 }}>Needs your attention</div>
          {!d ? <SkeletonRows n={3} /> : att.length ? (
            <div>
              {att.slice(0, 5).map((a) => (
                <a key={a.who + a.what} href={'#' + a.href} className="att-row">
                  <span className="avatar-chip">{initials(a.who)}</span>
                  <div className="b"><div className="who">{a.who}</div><div className="what">{a.what}</div></div>
                  <span className="when">{a.when}</span>
                </a>
              ))}
              <a href="#/app/approvals" className="att-more">Open the full queue →</a>
            </div>
          ) : (
            <div className="att-none">Nothing is waiting on you here.</div>
          )}
        </div>
      </div>
    </div>
  );
}
