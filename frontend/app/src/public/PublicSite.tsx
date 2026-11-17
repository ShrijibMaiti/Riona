/**
 * The public site: home, the hubs index and one page per hub, security, contact, docs and a 404. Built in the
 * Stratum grammar (paper inside a hairline frame, Geist and IBM Plex Mono, one signal orange). Every claim on it
 * is about what Riona does today; every figure comes from the Kestrel Digital demo organisation.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import * as api from '../data/repositories';
import { RionaMark } from '../components/Brand';
import { EVENTS, FAQ, FOOTER, MONL, PILLARS, ROLE_PREVIEW, SECURITY, SECURITY_MORE, STATUTORY, inr, previewShot, slip } from './content';
import { ENTRY, EntryFigure } from './EntryFigure';
import { LoginCard } from './Auth';
import { usePublicBody } from './usePublicBody';
import './site.css';

// ---------------------------------------------------------------- small drawn icons (no glyphs standing in)

const ArrowUR = () => <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M3 9L9 3M4 3h5v5" /></svg>;
const ArrowR = () => <svg width="13" height="11" viewBox="0 0 14 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M1 6h11M8 2l4 4-4 4" /></svg>;
const ArrowD = () => <svg width="11" height="13" viewBox="0 0 12 14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M6 1v11M2 8l4 4 4-4" /></svg>;
const Plus = () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="M7 1v12M1 7h12" /></svg>;
const Check = () => <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#9FB486" strokeWidth="1.6" aria-hidden="true"><path d="M2 6.5l2.5 2.5L10 3.5" /></svg>;
const Close = () => <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" /></svg>;

const Brand = () => <a href="#/" className="s-brand" aria-label="Riona, home"><RionaMark size={21} /><span>riona</span></a>;

// ---------------------------------------------------------------- shell

const NAV: [string, string][] = [['#/features', 'Product'], ['#/security', 'Security'], ['#/docs', 'Docs'], ['#/contact', 'Contact']];

export default function PublicSite({ path }: { path: string }) {
  usePublicBody();
  const R = path.replace(/\/$/, '') || '/';
  const seg = R.split('/').filter(Boolean);
  const [menu, setMenu] = useState(false);
  const [login, setLogin] = useState(false);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => { setMenu(false); window.scrollTo(0, 0); }, [R]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setLogin(false); setMenu(false); } };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  useEffect(() => { if (!login) opener.current?.focus?.(); }, [login]);
  const openLogin = (e?: { currentTarget: EventTarget }) => { opener.current = (e?.currentTarget as HTMLElement) ?? null; setLogin(true); setMenu(false); };

  const pillarKey = seg[0] === 'features' && seg[1] ? (seg[1] === 'platform' ? 'admin' : seg[1]) : null;
  const pillar = pillarKey ? PILLARS.find((p) => p.k === pillarKey) : null;
  let page: ReactNode;
  if (R === '/') page = <Home openLogin={openLogin} />;
  else if (R === '/features') page = <FeaturesIndex />;
  else if (pillar) page = <Feature k={pillar.k} />;
  else if (R === '/security') page = <SecurityPage />;
  else if (R === '/contact') page = <Contact />;
  else if (R === '/docs') page = <Docs />;
  else page = <NotFound />;
  const here = '#' + (seg[0] ? '/' + seg[0] : '/');

  return (
    <div className="pub site">
      <div className="frame">
        <header className="s-head">
          <div className="inner s-head-in">
            <Brand />
            <nav className="s-nav" aria-label="Site">
              {NAV.map(([href, n]) => <a key={href} href={href} aria-current={here === href ? 'page' : undefined}>{n}</a>)}
            </nav>
            <div className="s-head-act">
              <button className="s-btn s-btn-primary s-btn-sm" onClick={openLogin}>Sign in <ArrowUR /></button>
              <button className="s-btn s-btn-line s-btn-sm s-menu-btn" aria-expanded={menu} aria-controls="s-menu" onClick={() => setMenu(!menu)}>Menu</button>
            </div>
          </div>
          {menu && (
            <nav id="s-menu" className="s-menu" aria-label="Site">
              {NAV.map(([href, n]) => <a key={href} href={href}>{n}</a>)}
            </nav>
          )}
        </header>

        <main>{page}</main>

        <section className="rule inner s-close" aria-labelledby="close-h">
          <h2 id="close-h" className="s-h2">Hours entered once.<br /><span className="quiet">Numbers that agree.</span></h2>
          <div className="s-close-act">
            <button className="s-btn s-btn-primary" onClick={openLogin}>Sign in to Riona <ArrowUR /></button>
            <span className="s-micro">Inside, Kestrel Digital is a demo organisation.</span>
          </div>
        </section>
        <footer className="rule inner s-foot">
          <div className="s-foot-l">
            <Brand />
            <span className="s-micro">© 2026 Riona · a B.Tech project</span>
          </div>
          <nav aria-label="Footer">{FOOTER.map(([n, href]) => <a key={n} href={href}>{n}</a>)}</nav>
          <span className="s-micro s-dot">Built for Indian services firms</span>
        </footer>
      </div>

      {login && (
        <div className="s-scrim" onClick={() => setLogin(false)}>
          <div className="s-dialog" role="dialog" aria-modal="true" aria-label="Sign in" onClick={(e) => e.stopPropagation()}>
            <button className="s-x" onClick={() => setLogin(false)} aria-label="Close sign-in"><Close /></button>
            <LoginCard />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- home

function Home({ openLogin }: { openLogin: (e?: { currentTarget: EventTarget }) => void }) {
  return (
    <>
      <section className="inner s-hero" aria-labelledby="hero-h">
        <div>
          <h1 id="hero-h" className="s-h1">One entry.<br />Three figures.</h1>
          <p className="s-lead">Riona runs a services firm’s people, projects, clients and money on one record. Every hour your team logs becomes payroll cost, an invoice line and project margin, and each figure links back to the hours behind it.</p>
          <div className="s-hero-acts">
            <button className="s-btn s-btn-primary" onClick={openLogin}>Sign in <ArrowUR /></button>
            <a className="s-link" href="#/" onClick={(e) => { e.preventDefault(); document.getElementById('entry')?.scrollIntoView({ behavior: 'smooth' }); }}>Change the hours yourself <ArrowD /></a>
          </div>
          <p className="s-micro">Built for Indian IT services firms of 20 to 200 people.</p>
        </div>
        <EntryFigure />
      </section>

      <div className="rule inner s-strip" aria-label="Indian statutory items Riona calculates">
        <span className="s-cap">Indian statutory,<br />built in</span>
        <span className="item">PF<small>12% of basic</small></span>
        <span className="item">ESI<small>below ₹21,000</small></span>
        <span className="item">Prof. Tax<small>by work state</small></span>
        <span className="item">TDS<small>both regimes</small></span>
        <span className="item">GST<small>CGST+SGST / IGST</small></span>
      </div>

      <EntryEditor />
      <Hubs />
      <Ledger />
      <Roles />
      <Security />
      <Faq />
    </>
  );
}

/** The signature interaction: change the hours or the billable flag and watch the three figures follow. */
function EntryEditor() {
  const [hours, setHours] = useState(ENTRY.hours);
  const [billable, setBillable] = useState(true);
  const h = Math.max(0, Math.min(24, Math.round(hours * 2) / 2));
  const cost = h * ENTRY.costRate, bill = billable ? h * ENTRY.billRate : 0, margin = bill - cost;
  const step = (d: number) => setHours((x) => Math.max(0, Math.min(24, Math.round((x + d) * 2) / 2)));
  const costShare = bill > 0 ? Math.min(100, (cost / bill) * 100) : 100;
  return (
    <section id="entry" className="rule inner s-sec" aria-labelledby="entry-h">
      <div className="s-sec-head">
        <h2 id="entry-h" className="s-h2">Change one entry.<br />Watch three figures follow.</h2>
        <p className="s-body">Most firms copy hours from a timesheet into payroll and again into billing, and the copies drift. Riona keeps the entry and computes the rest when you read it.</p>
      </div>
      <div className="s-play">
        <div className="s-play-top">
          <span>kestrel-digital / <b>{ENTRY.id.toLowerCase()}</b></span>
          <span className="live"><i />Illustration · nothing is saved</span>
        </div>
        <div className="s-play-body">
          <div className="s-code" aria-label="Timesheet entry">
            <div className="ln"><span className="n">1</span><span><span className="k">entry:</span> <span className="v">{ENTRY.id}</span></span></div>
            <div className="ln"><span className="n">2</span><span><span className="k">person:</span> {ENTRY.person} <span className="c"># {ENTRY.title}</span></span></div>
            <div className="ln"><span className="n">3</span><span><span className="k">project:</span> {ENTRY.project}</span></div>
            <div className="ln"><span className="n">4</span><span><span className="k">client:</span> {ENTRY.client}</span></div>
            <div className="ln"><span className="n">5</span><span><span className="k">date:</span> {ENTRY.iso} <span className="c"># {ENTRY.task.toLowerCase()}</span></span></div>
            <div className="ln"><span className="n">6</span>
              <span className="row"><span className="k">hours:</span>
                <span className="s-step">
                  <button type="button" onClick={() => step(-0.5)} aria-label="Half an hour less"><svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M1 5h8" /></svg></button>
                  <input type="number" min={0} max={24} step={0.5} value={hours} aria-label="Hours on this entry" onChange={(e) => setHours(+e.target.value || 0)} onBlur={() => setHours(h)} />
                  <button type="button" onClick={() => step(0.5)} aria-label="Half an hour more"><svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M1 5h8M5 1v8" /></svg></button>
                </span>
              </span>
            </div>
            <div className="ln"><span className="n">7</span>
              <span className="row"><span className="k">billable:</span>
                <label className="s-toggle"><input type="checkbox" checked={billable} onChange={(e) => setBillable(e.target.checked)} /><span className="sw" aria-hidden="true" />{billable ? 'true' : 'false'}</label>
              </span>
            </div>
            <div className="ln"><span className="n">8</span><span /></div>
            <div className="ln"><span className="n">9</span><span><span className="k">cost_rate:</span> {ENTRY.costRate} <span className="c"># ₹19.86 L CTC × 1.4 ÷ 12 ÷ 140 h</span></span></div>
            <div className="ln"><span className="n">10</span><span><span className="k">bill_rate:</span> {ENTRY.billRate} <span className="c"># senior engineer, Northwind</span></span></div>
          </div>
          <div className="s-out" aria-live="polite">
            <div className="s-out-head"><b>Computed from {ENTRY.id}</b><span className="s-micro">{h.toFixed(1)} h · {billable ? 'billable' : 'not billable'}</span></div>
            <div className="s-cards">
              <div className="s-card"><div className="k">Payroll cost</div><div className="v">{inr(cost)}</div><div className="f">{h.toFixed(1)} h × {inr(ENTRY.costRate)}</div></div>
              <div className="s-card"><div className="k">Invoice line</div><div className="v">{inr(bill)}</div><div className="f">{billable ? h.toFixed(1) + ' h × ' + inr(ENTRY.billRate) : 'Not billed to the client'}</div></div>
              <div className="s-card"><div className="k">Margin</div><div className="v" style={{ color: margin < 0 ? 'var(--red)' : undefined }}>{(margin < 0 ? '−' : '+') + inr(Math.abs(margin))}</div><div className="f">{bill > 0 ? ((margin / bill) * 100).toFixed(1) + '% of the line' : 'Cost with no revenue'}</div></div>
            </div>
            <div className="s-split" aria-hidden="true">
              <div className="s-split-bar"><span style={{ width: costShare + '%', background: '#8DA172' }} /><span style={{ width: 100 - costShare + '%', background: 'var(--accent)' }} /></div>
              <div className="s-split-key"><span>cost {costShare.toFixed(0)}%</span><span>margin {Math.max(0, 100 - costShare).toFixed(0)}%</span></div>
            </div>
            <p className="note">The real entry was 7.0 billable hours, billed on {ENTRY.invoice}. In Riona, the profitability page links every cost back to entries like this one.</p>
          </div>
        </div>
        <div className="s-play-foot">
          <span>› One record. Payroll, invoicing and margin read it; none of them copy it.</span>
          <a className="s-btn s-btn-primary" href="#/features/finance">See profitability <ArrowR /></a>
        </div>
      </div>
    </section>
  );
}

