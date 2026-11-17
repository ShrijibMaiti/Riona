/**
 * Sign-in (password or Google / Microsoft), password reset and invitations, and first-time setup. Each calls a
 * session repository function, i.e. the API.
 */
import { useEffect, useState, type ReactNode } from 'react';
import * as api from '../data/repositories';
import { H, css } from './dc';
import { enterApp } from './content';
import { usePublicBody } from './usePublicBody';
import { RionaMark } from '../components/Brand';
import './site.css';
import { API_BASE } from '../data/repositories/http/client';

const INPUT = 'width:100%;height:44px;border:1px solid #D3D6CA;border-radius:4px;padding:0 13px;font-size:15px;outline:none;background:#FFFFFF;color:#252823';
const CARD = 'background:#FDFDF9;border:1px solid #DFE1D7;border-radius:6px;padding:32px 28px 26px';
const PRIMARY = 'width:100%;height:46px;border-radius:4px;border:none;background:#D4421F;color:#FFFFFF;font-size:14.5px;font-weight:550;cursor:pointer;margin-top:22px;box-shadow:0 1px 1px rgba(0,0,0,0.05),inset 0 1px 0 rgba(255,255,255,0.15)';
const LABEL = 'display:block;font-size:13px;color:#575B52;margin-bottom:6px';
const ERR = 'margin-top:18px;padding:10px 12px;border-radius:4px;background:#FBEFEC;border:1px solid #EBC9C2;color:#8F2A1D;font-size:13px';

const Wordmark = () => <div style={css('display:flex;align-items:center;justify-content:center;margin-bottom:28px')}><a href="#/" aria-label="Riona, home" style={css('display:inline-flex;align-items:center;gap:10px;font-size:22px;font-weight:600;letter-spacing:-0.05em;color:#252823;white-space:nowrap')}><RionaMark size={21} />riona</a></div>;

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label style={css('display:block;margin-top:14px')}><span style={css(LABEL)}>{label}</span>{children}</label>;
}
function Input(p: { value: string; onChange: (v: string) => void; type?: string; placeholder?: string; readOnly?: boolean; autoComplete?: string; onEnter?: () => void }) {
  return <H t="input" type={p.type ?? 'text'} value={p.value} readOnly={p.readOnly} placeholder={p.placeholder} autoComplete={p.autoComplete} onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter') p.onEnter?.(); }} onChange={(e: React.ChangeEvent<HTMLInputElement>) => p.onChange(e.target.value)} s={INPUT + (p.readOnly ? ';color:#676A61' : '')} f="border-color:#D4421F" />;
}

/** Why an SSO attempt came back to #/login?sso=… (the backend's auth/sso.ts redirects here on failure). */
const SSO_ERRORS: Record<string, string> = {
  unavailable: 'Single sign-on isn’t set up for this organisation yet. Sign in with your email and password.',
  no_account: 'That account isn’t on Riona. Ask your administrator to invite you, then try again.',
  failed: 'Single sign-on didn’t complete. Try again, or sign in with your email and password.',
};
const ssoError = () => SSO_ERRORS[new URLSearchParams(location.hash.split('?')[1] ?? '').get('sso') ?? ''] ?? '';

/**
 * The design's sign-in card: email and password, or Google / Microsoft single sign-on. Used in the landing modal
 * and on #/login. The account's role decides where you land.
 */
