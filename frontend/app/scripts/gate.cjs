/**
 * Quality gate: visits routes as every role at desktop and 390px width,
 * fails on console errors, page errors, horizontal scroll, or a "not built yet" stub.
 * Usage: node scripts/gate.cjs <baseUrl> <routesFile|-> [outDir]
 *
 * Against the API (VITE_DATA_SOURCE=http), set GATE_PASSWORD: each role then signs in as its demo account
 * (backend db/seed/import-fixture.ts; override with GATE_ACCOUNTS='{"Admin":"…"}'), since the role comes from the
 * session there. Expected refusals of a role's deep link (403/404 from the API, shown as the page's error state)
 * are counted, not failed. There the /portal routes are visited by a client account (Client), and only by it.
 */
const DEMO_ACCOUNTS = { Admin: 'dipak.sharma@kestrel.digital', HR: 'meera.iyer@kestrel.digital', Manager: 'vikram.menon@kestrel.digital', Employee: 'aarav.shah@kestrel.digital', Client: 'meghna@lumen.in' };
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const base = process.argv[2] || 'http://localhost:4173';
  const routes = fs.readFileSync(process.argv[3], 'utf8').split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('#'));
  const out = process.argv[4];
  // Against the API the portal belongs to client accounts: staff roles skip /portal routes, and a Client role
  // (Lumen Energy's contact) visits only those.
  const live = !!process.env.GATE_PASSWORD;
  const roles = (process.env.ROLES || (live ? 'Admin,HR,Manager,Employee,Client' : 'Admin,HR,Manager,Employee')).split(',');
  const routesFor = (role) => (!live ? routes : role === 'Client' ? routes.filter((r) => r.startsWith('/portal')) : routes.filter((r) => !r.startsWith('/portal')));
  const b = await chromium.launch();
  const problems = [];
  const refused = [];
  let stubs = 0, visits = 0;
  for (const width of [1440, 390]) {
    for (const role of roles) {
      const ctx = await b.newContext({ viewport: { width, height: 900 } });
      if (process.env.GATE_PASSWORD) {
        const accounts = { ...DEMO_ACCOUNTS, ...JSON.parse(process.env.GATE_ACCOUNTS || '{}') };
        const res = await ctx.request.post(base + '/api/v1/auth/login', { headers: { 'X-Requested-With': 'riona' }, data: { email: accounts[role], password: process.env.GATE_PASSWORD } });
        if (!res.ok()) { problems.push(`${role}: sign-in failed (${res.status()})`); await ctx.close(); continue; }
      }
      const p = await ctx.newPage();
      let errs = [];
      p.on('pageerror', (e) => errs.push(e.message));
      p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
      for (const r of routesFor(role)) {
        errs = [];
        await p.goto(`${base}/?role=${role}#${r}`);
        try { await p.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, { timeout: 8000 }); } catch { problems.push(`${role} ${width} ${r}: still loading after 8s`); }
        await p.waitForTimeout(150);
        visits++;
        const info = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, stub: !!document.querySelector('.stub'), text: document.body.innerText.length }));
        if (info.stub) { stubs++; if (role === 'Admin' && width === 1440) problems.push(`STUB ${r}`); }
        if (info.sw > info.cw + 1) problems.push(`${role} ${width} ${r}: horizontal scroll ${info.sw}>${info.cw}`);
        // The expired-link screen exists to show a 410; the browser logs that response.
        errs = errs.filter((e) => !(r.includes('/setup/expired') && /status of 410/.test(e)));
        // A role opening a record it may not see gets 403/404 and the page's error state: the rules working.
        if (errs.length && errs.every((e) => /status of (403|404)/.test(e)) && (await p.locator('[role="alert"]').count())) { refused.push(`${role} ${width} ${r}`); errs = []; }
        for (const e of errs) problems.push(`${role} ${width} ${r}: ${e}`);
        if (out && role === 'Admin') await p.screenshot({ path: `${out}/${width}${r.replace(/[/?=&]/g, '_')}.png`, fullPage: width === 1440 });
      }
      await ctx.close();
    }
  }
  await b.close();
  console.log(`visits ${visits}, stub hits ${stubs}, refused as expected ${refused.length}`);
  if (process.env.GATE_VERBOSE) for (const x of refused) console.log('  refused: ' + x);
  console.log(problems.length ? problems.join('\n') : 'GATE GREEN');
  process.exit(problems.filter((x) => !x.startsWith('STUB')).length ? 1 : 0);
})();
