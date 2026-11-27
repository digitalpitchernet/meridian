import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixtureAdapter } from '../../app/data/adapters/fixture.js';
import { createSupabaseAdapter } from '../../app/data/adapters/supabase.js';
import { buildFixtures, DEV_BUSINESS_ID, DEV_PROFILE_ID } from '../../app/data/fixtures/dev-fixtures.js';
import { createRepositories } from '../../app/data/repositories.js';
import { todayIn } from '../../app/core/format.js';

function makeFixture() {
  const db = createFixtureAdapter({
    seed: () => buildFixtures(todayIn('Asia/Kolkata')),
    session: { business_id: DEV_BUSINESS_ID, profile_id: DEV_PROFILE_ID },
  });
  return { db, repo: createRepositories(db) };
}

test('task execution (fixture): assign to active member, reject inactive member, transition and log activity', async () => {
  const { repo } = makeFixture();
  const participants = await repo.workspace.participants();
  const active = participants.find(p => p.is_active);
  assert.ok(active);

  const inactive = await repo.workspace.createParticipant({
    full_name: 'Former Advisor',
    participant_type: 'advisor',
    is_active: false,
  });

  const task = await repo.tasks.create({ title: 'Verify persistence', status: 'Inbox', priority: 'High' });
  assert.equal(task.assigned_to_participant_id, null);

  // Reject inactive participant
  await assert.rejects(
    repo.tasks.update(task.id, { assigned_to_participant_id: inactive.id }),
    err => err.code === '23514',
  );

  // Assign to active participant
  const assigned = await repo.tasks.update(task.id, { assigned_to_participant_id: active.id });
  assert.equal(assigned.assigned_to_participant_id, active.id);

  // Transition to In Progress, then Done
  const inProg = await repo.tasks.update(task.id, { status: 'In Progress' });
  assert.equal(inProg.status, 'In Progress');
  assert.equal(inProg.completed_at, null);

  const done = await repo.tasks.update(task.id, { status: 'Done' });
  assert.equal(done.status, 'Done');
  assert.ok(done.completed_at);

  // Entity activity history is retrievable
  const act = await repo.activity.forEntity('tasks', task.id, 10);
  assert.ok(act.length >= 4);
  assert.equal(act[0].entity_id, task.id);
});

test('supabase adapter: maps auth, query filters, inserts with business_id, and SQLSTATE errors', async () => {
  const calls = [];
  const mem = new Map();
  const storage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: k => mem.delete(k) };

  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : null });
    if (url.endsWith('/auth/v1/token?grant_type=password')) {
      return new Response(JSON.stringify({ access_token: 'tok-1', user: { id: 'u-1', email: 'a@b.com' } }), { status: 200 });
    }
    if (url.endsWith('/rest/v1/rpc/get_current_business_id')) {
      return new Response(JSON.stringify('biz-1'), { status: 200 });
    }
    if (url.includes('/rest/v1/tasks') && init.method === 'POST') {
      return new Response(JSON.stringify([{ id: 't-1', business_id: 'biz-1', title: 'Ship slice', status: 'Inbox' }]), { status: 201 });
    }
    if (url.includes('/rest/v1/tasks') && init.method === 'PATCH') {
      return new Response(JSON.stringify({ code: '23514', message: 'cannot assign a task to an inactive workspace member' }), { status: 400 });
    }
    return new Response(JSON.stringify([]), { status: 200 });
  };

  const adapter = createSupabaseAdapter({ url: 'http://127.0.0.1:5180', anonKey: 'anon', fetchImpl, storage });
  const session = await adapter.auth.signIn('a@b.com', 'secret123');
  assert.equal(session.access_token, 'tok-1');

  const repo = createRepositories(adapter);
  const created = await repo.tasks.create({ title: 'Ship slice' });
  assert.equal(created.business_id, 'biz-1');

  const postCall = calls.find(c => c.method === 'POST' && c.url.includes('/rest/v1/tasks'));
  assert.equal(postCall.body.business_id, 'biz-1');
  assert.equal(postCall.headers.Authorization, 'Bearer tok-1');

  await assert.rejects(
    repo.tasks.update('t-1', { assigned_to_participant_id: 'p-inactive' }),
    err => err.code === '23514',
  );
});
