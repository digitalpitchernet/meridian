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

import { createFixtureAdapter, DataError } from '../../app/data/adapters/fixture.js';
import { DEV_BUSINESS_ID, DEV_PROFILE_ID } from '../../app/data/fixtures/dev-fixtures.js';
import { createRepositories } from '../../app/data/repositories.js';
import { contactMatches, contactName } from '../../app/modules/projections.js';
const repo = () => { let clock = new Date('2026-11-08T06:00:00Z'); const db = createFixtureAdapter({ seed: () => buildFixtures(TODAY), session: { business_id: DEV_BUSINESS_ID, profile_id: DEV_PROFILE_ID }, now: () => (clock = new Date(clock.getTime() + 1000)) }); return { db, r: createRepositories(db) }; };
const rejects = async (p, code) => assert.rejects(p, e => e instanceof DataError && e.code === code, `expected ${code}`);

test('contacts: search matches every word across name, organisation, role and email', () => {
  const c = f.contacts.find(x => x.first_name === 'Priya');
  assert.equal(contactName(c), 'Priya Nair');
  assert.ok(contactMatches(c, 'priya')); assert.ok(contactMatches(c, 'nair ca')); assert.ok(contactMatches(c, 'ca.example'));
  assert.ok(!contactMatches(c, 'priya investor'));
  assert.equal(contactName({ first_name: 'Kavya', last_name: null }), 'Kavya');
});

test('contacts: category CHECK, project links with a composite key, roles, unlink', async () => {
  const { r, db } = repo();
  await rejects(r.contacts.create({ first_name: 'Nobody', category: 'Friend' }), '23514');
  await rejects(r.contacts.create({ first_name: '  ', category: 'Other' }), '23514');
  const c = await r.contacts.create({ first_name: 'Lena', category: 'Vendor' });
  const p = (await r.projects.list())[0];
  await r.contacts.link(p.id, c.id, 'Printer');
  await rejects(r.contacts.link(p.id, c.id), '23505');                                     // composite PK
  await rejects(r.contacts.link('00000000-0000-4000-8000-0000000000ee', c.id), '23503');    // FK
  const [updated] = await r.contacts.setRole(p.id, c.id, 'Print vendor');
  assert.equal(updated.relationship_role, 'Print vendor');
  await rejects(db.updateWhere('project_contacts', { project_id: p.id, contact_id: c.id }, { project_id: p.id }), '42501'); // only relationship_role is granted
  assert.equal(await r.contacts.unlink(p.id, c.id), 1);
  assert.equal((await r.contacts.links({ eq: { contact_id: c.id } })).length, 0);
});

test('contacts: deleting a contact removes project links and clears decision and event references (schema FKs)', async () => {
  const { r } = repo();
  const advisor = f.contacts.find(x => x.first_name === 'Ishaan');
  assert.ok((await r.contacts.links({ eq: { contact_id: advisor.id } })).length > 0);
  const dec = (await r.decisions.list({ eq: { contact_id: advisor.id } }))[0];
  assert.ok(dec);
  await r.contacts.remove(advisor.id);
  assert.equal((await r.contacts.links({ eq: { contact_id: advisor.id } })).length, 0, 'project_contacts cascade');
  assert.equal((await r.decisions.get(dec.id)).contact_id, null, 'decisions.contact_id set null');
  const investor = f.contacts.find(x => x.first_name === 'Dev');
  const ev = (await r.calendar.list({ eq: { contact_id: investor.id } }))[0];
  await r.contacts.remove(investor.id);
  assert.equal((await r.calendar.get(ev.id)).contact_id, null, 'calendar_events.contact_id set null');
});

test('relationships: deleting a project keeps tasks, cascades milestones, unlinks contacts; Command Centre inputs stay consistent', async () => {
  const { r } = repo();
  const beta = (await r.projects.list()).find(p => p.name === 'Meridian private beta');
  const ms = await r.milestones.forProject(beta.id);
  const evs = (await r.calendar.list()).filter(e => e.project_id === beta.id);
  const linkedTask = (await r.tasks.forProject(beta.id)).find(t => t.milestone_id);
  await r.projects.remove(beta.id);
  assert.equal((await r.milestones.forProject(beta.id)).length, 0);
  const t = await r.tasks.get(linkedTask.id);
  assert.equal(t.project_id, null); assert.equal(t.milestone_id, null);
  for (const e of evs) assert.equal((await r.calendar.get(e.id)).project_id, null);
  assert.equal((await r.contacts.links({ eq: { project_id: beta.id } })).length, 0);
  for (const m of ms) assert.equal((await r.calendar.list({ eq: { milestone_id: m.id } })).length, 0);
});

import { decisionEditable, canSupersede, reviewState, decisionMatches } from '../../app/modules/projections.js';

