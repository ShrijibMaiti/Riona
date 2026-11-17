/**
 * The shapes a client sees, built from the rows the portal role can read. Each takes only client-safe columns
 * (migration 011 grants nothing else), and copies field by field — never spreads a row — so nothing new in a
 * table can leak through by accident.
 */
import type { PortalDocument, PortalInvoice, PortalProject, PortalTicket } from '@riona/shared';
import { toRupees } from '../../lib/money';

type Phase = { id: string; name: string; start: string; end: string };
type Milestone = { id: string; name: string; date: string; done: boolean };

export function toPortalProject(
  p: { id: string; name: string; start: string; end: string; status: string; phases: unknown; milestones: unknown },
  tasks: { status: string }[],
): PortalProject {
  return {
    id: p.id, name: p.name, start: p.start, end: p.end, status: p.status as PortalProject['status'],
    // Share of tasks done: the same rule as the internal app (selectors/projects.ts projectProgress).
    progress: tasks.length ? Math.round((tasks.filter((t) => t.status === 'done').length / tasks.length) * 100) : 0,
    phases: ((p.phases ?? []) as Phase[]).map(({ id, name, start, end }) => ({ id, name, start, end })),
    milestones: ((p.milestones ?? []) as Milestone[]).map(({ id, name, date, done }) => ({ id, name, date, done })),
  };
}

type Frozen = { taxable: number; total: number; cgst?: number; sgst?: number; igst?: number };

export function toPortalInvoice(
  inv: { id: string; number: string; issued: string; due: string; status: string; issuedTotals: unknown },
  lines: { id: string; description: string; quantity: number; unit: string; ratePaise: number; amountPaise: number }[],
  payments: { date: string; amountPaise: number; method: string; reference: string }[],
  revisions: { at: string; reason: string; totalPaise: number }[],
): PortalInvoice {
  const t = inv.issuedTotals as Frozen;
  const total = toRupees(t.total), taxable = toRupees(t.taxable);
  const paid = toRupees(payments.reduce((a, p) => a + p.amountPaise, 0));
  const last = revisions[revisions.length - 1];
  return {
    id: inv.id, number: inv.number, issued: inv.issued, due: inv.due, status: inv.status as PortalInvoice['status'],
    lines: lines.map((l) => ({ id: l.id, description: l.description, quantity: l.quantity, unit: l.unit as 'h' | 'item', rate: toRupees(l.ratePaise), amount: toRupees(l.amountPaise) })),
    subtotal: taxable, tax: total - taxable, total, paid, balance: Math.max(0, total - paid),
    // Older frozen totals carry no split; treat their tax as IGST rather than invent one.
    gst: t.cgst !== undefined ? { cgst: toRupees(t.cgst), sgst: toRupees(t.sgst ?? 0), igst: toRupees(t.igst ?? 0) } : { cgst: 0, sgst: 0, igst: total - taxable },
    payments: payments.map((p) => ({ date: p.date, amount: toRupees(p.amountPaise), method: p.method, reference: p.reference })),
    // The first revision is the invoice as first issued; more than one means it was revised since.
    revision: revisions.length > 1 ? { at: last.at, reason: last.reason.replace(/^Revised: /, ''), firstIssuedTotal: toRupees(revisions[0].totalPaise) } : null,
  };
}

export function toPortalTicket(
  t: { id: string; clientId: string; projectId: string | null; subject: string; priority: string; status: string; opened: string; resolved: string | null; slaDue: string },
  messages: { id: string; at: string; author: string; fromClient: boolean; text: string }[],
  /** How staff replies are signed: the organisation's short name, e.g. "Kestrel". */
  vendor: string,
): PortalTicket {
  return {
    id: t.id, clientId: t.clientId, projectId: t.projectId, subject: t.subject, priority: t.priority as PortalTicket['priority'],
    status: t.status as PortalTicket['status'], opened: t.opened, resolved: t.resolved, slaDue: t.slaDue,
    // Staff replies are signed "Name · Kestrel"; the client's own carry their name.
    messages: messages.map((m) => ({ id: m.id, at: m.at, author: m.fromClient ? m.author : m.author + ' · ' + vendor, fromClient: m.fromClient, text: m.text })),
  };
}

export function toPortalDocument(
  d: { id: string; name: string; type: string; ownerType: string; ownerId: string },
  latest: { version: number; uploaded: string; size: string },
  projectName: string | null,
): PortalDocument {
  return { id: d.id, name: d.name, type: d.type, project: d.ownerType === 'project' ? projectName : null, version: latest.version, uploaded: latest.uploaded, size: latest.size };
}
