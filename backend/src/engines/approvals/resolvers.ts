/**
 * Who approves a request, worked out once when it is made, from the module's active workflow (the graph drawn on
 * Admin › Workflows) and facts about the request (days of leave, hours, amount). The resolved chain is stored on
 * the approval, so a later change to the workflow or to the org chart doesn't move a request already in flight.
 */
import { sql, type Kysely, type Transaction } from 'kysely';
import type { Workflow, WorkflowNode } from '@riona/shared';
import type { DB } from '../../db/schema';

type Q = Kysely<DB> | Transaction<DB>;

export type ApprovalType = 'Leave' | 'Expense' | 'Timesheet' | 'Regularisation' | 'Invoice' | 'Profile change';
/**
 * One approver in a request's chain, fixed when the request is made. `sla` (e.g. "48h", "3d") and `onTimeout` come
 * from the workflow's Approver step: past the SLA the approver is reminded, or, if the workflow says so, the step is
 * approved automatically (engines/approvals/timeouts.job.ts).
 */
export type PlanStep = { approverId: string; role: string; sla?: string; onTimeout?: 'approve' };
export type Facts = Record<string, number | string>;

export type ResolveContext = {
  type: ApprovalType;
  requesterId: string;
  facts: Facts;
  /** For timesheets: the manager of the project the week's hours mostly went to. */
  projectManagerId?: string | null;
  /** For invoices: the client's account owner. */
  accountOwnerId?: string | null;
  /**
   * When the workflow's path has no approver, let the request through instead of falling back to an Admin
   * (invoices under the sign-off threshold go straight out).
   */
  noFallback?: boolean;
};

/** The chain when a module has no active workflow. */
const DEFAULT_CHAIN: Record<ApprovalType, string[]> = {
  Leave: ['Reporting manager'],
  Expense: ['Reporting manager', 'Finance'],
  Timesheet: ['Project manager'],
  Regularisation: ['Reporting manager'],
  Invoice: ['Finance head'],
  'Profile change': ['HR'],
};

async function managerOf(q: Q, id: string) {
  return (await q.selectFrom('employees').select('managerId').where('id', '=', id).executeTakeFirst())?.managerId ?? null;
}

/** The most senior person in the requester's department along their reporting line. */
async function departmentHead(q: Q, requesterId: string) {
  const me = await q.selectFrom('employees').select(['id', 'dept', 'managerId']).where('id', '=', requesterId).executeTakeFirst();
  if (!me) return null;
  let head: string | null = null;
  let cur = me.managerId;
  for (let i = 0; cur && i < 20; i++) {
    const e = await q.selectFrom('employees').select(['id', 'dept', 'managerId']).where('id', '=', cur).executeTakeFirst();
    if (!e || e.dept !== me.dept) break;
    head = e.id;
    cur = e.managerId;
  }
  return head ?? me.managerId;
}

/** The first active user with this role name (or app role), by employee id: e.g. "HR", "Finance". */
async function byRole(q: Q, role: string, notId: string) {
  const r = await q
    .selectFrom('users')
    .select('employeeId')
    .where('status', '=', 'Active')
    .where('employeeId', 'is not', null)
    .where('employeeId', '!=', notId)
    // role is an enum (Admin/HR/Manager/Employee); role names like "Finance" aren't in it, so compare as text.
    .where((eb) => eb.or([eb('roleName', '=', role), sql<boolean>`role::text = ${role}`]))
    .orderBy('employeeId')
    .executeTakeFirst();
  return r?.employeeId ?? null;
}

async function resolveApprover(q: Q, kind: string, config: Record<string, string>, ctx: ResolveContext): Promise<string | null> {
  switch (kind) {
    case 'Reporting manager': return managerOf(q, ctx.requesterId);
    case 'Department head': case 'Delivery head': return departmentHead(q, ctx.requesterId);
    case 'Project manager': return ctx.projectManagerId ?? managerOf(q, ctx.requesterId);
    case 'Account owner': return ctx.accountOwnerId ?? null;
    case 'HR': return byRole(q, 'HR', ctx.requesterId);
    case 'Finance': case 'Finance approver': case 'Finance head': return byRole(q, 'Finance', ctx.requesterId);
    case 'Admin': return byRole(q, 'Admin', ctx.requesterId);
    case 'Person': return config.person ?? null;
    default: return null;
  }
}

