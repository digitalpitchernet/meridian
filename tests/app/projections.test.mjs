import test from 'node:test';
import assert from 'node:assert/strict';
import { kpis, attention, activeProjects, schedule, dueState, projectProgress, describeActivity, milestoneLate } from '../../app/modules/projections.js';
import { buildFixtures } from '../../app/data/fixtures/dev-fixtures.js';

const TODAY = '2026-11-08';
const f = buildFixtures(TODAY);
const data = { tasks: f.tasks, projects: f.projects, milestones: f.milestones, events: f.calendar_events };

test('dueState buckets', () => {
  assert.equal(dueState('2026-11-07', TODAY), 'overdue');
  assert.equal(dueState(TODAY, TODAY), 'today');
  assert.equal(dueState('2026-11-15', TODAY), 'soon');
  assert.equal(dueState('2026-11-16', TODAY), 'later');
  assert.equal(dueState(null, TODAY), null);
});

test('kpis count only open tasks and active projects', () => {
  const k = kpis(data, TODAY);
  const open = f.tasks.filter(t => t.status !== 'Done');
  assert.equal(k.openTasks, open.length);
  assert.equal(k.overdue, open.filter(t => t.due_date && t.due_date < TODAY).length);
  assert.equal(k.dueToday, open.filter(t => t.due_date === TODAY).length);
  assert.equal(k.activeProjects, 2);
  assert.ok(k.overdue > 0 && k.dueToday > 0, 'fixtures exercise overdue and due-today');
  assert.equal(k.lateMilestones, 1); // 'Beta feature freeze' is Delayed
});

test('attention: overdue first (Critical before others), then late milestones, then due today; Done never appears', () => {
  const { items, total } = attention(data, TODAY, 50);
  assert.equal(items.length, total);
  assert.equal(items[0].kind, 'overdue'); assert.equal(items[0].task.priority, 'Critical');
  const kinds = items.map(i => i.kind);
  assert.ok(kinds.lastIndexOf('overdue') < kinds.indexOf('milestone'));
  assert.ok(kinds.indexOf('milestone') < kinds.indexOf('today'));
  assert.ok(items.every(i => !i.task || i.task.status !== 'Done'));
  assert.equal(attention(data, TODAY, 3).items.length, 3);
});

test('a milestone past due but still Upcoming counts as late', () => {
  assert.equal(milestoneLate({ status: 'Upcoming', due_date: '2026-11-01' }, TODAY), true);
  assert.equal(milestoneLate({ status: 'Achieved', due_date: '2026-11-01' }, TODAY), false);
  assert.equal(milestoneLate({ status: 'Upcoming', due_date: '2026-11-20' }, TODAY), false);
});

test('active projects: progress, next open milestone, overdue counts', () => {
  const rows = activeProjects(data, TODAY);
  assert.deepEqual(rows.map(r => r.project.name), ['Meridian private beta', 'Seed round preparation']); // Critical before High
  const beta = rows[0];
  const betaTasks = f.tasks.filter(t => t.project_id === beta.project.id);
  assert.deepEqual(beta.progress, projectProgress(betaTasks));
  assert.equal(beta.next.title, 'Beta feature freeze'); assert.equal(beta.nextLate, true);
  assert.equal(projectProgress([]).pct, 0);
});

test('schedule: next 14 days grouped by business-local date; all-day events and open items only', () => {
  const days = schedule(data, TODAY, 'Asia/Kolkata', 14);
  assert.ok(days.every((d, i) => i === 0 || days[i - 1].date < d.date));
  assert.ok(days.every(d => d.date >= TODAY && d.date <= '2026-11-21'));
  const today = days.find(d => d.date === TODAY);
  assert.ok(today.items.some(i => i.kind === 'event' && i.event.title === 'Partner #3 onboarding call'));
  assert.ok(today.items.some(i => i.kind === 'task'));
  const offsite = days.find(d => d.date === '2026-11-17');
  assert.ok(offsite.items.some(i => i.kind === 'event' && i.event.is_all_day));
  const all = days.flatMap(d => d.items);
  assert.ok(all.every(i => i.kind !== 'task' || i.task.status !== 'Done'));
});

test('describeActivity phrases trigger rows', () => {
  assert.deepEqual(describeActivity({ event_type: 'tasks.update', summary: 'Tasks update: Ship it', metadata: { status: 'Done' } }), { verb: 'Completed', noun: 'task', label: 'Ship it', status: null });
  assert.deepEqual(describeActivity({ event_type: 'projects.update', summary: 'Projects update: Launch', metadata: { status: 'On Hold' } }), { verb: 'Updated', noun: 'project', label: 'Launch', status: 'On Hold' });
  assert.deepEqual(describeActivity({ event_type: 'milestones.insert', summary: 'Milestones insert', metadata: {} }), { verb: 'Created', noun: 'milestone', label: '', status: null });
});