function Hubs({ index = false }: { index?: boolean }) {
  return (
    <section className={'inner s-sec' + (index ? '' : ' rule')} aria-labelledby="hubs-h">
      {!index && (
        <div className="s-sec-head">
          <h2 id="hubs-h" className="s-h2">Six hubs, one record.</h2>
          <p className="s-body">Each hub is one word in the top bar, and nothing is more than two clicks away. A role sees only the hubs it can use.</p>
        </div>
      )}
      <div className="s-cols">
        {PILLARS.map((p) => (
          <a key={p.k} href={'#/features/' + p.k} className="s-col">
            <h3 className="s-h3">{p.name}</h3>
            <p className="s-body">{p.s}</p>
            <span className="s-micro">{p.all.filter((a) => !a[2]).slice(0, 3).map((a) => a[0]).join(' · ')}</span>
          </a>
        ))}
      </div>
    </section>
  );
}

/** Payroll history on the dark field: scrub Aarav Shah's real salary ledger and the payslip recalculates. */
function Ledger() {
  const LAST = 43;
  const [m, setM] = useState(LAST);
  const touched = useRef(false);
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = el.current;
    if (!node || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let iv = 0;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting || touched.current) return;
      io.disconnect();
      let i = 0;
      setM(0);
      iv = window.setInterval(() => { if (touched.current) return window.clearInterval(iv); i += 1; setM(Math.min(LAST, i)); if (i >= LAST) window.clearInterval(iv); }, 90);
    }, { threshold: 0.4 });
    io.observe(node);
    return () => { io.disconnect(); window.clearInterval(iv); };
  }, []);
  const take = (v: number) => { touched.current = true; setM(v); };
  const sl = slip(m);
  const month = MONL[(3 + m) % 12] + ' ' + (2023 + Math.floor((3 + m) / 12));
  const ev = EVENTS.filter((e) => e.m <= m);
  const note = sl.kind ? 'Includes a ' + sl.kind.toLowerCase() + ' event of ' + inr(Math.abs(sl.extra)) + ' this month.' : 'Rebuilt from ' + ev.length + ' event' + (ev.length === 1 ? '' : 's') + ' up to this month.';
  return (
    <section className="s-dark" aria-labelledby="ledger-h">
      <div className="rule inner s-sec">
        <div className="s-sec-head">
          <h2 id="ledger-h" className="s-h2">Payroll that keeps its history.</h2>
          <p className="s-body">Every hire, revision, bonus, deduction and correction is appended, never overwritten. Drag back to any month and the payslip is rebuilt from the events up to then.</p>
        </div>
        <div className="s-ledger" ref={el}>
          <div className="s-time">
            <div className="s-track">
              <div className="base" />
              <div className="fill" style={{ width: (m / LAST) * 100 + '%' }} />
              {EVENTS.map((e) => (
                <button key={e.m} className={'s-ev' + (e.m <= m ? ' on' : '')} style={{ left: (e.m / LAST) * 100 + '%', opacity: e.m <= m ? 1 : 0.4 }} onClick={() => take(e.m)} aria-label={e.type + ', ' + e.d}>
                  <span className="t">{e.type}</span>
                  <span className="d">{e.d}</span>
                  <span className="a">{e.ctc ? '₹' + (e.ctc / 1e5).toFixed(2) + ' L' : (e.amt! < 0 ? '−' : '+') + inr(Math.abs(e.amt!))}</span>
                  <span className="p" />
                </button>
              ))}
            </div>
            <input className="s-range" type="range" min={0} max={LAST} value={m} onChange={(e) => take(+e.target.value)} aria-label="Month in Aarav Shah’s salary history" aria-valuetext={month} />
            <div className="s-range-key s-micro"><span>Apr 2023</span><span>Nov 2026</span></div>
            <p className="s-micro" style={{ marginTop: 18 }}>FIG. 02 — Aarav Shah’s salary ledger in the demo organisation. The payslip is a simplified illustration of the arithmetic.</p>
          </div>
          <div className="s-slip">
            <div style={{ fontSize: 24, fontWeight: 550, letterSpacing: '-0.035em' }}>Payslip, {month}</div>
            <div className="rows">
              <span>Annual CTC</span><span>{inr(sl.ctc)}</span>
              <span>Gross this month</span><span>{inr(sl.gross)}</span>
              <span>PF · PT · TDS{sl.recovery ? ' · recovery' : ''}</span><span>− {inr(sl.ded)}</span>
            </div>
            <div className="net"><b>Net pay</b><span>{inr(sl.net)}</span></div>
            <p className="s-micro" style={{ marginTop: 12 }}>{note}</p>
          </div>
        </div>
        <div className="s-checks">
          {STATUTORY.map(([k, v]) => <div key={k}><b><Check />{k}</b><p>{v}</p></div>)}
        </div>
      </div>
    </section>
  );
}

