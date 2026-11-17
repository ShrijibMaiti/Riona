/**
 * Salary and payroll (registered alongside the people routes):
 *   GET  /employees/:id/salary-events   POST /employees/:id/salary-events   GET /salary-events   POST /employees
 *   GET  /payroll-runs   GET /payroll-runs/:id   GET /payroll-runs/:id/lines   POST /payroll-runs/:id/advance
 *   GET  /salary-structures   PUT /salary-structures/:id   GET /statutory-filings
 *   GET  /me/payslips/:month   GET /me/form16?fy=2026
 */
import type { FastifyPluginAsync } from 'fastify';
import { requireSession } from '../plugins/session';
import { parse } from '../../lib/validate';
import { NewSalaryEvent } from '../../engines/payroll/ledger';
import {
  addSalaryEvent, advance, createEmployee, getAllSalaryEvents, getFilings, getRun, getRunLines, getSalaryEvents, getStructures, listRuns,
  myForm16, myPayslip, NewEmployee, saveStructure, StructureInput,
} from '../../modules/people/payroll.service';

type Id = { Params: { id: string } };

const payrollRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', requireSession);

  app.post('/employees', async (req) => createEmployee(req.actor!, parse(NewEmployee, req.body)));
  app.get<Id>('/employees/:id/salary-events', async (req) => getSalaryEvents(req.actor!, req.params.id));
  app.post<Id>('/employees/:id/salary-events', async (req) => {
    // The frontend sends the whole event; only what a new event may carry is read.
    const { employeeId: _ignored, ...body } = (req.body ?? {}) as Record<string, unknown>;
    return addSalaryEvent(req.actor!, req.params.id, parse(NewSalaryEvent, body));
  });
  app.get('/salary-events', async (req) => getAllSalaryEvents(req.actor!));

  app.get('/payroll-runs', async (req) => listRuns(req.actor!));
  app.get<Id>('/payroll-runs/:id', async (req) => getRun(req.actor!, req.params.id));
  app.get<Id>('/payroll-runs/:id/lines', async (req) => getRunLines(req.actor!, req.params.id));
  app.post<Id>('/payroll-runs/:id/advance', async (req) => advance(req.actor!, req.params.id));

  app.get('/salary-structures', async (req) => getStructures(req.actor!));
  app.put<Id>('/salary-structures/:id', async (req) => saveStructure(req.actor!, req.params.id, parse(StructureInput, req.body)));
  app.get('/statutory-filings', async (req) => getFilings(req.actor!));

  app.get<{ Params: { month: string } }>('/me/payslips/:month', async (req) => myPayslip(req.actor!, req.params.month));
  app.get<{ Querystring: { fy?: string } }>('/me/form16', async (req) => myForm16(req.actor!, req.query.fy));
};

export default payrollRoutes;
