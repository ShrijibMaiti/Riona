/**
 * Finance: invoices (create, send, record payments, revise), expense claims (submit, reopen), budgets, and
 * profitability with its drill-down to the hours behind every figure.
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireSession } from '../plugins/session';
import { parse } from '../../lib/validate';
import { createInvoice, getInvoice, InvoiceFilter, listInvoices, NewInvoice, PaymentInput, recordPayment, sendInvoice } from '../../modules/finance/invoices.service';
import { ReviseInput, reviseInvoice } from '../../modules/finance/revisions';
import { ExpenseFilter, getExpense, listExpenses, NewExpense, ReopenExpense, reopenExpense, submitExpense } from '../../modules/finance/expenses.service';
import { listBudgets } from '../../modules/finance/budgets.service';
import { DrillQuery, getProfitability, getProfitEntries, PeriodQuery } from '../../modules/finance/profitability.service';

type Id = { Params: { id: string } };

const financeRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', requireSession);

  app.get('/invoices', async (req) => listInvoices(req.actor!, parse(InvoiceFilter, req.query)));
  app.post('/invoices', async (req) => createInvoice(req.actor!, parse(NewInvoice, req.body)));
  app.get<Id>('/invoices/:id', async (req) => getInvoice(req.actor!, req.params.id));
  app.post<Id>('/invoices/:id/send', async (req) => sendInvoice(req.actor!, req.params.id));
  app.post<Id>('/invoices/:id/payments', async (req) => recordPayment(req.actor!, req.params.id, parse(PaymentInput, req.body)));
  app.post<Id>('/invoices/:id/revise', async (req) => reviseInvoice(req.actor!, req.params.id, parse(ReviseInput, req.body)));

  app.get('/expenses', async (req) => listExpenses(req.actor!, parse(ExpenseFilter, req.query)));
  app.post('/expenses', async (req) => submitExpense(req.actor!, parse(NewExpense, req.body)));
  app.get<Id>('/expenses/:id', async (req) => getExpense(req.actor!, req.params.id));
  app.post<Id>('/expenses/:id/reopen', async (req) => {
    const b = parse(ReopenExpense, req.body);
    return reopenExpense(req.actor!, req.params.id, b.reason, b.amount);
  });

  app.get('/budgets', async (req) => listBudgets(req.actor!, parse(z.object({ fy: z.string().max(20).optional() }), req.query).fy || undefined));

  app.get('/profitability', async (req) => getProfitability(req.actor!, parse(PeriodQuery, req.query)));
  app.get('/profitability/entries', async (req) => getProfitEntries(req.actor!, parse(DrillQuery, req.query)));
};

export default financeRoutes;
