// M2 logic: calendar maths, milestone progress/state, calendar entries, decisions, contacts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { zonedToUtc, utcToZoned, startOfWeek, monthGrid, addMonths, weekday } from '../../app/core/format.js';
import { milestoneProgress, milestoneState, calendarEntries } from '../../app/modules/projections.js';
import { buildFixtures } from '../../app/data/fixtures/dev-fixtures.js';

const TODAY = '2026-11-08'; // a Sunday
const f = buildFixtures(TODAY);

test('time zones: business wall clock <-> UTC, including DST changes', () => {
  assert.equal(zonedToUtc('2026-11-08', '16:00', 'Asia/Kolkata'), '2026-11-08T10:30:00.000Z');
  assert.equal(zonedToUtc('2026-07-01', '09:00', 'Europe/London'), '2026-07-01T08:00:00.000Z'); // BST
  assert.equal(zonedToUtc('2026-12-01', '09:00', 'Europe/London'), '2026-12-01T09:00:00.000Z'); // GMT
  assert.equal(zonedToUtc('2026-11-08', '00:00', 'America/New_York'), '2026-11-08T05:00:00.000Z');
  assert.deepEqual(utcToZoned('2026-11-08T20:00:00Z', 'Asia/Kolkata'), { date: '2026-11-09', time: '01:30' });
  for (const [d, t, z] of [['2026-03-29', '12:00', 'Europe/London'], ['2026-11-01', '12:00', 'America/New_York']]) assert.deepEqual(utcToZoned(zonedToUtc(d, t, z), z), { date: d, time: t });
});

test('weeks honour profiles.week_start_day', () => {
  assert.equal(weekday(TODAY), 0);
  assert.equal(startOfWeek(TODAY, 'Monday'), '2026-11-02');
  assert.equal(startOfWeek(TODAY, 'Sunday'), '2026-11-08');
  assert.equal(startOfWeek(TODAY, 'Saturday'), '2026-11-07');
});

test('month grid covers the whole month in whole weeks', () => {
  for (const [date, ws] of [['2026-11-08', 'Monday'], ['2026-02-10', 'Sunday'], ['2026-03-01', 'Saturday'], ['2027-01-31', 'Monday']]) {
    const g = monthGrid(date, ws); const flat = g.flat();
    assert.ok(g.length >= 4 && g.length <= 6, `${date} ${g.length} weeks`);
    assert.ok(g.every(w => w.length === 7));
    assert.equal(flat[0], startOfWeek(`${date.slice(0, 7)}-01`, ws));
    const days = flat.filter(d => d.startsWith(date.slice(0, 7)));
    assert.equal(days.length, new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7), 0)).getUTCDate());
  }
  assert.equal(addMonths('2026-12-15', 1), '2027-01-01'); assert.equal(addMonths('2026-01-31', -1), '2025-12-01');
});

test('milestone progress counts only its own tasks; state reflects status and dates', () => {
  const m1 = f.milestones.find(m => m.title === 'Design partner onboarding');
  const mine = f.tasks.filter(t => t.milestone_id === m1.id);
  assert.deepEqual(milestoneProgress(m1.id, f.tasks), { done: mine.filter(t => t.status === 'Done').length, total: mine.length, pct: Math.round(mine.filter(t => t.status === 'Done').length / mine.length * 100) });
  assert.equal(milestoneProgress('none', f.tasks).total, 0);
  assert.equal(milestoneState({ status: 'Achieved', due_date: '2026-01-01' }, TODAY), 'achieved');
  assert.equal(milestoneState({ status: 'Cancelled', due_date: '2026-01-01' }, TODAY), 'cancelled');
  assert.equal(milestoneState({ status: 'Upcoming', due_date: '2026-11-01' }, TODAY), 'late');
  assert.equal(milestoneState({ status: 'Delayed', due_date: '2026-12-01' }, TODAY), 'late');
  assert.equal(milestoneState({ status: 'Upcoming', due_date: '2026-11-13' }, TODAY), 'due-soon');
  assert.equal(milestoneState({ status: 'In Progress', due_date: '2026-12-13' }, TODAY), 'upcoming');
});

test('calendar entries: tasks, milestones and events on business-local dates with overdue/today/done states', () => {
  const map = calendarEntries({ events: f.calendar_events, tasks: f.tasks, milestones: f.milestones, projects: f.projects }, '2026-10-01', '2026-12-31', 'Asia/Kolkata', TODAY);
  const all = [...map.values()].flat();
  const overdueTask = all.find(e => e.kind === 'task' && e.task.title === 'Fix sync conflict on task reorder');
  assert.equal(overdueTask.state, 'overdue');
  assert.equal(all.find(e => e.kind === 'task' && e.task.title === 'Onboarding call with partner #3').state, 'today');
  assert.equal(all.find(e => e.kind === 'task' && e.task.title === 'Accessibility pass on the sidebar').state, 'done');
  assert.equal(all.find(e => e.kind === 'milestone' && e.milestone.title === 'Beta feature freeze').state, 'overdue');
  assert.ok(map.get('2026-11-17').some(e => e.kind === 'event' && e.allDay), 'all-day event on its local day');
  assert.ok(map.get(TODAY).some(e => e.kind === 'event' && e.title === 'Partner #3 onboarding call'));
  for (const [date, list] of map) assert.ok(date >= '2026-10-01' && date <= '2026-12-31' && list.length > 0);
  // every task with a due date in range appears exactly once
  const due = f.tasks.filter(t => t.due_date && t.due_date >= '2026-10-01' && t.due_date <= '2026-12-31');
  assert.equal(all.filter(e => e.kind === 'task').length, due.length);
});