export function LoginCard() {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState(ssoError);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!/^\S+@\S+\.\S+$/.test(email)) return setErr('Enter a valid work email.');
    if (!pw) return setErr('Enter your password.');
    setBusy(true);
    try { const r = await api.login(email, pw); enterApp(r.role); } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  // A full-page redirect to the identity provider and back (the session cookie is set on return).
  const sso = (provider: 'google' | 'microsoft') => { location.href = API_BASE + '/auth/sso/' + provider + '/start'; };
  return (
    <>
      <Wordmark />
      <div style={css(CARD)}>
        <div style={css('font-size:22px;font-weight:550;letter-spacing:-0.03em')}>Sign in</div>
        {err && <div role="alert" style={css(ERR)}>{err}</div>}
        <label style={css('display:block;margin-top:20px')}><span style={css(LABEL)}>Work email</span><Input value={email} autoComplete="email" onChange={(v) => { setEmail(v); setErr(''); }} /></label>
        <Field label="Password"><Input type="password" value={pw} autoComplete="current-password" onChange={(v) => { setPw(v); setErr(''); }} onEnter={submit} /></Field>
        <H t="button" onClick={submit} disabled={busy} s={PRIMARY} h="background:#B9361A">{busy ? 'Signing in…' : 'Sign in'}</H>
        <div style={css('text-align:center;margin-top:16px')}><H t="a" href="#/forgot-password" s="font-size:13px;color:#676A61" h="color:#252823">Forgot password?</H></div>
        <div style={css('height:1px;background:rgba(37,40,35,0.15);margin:22px 0')} />
        <div style={css('display:grid;gap:8px')}>
          {(['Google', 'Microsoft'] as const).map((p) => <H key={p} t="button" onClick={() => sso(p === 'Google' ? 'google' : 'microsoft')} s="height:44px;border-radius:4px;border:1px solid rgba(37,40,35,0.22);background:transparent;font-size:14px;color:#252823;cursor:pointer" h="border-color:rgba(37,40,35,0.3)">Continue with {p}</H>)}
        </div>
      </div>
    </>
  );
}

function AuthLayout({ children, width = 400 }: { children: ReactNode; width?: number }) {
  usePublicBody();
  return (
    <div className="pub site">
      <div className="frame" style={css('min-height:100vh;display:flex;flex-direction:column;justify-content:center')}>
        <div className="rule" />
        <main className="inner" style={css('display:flex;justify-content:center;padding-top:56px;padding-bottom:56px')}><div style={{ width: 'min(' + width + 'px,100%)' }}>{children}</div></main>
        <div className="rule" />
      </div>
    </div>
  );
}

export function LoginPage() {
  return <AuthLayout><LoginCard /></AuthLayout>;
}