test('decisions: rules for editing, superseding, reviews and search', () => {
  assert.ok(decisionEditable({ status: 'Proposed' })); assert.ok(!decisionEditable({ status: 'Approved' }));
  assert.ok(canSupersede({ status: 'Approved' })); assert.ok(canSupersede({ status: 'Rejected' }));
  assert.ok(!canSupersede({ status: 'Proposed' })); assert.ok(!canSupersede({ status: 'Superseded' }));
  assert.equal(reviewState({ status: 'Approved', review_date: '2026-11-06' }, TODAY), 'due');
  assert.equal(reviewState({ status: 'Approved', review_date: TODAY }, TODAY), 'due');
  assert.equal(reviewState({ status: 'Approved', review_date: '2026-11-12' }, TODAY), 'soon');
  assert.equal(reviewState({ status: 'Superseded', review_date: '2026-11-01' }, TODAY), null);
  assert.equal(reviewState({ status: 'Approved', review_date: null }, TODAY), null);
  const d = f.decisions.find(x => x.title.startsWith('Hosting for the beta: move'));
  assert.ok(decisionMatches(d, 'backups monthly')); assert.ok(!decisionMatches(d, 'pricing'));
});

test('decisions: schema rules: self-supersession CHECK, selected option must belong to the same decision', async () => {
  const { r } = repo();
  const [a] = await r.decisions.list({ eq: { status: 'Proposed' } });
  await rejects(r.decisions.update(a.id, { superseded_by_id: a.id }), '23514');
  const other = f.decision_options.find(o => o.decision_id !== a.id);
  await rejects(r.decisions.update(a.id, { selected_option_id: other.id }), '23503');
  const own = (await r.decisions.options(a.id))[0];
  assert.equal((await r.decisions.update(a.id, { selected_option_id: own.id })).selected_option_id, own.id);
  await r.decisions.removeOption(own.id);
  assert.equal((await r.decisions.get(a.id)).selected_option_id, null, 'deleting the selected option clears it (ON DELETE SET NULL)');
});

test('decisions: outcome recording requires a rationale and only applies to Proposed', async () => {
  const { r } = repo();
  const [p] = await r.decisions.list({ eq: { status: 'Proposed' } });
  const [opt] = await r.decisions.options(p.id);
  await rejects(r.decisions.decide(p.id, { status: 'Approved', selected_option_id: opt.id, rationale: '  ' }), '23502');
  const done = await r.decisions.decide(p.id, { status: 'Approved', selected_option_id: opt.id, rationale: 'Runway matters more.', decision_date: TODAY });
  assert.equal(done.status, 'Approved'); assert.equal(done.selected_option_id, opt.id); assert.equal(done.decision_date, TODAY);
  await rejects(r.decisions.decide(p.id, { status: 'Rejected', rationale: 'again' }), '23514');
});

test('decisions: superseding preserves the old record and links both ways; chains are walkable; no double supersede', async () => {
  const { r } = repo();
  const current = f.decisions.find(x => x.title === 'Hosting for the beta: move to a managed platform');
  const before = await r.decisions.get(current.id);
  const beforeOptions = await r.decisions.options(current.id);
  const { created, updated } = await r.decisions.supersede(current.id, { title: 'Hosting: self-managed database again', context: 'Costs tripled.', rationale: 'Cost now outweighs convenience.' },
    { outcome: 'Self-managed Postgres with scripted backups', alternatives: ['Stay managed', ''] });
  assert.equal(created.status, 'Approved'); assert.equal(created.project_id, before.project_id);
  const opts = await r.decisions.options(created.id);
  assert.deepEqual(opts.map(o => o.title), ['Self-managed Postgres with scripted backups', 'Stay managed']);
  assert.equal(created.selected_option_id, opts[0].id);
  // the old record keeps its outcome, options and rationale; only status and the forward link change
  assert.equal(updated.status, 'Superseded'); assert.equal(updated.superseded_by_id, created.id);
  for (const k of ['title', 'context', 'problem', 'rationale', 'selected_option_id', 'decision_date']) assert.deepEqual(updated[k], before[k], k);
  assert.deepEqual((await r.decisions.options(current.id)).map(o => o.id), beforeOptions.map(o => o.id));
  // chain: new -> current -> original (seeded as superseded by current)
  const chain = await r.decisions.history(created.id);
  assert.deepEqual(chain.map(x => x.title), ['Hosting for the beta: move to a managed platform', 'Hosting for the beta']);
  await rejects(r.decisions.supersede(current.id, { title: 'x' }, { outcome: 'y' }), '23514');            // already superseded
  const proposed = (await r.decisions.list({ eq: { status: 'Proposed' } }))[0];
  await rejects(r.decisions.supersede(proposed.id, { title: 'x' }, { outcome: 'y' }), '23514');           // not decided yet
  await rejects(r.decisions.supersede(created.id, { title: 'x' }, { outcome: '  ' }), '23502');           // outcome required
});
