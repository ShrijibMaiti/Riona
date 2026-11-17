import { useMemo } from 'react';
import { CalendarView, type CalEvent } from '../../components/CalendarView';
import { PageHeader } from '../../components/PageHeader';
import { ErrorState, SkeletonRows } from '../../components/ui';
import * as api from '../../data/repositories';
import { useEmployees, useLeave, useMe, useProjects, useTasks } from '../../hooks/data';
import { addDays } from '../../lib/dates';
import { SC } from '../../lib/format';
import { all, useQuery } from '../../lib/query';

/** Holidays, leave, deadlines and room bookings, layered. */
export default function WorkCalendar() {
  const me = useMe();
  const today = me.data?.today;
  const q = all({ me, emps: useEmployees(), leave: useLeave(), tasks: useTasks(), projects: useProjects(), holidays: useQuery(['holidays'], api.getHolidays),
    bookings: useQuery(['bookings', 'week', today], async () => (await Promise.all(Array.from({ length: 10 }, (_, i) => api.getBookings(addDays(today!, i - 2))))).flat(), { enabled: !!today }),
    rooms: useQuery(['rooms'], api.getRooms) });
  const events = useMemo<CalEvent[]>(() => {
    if (!q.data) return [];
    const { emps, leave, tasks, projects, holidays, bookings, rooms } = q.data;
    const nm = (id: string) => emps.find((e) => e.id === id)?.name ?? id;
    return [
      ...holidays.map((h) => ({ id: 'h' + h.date, layer: 'holiday', title: h.name, date: h.date })),
      ...leave.filter((l) => l.status === 'Approved').map((l) => ({ id: l.id, layer: 'leave', title: nm(l.employeeId) + ' away', date: l.from, end: l.to, workdaysOnly: true, href: '/app/people/leave/calendar' })),
      ...tasks.filter((t) => t.status !== 'done').map((t) => ({ id: t.id, layer: 'deadline', title: t.id + ' ' + t.title, date: t.due, href: '/app/work/projects/' + t.projectId + '/task/' + t.id })),
      ...projects.flatMap((p) => p.milestones.map((ms) => ({ id: ms.id, layer: 'deadline', title: p.name + ' · ' + ms.name, date: ms.date, href: '/app/work/projects/' + p.id + '/timeline' }))),
      ...bookings.map((b) => ({ id: b.id, layer: 'booking', title: b.title + ' · ' + (rooms.find((r) => r.id === b.roomId)?.name ?? ''), date: b.date, time: b.start, href: '/app/workplace/rooms' })),
    ];
  }, [q.data]);
  if (q.error) return <div className="wrap page"><ErrorState error={q.error} retry={q.refetch} /></div>;
  return (
    <div className="wrap page" style={{ paddingBottom: 120 }}>
      <PageHeader title="Calendar" desc="Holidays, leave, deadlines and room bookings in one view. Turn layers on and off on the right." />
      {!q.data || !today ? <SkeletonRows /> : (
        <CalendarView today={today} events={events} layers={[
          { key: 'holiday', label: 'Holidays', colour: SC.blue }, { key: 'leave', label: 'Leave', colour: SC.amber },
          { key: 'deadline', label: 'Deadlines', colour: 'var(--violet)' }, { key: 'booking', label: 'Room bookings', colour: SC.gray },
        ]} />
      )}
    </div>
  );
}
