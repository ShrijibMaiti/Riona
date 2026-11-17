import { useState } from 'react';
import { Shimmer } from '../components/ui';
import * as api from '../data/repositories';
import { EMPTY, RANGES, TARGET, type Cell, type Range } from '../data/selectors/blocks';
import { useQuery } from '../lib/query';
import { useApp } from '../state/store';

/**
 * Analytics: a daily heatmap of the chosen metric, then plain bars. The server still sends its block model
 * (squares); the bars are read off it here, so a bar's length is exactly the count of filled squares.
 */
const filled = (cells: Cell[]) => cells.reduce((n, c) => n + (c.colour === EMPTY || c.colour === TARGET ? 0 : 1), 0);
const shareOf = (cells: Cell[], label: string) => cells.filter((c) => c.title?.startsWith(label + ' · ')).length;
export function BlockAnalytics() {
  const { role, settings } = useApp();
  const [metric, setMetric] = useState(0);
  const [range, setRange] = useState<Range>(26);
  const [hover, setHover] = useState('');

  // Reset the metric when the role changes (metric sets differ per role).
  const [lastRole, setLastRole] = useState(role);
  if (lastRole !== role) {
    setLastRole(role);
    setMetric(0);
    setHover('');
  }

  // Computed on the server over what this person may see (GET /dashboard-blocks).
  const q = useQuery(['facts', 'blocks', role, metric, range, settings.blockColour], () => api.getDashboardBlocks(metric, range, settings.blockColour));
  const bk = q.data;
  if (!bk) {
    return (
      <section className="blocks" aria-busy="true">
        <div style={{ maxWidth: 320 }}><Shimmer h={22} r={4} /></div>
        <div className="brow first"><div className="bpanel heat" style={{ height: 280 }} /><div className="bpanel share" style={{ height: 280 }} /></div>
      </section>
    );
  }
  const labels = bk.metricLabels;

  return (
    <section className="blocks" aria-labelledby="blocks-title">
      <div className="blocks-head">
        <div>
          <h2 id="blocks-title">{bk.title}</h2>
          <div className="sub">One square per day. Darker means more.</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div className="dseg" role="group" aria-label="Metric">
            {labels.map((l, i) => (
              <button key={l} className={i === bk.metricIndex ? 'active' : ''} aria-pressed={i === bk.metricIndex} onClick={() => { setMetric(i); setHover(''); }}>
                {l}
              </button>
            ))}
          </div>
          <div className="dseg" role="group" aria-label="Range">
            {RANGES.map((n) => (
              <button key={n} className={n === range ? 'active' : ''} aria-pressed={n === range} onClick={() => { setRange(n); setHover(''); }}>
                {n} wk
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="brow first">
        {/* Contribution heatmap */}
        <div className="bpanel heat">
          <div className="heat-stats">
            {bk.stats.map((x) => (
              <div key={x.label}>
                <div className="v">{x.value}</div>
                <div className="k">{x.label}</div>
              </div>
            ))}
          </div>
          <div className="heat-scroll"><div className="heat-inner">
          <div className="heat-row">
            <div className="heat-gutter" />
            <div className="heat-months" aria-hidden>
              {bk.weeks.map((w, i) => <span key={i}>{w.month}</span>)}
            </div>
          </div>
          <div className="heat-row" style={{ marginTop: 4 }}>
            <div className="heat-gutter heat-dow" aria-hidden>
              <span>Mon</span><span /><span>Wed</span><span /><span>Fri</span><span /><span />
            </div>
            <div
              className={'heat-grid' + (range > 26 ? ' dense' : '')}
              role="grid"
              aria-label={bk.title}
              onMouseOver={(e) => {
                const t = (e.target as HTMLElement).dataset?.t;
                if (t && t !== hover) setHover(t);
              }}
              onMouseLeave={() => setHover('')}
            >
              {bk.weeks.map((w, wi) => (
                <div key={wi} className="heat-week" role="row">
                  {w.days.map((d, di) => (
                    <span
                      key={di}
                      role="gridcell"
                      data-t={d.title}
                      title={d.title}
                      aria-label={d.title}
                      className={'heat-day' + (d.future ? ' future' : '') + (d.today ? ' today' : '')}
                      style={{ background: d.bg }}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
          </div></div>
          <div className="heat-foot">
            <span className="heat-readout" aria-live="polite">{hover || 'Hover a block to read that day.'}</span>
            <div className="ramp" aria-hidden>
              <span style={{ marginRight: 4 }}>Less</span>
              {bk.levels.map((c) => <i key={c} style={{ background: c }} />)}
              <span style={{ marginLeft: 4 }}>More</span>
            </div>
          </div>
        </div>

        {/* Share of the total, as bars */}
        <div className="bpanel share">
          <h3>{bk.waffle.title}</h3>
          <div className="sub">{bk.waffle.sub}</div>
          <div className="hbars">
            {bk.waffle.legend.map((l) => {
              const n = shareOf(bk.waffle.cells, l.label);
              return (
                <div key={l.label} className="hbar" title={l.label + ' · ' + (l.value ?? '')}>
                  <span className="k">{l.label}</span>
                  <span className="track"><span className="fill" style={{ display: 'block', width: (100 * n) / Math.max(1, bk.waffle.cells.length) + '%', background: l.colour }} /></span>
                  <span className="v">{l.value}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="brow">
        {/* Pixel bars */}
        {bk.pixels && (
          <div className="bpanel pix">
            <div className="pix-head">
              <div>
                <h3>{bk.pixels.title}</h3>
                <div className="sub">{bk.pixels.sub}</div>
              </div>
              <div className="legend-inline">
                {bk.pixels.legend.map((l) => (
                  <span key={l.label}><i style={{ background: l.colour }} />{l.label}</span>
                ))}
              </div>
            </div>
            {(() => {
              const px = bk.pixels!;
              const rows = px.groups[0]?.cols[0]?.length || 1;
              const t = px.groups[0]?.cols[0]?.findIndex((c) => c.colour === TARGET) ?? -1;
              return (
                <>
                  <div className="vbars" role="img" aria-label={px.title + ': ' + px.groups.map((g) => g.label + ' ' + g.value).join(', ')}>
                    {t >= 0 && <span className="vbar-target" style={{ bottom: (100 * (rows - t - 0.5)) / rows + '%' }} />}
                    {px.groups.map((g) => (
                      <div key={g.label} className="vbar-g" title={g.label + ' · ' + g.value}>
                        {g.cols.map((col, ci) => {
                          const n = filled(col);
                          const c = col.find((k) => k.colour !== EMPTY && k.colour !== TARGET)?.colour ?? 'transparent';
                          return <span key={ci} className="vbar" style={{ height: (100 * n) / rows + '%', background: c }} />;
                        })}
                      </div>
                    ))}
                  </div>
                  <div className="vlabels">
                    {px.groups.map((g) => <div key={g.label}><div className="v">{g.value}</div><div className="k">{g.label}</div></div>)}
                  </div>
                </>
              );
            })()}
            <div className="pix-unit">{bk.pixels.unit}</div>
          </div>
        )}

        {/* Block meters */}
        <div className="bpanel meters">
          <h3>{bk.meters.title}</h3>
          <div className="sub">{bk.meters.sub}</div>
          <div className="hbars">
            {bk.meters.rows.map((m) => {
              const n = m.cells.reduce((a, k) => a + (k.colour === EMPTY ? 0 : 1), 0);
              const c = m.cells.find((k) => k.colour !== EMPTY)?.colour ?? 'transparent';
              return (
                <div key={m.label} className="hbar">
                  <span className="k">{m.label}</span>
                  <span className="track"><span className="fill" style={{ display: 'block', width: (100 * n) / Math.max(1, m.cells.length) + '%', background: c }} /></span>
                  <span className="v">{m.value}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
