/** Projects with their team, phases and milestones (read). */
import type { Paginated, Project } from '@riona/shared';
import { sql, type Kysely, type Transaction } from 'kysely';
import { z } from 'zod';
import { db } from '../../db/client';
import type { DB } from '../../db/schema';
import { authorize } from '../../auth/rbac/authorize';
import type { Actor } from '../../http/plugins/session';
import { notFound } from '../../lib/errors';
import { F, opt } from '../../lib/validate';
import { toRupees } from '../../lib/money';

/** GET /projects?search&clientId&managerId&status&memberId&page&pageSize */
export const ProjectFilter = z.object({
  search: opt(z.string().max(200)),
  clientId: opt(z.string().max(40)),
  managerId: opt(z.string().max(40)),
  status: opt(z.string().max(20)),
  memberId: opt(z.string().max(40)),
  page: opt(F.page),
  pageSize: opt(F.pageSize),
});

type Q = Kysely<DB> | Transaction<DB>;

/** Projects with their teams, in two queries. */
async function load(q: Q, where: (qb: ReturnType<typeof base>) => ReturnType<typeof base>, page?: { limit: number; offset: number }) {
  let qb = where(base(q)).selectAll('projects').orderBy('projects.start').orderBy('projects.id');
  if (page) qb = qb.limit(page.limit).offset(page.offset);
  const rows = await qb.execute();
  if (!rows.length) return [];
  const team = await q.selectFrom('projectMembers').selectAll().where('projectId', 'in', rows.map((r) => r.id)).orderBy('position').execute();
  return rows.map((r): Project => ({
    id: r.id, name: r.name, code: r.code, clientId: r.clientId, managerId: r.managerId ?? '', start: r.start, end: r.end,
    model: r.model as Project['model'], fee: r.feePaise === null ? null : toRupees(r.feePaise), budget: toRupees(r.budgetPaise),
    health: r.health as Project['health'], status: r.status as Project['status'],
    team: team.filter((m) => m.projectId === r.id).map((m) => ({ employeeId: m.employeeId, role: m.role, allocation: m.allocation })),
    milestones: r.milestones as Project['milestones'], phases: r.phases as Project['phases'],
  }));
}
const base = (q: Q) => q.selectFrom('projects');

export async function listProjects(actor: Actor, f: z.infer<typeof ProjectFilter>): Promise<Paginated<Project>> {
  authorize(actor, 'projects', 'view');
  const page = f.page ?? 1, pageSize = f.pageSize ?? 1000;
  const where = (qb: ReturnType<typeof base>) => {
    let w = qb;
    if (f.search?.trim()) {
      const like = '%' + f.search.trim().toLowerCase().replace(/[\\%_]/g, (c) => '\\' + c) + '%';
      w = w.where(sql<boolean>`lower(projects.name || ' ' || projects.id || ' ' || projects.code) LIKE ${like}`);
    }
    if (f.clientId) w = w.where('projects.clientId', '=', f.clientId);
    if (f.managerId) w = w.where('projects.managerId', '=', f.managerId);
    if (f.status) w = w.where('projects.status', '=', f.status);
    if (f.memberId) {
      const member = f.memberId;
      w = w.where((eb) => eb.exists(eb.selectFrom('projectMembers as pm').select('pm.projectId').whereRef('pm.projectId', '=', 'projects.id').where('pm.employeeId', '=', member)));
    }
    return w;
  };
  const total = (await where(base(db)).select(sql<number>`count(*)::int`.as('n')).executeTakeFirst())?.n ?? 0;
  const items = await load(db, where, { limit: pageSize, offset: (page - 1) * pageSize });
  return { items, total, page, pageSize };
}

export async function getProject(actor: Actor, id: string): Promise<Project> {
  authorize(actor, 'projects', 'view');
  const [p] = await load(db, (qb) => qb.where('projects.id', '=', id));
  if (!p) throw notFound('Project not found');
  return p;
}

/** Is this employee on the project's team (or its manager)? */
export async function isOnProject(q: Q, projectId: string, employeeId: string | null): Promise<boolean> {
  if (!employeeId) return false;
  const r = await q
    .selectFrom('projects')
    .select('id')
    .where('id', '=', projectId)
    .where((eb) => eb.or([
      eb('managerId', '=', employeeId),
      eb.exists(eb.selectFrom('projectMembers').select('projectId').where('projectId', '=', projectId).where('employeeId', '=', employeeId)),
    ]))
    .executeTakeFirst();
  return !!r;
}
