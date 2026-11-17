/**
 * Route table. Each hub is one lazy chunk; the hash path decides which loads.
 */
import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from 'react';
import { SkeletonPage } from './components/ui';

export type RouteProps = { path: string; seg: string[]; query: URLSearchParams };

const chunks: Record<string, LazyExoticComponent<ComponentType<RouteProps>>> = {
  dashboard: lazy(() => import('./screens/Dashboard')),
  people: lazy(() => import('./screens/people/routes')),
  work: lazy(() => import('./screens/work/routes')),
  clients: lazy(() => import('./screens/clients/routes')),
  finance: lazy(() => import('./screens/finance/routes')),
  workplace: lazy(() => import('./screens/workplace/routes')),
  admin: lazy(() => import('./screens/admin/routes')),
  me: lazy(() => import('./screens/me/routes')),
  approvals: lazy(() => import('./screens/approvals/routes')),
};

export function AppRoute({ path, query }: { path: string; query: URLSearchParams }) {
  const seg = path.split('/').filter(Boolean);
  const key = seg.length === 1 ? 'dashboard' : seg[1];
  const C = chunks[key] ?? chunks.dashboard;
  return (
    <Suspense fallback={<SkeletonPage />}>
      <C path={path} seg={seg} query={query} />
    </Suspense>
  );
}