export function ForgotPage() {
  const [email, setEmail] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const submit = async () => {
    setBusy(true);
    try { await api.requestPasswordReset(email); setSent(true); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <AuthLayout>
      <Wordmark />
      <div style={css(CARD)}>
        {!sent ? (
          <>
            <div style={css('font-size:22px;font-weight:550;letter-spacing:-0.03em')}>Reset your password</div>
            <p style={css('font-size:14px;color:#575B52;line-height:1.6;margin:10px 0 0')}>Enter your work email and we’ll send a link to choose a new password. The link works for one hour.</p>
            {err && <div role="alert" style={css(ERR)}>{err}</div>}
            <label style={css('display:block;margin-top:20px')}><span style={css(LABEL)}>Work email</span><Input value={email} autoComplete="email" placeholder="you@company.in" onChange={(v) => { setEmail(v); setErr(''); }} onEnter={submit} /></label>
            <H t="button" onClick={submit} disabled={busy} s={PRIMARY} h="background:#B9361A">{busy ? 'Sending…' : 'Send reset link'}</H>
          </>
        ) : (
          <div style={css('animation:fadeIn 200ms ease-out')}>
            <div style={css('font-size:22px;font-weight:550;letter-spacing:-0.03em')}>Check your inbox</div>
            <p style={css('font-size:14px;color:#3B3F37;line-height:1.6;margin:10px 0 0')}>If {email} has a Riona account, a reset link is on its way. It expires in one hour.</p>
          </div>
        )}
      </div>
      <div style={css('text-align:center;margin-top:20px')}><H t="a" href="#/login" s="font-size:13px;color:#676A61" h="color:#252823">← Back to sign in</H></div>
    </AuthLayout>
  );
}

// ---------------------------------------------------------------- password from an emailed link

/** #/reset-password/:token — "Forgot password" and invitations both land here to choose a password. */
export function ResetPage({ token }: { token: string }) {
  const [check, setCheck] = useState<{ email: string; name: string; invite: boolean } | null>(null);
  const [gone, setGone] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.checkResetToken(token).then(setCheck, (e: Error) => setGone(e.message));
  }, [token]);
  const submit = async () => {
    if (pw.length < 10) return setErr('Use at least 10 characters.');
    if (pw !== pw2) return setErr('The two passwords don’t match.');
    setBusy(true);
    try { const r = await api.completeReset(token, pw); enterApp(r.role); } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  return (
    <AuthLayout>
      <Wordmark />
      <div style={css(CARD)} aria-busy={!check && !gone}>
        {gone ? (
          <>
            <div style={css('font-size:22px;font-weight:550;letter-spacing:-0.03em')}>This link has expired</div>
            <div role="alert" style={css(ERR)}>{gone}</div>
            <H t="a" href="#/forgot-password" s={PRIMARY + ';display:flex;align-items:center;justify-content:center;text-decoration:none'} h="background:#B9361A">Send a new link</H>
          </>
        ) : check && (
          <>
            <div style={css('font-size:22px;font-weight:550;letter-spacing:-0.03em')}>{check.invite ? 'Welcome, ' + check.name.split(' ')[0] : 'Choose a new password'}</div>
            <p style={css('font-size:14px;color:#575B52;line-height:1.6;margin:10px 0 0')}>{check.invite ? 'Choose a password to finish setting up your account.' : 'Signing in with a new password signs you out everywhere else.'} Account: {check.email}</p>
            {err && <div role="alert" style={css(ERR)}>{err}</div>}
            <label style={css('display:block;margin-top:20px')}><span style={css(LABEL)}>New password</span><Input type="password" value={pw} autoComplete="new-password" placeholder="At least 10 characters" onChange={(v) => { setPw(v); setErr(''); }} /></label>
            <label style={css('display:block;margin-top:14px')}><span style={css(LABEL)}>Type it again</span><Input type="password" value={pw2} autoComplete="new-password" onChange={(v) => { setPw2(v); setErr(''); }} onEnter={submit} /></label>
            <H t="button" onClick={submit} disabled={busy} s={PRIMARY} h="background:#B9361A">{busy ? 'Saving…' : check.invite ? 'Set password and sign in' : 'Save and sign in'}</H>
          </>
        )}
      </div>
      <div style={css('text-align:center;margin-top:20px')}><H t="a" href="#/login" s="font-size:13px;color:#676A61" h="color:#252823">← Back to sign in</H></div>
    </AuthLayout>
  );
}

// ---------------------------------------------------------------- setup wizard

const STATES = ['Karnataka', 'Maharashtra', 'Tamil Nadu', 'Telangana', 'Delhi', 'Gujarat', 'Haryana', 'Kerala', 'Uttar Pradesh', 'West Bengal'];
const MODULES: [string, string][] = [['People', 'Directory, attendance, leave, payroll'], ['Work', 'Projects, boards, timesheets'], ['Clients', 'Accounts, leads, contracts, tickets'], ['Finance', 'Invoices, expenses, profitability'], ['Workplace', 'Assets, rooms, announcements']];
const STEPS = ['Organisation', 'Your account', 'Hubs', 'Review'];