function Roles() {
  const [role, setRole] = useState('Admin');
  const keys = Object.keys(ROLE_PREVIEW);
  const onKey = (e: React.KeyboardEvent) => {
    const i = keys.indexOf(role);
    if (e.key === 'ArrowRight') setRole(keys[(i + 1) % keys.length]);
    if (e.key === 'ArrowLeft') setRole(keys[(i + keys.length - 1) % keys.length]);
  };
  return (
    <section className="rule inner s-sec" aria-labelledby="roles-h">
      <div className="s-sec-head">
        <h2 id="roles-h" className="s-h2">Five roles, five views.</h2>
        <div role="tablist" aria-label="Role" className="s-seg" onKeyDown={onKey}>
          {keys.map((k) => <button key={k} role="tab" aria-selected={role === k} tabIndex={role === k ? 0 : -1} onClick={() => setRole(k)}>{k}</button>)}
        </div>
      </div>
      <div className="s-shot" role="tabpanel" aria-label={role}>
        <img key={role} src={previewShot(ROLE_PREVIEW[role][0])} alt={'Riona as ' + role + ': ' + ROLE_PREVIEW[role][1]} loading="lazy" width={1440} height={900} />
      </div>
      <div className="s-shot-cap"><span className="s-body">{ROLE_PREVIEW[role][1]}</span><span className="s-micro">FIG. 03 — the demo organisation, as {role === 'Client' ? 'a client contact' : 'the ' + role.toLowerCase()}</span></div>
    </section>
  );
}

