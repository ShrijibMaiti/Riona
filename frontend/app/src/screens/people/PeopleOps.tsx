import { useMemo, useState } from 'react';
import { BlocksCell, DataTable, Mono, PersonCell, Status, TextCell, type Column } from '../../components/DataTable';
import { FilterBar } from '../../components/FilterBar';
import { KanbanBoard } from '../../components/KanbanBoard';
import { PageHeader } from '../../components/PageHeader';
import { ErrorState, SkeletonRows, StatusLabel } from '../../components/ui';
import * as api from '../../data/repositories';
import { teamOf } from '../../data/selectors/people';
import type { CandidateStage, Certification, ChecklistOwner, Job, OnboardingCase, Review } from '../../data/types';
import { useEmployees, useMe } from '../../hooks/data';
import { daysBetween } from '../../lib/dates';
import { dm, dmy, initials } from '../../lib/format';
import { all, invalidate, useQuery } from '../../lib/query';
import { go, useApp } from '../../state/store';

// ---------------- onboarding ----------------
const stageOf = (c: OnboardingCase, today: string) => c.kind === 'Leaving' ? 'Exit' : c.date > today ? 'Pre-joining' : daysBetween(c.date, today) <= 30 ? 'First month' : 'Probation';
const OB_STAGES = ['Pre-joining', 'First month', 'Probation', 'Exit'];

export function Onboarding({ board }: { board?: boolean }) {
  const q = all({ me: useMe(), cases: useQuery(['onboarding'], api.getOnboarding) });
  const [search, setSearch] = useState('');
  if (q.error) return <div className="wrap page"><ErrorState error={q.error} retry={q.refetch} /></div>;
  const today = q.data?.me.today ?? '';
  const rows = q.data?.cases.filter((c) => !search || c.personName.toLowerCase().includes(search.toLowerCase()));
  const pctDone = (c: OnboardingCase) => Math.round((c.items.filter((i) => i.done).length / c.items.length) * 100);
  const cols: Column<OnboardingCase>[] = [
    { key: 'n', header: 'Name', render: (c) => <PersonCell name={c.personName} sub={c.title} />, sort: (c) => c.personName, mobile: true },
    { key: 'd', header: 'Department', render: (c) => c.dept, sort: (c) => c.dept },
    { key: 's', header: 'Start date', render: (c) => <span className="nowrap">{c.kind === 'Leaving' ? 'Leaves ' : ''}{dmy(c.date)}</span>, sort: (c) => c.date, mobile: true },
    { key: 'st', header: 'Stage', render: (c) => <Status label={stageOf(c, today)} colour={stageOf(c, today) === 'Exit' ? 'red' : stageOf(c, today) === 'Pre-joining' ? 'blue' : 'green'} />, mobile: true },
    { key: 'c', header: 'Checklist', render: (c) => <BlocksCell pct={pctDone(c)} text={c.items.filter((i) => i.done).length + ' of ' + c.items.length} />, sort: pctDone },
    { key: 'b', header: 'Buddy', render: (c) => (c.items.find((i) => i.label === 'Buddy assigned')?.done ? 'Assigned' : '—') },
  ];
  return (
    <div className="wrap page" style={{ paddingBottom: 140 }}>
      <PageHeader title="Onboarding" desc="Joiners from offer to the end of probation, and leavers through their last day." views={[{ label: 'Table', href: '/app/people/onboarding' }, { label: 'Board', href: '/app/people/onboarding/board' }]} current={board ? '/app/people/onboarding/board' : '/app/people/onboarding'} />
      <FilterBar search={search} onSearch={setSearch} />
      {board ? (
        !rows ? <SkeletonRows /> : (
          <KanbanBoard columns={OB_STAGES.map((s) => ({ key: s, label: s }))} items={rows} colOf={(c) => stageOf(c, today)} idOf={(c) => c.id} onOpen={(c) => go('/app/people/onboarding/' + c.id)} minColWidth={230}
            render={(c) => (
              <>
                <div className="kc-top"><span className="mono" style={{ fontSize: 11 }}>{c.id}</span><span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{dm(c.date)}</span></div>
                <div className="kc-title">{c.personName}</div>
                <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 2 }}>{c.title} · {c.dept}</div>
                <div style={{ marginTop: 12 }}><BlocksCell pct={pctDone(c)} text={pctDone(c) + '%'} /></div>
              </>
            )} hint="Stages follow the dates: before day one, the first month, probation and exits." />
        )
      ) : (
        <DataTable rows={rows} columns={cols} rowKey={(c) => c.id} onOpen={(c) => go('/app/people/onboarding/' + c.id)} />
      )}
    </div>
  );
}

