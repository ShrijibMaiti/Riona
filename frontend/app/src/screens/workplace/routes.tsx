/** Workplace hub routes — loaded as one lazy chunk. */
import { lazy } from 'react';
import Hub from '../Hub';
import { NotFound } from '../NotFound';
import type { RouteProps } from '../../routes';

const W = () => import('./Workplace');
const Assets = lazy(() => W().then((m) => ({ default: m.Assets })));
const AssetDetail = lazy(() => W().then((m) => ({ default: m.AssetDetail })));
const Inventory = lazy(() => W().then((m) => ({ default: m.Inventory })));
const Rooms = lazy(() => W().then((m) => ({ default: m.Rooms })));
const Announcements = lazy(() => W().then((m) => ({ default: m.Announcements })));
const KbHome = lazy(() => W().then((m) => ({ default: m.KbHome })));
const KbArticleView = lazy(() => W().then((m) => ({ default: m.KbArticleView })));
const Visitors = lazy(() => W().then((m) => ({ default: m.Visitors })));
const Kiosk = lazy(() => W().then((m) => ({ default: m.Kiosk })));

export default function WorkplaceRoutes({ seg }: RouteProps) {
  const [, , a, b] = seg;
  if (!a) return <Hub hubKey="workplace" />;
  if (a === 'assets') return !b ? <Assets /> : <AssetDetail key={b} id={b} />;
  if (a === 'inventory' && !b) return <Inventory />;
  if (a === 'rooms' && !b) return <Rooms />;
  if (a === 'announcements' && !b) return <Announcements />;
  if (a === 'kb') return !b ? <KbHome /> : <KbArticleView key={b} slug={b} />;
  if (a === 'visitors') return !b ? <Visitors /> : b === 'kiosk' ? <Kiosk /> : <NotFound seg={seg} />;
  return <NotFound seg={seg} />;
}
