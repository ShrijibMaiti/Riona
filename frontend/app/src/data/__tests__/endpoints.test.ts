/**
 * The endpoint table (repositories/http/endpoints.ts) is the contract the HTTP client and the backend follow
 * (every repository function in ../repositories/contract.ts has an entry: the type-check enforces it). These checks
 * keep it well-formed, and prove that each function's arguments survive the trip through a real request (path
 * params, query string, JSON body) and come back out unchanged, so the backend receives what the screens sent.
 */
import { describe, expect, it } from 'vitest';
import { http } from '../repositories/http';
import { decodeQuery, encodeQuery, ENDPOINTS, type Incoming } from '../repositories/http/endpoints';

type Name = keyof typeof ENDPOINTS;

/** Send arguments through call() → the wire → args(), as client.ts and scripts/mock-api.ts do. */
function roundTrip(name: Name, args: unknown[]): unknown[] {
  const ep = ENDPOINTS[name] as unknown as { routes: string[]; call: (...a: unknown[]) => { route?: number; params?: Record<string, unknown>; query?: object; body?: unknown }; args: (r: Incoming) => unknown[] };
  const req = ep.call(...args);
  const pattern = ep.routes[req.route ?? 0].split(' ')[1];
  const params: Record<string, string> = {};
  for (const [, key] of pattern.matchAll(/:(\w+)/g)) {
    const v = req.params?.[key];
    expect(v, `${name}: missing path param :${key}`).not.toBeUndefined();
    params[key] = decodeURIComponent(encodeURIComponent(String(v)));
  }
  const query = decodeQuery(new URLSearchParams(encodeQuery(req.query).slice(1)));
  const body = req.body === undefined ? {} : JSON.parse(JSON.stringify(req.body));
  return ep.args({ route: req.route ?? 0, params, query, body });
}
/** JSON drops undefined; compare the way the wire does. */
const wire = (v: unknown) => JSON.parse(JSON.stringify(v ?? null));

describe('endpoint table', () => {
  const all = Object.entries(ENDPOINTS).flatMap(([name, ep]) => ep.routes.map((r) => ({ name, route: r })));

  it('the http implementation has exactly the table’s functions', () => {
    expect(Object.keys(http).sort()).toEqual(Object.keys(ENDPOINTS).sort());
    expect(Object.keys(ENDPOINTS).length).toBeGreaterThan(130);
  });

  it('every route is "METHOD /path" with kebab-case segments', () => {
    for (const { name, route } of all) expect(route, name).toMatch(/^(GET|POST|PUT|PATCH|DELETE) (\/(:[a-zA-Z]+|[a-z0-9-]+))+$/);
  });

  it('no two functions share a route', () => {
    const seen = new Map<string, string>();
    for (const { name, route } of all) {
      const shape = route.replace(/:\w+/g, ':');
      expect(seen.get(shape), `${name} and ${seen.get(shape)} both use ${route}`).toBeUndefined();
      seen.set(shape, name);
    }
  });

  it('query strings keep numbers, booleans and lists, and tell an empty list from no list', () => {
    const f = { search: 'a&b=c', page: 2, pageSize: 50, billable: false, ids: ['T-1', 'T-2'], status: undefined };
    expect(decodeQuery(new URLSearchParams(encodeQuery(f).slice(1)))).toEqual({ search: 'a&b=c', page: 2, pageSize: 50, billable: false, ids: ['T-1', 'T-2'] });
    expect(decodeQuery(new URLSearchParams(encodeQuery({ ids: [] }).slice(1)))).toEqual({ ids: [] });
    expect(encodeQuery({})).toBe('');
  });
});

