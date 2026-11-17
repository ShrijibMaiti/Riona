/**
 * Wave 8: every endpoint in the contract is served by the backend, the mock is gone, and the remaining modules
 * read exactly as the frontend's fixture has them.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { fixture } from '../helpers/golden';
import { ENDPOINTS } from '../../../frontend/app/src/data/repositories/http/endpoints';
import { db } from '../helpers/db';
import { PREFIX, signIn, testApp } from '../helpers/session';

afterAll(async () => {
  await (await testApp()).close();
  await db.destroy();
});

const byId = <T extends { id: string }>(xs: T[]) => [...xs].sort((a, b) => a.id.localeCompare(b.id));
const TIMES = new Set(['at', 'lastActive', 'lastRun']);
const instants = <T,>(x: T): T => JSON.parse(JSON.stringify(x), (k, v) => (TIMES.has(k) && typeof v === 'string' ? Date.parse(v) : v));

describe('coverage', () => {
  it('every route in the contract (endpoints.ts) is registered in the backend', async () => {
    const app = await testApp();
    const missing = Object.entries(ENDPOINTS as Record<string, { routes: string[] }>).flatMap(([name, ep]) =>
      ep.routes.filter((r) => {
        const [method, path] = r.split(' ');
        return !app.hasRoute({ method: method as 'GET', url: PREFIX + path });
      }).map((r) => `${name}: ${r}`),
    );
    expect(missing).toEqual([]);
  });

  it('nothing is forwarded to a mock: an unknown route is a plain 404', async () => {
    const res = await (await signIn('Admin')).get('/no-such-thing');
    expect(res.status).toBe(404);
    expect(res.headers['x-served-by']).toBeUndefined();
  });
});

describe('parity with the frontend fixture (as Admin, Dipak)', () => {
  const lists: [string, string, () => Promise<{ id: string }[]>][] = [
    ['leads', '/leads', () => fixture.getLeads()],
    ['contracts', '/contracts', () => fixture.getContracts()],
    ['client documents', '/documents?ownerType=client', () => fixture.getDocuments('client')],
    ['project documents', '/documents?ownerType=project&ownerId=P-214', () => fixture.getDocuments('project', 'P-214')],
    ['employee documents', '/documents?ownerType=employee', () => fixture.getDocuments('employee')],
    ['assets', '/assets', () => fixture.getAssets()],
    ['my assets', '/me/assets', () => fixture.getMyAssets()],
    ['inventory', '/inventory', () => fixture.getInventory()],
    ['rooms', '/rooms', () => fixture.getRooms()],
    ['bookings', '/bookings?date=2026-11-06', () => fixture.getBookings('2026-11-06')],
    ['announcements', '/announcements', () => fixture.getAnnouncements()],
    ['kb', '/kb', () => fixture.getKbArticles()],
    ['visitors (all)', '/visitors', () => fixture.getVisitors()],
    ['visitors (a day)', '/visitors?date=2026-11-06', () => fixture.getVisitors('2026-11-06')],
    ['jobs', '/jobs', () => fixture.getJobs()],
    ['candidates', '/candidates', () => fixture.getCandidates()],
    ['candidates of a job', '/candidates?jobId=J-31', () => fixture.getCandidates('J-31')],
    ['onboarding', '/onboarding', () => fixture.getOnboarding()],
    ['review cycles', '/review-cycles', () => fixture.getReviewCycles()],
    ['reviews', '/reviews', () => fixture.getReviews()],
    ['reviews of a cycle', '/reviews?cycleId=RC-H2-26', () => fixture.getReviews({ cycleId: 'RC-H2-26' })],
    ['goals', '/goals', () => fixture.getGoals()],
    ['goals of a person', '/goals?employeeId=E-0112', () => fixture.getGoals('E-0112')],
    ['programmes', '/training/programmes', () => fixture.getProgrammes()],
    ['certifications', '/training/certifications', () => fixture.getCertifications()],
    ['users (staff)', '/users', () => fixture.getUsers()],
    ['roles', '/roles', () => fixture.getRoles()],
    ['notification rules', '/notification-rules', () => fixture.getNotificationRules()],
    ['masters', '/masters', () => fixture.getMasters()],
    ['system jobs', '/system-jobs', () => fixture.getSystemJobs()],
  ];

  it.each(lists)('%s', async (_name, path, want) => {
    const admin = await signIn('Admin');
    const res = await admin.get(path);
    expect(res.status, path).toBe(200);
    const expected = await want();
    // The backend also has the client-portal accounts (Wave 7), which the fixture doesn't.
    const got = (res.body as { id: string }[]).filter((x) => expected.some((e) => e.id === x.id));
    expect(got.length, path).toBe(expected.length);
    expect(instants(byId(got))).toEqual(instants(byId(expected)));
  });

  it('single records', async () => {
    const admin = await signIn('Admin');
    const pairs: [string, unknown][] = [
      ['/leads/LD-40', await fixture.getLead('LD-40')],
      ['/assets/AS-100', await fixture.getAsset('AS-100')],
      ['/kb/leave-policy-2026', await fixture.getKbArticle('leave-policy-2026')],
      ['/jobs/J-31', await fixture.getJob('J-31')],
      ['/candidates/CA-500', await fixture.getCandidate('CA-500')],
      ['/onboarding/OB-21', await fixture.getOnboardingCase('OB-21')],
      ['/reviews/RV-0100-H2-26', await fixture.getReview('RV-0100-H2-26')],
      ['/documents/DOC-241/versions/latest/download', await fixture.getDocumentUrl('DOC-241')],
      ['/documents/DOC-241/versions/1/download', await fixture.getDocumentUrl('DOC-241', 1)],
    ];
    for (const [path, want] of pairs) expect(instants((await admin.get(path)).body), path).toEqual(instants(want));
  });
});
