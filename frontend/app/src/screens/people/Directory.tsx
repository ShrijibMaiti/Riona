import { useMemo, useState } from 'react';
import { DataTable, Mono, PersonCell, Status, TextCell, downloadCsv, type Column } from '../../components/DataTable';
import { ConfirmDialog, PersonPicker } from '../../components/Dialogs';
import { FilterBar } from '../../components/FilterBar';
import { PageHeader } from '../../components/PageHeader';
import { ErrorState } from '../../components/ui';
import * as api from '../../data/repositories';
import { teamOf } from '../../data/selectors/people';
import type { Employee } from '../../data/types';
import { canSeeAudit, useAllowedList, useEmployees, useMe } from '../../hooks/data';
import { mondayOf } from '../../lib/dates';
import { invalidate, useQuery } from '../../lib/query';
import { go, useApp } from '../../state/store';

const SCOPES = ['All records', 'Created by me', 'My team', 'Changed this week'] as const;

export default function Directory() {
  const { role, say } = useApp();
  const emps = useEmployees();
  const me = useMe();
  const audit = useAllowedList(canSeeAudit(role), ['audit', 'employee'], () => api.getAuditEvents({ entity: 'Employee', pageSize: 1000 }).then((p) => p.items));
  const hires = useQuery(['salary', 'all'], api.getAllSalaryEvents);
  const [search, setSearch] = useState('');
  const [f, setF] = useState({ dept: '', location: '', status: '' });
  const [scope, setScope] = useState<string>('All records');
  const [cols, setCols] = useState(false);
  const [assign, setAssign] = useState<Employee[] | null>(null);
  const [archive, setArchive] = useState<Employee[] | null>(null);

  const byId = useMemo(() => new Map(emps.data?.map((e) => [e.id, e])), [emps.data]);
  const rows = useMemo(() => {
    if (!emps.data || !me.data) return undefined;
    const meId = me.data.employee.id;
    const team = new Set(teamOf(emps.data, meId).map((e) => e.id));
    const wk = mondayOf(me.data.today);
    const changed = new Set(audit.data?.filter((a) => a.at.slice(0, 10) >= wk).map((a) => a.entityId));
    const mine = new Set(hires.data?.filter((h) => h.type === 'Hired' && h.actorId === meId).map((h) => h.employeeId));
    const q = search.trim().toLowerCase();
    return emps.data.filter(
      (e) => (!q || [e.name, e.email, e.id, e.title, e.dept, e.location].join(' ').toLowerCase().includes(q)) &&
        (!f.dept || e.dept === f.dept) && (!f.location || e.location === f.location) && (!f.status || e.status === f.status) &&
        (scope === 'All records' || (scope === 'My team' && team.has(e.id)) || (scope === 'Changed this week' && changed.has(e.id)) || (scope === 'Created by me' && mine.has(e.id))),
    );
  }, [emps.data, me.data, audit.data, hires.data, search, f, scope]);

  const opts = (k: keyof Employee) => [...new Set(emps.data?.map((e) => String(e[k])))].sort();
  const columns: Column<Employee>[] = [
    { key: 'name', header: 'Name', render: (e) => <PersonCell name={e.name} sub={e.email} />, sort: (e) => e.name, mobile: true },
    { key: 'id', header: 'Employee ID', render: (e) => <Mono>{e.id}</Mono>, sort: (e) => e.id },
    { key: 'title', header: 'Designation', render: (e) => <TextCell text={e.title} />, sort: (e) => e.title, mobile: true },
    { key: 'dept', header: 'Department', render: (e) => e.dept, sort: (e) => e.dept, mobile: true },
    { key: 'mgr', header: 'Reporting manager', render: (e) => <span className="nowrap">{e.managerId ? byId.get(e.managerId)?.name : '—'}</span>, sort: (e) => (e.managerId ? byId.get(e.managerId)?.name ?? '' : '') },
    { key: 'loc', header: 'Location', render: (e) => e.location, sort: (e) => e.location },
    { key: 'status', header: 'Status', render: (e) => <Status label={e.status} />, sort: (e) => e.status },
  ];
  const exportRows = (list: Employee[]) =>
    downloadCsv('directory.csv', ['Name', 'Email', 'Employee ID', 'Designation', 'Department', 'Reporting manager', 'Location', 'Status'],
      list.map((e) => [e.name, e.email, e.id, e.title, e.dept, e.managerId ? byId.get(e.managerId)?.name ?? '' : '', e.location, e.status]));
  const canEdit = role === 'Admin' || role === 'HR';

  if (emps.error) return <div className="wrap page"><ErrorState error={emps.error} retry={emps.refetch} /></div>;
  const active = emps.data?.filter((e) => e.status !== 'Inactive') ?? [];
  return (
    <div className="wrap page" style={{ paddingBottom: 140 }}>
      <PageHeader
        title="Directory"
        desc={emps.data ? `${active.length} people across ${new Set(active.map((e) => e.dept)).size} departments and ${new Set(active.map((e) => e.location)).size} locations.` : ' '}
        more={[
          { label: 'Org chart', run: () => go('/app/people/org-chart') },
          { label: 'Export CSV', run: () => rows && exportRows(rows) },
          { label: 'Column visibility', run: () => setCols(true) },
        ]}
        primary={canEdit ? { label: 'Add employee', href: '/app/people/directory/new' } : undefined}
        views={[{ label: 'Table', href: '/app/people/directory' }, { label: 'Org chart', href: '/app/people/org-chart' }]}
        current="/app/people/directory"
      />
      <FilterBar
        search={search}
        onSearch={setSearch}
        filters={[
          { key: 'dept', label: 'Departments', options: opts('dept'), value: f.dept, onChange: (v) => setF({ ...f, dept: v }) },
          { key: 'location', label: 'Locations', options: opts('location'), value: f.location, onChange: (v) => setF({ ...f, location: v }) },
          { key: 'status', label: 'Statuses', options: opts('status'), value: f.status, onChange: (v) => setF({ ...f, status: v }) },
        ]}
        scopes={[...SCOPES]}
        scope={scope}
        onScope={setScope}
      />
      <div style={{ position: 'relative' }}>
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(e) => e.id}
          onOpen={(e) => go('/app/people/directory/' + e.id)}
          selectable={canEdit}
          showColumns={cols}
          onCloseColumns={() => setCols(false)}
          initialSort={{ key: 'name', dir: 'asc' }}
          rowMenu={(e) => [
            { label: 'Open profile', run: () => go('/app/people/directory/' + e.id) },
            { label: 'Edit profile', run: () => go('/app/people/directory/' + e.id + '/edit'), hidden: !canEdit },
            { label: 'Compensation', run: () => go('/app/people/directory/' + e.id + '/compensation'), hidden: !canEdit },
            { label: 'Initiate offboarding', run: () => setArchive([e]), danger: true, hidden: !canEdit || e.status === 'Inactive' },
          ]}
          bulk={[
            { label: 'Export', run: (list) => exportRows(list) },
            { label: 'Assign manager', run: (list) => setAssign(list) },
            { label: 'Archive', run: (list) => setArchive(list) },
          ]}
          empty={{ title: 'No records match these filters.', sub: 'Clear them to see everything again.', onClear: () => { setSearch(''); setF({ dept: '', location: '', status: '' }); setScope('All records'); } }}
        />
      </div>
      {assign && emps.data && (
        <div style={{ position: 'fixed', bottom: 90, left: '50%', transform: 'translateX(-50%)', zIndex: 75, width: 300 }}>
          <PersonPicker
            people={emps.data.filter((e) => e.status !== 'Inactive')}
            exclude={assign.map((e) => e.id)}
            label={'New manager for ' + assign.length + (assign.length === 1 ? ' person' : ' people')}
            onClose={() => setAssign(null)}
            onPick={async (m) => {
              await Promise.all(assign.map((e) => api.updateEmployee(e.id, { managerId: m.id })));
              invalidate('employees', 'audit');
              say(assign.length + ' now report to ' + m.name);
              setAssign(null);
            }}
          />
        </div>
      )}
      {archive && (
        <ConfirmDialog
          title={archive.length === 1 ? 'Offboard ' + archive[0].name + '?' : 'Archive ' + archive.length + ' people?'}
          body={'They will be marked inactive and an exit checklist opens for HR, IT, their manager and finance. Their records, payslips and audit history are kept.'}
          confirm={archive.length === 1 ? 'Start offboarding' : 'Archive'}
          danger
          onCancel={() => setArchive(null)}
          onConfirm={async () => {
            await Promise.all(archive.map((e) => api.updateEmployee(e.id, { status: 'Inactive' })));
            invalidate('employees', 'audit');
            say(archive.length === 1 ? 'Offboarding started for ' + archive[0].name : archive.length + ' people archived');
            setArchive(null);
          }}
        />
      )}
    </div>
  );
}

