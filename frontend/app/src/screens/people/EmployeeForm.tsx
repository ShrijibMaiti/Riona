import { useEffect, useState } from 'react';
import { PageHeader } from '../../components/PageHeader';
import { ErrorState, SkeletonRows } from '../../components/ui';
import * as api from '../../data/repositories';
import type { Department, Employee, EmploymentType } from '../../data/types';
import { useEmployees, useMe } from '../../hooks/data';
import { invalidate, useQuery } from '../../lib/query';
import { go, useApp } from '../../state/store';

const DEPTS: Department[] = ['Engineering', 'Delivery', 'Design', 'Sales', 'Operations', 'People', 'Finance', 'Leadership'];
const LOCS = ['Bengaluru', 'Pune', 'Mumbai', 'Kochi', 'Kolkata', 'Remote'];
const TYPES: EmploymentType[] = ['Full-time', 'Contract', 'Intern'];

type Form = { name: string; email: string; phone: string; title: string; dept: Department; managerId: string; location: string; type: EmploymentType; joined: string; billable: boolean; billRate: string; ctc: string; status: Employee['status'] };

/** Add (no id) or edit (id) an employee. Its own route, never a modal. */
export default function EmployeeForm({ id }: { id?: string }) {
  const { say, role } = useApp();
  const me = useMe();
  const emps = useEmployees();
  const existing = useQuery(['employees', id], () => api.getEmployee(id!), { enabled: !!id });
  const [f, setF] = useState<Form | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (f) return;
    if (id && existing.data) {
      const e = existing.data;
      setF({ name: e.name, email: e.email, phone: e.phone, title: e.title, dept: e.dept, managerId: e.managerId ?? '', location: e.location, type: e.type, joined: e.joined, billable: e.billable, billRate: String(e.billRate), ctc: '', status: e.status });
    } else if (!id && me.data) {
      setF({ name: '', email: '', phone: '', title: '', dept: 'Engineering', managerId: '', location: 'Bengaluru', type: 'Full-time', joined: me.data.today, billable: true, billRate: '2100', ctc: '', status: 'Probation' });
    }
  }, [id, existing.data, me.data, f]);

  if (role !== 'Admin' && role !== 'HR') return <div className="wrap page"><h1 className="display">Not available</h1><p className="lede">Only HR and admins can add or edit employee records.</p></div>;
  if (existing.error) return <div className="wrap page"><ErrorState error={existing.error} retry={existing.refetch} /></div>;
  if (!f) return <div className="wrap page"><SkeletonRows /></div>;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF({ ...f, [k]: v });
  const errors = {
    name: !f.name.trim() ? 'Required' : '',
    email: !/^\S+@\S+\.\S+$/.test(f.email) ? 'Enter a valid email' : '',
    title: !f.title.trim() ? 'Required' : '',
    ctc: !id && !(+f.ctc > 0) ? 'Enter the annual CTC in rupees' : '',
  };
  const invalid = Object.values(errors).some(Boolean);
  const save = async () => {
    setTouched(true);
    if (invalid) return;
    setBusy(true);
    setErr(null);
    try {
      const base = { name: f.name.trim(), email: f.email.trim(), phone: f.phone, title: f.title.trim(), dept: f.dept, managerId: f.managerId || null, location: f.location, type: f.type, joined: f.joined, billable: f.billable, billRate: +f.billRate || 0 };
      const e = id ? await api.updateEmployee(id, { ...base, status: f.status }) : await api.createEmployee({ ...base, ctc: +f.ctc });
      invalidate('employees', 'salary', 'audit');
      say(id ? 'Saved ' + e.name : e.name + ' added');
      go('/app/people/directory/' + e.id);
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const errOf = (k: keyof typeof errors) => (touched ? errors[k] : '');
  return (
    <div className="wrap page" style={{ maxWidth: 960 }}>
      <PageHeader title={id ? 'Edit ' + (existing.data?.name ?? '') : 'Add employee'} desc={id ? 'Changes are written to the audit log. Compensation changes are made as ledger events on the Compensation tab.' : 'Creates the record, the first salary event and a joining checklist.'} />
      {err && <div className="err-banner" role="alert" style={{ marginTop: 24 }}>{err}</div>}
      <div className="form-grid" style={{ marginTop: 32 }}>
        <FieldBox error={errOf('name')} label="Full name"><input value={f.name} onChange={(e) => set('name', e.target.value)} /></FieldBox>
        <FieldBox error={errOf('email')} label="Work email"><input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} /></FieldBox>
        <FieldBox label="Mobile"><input value={f.phone} onChange={(e) => set('phone', e.target.value)} /></FieldBox>
        <FieldBox error={errOf('title')} label="Designation"><input value={f.title} onChange={(e) => set('title', e.target.value)} /></FieldBox>
        <FieldBox label="Department"><select value={f.dept} onChange={(e) => set('dept', e.target.value as Department)}>{DEPTS.map((d) => <option key={d}>{d}</option>)}</select></FieldBox>
        <FieldBox label="Reporting manager"><select value={f.managerId} onChange={(e) => set('managerId', e.target.value)}><option value="">—</option>{emps.data?.filter((e) => e.id !== id && e.status !== 'Inactive').map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></FieldBox>
        <FieldBox label="Location"><select value={f.location} onChange={(e) => set('location', e.target.value)}>{LOCS.map((d) => <option key={d}>{d}</option>)}</select></FieldBox>
        <FieldBox label="Employment type"><select value={f.type} onChange={(e) => set('type', e.target.value as EmploymentType)}>{TYPES.map((d) => <option key={d}>{d}</option>)}</select></FieldBox>
        <FieldBox label="Date of joining"><input type="date" value={f.joined} onChange={(e) => set('joined', e.target.value)} /></FieldBox>
        {id && <FieldBox label="Status"><select value={f.status} onChange={(e) => set('status', e.target.value as Employee['status'])}>{['Active', 'Probation', 'On leave', 'Inactive'].map((d) => <option key={d}>{d}</option>)}</select></FieldBox>}
        {!id && <FieldBox error={errOf('ctc')} label="Annual CTC (₹)" hint="Recorded as the Hired event on the salary ledger."><input inputMode="numeric" value={f.ctc} onChange={(e) => set('ctc', e.target.value.replace(/[^\d]/g, ''))} /></FieldBox>}
        <FieldBox label="Bill rate (₹ per hour)" hint="Used on client invoices."><input inputMode="numeric" value={f.billRate} onChange={(e) => set('billRate', e.target.value.replace(/[^\d]/g, ''))} /></FieldBox>
        <label className="field" style={{ alignSelf: 'end' }}><span style={{ display: 'flex', gap: 10, alignItems: 'center', height: 40 }}><input type="checkbox" checked={f.billable} onChange={(e) => set('billable', e.target.checked)} />Logs billable time</span></label>
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 36 }}>
        <button className="btn-dark" disabled={busy} onClick={save}>{busy ? 'Saving…' : id ? 'Save changes' : 'Add employee'}</button>
        <a className="btn-line" style={{ display: 'inline-flex', alignItems: 'center' }} href={'#/app/people/directory' + (id ? '/' + id : '')}>Cancel</a>
      </div>
    </div>
  );
}

/** Defined at module level so inputs keep focus across renders. */
function FieldBox({ label, children, hint, error }: { label: string; children: React.ReactNode; hint?: string; error?: string }) {
  return <label className="field"><span>{label}</span>{children}{hint && <span className="hint">{hint}</span>}{error && <span className="err">{error}</span>}</label>;
}
