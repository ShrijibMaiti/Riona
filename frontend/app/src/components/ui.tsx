import type { ReactNode } from 'react';
import { SC, statusColour } from '../lib/format';

/** Marks a figure the system cannot state authoritatively. Hover or focus for the basis. */
export function Est({ basis }: { basis: string }) {
  return (
    <span className="est" tabIndex={0} aria-label={'Estimated: ' + basis} title={'Estimated · ' + basis}>
      est.
    </span>
  );
}

export function Dot({ colour, size = 6 }: { colour: string; size?: number }) {
  return <span className="dot" style={{ background: colour, width: size, height: size }} />;
}

/** Status text with a coloured dot. Colour is status only. */
export function StatusLabel({ label, colour }: { label: string; colour?: keyof typeof SC | string }) {
  const c = colour ? (colour in SC ? SC[colour as keyof typeof SC] : colour) : statusColour(label);
  return (
    <span className="status-label">
      <Dot colour={c} />
      {label}
    </span>
  );
}

export function Shimmer({ w = '100%', h = 10, r = 5 }: { w?: number | string; h?: number; r?: number }) {
  return <span className="shimmer" style={{ width: w, height: h, borderRadius: r }} />;
}

/** Card-grid skeleton used while metrics load. */
export function SkeletonCards({ n = 4 }: { n?: number }) {
  return (
    <div className="metrics" aria-busy="true" aria-label="Loading">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="metric">
          <Shimmer w="55%" />
          <div style={{ marginTop: 22 }}><Shimmer w="40%" h={26} r={6} /></div>
          <div style={{ marginTop: 18 }}><Shimmer w="70%" /></div>
        </div>
      ))}
    </div>
  );
}

/** The design's table skeleton: avatar circle plus four bars, shimmering. */
export function SkeletonRows({ n = 6 }: { n?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="skel-row">
          <span className="skel-avatar" />
          <span className="shimmer" style={{ flex: 1.4 }} />
          <span className="skel-bar" style={{ flex: 1 }} />
          <span className="skel-bar" style={{ flex: 1 }} />
          <span className="skel-bar" style={{ flex: 0.6 }} />
        </div>
      ))}
    </div>
  );
}

export function SkeletonPage({ title }: { title?: string }) {
  return (
    <div className="wrap page" aria-busy="true">
      {title ? <h1 className="display">{title}</h1> : <Shimmer w={280} h={44} r={8} />}
      <div style={{ marginTop: 40 }}><SkeletonCards /></div>
      <div className="card" style={{ marginTop: 24 }}><SkeletonRows /></div>
    </div>
  );
}

export function ErrorState({ error, retry }: { error: Error; retry?: () => void }) {
  return (
    <div className="empty" role="alert">
      <div className="empty-t">This didn’t load.</div>
      <div className="empty-s">{error.message}</div>
      {retry && <button className="btn-line" style={{ marginTop: 20 }} onClick={retry}>Try again</button>}
    </div>
  );
}

export function EmptyState({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-t">{title}</div>
      {sub && <div className="empty-s">{sub}</div>}
      {action && <div style={{ marginTop: 20 }}>{action}</div>}
    </div>
  );
}

/** Render children once data is ready; skeleton while loading; error with retry. */
export function Async<T>({ q, skeleton, children }: { q: { data: T | undefined; loading: boolean; error: Error | undefined; refetch: () => void }; skeleton?: ReactNode; children: (d: T) => ReactNode }) {
  if (q.error && q.data === undefined) return <ErrorState error={q.error} retry={q.refetch} />;
  if (q.data === undefined) return <>{skeleton ?? <SkeletonRows />}</>;
  return <>{children(q.data)}</>;
}
