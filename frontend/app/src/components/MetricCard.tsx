import type { MetricDef } from '../config/hubs';
import type { Facts } from '../data/selectors/facts';
import { SC } from '../lib/format';
import { Est } from './ui';

const TREND = { up: SC.green, down: SC.red, warn: SC.amber, flat: SC.gray } as const;

export function MetricGrid({ metrics, facts, className }: { metrics: MetricDef[]; facts: Facts; className?: string }) {
  return (
    <div className={'metrics' + (className ? ' ' + className : '')}>
      {metrics.map((m) => {
        const trend = typeof m.trend === 'function' ? m.trend(facts) : m.trend;
        return (
          <a key={m.label} href={'#' + m.href} className="metric">
            <div className="k">{m.label}</div>
            <div className="v">{m.value(facts)}{m.estimated && <Est basis={m.estimated} />}</div>
            <div className="d"><span className="dot" style={{ background: TREND[trend] }} />{m.delta(facts)}</div>
          </a>
        );
      })}
    </div>
  );
}