export function SetupWizard({ token }: { token: string }) {
  const [check, setCheck] = useState<{ orgName: string; email: string } | null>(null);
  const [linkErr, setLinkErr] = useState('');
  const [step, setStep] = useState(0);
  const [org, setOrg] = useState({ orgName: '', legalName: '', state: 'Karnataka', gstin: '' });
  const [acct, setAcct] = useState({ adminName: '', password: '', confirm: '' });
  const [mods, setMods] = useState<string[]>(MODULES.map((m) => m[0]));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let live = true;
    api.checkSetupToken(token).then((r) => { if (!live) return; setCheck(r); setOrg((o) => ({ ...o, orgName: r.orgName, legalName: r.orgName + ' Pvt Ltd' })); }, (e) => live && setLinkErr((e as Error).message));
    return () => { live = false; };
  }, [token]);

  const validate = (): string => {
    if (step === 0) {
      if (!org.orgName.trim()) return 'Add your organisation’s name.';
      if (org.gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(org.gstin.toUpperCase())) return 'That GSTIN doesn’t look right — it has 15 characters, like 29ABCDE1234F1Z5.';
    }
    if (step === 1) {
      if (!acct.adminName.trim()) return 'Add your name.';
      if (acct.password.length < 10) return 'Use at least 10 characters for your password.';
      if (acct.password !== acct.confirm) return 'The two passwords don’t match.';
    }
    if (step === 2 && !mods.length) return 'Pick at least one hub. You can switch others on later.';
    return '';
  };
  const next = async () => {
    const v = validate();
    if (v) return setErr(v);
    setErr('');
    if (step < 3) return setStep(step + 1);
    setBusy(true);
    try {
      await api.completeSetup(token, { orgName: org.orgName, legalName: org.legalName, state: org.state, gstin: org.gstin.toUpperCase(), adminName: acct.adminName, password: acct.password, modules: mods });
      setDone(true);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <AuthLayout width={520}>
      <Wordmark />
      <div style={css(CARD)} aria-busy={!check && !linkErr}>
        {linkErr ? (
          <>
            <div style={css('font-size:22px;font-weight:550;letter-spacing:-0.03em')}>This link can’t be used</div>
            <div role="alert" style={css(ERR)}>{linkErr}</div>
            <p style={css('font-size:14px;color:#575B52;line-height:1.6;margin:16px 0 0')}>Setup links last seven days. Whoever invited you can send a fresh one, or <a href="#/contact" style={css('color:#252823;border-bottom:1px solid #D4421F')}>write to us</a>.</p>
          </>
        ) : !check ? (
          <div style={css('font-size:14px;color:#575B52;padding:24px 0')}>Checking your setup link…</div>
        ) : done ? (
          <div style={css('animation:fadeIn 200ms ease-out')}>
            <div style={css('font-size:10.5px;letter-spacing:0.3em;text-transform:uppercase;color:#676A61')}>All set</div>
            <div style={css('font-size:30px;font-weight:300;letter-spacing:-0.02em;margin-top:10px')}>{org.orgName} is ready.</div>
            <p style={css('font-size:14px;color:#3B3F37;line-height:1.6;margin:12px 0 0')}>Next, invite your team and set up your first payroll structure. The admin dashboard walks you through both.</p>
            <H t="button" onClick={() => enterApp('Admin')} s={PRIMARY} h="background:#B9361A">Open Riona</H>
          </div>
        ) : (
          <>
            <div style={css('display:flex;justify-content:space-between;align-items:baseline;gap:12px')}>
              <div style={css('font-size:22px;font-weight:550;letter-spacing:-0.03em')}>{STEPS[step]}</div>
              <div style={css('font-size:12.5px;color:#676A61;white-space:nowrap')}>Step {step + 1} of 4</div>
            </div>
            <div aria-hidden="true" style={css('display:grid;grid-template-columns:repeat(4,1fr);gap:4px;margin-top:16px')}>
              {STEPS.map((s, i) => <span key={s} style={{ ...css('height:3px;border-radius:2px'), background: i <= step ? '#D4421F' : 'rgba(37,40,35,0.18)' }} />)}
            </div>
            {err && <div role="alert" style={css(ERR)}>{err}</div>}

            {step === 0 && (
              <div style={css('margin-top:8px')}>
                <Field label="Organisation name"><Input value={org.orgName} onChange={(v) => setOrg({ ...org, orgName: v })} /></Field>
                <Field label="Legal name (as on your GST registration)"><Input value={org.legalName} onChange={(v) => setOrg({ ...org, legalName: v })} /></Field>
                <Field label="Registered state">
                  <H t="select" value={org.state} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setOrg({ ...org, state: e.target.value })} s={INPUT} f="border-color:#D4421F">{STATES.map((s) => <option key={s}>{s}</option>)}</H>
                </Field>
                <Field label="GSTIN (optional)"><Input value={org.gstin} placeholder="29ABCDE1234F1Z5" onChange={(v) => setOrg({ ...org, gstin: v })} /></Field>
                <p style={css('font-size:12.5px;color:#676A61;margin:10px 0 0;line-height:1.5')}>The state decides how GST splits on your invoices and which Professional Tax slab applies.</p>
              </div>
            )}
            {step === 1 && (
              <div style={css('margin-top:8px')}>
                <Field label="Your name"><Input value={acct.adminName} autoComplete="name" onChange={(v) => setAcct({ ...acct, adminName: v })} /></Field>
                <Field label="Work email"><Input value={check.email} readOnly onChange={() => {}} /></Field>
                <Field label="Password"><Input type="password" value={acct.password} autoComplete="new-password" onChange={(v) => setAcct({ ...acct, password: v })} /></Field>
                <Field label="Confirm password"><Input type="password" value={acct.confirm} autoComplete="new-password" onChange={(v) => setAcct({ ...acct, confirm: v })} onEnter={next} /></Field>
                <p style={css('font-size:12.5px;color:#676A61;margin:10px 0 0')}>At least 10 characters. You’ll be the first admin.</p>
              </div>
            )}
            {step === 2 && (
              <div style={css('display:grid;gap:8px;margin-top:20px')}>
                {MODULES.map(([m, d]) => {
                  const on = mods.includes(m);
                  return (
                    <label key={m} style={{ ...css('display:flex;align-items:center;gap:14px;padding:14px 16px;border-radius:6px;cursor:pointer'), border: '1px solid ' + (on ? 'rgba(37,40,35,0.3)' : 'rgba(37,40,35,0.17)'), background: on ? 'rgba(37,40,35,0.09)' : 'transparent' }}>
                      <input type="checkbox" checked={on} onChange={() => setMods(on ? mods.filter((x) => x !== m) : [...mods, m])} style={{ accentColor: '#D4421F' }} />
                      <span><span style={css('display:block;font-size:15px;font-weight:600')}>{m}</span><span style={css('display:block;font-size:13px;color:#575B52')}>{d}</span></span>
                    </label>
                  );
                })}
                <p style={css('font-size:12.5px;color:#676A61;margin:4px 0 0')}>Platform (roles, workflows, audit) and My Space are always on.</p>
              </div>
            )}
            {step === 3 && (
              <div style={css('display:grid;grid-template-columns:auto 1fr;gap:10px 20px;margin-top:22px;font-size:14px')}>
                {[['Organisation', org.orgName], ['Legal name', org.legalName || '—'], ['State', org.state], ['GSTIN', org.gstin.toUpperCase() || 'Add later'], ['Admin', acct.adminName + ' · ' + check.email], ['Hubs', mods.join(', ')]].map(([k, v]) => (
                  <div key={k} style={{ display: 'contents' }}><span style={css('color:#676A61')}>{k}</span><span style={css('min-width:0;overflow-wrap:anywhere')}>{v}</span></div>
                ))}
              </div>
            )}

            <div style={css('display:flex;gap:10px;margin-top:24px')}>
              {step > 0 && <H t="button" onClick={() => { setErr(''); setStep(step - 1); }} s="height:48px;padding:0 20px;border-radius:4px;border:1px solid rgba(37,40,35,0.22);background:transparent;font-size:15px;color:#252823;cursor:pointer" h="border-color:rgba(37,40,35,0.3)">Back</H>}
              <H t="button" onClick={next} disabled={busy} s="flex:1;height:46px;border-radius:4px;border:none;background:#D4421F;color:#FFFFFF;font-size:14.5px;font-weight:550;cursor:pointer" h="background:#B9361A">{step < 3 ? 'Continue' : busy ? 'Creating your workspace…' : 'Create workspace'}</H>
            </div>
          </>
        )}
      </div>
    </AuthLayout>
  );
}
