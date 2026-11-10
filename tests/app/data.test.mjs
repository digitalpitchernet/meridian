// node --test tests/app — the development adapter must refuse what the database refuses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixtureAdapter, DataError } from '../../app/data/adapters/fixture.js';
import { buildFixtures, DEV_BUSINESS_ID, DEV_PROFILE_ID } from '../../app/data/fixtures/dev-fixtures.js';
import { createRepositories } from '../../app/data/repositories.js';
import { TABLES } from '../../app/data/schema.js';

const TODAY = '2026-11-08';
const make = (opts = {}) => {
  let clock = new Date('2026-11-08T06:00:00Z');
  const db = createFixtureAdapter({ seed: () => buildFixtures(TODAY), session: { business_id: DEV_BUSINESS_ID, profile_id: DEV_PROFILE_ID }, now: () => clock, ...opts });
  return { db, repo: createRepositories(db), tick: (ms = 1000) => { clock = new Date(clock.getTime() + ms); } };
};
const code = async (p, c) => { await assert.rejects(p, e => e instanceof DataError && e.code === c, `expected SQLSTATE ${c}`); };

test('fixtures: every seeded row satisfies the schema mirror', async () => {
  const f = buildFixtures(TODAY);
  const { db } = make();
  for (const [table, list] of Object.entries(f)) {
    assert.ok(TABLES[table], `fixture table ${table} exists in schema.js`);
    for (const r of list) {
      assert.equal(r.business_id ?? r.id, DEV_BUSINESS_ID === r.id ? r.id : DEV_BUSINESS_ID, `${table} row belongs to the dev business`);
      for (const col of Object.keys(r)) assert.ok(col in TABLES[table].columns, `${table}.${col} is a real column`);
      for (const col of Object.keys(TABLES[table].columns)) assert.ok(col in r, `${table}.${col} present in fixture row`);
    }
  }
  // round-trip one row of each writable table through validation by re-inserting a copy with a new id
  const p = (await db.select('projects'))[0];
  await db.insert('projects', { ...p, id: undefined, created_at: undefined, updated_at: undefined });
});

test('schema: enum, length, not-null and table CHECKs are enforced (23514 / 23502)', async () => {
  const { repo } = make();
  await code(repo.projects.create({ name: 'X', status: 'Paused' }), '23514');
  await code(repo.projects.create({ name: '   ' }), '23514');
  await code(repo.projects.create({ name: 'x'.repeat(201) }), '23514');
  await code(repo.projects.create({ description: 'no name' }), '23502');
  await code(repo.projects.create({ name: 'Dates', start_date: '2026-11-10', target_date: '2026-11-01' }), '23514');
  await code(repo.tasks.create({ title: 'r', recurrence_rule: 'weekly' }), '23514'); // rule without interval
  await code(repo.tasks.create({ title: 'p', priority: 'Urgent' }), '23514');
  const ok = await repo.projects.create({ name: '  Trimmed name ok ' });
  assert.equal(ok.status, 'Planning'); assert.equal(ok.priority, 'Normal'); assert.equal(ok.business_id, DEV_BUSINESS_ID);
});

test('privileges: column grants and table grants (42501), unknown columns (42703)', async () => {
  const { repo, db } = make();
  const [task] = await repo.tasks.list();
  await code(repo.tasks.update(task.id, { completed_at: new Date().toISOString() }), '42501'); // not granted: server-managed
  await code(repo.tasks.update(task.id, { business_id: DEV_BUSINESS_ID }), '42501');
  await code(repo.tasks.update(task.id, { colour: 'red' }), '42703');
  await code(db.insert('activity_records', { event_type: 'forged' }), '42501');       // server-written only
  await code(db.update('activity_records', (await repo.activity.recent(1))[0].id, { summary: 'x' }), '42501');
  await code(db.remove('activity_records', (await repo.activity.recent(1))[0].id), '42501');
  await code(db.insert('businesses', { business_name: 'Another' }), '42501');          // onboarding is create_workspace() only
  const biz = await repo.workspace.business();
  await code(repo.workspace.updateBusiness(biz.id, { base_currency: 'USD' }), '42501');
  assert.equal((await repo.workspace.updateBusiness(biz.id, { accent_color: '#10B981' })).accent_color, '#10B981');
  await code(repo.workspace.updateBusiness(biz.id, { accent_color: 'green' }), '23514');
});

