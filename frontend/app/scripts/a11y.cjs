/**
 * Accessibility audit: runs axe-core (WCAG 2.0/2.1 A + AA rules) over representative routes at 1440 px and 390 px.
 * Usage: node scripts/a11y.cjs <baseUrl>   — exits 1 if any serious or critical violation is found.
 */
const { chromium } = require('playwright');
const AXE = require.resolve('axe-core/axe.min.js');
const ROUTES = [
  ['Dashboard', '?role=Admin#/app'],
  ['Hub (People)', '?role=HR#/app/people'],
  ['Directory', '?role=HR#/app/people/directory'],
  ['Compensation ledger', '?role=HR#/app/people/directory/E-0112/compensation'],
  ['New invoice', '?role=Admin#/app/finance/invoices/new'],
  ['Profitability', '?role=Admin#/app/finance/profitability'],
  ['Workflow builder', '?role=Admin#/app/admin/workflows/WF-2'],
  ['Kanban board', '?role=Manager#/app/work/projects/P-214'],
  ['Landing', '#/'],
  ['Portal', '#/portal'],
  ['My Space · payslips', '?role=Employee#/app/me/payslips'],
  ['Setup wizard', '#/setup/demo-token'],
];
(async () => {
  const base = process.argv[2] || 'http://localhost:4173';
  const b = await chromium.launch();
  const found = [];
  for (const width of [1440, 390]) {
    const ctx = await b.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    const p = await ctx.newPage();
    for (const [name, r] of ROUTES) {
      await p.goto(base + '/' + r);
      await p.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, { timeout: 10000 }).catch(() => {});
      await p.waitForTimeout(400);
      await p.addScriptTag({ path: AXE });
      const res = await p.evaluate(() => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } }));
      for (const v of res.violations) found.push({ width, name, id: v.id, impact: v.impact, help: v.help, n: v.nodes.length, sample: v.nodes.slice(0, 3).map((x) => x.target.join(' ') + (x.failureSummary ? ' — ' + x.failureSummary.split('\n').slice(1, 2).join('').trim() : '')) });
    }
    await ctx.close();
  }
  await b.close();
  const rank = { critical: 0, serious: 1, moderate: 2, minor: 3 };
  found.sort((a, b) => rank[a.impact] - rank[b.impact] || a.id.localeCompare(b.id));
  for (const f of found) console.log(`[${f.impact}] ${f.id} · ${f.name} @${f.width} · ${f.n} node(s) · ${f.help}\n    ${f.sample.join('\n    ')}`);
  const bad = found.filter((f) => f.impact === 'serious' || f.impact === 'critical');
  console.log(`\n${found.length} violation groups; serious/critical: ${bad.length}`);
  process.exit(bad.length ? 1 : 0);
})();