describe('arguments survive the request', () => {
  const samples: [Name, unknown[]][] = [
    ['getEmployees', [{ search: 'sharma', dept: 'Engineering', page: 2, pageSize: 25, sort: 'name', dir: 'desc' }]],
    ['getEmployee', ['E-0100']],
    ['updateEmployee', ['E-0100', { title: 'COO', billable: false }]],
    ['appendSalaryEvent', [{ employeeId: 'E-0100', type: 'Bonus', effective: '2026-11-01', amount: 50000, note: 'Diwali' }]],
    ['getAttendance', [{ employeeId: 'E-0100', from: '2026-10-01', to: '2026-10-31' }]],
    ['saveSalaryStructure', [{ id: 'SS-1', name: 'Standard', components: [] }]],
    ['getCandidates', ['J-1']],
    ['getCandidates', [undefined]],
    ['moveCandidate', ['C-1', 'Offer']],
    ['setChecklistItem', ['OB-1', 'IT-3', true]],
    ['requestProfileChange', ['bank', 'HDFC 1234', 'Changed banks']],
    ['createTask', ['P-1', { title: 'Fix it', assigneeId: null, due: '2026-11-20', priority: 'High', estimateHours: 4 }]],
    ['addComment', ['T-1', 'Looks good']],
    ['getTimesheetEntries', [{ employeeId: 'E-0100', billable: true, ids: ['TE-1', 'TE-2'] }]],
    ['getTimesheetEntries', [{ ids: [] }]],
    ['saveTimesheetWeek', ['E-0100', '2026-11-02', [{ projectId: 'P-1', taskId: null, note: '', billable: true, hours: [8, 8, 0, 0, 0, 0, 0] }]]],
    ['submitTimesheetWeek', ['E-0100', '2026-11-02']],
    ['recallTimesheetWeek', ['E-0100', '2026-11-02']],
    ['recordPayment', ['INV-1', { date: '2026-11-06', amount: 1000, method: 'NEFT', reference: 'UTR1' }, 5000]],
    ['reviseInvoice', ['INV-1', 'Wrong rate', [{ id: 'L1', description: 'x', quantity: 1, rate: 10, amount: 10 }], 0]],
    ['reopenExpense', ['EX-1', 'Receipt was short', 1200]],
    ['decideApproval', ['A-1', false, 'Not this week']],
    ['decideApproval', ['A-1', true, undefined]],
    ['approveMany', [['A-1', 'A-2']]],
    ['moveLead', ['L-1', 'Won']],
    ['getTickets', ['C-31']],
    ['replyToTicket', ['TK-1', 'On it', true]],
    ['setTicketStatus', ['TK-1', 'Resolved']],
    ['getDocuments', ['project', 'P-1']],
    ['getDocuments', ['client', undefined]],
    ['uploadVersion', ['D-1', 'v2', 'F-12']],
    ['getDocumentUrl', ['D-1', 3]],
    ['getDocumentUrl', ['D-1', undefined]],
    ['reportAssetIssue', ['AS-1', 'Fan noise']],
    ['allocateAsset', ['AS-1', 'E-0100', 'New joiner']],
    ['allocateAsset', ['AS-1', null, 'Returned']],
    ['moveStock', ['IN-1', 'out', 3, 'Pantry']],
    ['getBookings', ['2026-11-06']],
    ['getKbArticle', ['leave-policy']],
    ['checkVisitor', ['V-1', 'in']],
    ['checkVisitor', ['V-1', 'out']],
    ['registerVisitor', [{ name: 'Asha', company: 'Acme', hostId: 'E-0100', purpose: 'Meeting', date: '2026-11-06', expected: '11:00' }, true]],
    ['updateUser', ['U-1', { status: 'Suspended' }]],
    ['setPermission', ['R-1', 'Payroll', 'view']],
    ['saveWorkflow', [{ id: 'WF-1', name: 'Leave', nodes: [] }]],
    ['setNotificationChannel', ['NR-1', 'email', false]],
    ['getAuditEvents', [{ entity: 'Invoice', actorId: 'E-0100', page: 3 }]],
    ['saveMasterRow', ['M-1', { id: 'R-9', values: ['a', 'b'], active: true }]],
    ['saveMasterRow', ['M-1', { values: ['a', 'b'], active: true }]],
    ['login', ['dipak@kestrel.digital', 'correct horse']],
    ['requestPasswordReset', ['dipak@kestrel.digital']],
    ['checkSetupToken', ['tok/with?odd chars']],
    ['checkResetToken', ['invite-tok/odd?']],
    ['completeReset', ['tok', 'a long password 123']],
    ['completeSetup', ['tok', { orgName: 'K', legalName: 'K Pvt', state: 'KA', gstin: '', adminName: 'D', password: '0123456789', modules: ['people'] }]],
    ['payPortalInvoice', ['INV-1', 'UPI']],
    ['replyPortalTicket', ['TK-1', 'Thanks']],
    ['getPortalDocumentUrl', ['D-1']],
    ['markAllNotificationsRead', []],
  ];

  it.each(samples)('%s', (name, args) => {
    expect(wire(roundTrip(name, args))).toEqual(wire(args));
  });
});