const OWNERS: ChecklistOwner[] = ['HR', 'IT', 'Manager', 'Finance'];
export function OnboardingCaseScreen({ id }: { id: string }) {
  const { say } = useApp();
  const q = useQuery(['onboarding', id], () => api.getOnboardingCase(id));
  if (q.error) return <div className="wrap page"><ErrorState error={q.error} retry={q.refetch} /></div>;
  const c = q.data;
  const toggle = async (itemId: string, done: boolean) => { await api.setChecklistItem(id, itemId, done); invalidate('onboarding'); };
  return (
    <div className="wrap page" style={{ paddingBottom: 140 }}>
      <PageHeader title={c?.personName ?? '…'} desc={c ? c.title + ' · ' + c.dept + ' · ' + (c.kind === 'Leaving' ? 'last day ' : 'starts ') + dmy(c.date) : ''}
        aside={c?.employeeId ? <a className="btn-line" style={{ display: 'inline-flex', alignItems: 'center' }} href={'#/app/people/directory/' + c.employeeId}>Open profile</a> : undefined} />
      {!c ? <SkeletonRows /> : (
        <>
          <div style={{ marginTop: 24, maxWidth: 520 }}><BlocksCell pct={(c.items.filter((i) => i.done).length / c.items.length) * 100} text={c.items.filter((i) => i.done).length + ' of ' + c.items.length + ' done'} /></div>
          <div className="owner-grid">
            {OWNERS.map((o) => {
              const items = c.items.filter((i) => i.owner === o);
              if (!items.length) return null;
              return (
                <section key={o} className="card owner-card">
                  <div className="owner-h"><b>{o}</b><span>{items.filter((i) => i.done).length} of {items.length}</span></div>
                  {items.map((i) => (
                    <label key={i.id} className="check-row">
                      <input type="checkbox" checked={i.done} onChange={async (e) => { await toggle(i.id, e.target.checked); say(i.label + (e.target.checked ? ' · done' : ' · reopened')); }} />
                      <span className={i.done ? 'done' : ''}>{i.label}</span>
                      <i>{i.doneOn ? dm(i.doneOn) : ''}</i>
                    </label>
                  ))}
                </section>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------- performance ----------------
export function Performance() {
  const { role } = useApp();
  const q = all({ me: useMe(), emps: useEmployees(), cycles: useQuery(['cycles'], api.getReviewCycles), reviews: useQuery(['reviews', 'all'], () => api.getReviews()) });
  const [cycle, setCycle] = useState('RC-H2-26');
  const [search, setSearch] = useState('');
  if (q.error) return <div className="wrap page"><ErrorState error={q.error} retry={q.refetch} /></div>;
  const d = q.data;
  const meId = d?.me.employee.id ?? '';
  // Hide by role: HR/Admin see everyone; managers their reporting line; employees themselves.
  const visible = (r: Review) => role === 'Admin' || role === 'HR' || r.employeeId === meId || (role === 'Manager' && d && teamOf(d.emps, meId).some((e) => e.id === r.employeeId));
  const cyc = d?.cycles.map((c) => { const rs = d.reviews.filter((r) => r.cycleId === c.id); return { c, n: rs.length, pct: rs.length ? Math.round((rs.filter((r) => r.status === 'Completed' || (c.stage === 'Self review' && r.status !== 'Not started')).length / rs.length) * 100) : 0 }; });
  const nm = (id: string) => d?.emps.find((e) => e.id === id)?.name ?? id;
  const reviews = d?.reviews.filter((r) => r.cycleId === cycle && visible(r) && (!search || nm(r.employeeId).toLowerCase().includes(search.toLowerCase())));
  return (
    <div className="wrap page" style={{ paddingBottom: 140 }}>
      <PageHeader title="Performance" desc="Two cycles a year, plus probation reviews." />
      <div style={{ marginTop: 24 }}>
        <DataTable rows={cyc} rowKey={(x) => x.c.id} onOpen={(x) => setCycle(x.c.id)} rowClass={(x) => (x.c.id === cycle ? 'row-on' : '')} columns={[
          { key: 'c', header: 'Cycle', render: (x) => <TextCell text={<b style={{ fontWeight: 500 }}>{x.c.name}</b>} sub={x.c.period} />, mobile: true },
          { key: 'p', header: 'Participants', align: 'right', render: (x) => <span className="num">{x.n}</span> },
          { key: 's', header: 'Stage', render: (x) => <Status label={x.c.stage} colour={x.c.stage === 'Closed' ? 'green' : 'blue'} />, mobile: true },
          { key: 'pc', header: 'Completion', render: (x) => <BlocksCell pct={x.pct} text={x.pct + '%'} /> },
          { key: 'cl', header: 'Closes', render: (x) => dmy(x.c.managerDue), mobile: true },
        ]} />
      </div>
      <div className="section-title" style={{ marginTop: 40 }}>{d?.cycles.find((c) => c.id === cycle)?.name} reviews{role === 'Manager' ? ' · your reporting line' : role === 'Employee' ? ' · yours' : ''}</div>
      <FilterBar search={search} onSearch={setSearch} />
      <DataTable rows={reviews} rowKey={(r) => r.id} onOpen={(r) => go('/app/people/performance/reviews/' + r.id)} columns={[
        { key: 'e', header: 'Employee', render: (r) => <PersonCell name={nm(r.employeeId)} sub={d?.emps.find((e) => e.id === r.employeeId)?.title} />, sort: (r) => nm(r.employeeId), mobile: true },
        { key: 'rv', header: 'Reviewer', render: (r) => nm(r.reviewerId), sort: (r) => nm(r.reviewerId) },
        { key: 's', header: 'Status', render: (r) => <Status label={r.status} colour={r.status === 'Completed' ? 'green' : r.status === 'Not started' ? 'gray' : 'blue'} />, sort: (r) => r.status, mobile: true },
        { key: 'rt', header: 'Rating', render: (r) => r.rating ?? '—', mobile: true },
      ]} empty={{ title: 'No reviews you can see in this cycle.' }} />
    </div>
  );
}

export function ReviewForm({ id }: { id: string }) {
  const { say } = useApp();
  const q = all({ me: useMe(), emps: useEmployees(), review: useQuery(['reviews', 'one', id], () => api.getReview(id)), cycles: useQuery(['cycles'], api.getReviewCycles), goals: useQuery(['goals', 'all'], () => api.getGoals()) });
  const [self, setSelf] = useState<string[] | null>(null);
  const [mgr, setMgr] = useState<string[] | null>(null);
  const [rating, setRating] = useState<Review['rating'] | null>(null);
  const [busy, setBusy] = useState(false);
  if (q.error) return <div className="wrap page"><ErrorState error={q.error} retry={q.refetch} /></div>;
  if (!q.data) return <div className="wrap page"><SkeletonRows /></div>;
  const r = q.data.review;
  const meId = q.data.me.employee.id;
  const QUESTIONS = ['What did you deliver this cycle that you are proudest of?', 'Where did you fall short, and what got in the way?', 'What will you focus on next cycle?'];
  const isSelf = r.employeeId === meId, isReviewer = r.reviewerId === meId, closed = r.status === 'Completed';
  const s = self ?? (r.selfAnswers.length ? r.selfAnswers : ['', '', '']);
  const m = mgr ?? (r.managerAnswers.length ? r.managerAnswers : ['', '', '']);
  const rt = rating ?? r.rating;
  const emp = q.data.emps.find((e) => e.id === r.employeeId)!;
  const cycle = q.data.cycles.find((c) => c.id === r.cycleId)!;
  const save = async (status: Review['status']) => {
    setBusy(true);
    try { await api.saveReview(r.id, { selfAnswers: s, managerAnswers: m, rating: rt, status }); invalidate('reviews'); say(status === 'Completed' ? 'Review completed' : status === 'Manager review' ? 'Self review submitted to ' + q.data!.emps.find((e) => e.id === r.reviewerId)?.name : 'Draft saved'); }
    finally { setBusy(false); }
  };
  const selfDone = s.every((x) => x.trim().length > 10);
  return (
    <div className="wrap page" style={{ paddingBottom: 140, maxWidth: 900 }}>
      <PageHeader title={emp.name + ' · ' + cycle.name} desc={cycle.period + ' · self review due ' + dmy(cycle.selfDue) + ' · manager review due ' + dmy(cycle.managerDue)} aside={<StatusLabel label={r.status} colour={closed ? 'green' : 'blue'} />} />
      <div className="section-title" style={{ marginTop: 32 }}>Goals</div>
      {q.data.goals.filter((g) => g.employeeId === r.employeeId && g.cycleId === r.cycleId).map((g) => (
        <div key={g.id} style={{ padding: '12px 0', borderTop: '1px solid var(--line-soft)' }}><div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, gap: 12 }}><span>{g.title}</span><span style={{ color: 'var(--ink-3)' }}>{g.measure}</span></div><div className="bar"><div style={{ width: g.progress + '%' }} /></div></div>
      ))}
      {QUESTIONS.map((qq, i) => (
        <div key={i} className="review-q">
          <div className="review-qt">{i + 1}. {qq}</div>
          <label className="field"><span>Self</span><textarea rows={3} readOnly={!isSelf || closed || r.status === 'Manager review'} value={s[i] ?? ''} onChange={(e) => setSelf(s.map((x, j) => (j === i ? e.target.value : x)))} placeholder={isSelf ? 'In your words…' : 'Not written yet'} /></label>
          {(isReviewer || closed) && <label className="field" style={{ marginTop: 12 }}><span>Manager</span><textarea rows={3} readOnly={!isReviewer || closed} value={m[i] ?? ''} onChange={(e) => setMgr(m.map((x, j) => (j === i ? e.target.value : x)))} /></label>}
        </div>
      ))}
      {(isReviewer || closed) && (
        <div className="review-q">
          <div className="review-qt">Overall rating</div>
          <div className="viewseg" style={{ marginTop: 8 }}>
            {(['Below expectations', 'Meets expectations', 'Exceeds expectations'] as const).map((x) => <button key={x} disabled={!isReviewer || closed} className={rt === x ? 'active' : ''} aria-pressed={rt === x} onClick={() => setRating(x)}>{x}</button>)}
          </div>
        </div>
      )}
      {!closed && (isSelf || isReviewer) && (
        <div style={{ display: 'flex', gap: 10, marginTop: 28 }}>
          <button className="btn-line" disabled={busy} onClick={() => save(r.status === 'Not started' ? 'Self review' : r.status)}>Save draft</button>
          {isSelf && r.status !== 'Manager review' && <button className="btn-dark" disabled={busy || !selfDone} onClick={() => save('Manager review')}>Submit to manager</button>}
          {isReviewer && <button className="btn-dark" disabled={busy || !rt || !m.every((x) => x.trim().length > 5)} onClick={() => save('Completed')}>Complete review</button>}
        </div>
      )}
      {!isSelf && !isReviewer && !closed && <p className="ph-desc" style={{ marginTop: 24 }}>Only {emp.name.split(' ')[0]} and their reviewer can write in this review.</p>}
    </div>
  );
}

// ---------------- recruitment ----------------
const C_STAGES: CandidateStage[] = ['Applied', 'Screening', 'Interviewing', 'Offer', 'Hired', 'Rejected'];
export function Recruitment() {
  const q = all({ emps: useEmployees(), jobs: useQuery(['jobs'], api.getJobs), cands: useQuery(['candidates', 'all'], () => api.getCandidates()) });
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  if (q.error) return <div className="wrap page"><ErrorState error={q.error} retry={q.refetch} /></div>;
  const d = q.data;
  const of = (j: Job, s: CandidateStage) => d!.cands.filter((c) => c.jobId === j.id && c.stage === s).length;
  const rows = d?.jobs.filter((j) => (!search || j.title.toLowerCase().includes(search.toLowerCase())) && (!status || j.status === status));
  const open = d?.jobs.filter((j) => j.status === 'Open').length ?? 0;
  return (
    <div className="wrap page" style={{ paddingBottom: 140 }}>
      <PageHeader title="Recruitment" desc={d ? open + ' open roles, ' + (d.jobs.length - open) + ' on hold.' : ' '} />
      <FilterBar search={search} onSearch={setSearch} filters={[{ key: 's', label: 'Statuses', options: ['Open', 'On hold', 'Closed'], value: status, onChange: setStatus }]} />
      <DataTable rows={rows} rowKey={(j) => j.id} onOpen={(j) => go('/app/people/recruitment/jobs/' + j.id)} columns={[
        { key: 'r', header: 'Role', render: (j) => <TextCell text={<b style={{ fontWeight: 500 }}>{j.title}</b>} sub={j.dept + ' · ' + j.location} />, sort: (j) => j.title, mobile: true },
        { key: 'o', header: 'Openings', align: 'right', render: (j) => <span className="num">{j.openings}</span> },
        { key: 'a', header: 'Applicants', align: 'right', render: (j) => <span className="num">{d!.cands.filter((c) => c.jobId === j.id).length}</span>, sort: (j) => d!.cands.filter((c) => c.jobId === j.id).length, mobile: true },
        { key: 'f', header: 'Applied · Screen · Interview · Offer', render: (j) => <Mono>{of(j, 'Applied')} · {of(j, 'Screening')} · {of(j, 'Interviewing')} · {of(j, 'Offer')}</Mono> },
        { key: 'ow', header: 'Owner', render: (j) => d!.emps.find((e) => e.id === j.hiringManagerId)?.name },
        { key: 's', header: 'Status', render: (j) => <Status label={j.status} colour={j.status === 'Open' ? 'blue' : 'amber'} />, mobile: true },
      ]} />
    </div>
  );
}

export function JobPipeline({ id }: { id: string }) {
  const { say } = useApp();
  const q = all({ job: useQuery(['jobs', 'one', id], () => api.getJob(id)), cands: useQuery(['candidates', id], () => api.getCandidates(id)), emps: useEmployees() });
  if (q.error) return <div className="wrap page"><ErrorState error={q.error} retry={q.refetch} /></div>;
  const job = q.data?.job;
  const move = async (cid: string, stage: string) => {
    const c = q.data?.cands.find((x) => x.id === cid);
    if (!c || c.stage === stage) return;
    await api.moveCandidate(cid, stage as CandidateStage);
    invalidate('candidates', 'audit');
    say(c.name + ' moved to ' + stage);
  };
  return (
    <div className="wrap page wide" style={{ paddingBottom: 120 }}>
      <PageHeader title={job?.title ?? '…'} desc={job ? job.dept + ' · ' + job.location + ' · ' + job.openings + (job.openings === 1 ? ' opening' : ' openings') + ' · posted ' + dmy(job.posted) : ''} />
      {!q.data ? <SkeletonRows /> : (
        <KanbanBoard columns={C_STAGES.map((s) => ({ key: s, label: s, wip: s === 'Offer' ? job?.openings : undefined }))} items={q.data.cands} colOf={(c) => c.stage} idOf={(c) => c.id} onMove={move} minColWidth={210}
          onOpen={(c) => go('/app/people/recruitment/candidates/' + c.id)} hint="Drag candidates between stages, or focus a card and use ← →. Click to open the candidate."
          render={(c) => (
            <>
              <div className="kc-top"><span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{c.source}</span><span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{dm(c.applied)}</span></div>
              <div className="kc-title">{c.name}</div>
              <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 2 }}>{c.experienceYears} yrs · {c.currentCompany}</div>
              {c.interviews.length > 0 && <div className="kc-foot">{c.interviews.length} {c.interviews.length === 1 ? 'interview' : 'interviews'} · {c.interviews.filter((i) => i.outcome === 'Pending').length ? 'next pending' : 'all done'}</div>}
            </>
          )} />
      )}
    </div>
  );
}

export function CandidateView({ id }: { id: string }) {
  const { say } = useApp();
  const one = useQuery(['candidates', 'one', id], () => api.getCandidate(id));
  const c = one.data;
  // The split view's left list: the other candidates for the same job.
  const sib = useQuery(['candidates', c?.jobId], () => api.getCandidates(c!.jobId), { enabled: !!c });
  const jobQ = useQuery(['jobs', 'one', c?.jobId], () => api.getJob(c!.jobId), { enabled: !!c });
  const emps = useEmployees();
  const siblings = sib.data ?? [];
  const job = jobQ.data;
  const err = one.error ?? sib.error ?? jobQ.error;
  if (err) return <div className="wrap page"><ErrorState error={err} retry={() => { one.refetch(); sib.refetch(); jobQ.refetch(); }} /></div>;
  const move = async (stage: CandidateStage) => { if (!c) return; await api.moveCandidate(c.id, stage); invalidate('candidates', 'audit'); say(c.name + ' moved to ' + stage); };
  return (
    <div className="wrap page" style={{ paddingBottom: 120 }}>
      <a className="back-link" href={'#/app/people/recruitment/jobs/' + (c?.jobId ?? '')}>← {job?.title ?? 'Pipeline'}</a>
      <div className="split">
        <nav className="split-list card" aria-label="Candidates">
          {!sib.data && <SkeletonRows n={5} />}
          {siblings.map((x) => (
            <a key={x.id} href={'#/app/people/recruitment/candidates/' + x.id} className={'split-item' + (x.id === id ? ' on' : '')} aria-current={x.id === id ? 'page' : undefined}>
              <span className="pcell-av" style={{ width: 28, height: 28, fontSize: 11 }}>{initials(x.name)}</span>
              <span style={{ minWidth: 0 }}><b>{x.name}</b><i>{x.stage} · {x.experienceYears} yrs</i></span>
            </a>
          ))}
        </nav>
        <section className="split-main">
          {!c ? <SkeletonRows /> : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <div><h1 className="pf-name" style={{ fontSize: 40 }}>{c.name}</h1><div className="pf-meta"><span>{c.currentCompany}</span><span>{c.experienceYears} years</span><span>{c.source}</span><span>{c.email}</span></div></div>
                <StatusLabel label={c.stage} colour={c.stage === 'Rejected' ? 'red' : c.stage === 'Hired' ? 'green' : 'blue'} />
              </div>
              <div className="viewseg" style={{ marginTop: 24 }} role="group" aria-label="Move to stage">
                {C_STAGES.map((s) => <button key={s} className={c.stage === s ? 'active' : ''} aria-pressed={c.stage === s} onClick={() => move(s)}>{s}</button>)}
              </div>
              <div className="section-title" style={{ marginTop: 32 }}>Notes</div>
              <p style={{ fontSize: 14, lineHeight: 1.55, margin: 0 }}>{c.notes}</p>
              <div className="section-title" style={{ marginTop: 32 }}>Interview loop</div>
              {c.interviews.map((i) => (
                <div key={i.id} className="kv" style={{ gridTemplateColumns: '150px 1fr auto' }}><span>{i.round}</span><span>{emps.data?.find((e) => e.id === i.interviewerId)?.name} · {dmy(i.date)}</span><StatusLabel label={i.outcome} colour={i.outcome === 'No' ? 'red' : i.outcome === 'Pending' ? 'amber' : 'green'} /></div>
              ))}
              {!c.interviews.length && <div className="empty-s">No interviews scheduled yet.</div>}
              <div className="section-title" style={{ marginTop: 32 }}>Application</div>
              <div className="kv"><span>Applied</span><span>{dmy(c.applied)}</span></div>
              <div className="kv"><span>Role</span><span>{job?.title}</span></div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

// ---------------- training ----------------
export function Training() {
  const q = all({ me: useMe(), emps: useEmployees(), progs: useQuery(['programmes'], api.getProgrammes), certs: useQuery(['certifications', 'all'], () => api.getCertifications()) });
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [prog, setProg] = useState('');
  const rows = useMemo(() => q.data?.certs.filter((c) => {
    const e = q.data!.emps.find((x) => x.id === c.employeeId);
    const p = q.data!.progs.find((x) => x.id === c.programmeId);
    return (!search || (e?.name + ' ' + p?.name).toLowerCase().includes(search.toLowerCase())) && (!status || c.status === status) && (!prog || p?.name === prog);
  }).sort((a, b) => ['Expired', 'Expiring', 'Assigned', 'Valid'].indexOf(a.status) - ['Expired', 'Expiring', 'Assigned', 'Valid'].indexOf(b.status)), [q.data, search, status, prog]);
  if (q.error) return <div className="wrap page"><ErrorState error={q.error} retry={q.refetch} /></div>;
  const today = q.data?.me.today ?? '';
  const marker = (c: Certification) => {
    if (c.status === 'Expired') return <Status label={'Lapsed ' + dm(c.expires!)} colour="red" />;
    if (c.status === 'Expiring') return <Status label={'Expires in ' + daysBetween(today, c.expires!) + ' days'} colour="amber" />;
    if (c.status === 'Assigned') return <Status label="Not completed" colour="gray" />;
    return <Status label="Valid" colour="green" />;
  };
  const cols: Column<Certification>[] = [
    { key: 'c', header: 'Certification', render: (c) => <TextCell text={q.data!.progs.find((p) => p.id === c.programmeId)?.name} sub={q.data!.progs.find((p) => p.id === c.programmeId)?.mandatory ? 'Mandatory' : undefined} />, mobile: true },
    { key: 'h', header: 'Holder', render: (c) => <PersonCell name={q.data!.emps.find((e) => e.id === c.employeeId)?.name ?? ''} />, sort: (c) => c.employeeId, mobile: true },
    { key: 'i', header: 'Issued', render: (c) => dmy(c.completed), sort: (c) => c.completed ?? '' },
    { key: 'e', header: 'Expires', render: (c) => (c.expires ? dmy(c.expires) : 'Does not expire'), sort: (c) => c.expires ?? '9' },
    { key: 's', header: 'Status', render: marker, mobile: true },
  ];
  const soon = q.data?.certs.filter((c) => c.status === 'Expiring').length ?? 0;
  const lapsed = q.data?.certs.filter((c) => c.status === 'Expired').length ?? 0;
  return (
    <div className="wrap page" style={{ paddingBottom: 140 }}>
      <PageHeader title="Training" desc={'Certifications that lapse are flagged 45 days out. ' + lapsed + ' lapsed, ' + soon + ' expiring soon.'} />
      <FilterBar search={search} onSearch={setSearch} filters={[
        { key: 'p', label: 'Programmes', options: q.data?.progs.map((p) => p.name) ?? [], value: prog, onChange: setProg },
        { key: 's', label: 'Statuses', options: ['Expired', 'Expiring', 'Assigned', 'Valid'], value: status, onChange: setStatus },
      ]} />
      <DataTable rows={rows} columns={cols} rowKey={(c) => c.id} onOpen={(c) => go('/app/people/directory/' + c.employeeId)} rowClass={(c) => (c.status === 'Expired' ? 'row-red' : c.status === 'Expiring' ? 'row-amber' : '')} />
    </div>
  );
}