function Security({ page = false }: { page?: boolean }) {
  const H = page ? 'h1' : 'h2';
  return (
    <section className={(page ? '' : 'rule ') + 'inner s-sec'} aria-labelledby="sec-h">
      <div className="s-sec-head">
        <H id="sec-h" className={page ? 's-h1' : 's-h2'}>Salaries are sensitive.<br /><span className="quiet">Riona is built that way.</span></H>
        <p className="s-body">Compensation, bank details and client contracts sit in one system, so access is decided by the server and the database, not by what a screen happens to hide.</p>
      </div>
      <div className="s-four">
        {SECURITY.map(([k, v]) => <div key={k}><h3 className="s-h3">{k}</h3><p className="s-body">{v}</p></div>)}
      </div>
      {page ? (
        <div className="s-more">
          {SECURITY_MORE.map(([k, v, c]) => <div key={k}><h3 className="s-h3">{k}{c && <span className="s-coming">Coming</span>}</h3><p className="s-body" style={{ marginTop: 8 }}>{v}</p></div>)}
        </div>
      ) : (
        <p className="s-micro" style={{ marginTop: 32 }}>Coming: multi-factor sign-in, field-level encryption, SAML and SCIM. <a className="s-link-under" href="#/security">The full list</a></p>
      )}
    </section>
  );
}