test('row-level security: other businesses are invisible and cannot be written (42501)', async () => {
  const { repo, db } = make();
  await code(repo.projects.create({ name: 'Planted', business_id: '00000000-0000-4000-8000-0000000000ff' }), '42501');
  assert.equal(await db.update('projects', '00000000-0000-4000-8000-0000000000ff', { name: 'x' }), null);
  assert.equal(await db.remove('projects', '00000000-0000-4000-8000-0000000000ff'), false);
});

test('foreign keys: missing parent refused (23503); delete cascades or sets null like the migrations', async () => {
  const { repo } = make();
  await code(repo.tasks.create({ title: 'Orphan', project_id: '00000000-0000-4000-8000-0000000000ee' }), '23503');
  await code(repo.milestones.create({ title: 'm', due_date: TODAY, project_id: '00000000-0000-4000-8000-0000000000ee' }), '23503');
  const project = (await repo.projects.list()).find(p => p.name === 'Meridian private beta');
  const before = await repo.tasks.forProject(project.id);
  const ms = await repo.milestones.forProject(project.id);
  assert.ok(before.length > 0 && ms.length > 0);
  assert.equal(await repo.projects.remove(project.id), true);
  assert.equal((await repo.milestones.forProject(project.id)).length, 0, 'milestones cascade');
  for (const t of before) { const now = await repo.tasks.get(t.id); assert.equal(now.project_id, null, 'tasks keep, project set null'); assert.equal(now.milestone_id, null, 'milestone link set null'); }
  const task = before[0];
  const subs = await repo.tasks.subtasks(task.id);
  await repo.tasks.remove(task.id);
  for (const s of subs) assert.equal((await repo.tasks.allSubtasks()).some(x => x.id === s.id), false, 'subtasks cascade');
});

test('triggers: Done <-> completed_at like sync_task_completion; updated_at moves on update', async () => {
  const { repo, tick } = make();
  const t = await repo.tasks.create({ title: 'Ship it' });
  assert.equal(t.status, 'Inbox'); assert.equal(t.completed_at, null);
  tick(5000);
  const done = await repo.tasks.update(t.id, { status: 'Done' });
  assert.ok(done.completed_at); assert.ok(done.updated_at > t.updated_at);
  const renamed = await repo.tasks.update(t.id, { title: 'Ship it now' });
  assert.equal(renamed.completed_at, done.completed_at, 'completion untouched when status not in the update');
  const reopened = await repo.tasks.update(t.id, { status: 'Next' });
  assert.equal(reopened.completed_at, null);
  const createdDone = await repo.tasks.create({ title: 'Already done', status: 'Done' });
  assert.ok(createdDone.completed_at);
});

test('activity: record_activity() rows for projects/milestones/tasks only, append-only, labelled like the trigger', async () => {
  const { repo, tick } = make();
  const before = (await repo.activity.recent(100)).length;
  const p = await repo.projects.create({ name: 'Launch plan', status: 'Active' }); tick();
  await repo.projects.update(p.id, { status: 'On Hold' }); tick();
  await repo.tasks.create({ title: 'Plain task' }); tick();
  await repo.contacts.create({ first_name: 'Nina', category: 'Vendor' }); // contacts have no activity trigger
  tick();
  const recent = await repo.activity.recent(100);
  assert.equal(recent.length, before + 3);
  const [last, mid] = recent;
  assert.equal(last.event_type, 'tasks.insert'); assert.equal(last.summary, 'Tasks insert: Plain task'); assert.deepEqual(last.metadata, { status: 'Inbox' });
  assert.equal(mid.event_type, 'projects.update'); assert.equal(mid.summary, 'Projects update: Launch plan'); assert.equal(mid.actor_type, 'user'); assert.equal(mid.actor_id, DEV_PROFILE_ID);
  await repo.projects.remove(p.id);
  assert.equal((await repo.activity.recent(1))[0].event_type, 'projects.delete');
});

test('persistence: changes survive a reload from storage; reset restores the fixtures', async () => {
  const mem = new Map(); const storage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const a = make({ storage });
  const p = await a.repo.projects.create({ name: 'Persisted project' });
  const b = make({ storage });
  assert.equal((await b.repo.projects.get(p.id)).name, 'Persisted project');
  b.db.dev.reset();
  assert.equal(await b.repo.projects.get(p.id), null);
  mem.set('meridian.dev.v1', '{not json'); // corrupt snapshot reseeds instead of crashing
  const c = make({ storage });
  assert.ok((await c.repo.projects.list()).length >= 6);
});

test('isolation: callers get copies, so mutating a result never changes stored data', async () => {
  const { repo } = make();
  const [p] = await repo.projects.list();
  p.name = 'mutated';
  assert.notEqual((await repo.projects.get(p.id)).name, 'mutated');
});
