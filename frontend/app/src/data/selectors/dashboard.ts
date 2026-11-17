/**
 * Everything a dashboard and the hubs show, from one set of records: the figures (Facts), each hub's "needs your
 * attention" list, and the role's dashboard list. The server computes it (GET /dashboard-facts) over what the
 * signed-in person may see, so the browser no longer loads every collection to work it out.
 */
import { DASHBOARDS, type DashItem } from '../../config/dashboards';
import { HUBS } from '../../config/hubs';
import type { Role } from '../types';
import { hubAttention, type Att } from './attention';
import { computeFacts, type Facts, type FactsInput } from './facts';

export type DashboardFacts = { facts: Facts; attention: Record<string, Att[]>; dashboard: DashItem[] };

export function dashboardFacts(input: FactsInput, role: Role, now: string): DashboardFacts {
  const facts = computeFacts({ ...input, now });
  const attention = Object.fromEntries(Object.keys(HUBS).map((k) => [k, hubAttention(input, k, now)]));
  return { facts, attention, dashboard: DASHBOARDS[role].list(facts, input) };
}