function Faq() {
  const [open, setOpen] = useState(0);
  return (
    <section className="rule inner s-sec" aria-labelledby="faq-h">
      <div className="s-faq">
        <div className="s-faq-intro">
          <h2 id="faq-h" className="s-h2">Straight answers.</h2>
          <p className="s-body">Including what isn’t built yet. Riona is a project before it is a product, and it says so.</p>
        </div>
        <div>
          {FAQ.map(([q, a], i) => (
            <div key={q} className="s-qa">
              <button onClick={() => setOpen(open === i ? -1 : i)} aria-expanded={open === i} aria-controls={'faq-' + i}>{q}<Plus /></button>
              {open === i && <p id={'faq-' + i}>{a}</p>}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- other pages

function FeaturesIndex() {
  return (
    <>
      <div className="inner s-page-head">
        <h1 className="s-h1">Six hubs.<br /><span className="quiet">One record.</span></h1>
        <p className="s-lead">People, Work, Clients, Finance, Workplace and Admin share one database and one approvals engine, so an hour logged in Work is the same hour costed in People and billed in Finance.</p>
      </div>
      <div className="rule"><Hubs index /></div>
    </>
  );
}

function Feature({ k }: { k: string }) {
  const fp = PILLARS.find((p) => p.k === k)!;
  return (
    <>
      <div className="inner" style={{ paddingTop: 36 }}><a href="#/features" className="s-link s-micro"><span style={{ transform: 'scaleX(-1)', display: 'inline-flex' }}><ArrowR /></span> All hubs</a></div>
      <div className="inner s-page-head" style={{ paddingTop: 20 }}>
        <h1 className="s-h1">{fp.name}</h1>
        <p className="s-lead">{fp.s}</p>
      </div>
      <div className="inner" style={{ paddingBottom: 56 }}>
        <div className="s-shot"><img src={previewShot(fp.src)} alt={fp.name + ' in Riona, with the demo organisation'} width={1440} height={900} /></div>
        <div className="s-shot-cap"><span className="s-body">{fp.link}</span><span className="s-micro">FIG. — {fp.name.toUpperCase()} IN THE DEMO ORGANISATION</span></div>
      </div>
      <section className="rule inner s-sec" aria-labelledby="mods-h">
        <h2 id="mods-h" className="s-h2" style={{ marginBottom: 32 }}>What’s in {fp.name}</h2>
        <div className="s-mods">
          {fp.all.map(([n, d, c]) => <div key={n}><h3 className="s-h3">{n}{c && <span className="s-coming">Coming</span>}</h3><p className="s-body">{d}</p></div>)}
        </div>
      </section>
      <div className="rule inner" style={{ paddingTop: 26, paddingBottom: 30 }}>
        <div className="s-chips"><span className="s-cap" style={{ marginRight: 8 }}>Other hubs</span>{PILLARS.filter((p) => p !== fp).map((o) => <a key={o.k} href={'#/features/' + o.k}>{o.name}</a>)}</div>
      </div>
    </>
  );
}

function SecurityPage() {
  return <Security page />;
}

const DEMO_FIELDS: ['name' | 'email' | 'company' | 'size', string, string, string][] = [['name', 'Your name', 'Dipak Sharma', 'name'], ['email', 'Work email', 'dipak@company.in', 'email'], ['company', 'Company', 'Kestrel Digital', 'organization'], ['size', 'Number of employees', '140', 'off']];

function Contact() {
  const [f, setF] = useState({ name: '', email: '', company: '', size: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try { await api.requestDemo(f); setSent(true); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  return (
    <section className="inner s-sec" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(380px, 100%), 1fr))', gap: '40px 72px', alignItems: 'start' }}>
      <div>
        <h1 className="s-h1">Talk to us.</h1>
        <p className="s-lead" style={{ marginTop: 22 }}>Questions about Riona, the project behind it, or a walk-through of the demo organisation. Every message is read by the people who built it.</p>
      </div>
      <div style={{ border: '1px solid var(--line)', borderRadius: 6, background: 'var(--surface)', padding: 28 }}>
        {!sent ? (
          <form className="s-form" onSubmit={submit} noValidate>
            {DEMO_FIELDS.map(([k, label, ph, ac]) => (
              <label key={k}><span>{label}</span><input className="s-input" value={f[k]} autoComplete={ac} inputMode={k === 'size' ? 'numeric' : undefined} type={k === 'email' ? 'email' : 'text'} placeholder={ph} onChange={(e) => { setF({ ...f, [k]: e.target.value }); setErr(''); }} /></label>
            ))}
            {err && <div role="alert" className="s-err">{err}</div>}
            <button className="s-btn s-btn-primary" type="submit" disabled={busy} style={{ justifyContent: 'space-between' }}>{busy ? 'Sending…' : 'Send message'} <ArrowR /></button>
          </form>
        ) : (
          <div role="status">
            <div className="s-h2">Thanks, {(f.name || 'there').split(' ')[0]}.</div>
            <p className="s-body" style={{ marginTop: 14 }}>Your message is in. We’ll reply to {f.email}.</p>
            <a href="#/" className="s-link s-link-under" style={{ marginTop: 20 }}>Back to the homepage</a>
          </div>
        )}
      </div>
    </section>
  );
}

function Docs() {
  return (
    <section className="inner s-sec" style={{ minHeight: '52vh' }}>
      <h1 className="s-h1">Docs</h1>
      <p className="s-lead" style={{ marginTop: 20 }}>Setup guides, a statutory payroll handbook and the API reference are being written. Until then, the project report describes how every part of Riona works.</p>
      <div className="s-hero-acts"><a className="s-btn s-btn-line" href="#/contact">Ask us instead <ArrowR /></a></div>
    </section>
  );
}

function NotFound() {
  return (
    <section className="inner s-sec" style={{ minHeight: '52vh' }}>
      <p className="s-micro">404</p>
      <h1 className="s-h1" style={{ marginTop: 10 }}>There’s no page here.</h1>
      <p className="s-lead" style={{ marginTop: 20 }}>The link may be old, or mistyped. Everything on the site starts from the homepage.</p>
      <div className="s-hero-acts"><a className="s-btn s-btn-primary" href="#/">Go to the homepage <ArrowR /></a><a className="s-link s-link-under" href="#/features">See the six hubs</a></div>
    </section>
  );
}
