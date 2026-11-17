/** Finance hub routes — loaded as one lazy chunk. */
import { lazy } from 'react';
import Hub from '../Hub';
import { NotFound } from '../NotFound';
import type { RouteProps } from '../../routes';

const NewInvoice = lazy(() => import('./NewInvoice'));
const ReviseInvoice = lazy(() => import('./ReviseInvoice'));
const Profitability = lazy(() => import('./Profitability'));
const ProfitEntries = lazy(() => import('./ProfitEntries'));
const F = () => import('./FinanceScreens');
const Invoices = lazy(() => F().then((m) => ({ default: m.Invoices })));
const InvoiceDetail = lazy(() => F().then((m) => ({ default: m.InvoiceDetail })));
const Expenses = lazy(() => F().then((m) => ({ default: m.Expenses })));
const ExpenseApprovals = lazy(() => F().then((m) => ({ default: m.ExpenseApprovals })));
const SubmitExpense = lazy(() => F().then((m) => ({ default: m.SubmitExpense })));
const ExpenseDetail = lazy(() => F().then((m) => ({ default: m.ExpenseDetail })));
const Budget = lazy(() => F().then((m) => ({ default: m.Budget })));

export default function FinanceRoutes({ seg, query }: RouteProps) {
  const [, , a, b, c] = seg;
  if (!a) return <Hub hubKey="finance" />;
  if (a === 'invoices' && b && c === 'revise') return <ReviseInvoice key={b} id={b} />;
  if (a === 'invoices' && c) return <NotFound seg={seg} />;
  if (a === 'invoices') return !b ? <Invoices /> : b === 'new' ? <NewInvoice initialClient={query.get('client') ?? undefined} /> : <InvoiceDetail key={b} id={b} />;
  if (a === 'expenses') return !b ? <Expenses /> : b === 'approvals' ? <ExpenseApprovals /> : b === 'submit' || b === 'new' ? <SubmitExpense /> : <ExpenseDetail key={b} id={b} />;
  if (a === 'budget' && !b) return <Budget />;
  if (a === 'profitability' && !b) return <Profitability initial={query} />;
  if (a === 'profitability' && b === 'entries') return <ProfitEntries query={query} />;
  return <NotFound seg={seg} />;
}
