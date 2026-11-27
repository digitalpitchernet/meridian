import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalSupabase, hasLocalPgServer } from '../../tools/local-supabase.mjs';
import { createSupabaseAdapter } from '../../app/data/adapters/supabase.js';
import { createRepositories } from '../../app/data/repositories.js';

const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

const isDisposableRemote = process.env.MERIDIAN_DISPOSABLE_VALIDATION === '1';
const hasRemoteValidationProject = Boolean(
  isDisposableRemote
  && process.env.TEST_SUPABASE_URL
  && process.env.TEST_SUPABASE_ANON_KEY
  && process.env.TEST_USER_A_EMAIL
  && process.env.TEST_USER_A_PASSWORD,
);
const canRunPgE2E = hasLocalPgServer() || hasRemoteValidationProject;

function makeMemStorage() {
  const m = new Map();
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) };
}

test(
  'task execution E2E against PostgreSQL: auth, workspace isolation, assignment, transitions, activity, reload',
  {
    skip: !canRunPgE2E
      && 'No local PostgreSQL server (pg_config --sharedir/postgres.bki) or disposable validation project (MERIDIAN_DISPOSABLE_VALIDATION=1 + TEST_SUPABASE_URL/ANON_KEY + TEST_USER_A_*) configured',
  },
  async (t) => {
    const useLocal = hasLocalPgServer();
    let baseUrl;
    let anonKey = 'test-anon';

    if (useLocal) {
      const workDir = mkdtempSync(join(REPO_ROOT, '.local-pg-test-'));
      const backend = createLocalSupabase({
        dataDir: join(workDir, 'data'),
        logFile: join(workDir, 'postgres.log'),
        port: 55439,
        seedDemo: false,
      });
      backend.initAndStart();
      backend.runPsql(backend.pgUrl, 'UPDATE public.installation_settings SET max_workspaces = 2;');

      const server = createServer((req, res) => backend.handleRequest(req, res));
      await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
      const { port: httpPort } = server.address();
      baseUrl = `http://127.0.0.1:${httpPort}`;

      t.after(async () => {
        await new Promise(r => server.close(r));
        backend.stop();
        rmSync(workDir, { recursive: true, force: true });
      });
    } else {
      baseUrl = process.env.TEST_SUPABASE_URL;
      anonKey = process.env.TEST_SUPABASE_ANON_KEY;
    }

    const storageA = makeMemStorage();
    const adapterA = createSupabaseAdapter({ url: baseUrl, anonKey, storage: storageA });
    let userA;
    if (useLocal) {
      const signUpA = await adapterA.auth.signUp(`founder.a.${Date.now()}@meridian.test`, 'passwordA123');
      userA = signUpA.user;
    } else {
      // Remote validation uses pre-confirmed accounts (respecting GoTrue email confirmation and max_workspaces).
      const signInA = await adapterA.auth.signIn(process.env.TEST_USER_A_EMAIL, process.env.TEST_USER_A_PASSWORD);
      userA = signInA.user;
    }
    assert.ok(userA?.id);
    const repoA = createRepositories(adapterA);

    let bizA = await adapterA.rpc('get_current_business_id');
    if (!bizA) {
      bizA = await adapterA.rpc('create_workspace', {
        p_business_name: 'Alpha Validation Studio',
        p_base_currency: 'INR',
        p_locale: 'en-IN',
        p_timezone: 'Asia/Kolkata',
        p_full_name: 'Asha Varma',
        p_financial_year_start_month: 4,
      });
    }
    assert.ok(bizA);

    const suffix = Date.now();
    const activeMemberA = await repoA.workspace.createParticipant({
      full_name: `Rohan Validation ${suffix}`,
      participant_type: 'cofounder',
      is_active: true,
    });
    const inactiveMemberA = await repoA.workspace.createParticipant({
      full_name: `Inactive Validation ${suffix}`,
      participant_type: 'advisor',
      is_active: false,
    });

    const createdTaskIds = [];
    t.after(async () => {
      if (useLocal) return;
      for (const tid of createdTaskIds) {
        await repoA.tasks.remove(tid).catch(() => {});
      }
      await repoA.workspace.removeParticipant(activeMemberA.id).catch(() => {});
      await repoA.workspace.removeParticipant(inactiveMemberA.id).catch(() => {});
    });

    // Optional Workspace B checks (local ephemeral cluster, or disposable remote with TEST_USER_B_*)
    let repoB = null;
    let memberB = null;
    const hasUserB = useLocal || Boolean(process.env.TEST_USER_B_EMAIL && process.env.TEST_USER_B_PASSWORD);
    if (hasUserB) {
      const storageB = makeMemStorage();
      const adapterB = createSupabaseAdapter({ url: baseUrl, anonKey, storage: storageB });
      if (useLocal) {
        await adapterB.auth.signUp(`founder.b.${Date.now()}@meridian.test`, 'passwordB123');
      } else {
        await adapterB.auth.signIn(process.env.TEST_USER_B_EMAIL, process.env.TEST_USER_B_PASSWORD);
      }
      repoB = createRepositories(adapterB);
      let bizB = await adapterB.rpc('get_current_business_id');
      if (!bizB && useLocal) {
        bizB = await adapterB.rpc('create_workspace', {
          p_business_name: 'Beta Validation Labs',
          p_base_currency: 'USD',
          p_locale: 'en-US',
          p_timezone: 'America/New_York',
          p_full_name: 'Ben Carter',
          p_financial_year_start_month: 1,
        });
      }
      if (bizB && bizB !== bizA) {
        memberB = (await repoB.workspace.participants())[0] || null;
      }
    }

    const created = await repoA.tasks.create({
      title: `Ship Task Execution Slice ${suffix}`,
      priority: 'High',
      status: 'Inbox',
      description: 'End-to-end persisted task.',
    });
    createdTaskIds.push(created.id);
    assert.equal(created.business_id, bizA);
    assert.equal(created.status, 'Inbox');
    assert.equal(created.completed_at, null);

    // Reject inactive member (23514) and unknown/cross-workspace member (23503)
    await assert.rejects(
      repoA.tasks.update(created.id, { assigned_to_participant_id: inactiveMemberA.id }),
      err => err.code === '23514',
    );
    const foreignOrUnknownId = memberB?.id || '00000000-0000-4000-8000-0000000000ff';
    await assert.rejects(
      repoA.tasks.update(created.id, { assigned_to_participant_id: foreignOrUnknownId }),
      err => err.code === '23503',
    );

    // Simultaneous status + assignee update must log both events
    const movedAndAssigned = await repoA.tasks.update(created.id, {
      status: 'In Progress',
      assigned_to_participant_id: activeMemberA.id,
    });
    assert.equal(movedAndAssigned.status, 'In Progress');
    assert.equal(movedAndAssigned.assigned_to_participant_id, activeMemberA.id);

    // Cross-workspace RLS isolation when User B is configured
    if (repoB && memberB) {
      assert.equal(await repoB.tasks.get(created.id), null);
      assert.equal((await repoB.tasks.list()).some(x => x.id === created.id), false);
      await assert.rejects(repoB.tasks.update(created.id, { status: 'Done' }), err => err.code === 'P0002');
    }

    // Complete task -> server-side completed_at
    const completed = await repoA.tasks.update(created.id, { status: 'Done' });
    assert.equal(completed.status, 'Done');
    assert.ok(completed.completed_at);

    // Accountability activity_records
    const history = await repoA.activity.forEntity('tasks', created.id, 20);
    const eventTypes = history.map(a => a.event_type);
    assert.ok(eventTypes.includes('tasks.insert'));
    assert.ok(eventTypes.includes('tasks.assigned'));
    assert.ok(eventTypes.includes('tasks.status_changed'));
    assert.ok(eventTypes.includes('tasks.completed'));
    assert.ok(history.every(a => a.actor_type === 'user' && a.actor_id === userA.id));

    // Reload persistence
    const reloadedAdapter = createSupabaseAdapter({ url: baseUrl, anonKey, storage: storageA });
    const restoredSession = await reloadedAdapter.auth.getSession();
    assert.equal(restoredSession.user.id, userA.id);
    const reloadedRepo = createRepositories(reloadedAdapter);
    const reloadedTask = await reloadedRepo.tasks.get(created.id);
    assert.equal(reloadedTask.title, `Ship Task Execution Slice ${suffix}`);
    assert.equal(reloadedTask.status, 'Done');
    assert.equal(reloadedTask.assigned_to_participant_id, activeMemberA.id);
  },
);
