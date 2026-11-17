/** Clients hub routes — loaded as one lazy chunk. */
import { lazy } from 'react';
import Hub from '../Hub';
import { NotFound } from '../NotFound';
import type { RouteProps } from '../../routes';

const C = () => import('./Clients');
const Accounts = lazy(() => C().then((m) => ({ default: m.Accounts })));
const Account = lazy(() => C().then((m) => ({ default: m.Account })));
const Leads = lazy(() => C().then((m) => ({ default: m.Leads })));
const LeadDetail = lazy(() => C().then((m) => ({ default: m.LeadDetail })));
const Contracts = lazy(() => C().then((m) => ({ default: m.Contracts })));
const Tickets = lazy(() => C().then((m) => ({ default: m.Tickets })));
const TicketDetail = lazy(() => C().then((m) => ({ default: m.TicketDetail })));

export default function ClientsRoutes({ seg }: RouteProps) {
  const [, , a, b, c] = seg;
  if (!a) return <Hub hubKey="clients" />;
  if (a === 'accounts') return !b ? <Accounts /> : <Account key={b} id={b} tab={c} />;
  if (a === 'leads') return !b ? <Leads /> : b === 'board' ? <Leads board /> : <LeadDetail id={b} />;
  if (a === 'contracts' && !b) return <Contracts />;
  if (a === 'tickets') return !b ? <Tickets /> : <TicketDetail key={b} id={b} />;
  return <NotFound seg={seg} />;
}