/** A Condition node's test, e.g. { field: 'days', op: '>', value: '5' }. */
export function holds(config: Record<string, string>, facts: Facts): boolean {
  const have = facts[config.field];
  const a = typeof have === 'number' ? have : Number(have);
  const want = Number(config.value);
  if (Number.isNaN(a) || Number.isNaN(want)) return String(have) === config.value ? config.op === '=' || config.op === '==' : config.op === '!=';
  switch (config.op) {
    case '>': return a > want;
    case '>=': return a >= want;
    case '<': return a < want;
    case '<=': return a <= want;
    case '=': case '==': return a === want;
    case '!=': return a !== want;
    default: return false;
  }
}

export type Resolution = {
  steps: PlanStep[];
  /** The path ended at a "reject" outcome: the request is refused as it is made. */
  rejected: boolean;
  reason?: string;
  /** Who the workflow's Notification steps tell when the request is approved. */
  notify: string[];
};

/**
 * Walks the workflow from its Trigger: Approver nodes add a step, Condition nodes follow the "Yes"/"No" edge
 * (an unlabelled single edge means the condition guards the next node, which is skipped when it fails),
 * Notification nodes collect recipients, and an Outcome ends the walk.
 */
export async function resolveChain(q: Q, def: Pick<Workflow, 'nodes' | 'edges'> | null, ctx: ResolveContext): Promise<Resolution> {
  const kinds: { kind: string; label: string; config: Record<string, string> }[] = [];
  const notifyTo: string[] = [];
  let rejected = false, reason: string | undefined;

  if (!def) {
    for (const k of DEFAULT_CHAIN[ctx.type]) kinds.push({ kind: k, label: k, config: {} });
  } else {
    const byId = new Map(def.nodes.map((n) => [n.id, n]));
    const out = (id: string) => def.edges.filter((e) => e.from === id);
    let node: WorkflowNode | undefined = def.nodes.find((n) => n.kind === 'Trigger');
    const seen = new Set<string>();
    while (node && !seen.has(node.id)) {
      seen.add(node.id);
      const edges = out(node.id);
      if (node.kind === 'Approver') kinds.push({ kind: node.config.approver ?? node.label, label: node.label, config: node.config });
      if (node.kind === 'Notification' && node.config.to) notifyTo.push(node.config.to);
      if (node.kind === 'Outcome') {
        rejected = node.config.result === 'reject';
        reason = rejected ? node.label : undefined;
        break;
      }
      if (node.kind === 'Condition') {
        const ok = holds(node.config, ctx.facts);
        const labelled = edges.find((e) => e.label === (ok ? 'Yes' : 'No'));
        if (labelled) node = byId.get(labelled.to);
        else if (ok) node = byId.get(edges[0]?.to ?? '');
        else {
          const guarded = byId.get(edges[0]?.to ?? '');
          node = guarded ? byId.get(out(guarded.id)[0]?.to ?? '') : undefined;
        }
        continue;
      }
      node = byId.get(edges[0]?.to ?? '');
    }
  }

  const steps: PlanStep[] = [];
  for (const k of kinds) {
    const id = await resolveApprover(q, k.kind, k.config, ctx);
    // Nobody approves their own request, and nobody is asked twice.
    if (!id || id === ctx.requesterId || steps.some((s) => s.approverId === id)) continue;
    steps.push({ approverId: id, role: k.label, ...(k.config.sla ? { sla: k.config.sla } : {}), ...(k.config.onTimeout === 'approve' ? { onTimeout: 'approve' as const } : {}) });
  }
  // Nobody resolved (the requester heads everything): an Admin other than them decides.
  if (!steps.length && !rejected && !ctx.noFallback) {
    const admin = await byRole(q, 'Admin', ctx.requesterId);
    if (admin) steps.push({ approverId: admin, role: 'Admin' });
  }

  const notify: string[] = [];
  for (const to of notifyTo) {
    const id = to === 'Requester' ? ctx.requesterId : to === 'Manager' ? await managerOf(q, ctx.requesterId) : await resolveApprover(q, to, {}, ctx);
    if (id && !notify.includes(id)) notify.push(id);
  }
  return { steps, rejected, reason, notify };
}
