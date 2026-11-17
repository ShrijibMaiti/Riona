/**
 * People: the directory and employee records, attendance and regularisations, holidays, leave, profile changes.
 * (Salary and payroll join in Wave 5.)
 */
import type { FastifyPluginAsync } from 'fastify';
import { requireSession } from '../plugins/session';
import { parse } from '../../lib/validate';
import { EmployeeFilter, EmployeePatch, SelfServicePatch } from '../../modules/people/employees.schema';
import { getEmployee, listEmployees, revealBankAccount, updateEmployee, updateMyProfile } from '../../modules/people/employees.service';
import { AttendanceQuery, getAttendance, getHolidays } from '../../modules/people/attendance.service';
import { ApplyLeave, applyLeave, cancelLeave, getLeaveRequests, getLeaveTypes, LeaveQuery } from '../../modules/people/leave.service';
import { getRegularisations, NewRegularisation, RegularisationQuery, requestRegularisation } from '../../modules/people/regularisations.service';
import { getMyProfileChanges, NewProfileChange, requestProfileChange } from '../../modules/people/profile-changes.service';

type Id = { Params: { id: string } };

const peopleRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', requireSession);

  app.get('/employees', async (req) => listEmployees(req.actor!, parse(EmployeeFilter, req.query)));
  app.get<Id>('/employees/:id', async (req) => getEmployee(req.actor!, req.params.id));
  app.patch<Id>('/employees/:id', async (req) => updateEmployee(req.actor!, req.params.id, parse(EmployeePatch, req.body)));
  app.post<Id>('/employees/:id/bank/reveal', async (req) => revealBankAccount(req.actor!, req.params.id));
  app.patch('/me/profile', async (req) => updateMyProfile(req.actor!, parse(SelfServicePatch, req.body)));
  app.get('/me/profile-changes', async (req) => getMyProfileChanges(req.actor!));
  app.post('/me/profile-changes', async (req) => requestProfileChange(req.actor!, parse(NewProfileChange, req.body)));

  app.get('/attendance', async (req) => getAttendance(req.actor!, parse(AttendanceQuery, req.query)));
  app.get('/holidays', async () => getHolidays());
  app.get('/regularisations', async (req) => getRegularisations(req.actor!, parse(RegularisationQuery, req.query)));
  app.post('/regularisations', async (req) => requestRegularisation(req.actor!, parse(NewRegularisation, req.body)));

  app.get('/leave-types', async () => getLeaveTypes());
  app.get('/leave-requests', async (req) => getLeaveRequests(req.actor!, parse(LeaveQuery, req.query)));
  app.post('/leave-requests', async (req) => applyLeave(req.actor!, parse(ApplyLeave, req.body)));
  app.post<Id>('/leave-requests/:id/cancel', async (req) => cancelLeave(req.actor!, req.params.id));
};

export default peopleRoutes;
