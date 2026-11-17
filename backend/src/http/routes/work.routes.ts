/** Work: clients, projects, tasks, timesheets. */
import type { FastifyPluginAsync } from 'fastify';
import { requireSession } from '../plugins/session';
import { parse } from '../../lib/validate';
import { getClient, listClients } from '../../modules/work/clients.service';
import { getProject, listProjects, ProjectFilter } from '../../modules/work/projects.service';
import { EntryFilter, listEntries, listWeeks, recallWeek, SaveWeek, saveWeek, submitWeek, WeekFilter } from '../../modules/work/timesheets.service';
import { addComment, createTask, getTask, listTasks, NewComment, NewTask, TaskFilter, TaskPatch, updateTask } from '../../modules/work/tasks.service';

type Id = { Params: { id: string } };

const workRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', requireSession);

  app.get('/clients', async (req) => listClients(req.actor!));
  app.get<Id>('/clients/:id', async (req) => getClient(req.actor!, req.params.id));

  app.get('/projects', async (req) => listProjects(req.actor!, parse(ProjectFilter, req.query)));
  app.get<Id>('/projects/:id', async (req) => getProject(req.actor!, req.params.id));
  app.post<Id>('/projects/:id/tasks', async (req) => createTask(req.actor!, req.params.id, parse(NewTask, req.body)));

  app.get('/tasks', async (req) => listTasks(req.actor!, parse(TaskFilter, req.query)));
  app.get<Id>('/tasks/:id', async (req) => getTask(req.actor!, req.params.id));
  app.patch<Id>('/tasks/:id', async (req) => updateTask(req.actor!, req.params.id, parse(TaskPatch, req.body)));
  app.post<Id>('/tasks/:id/comments', async (req) => addComment(req.actor!, req.params.id, parse(NewComment, req.body).text));

  type Week = { Params: { employeeId: string; weekStart: string } };
  app.get('/timesheet-entries', async (req) => listEntries(req.actor!, parse(EntryFilter, req.query)));
  app.get('/timesheet-weeks', async (req) => listWeeks(req.actor!, parse(WeekFilter, req.query)));
  app.put<Week>('/timesheet-weeks/:employeeId/:weekStart', async (req) => saveWeek(req.actor!, req.params.employeeId, req.params.weekStart, parse(SaveWeek, req.body).rows));
  app.post<Week>('/timesheet-weeks/:employeeId/:weekStart/submit', async (req) => submitWeek(req.actor!, req.params.employeeId, req.params.weekStart));
  app.post<Week>('/timesheet-weeks/:employeeId/:weekStart/recall', async (req) => recallWeek(req.actor!, req.params.employeeId, req.params.weekStart));
};

export default workRoutes;
