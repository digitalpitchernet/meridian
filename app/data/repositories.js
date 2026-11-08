import { DataError } from './errors.js';

// Repositories: the ONLY way screens read or write data. Named after the backend tables, views and RPCs
// (supabase/migrations, ENGINEERING-SPEC §5), so swapping the development adapter for the Supabase adapter
// does not change a single screen. Each repository takes an adapter with select/get/insert/update/remove/rpc.

export function createRepositories(db) {
  const table = name => ({
    list: (query) => db.select(name, query),
    get: (id) => db.get(name, id),
    create: (row) => db.insert(name, row),
    update: (id, patch) => db.update(name, id, patch),
    remove: (id) => db.remove(name, id),
  });

  const workspace = {
    // one workspace per installation: the caller's business (get_current_business_id) and own profile
    async business() { const id = await db.rpc('get_current_business_id'); return db.get('businesses', id); },
    async profile() { return (await db.select('profiles', { limit: 1 }))[0] ?? null; },
    updateBusiness: (id, patch) => db.update('businesses', id, patch),
    updateProfile: (id, patch) => db.update('profiles', id, patch),
    participants: () => db.select('participants', { order: [{ col: 'created_at' }] }),
  };

  const projects = {
    ...table('projects'),
    list: (query = {}) => db.select('projects', { order: [{ col: 'updated_at', asc: false }], ...query }),
  };

  const milestones = {
    ...table('milestones'),
    forProject: (projectId) => db.select('milestones', { eq: { project_id: projectId }, order: [{ col: 'due_date' }] }),
    list: (query = {}) => db.select('milestones', { order: [{ col: 'due_date' }], ...query }),
  };

  const tasks = {
    ...table('tasks'),
    list: (query = {}) => db.select('tasks', { order: [{ col: 'due_date' }, { col: 'created_at' }], ...query }),
    forProject: (projectId) => db.select('tasks', { eq: { project_id: projectId }, order: [{ col: 'due_date' }, { col: 'created_at' }] }),
    subtasks: (taskId) => db.select('subtasks', { eq: { task_id: taskId }, order: [{ col: 'sort_order' }, { col: 'created_at' }] }),
    allSubtasks: () => db.select('subtasks'),
    addSubtask: (row) => db.insert('subtasks', row),
    updateSubtask: (id, patch) => db.update('subtasks', id, patch),
    removeSubtask: (id) => db.remove('subtasks', id),
  };

  const calendar = {
    ...table('calendar_events'),
    // events overlapping [fromIso, toIso)
    async between(fromIso, toIso) {
      const all = await db.select('calendar_events', { order: [{ col: 'starts_at' }] });
      return all.filter(e => e.ends_at >= fromIso && e.starts_at < toIso);
    },
  };

  const activity = {
    // activity_records is append-only and server-written: no create/update/remove here, by design
    recent: (limit = 20) => db.select('activity_records', { order: [{ col: 'created_at', asc: false }], limit }),
  };

  const contacts = {
    ...table('contacts'),
    list: (q = {}) => db.select('contacts', { order: [{ col: 'first_name' }, { col: 'last_name' }], ...q }),
    // project_contacts has a composite key (business_id, project_id, contact_id)
    links: (q = {}) => db.select('project_contacts', { order: [{ col: 'created_at' }], ...q }),
    link: (projectId, contactId, role = null) => db.insert('project_contacts', { project_id: projectId, contact_id: contactId, relationship_role: role }),
    setRole: (projectId, contactId, role) => db.updateWhere('project_contacts', { project_id: projectId, contact_id: contactId }, { relationship_role: role }),
    unlink: (projectId, contactId) => db.removeWhere('project_contacts', { project_id: projectId, contact_id: contactId }),
  };

  const decisions = {
    ...table('decisions'),
    list: (q = {}) => db.select('decisions', { order: [{ col: 'decision_date', asc: false }, { col: 'created_at', asc: false }], ...q }),
    options: (decisionId) => db.select('decision_options', { eq: { decision_id: decisionId }, order: [{ col: 'sort_order' }, { col: 'created_at' }] }),
    allOptions: () => db.select('decision_options'),
    addOption: (row) => db.insert('decision_options', row),
    updateOption: (id, patch) => db.update('decision_options', id, patch),
    removeOption: (id) => db.remove('decision_options', id),
    // Supersede: record the replacement, then point the old decision at it and mark it Superseded.
    // The old decision's outcome, options and rationale are left untouched (history is preserved).
    // NOT ATOMIC: two writes. Gate 1 has no RPC for this; when one is added, only this method changes.
    // replacement: decision columns; outcome: the chosen option's title (required); alternatives: other option titles.
    // Writes, in order: new decision (Proposed) -> its options -> new decision Approved with the chosen option -> old
    // decision Superseded and pointing at the new one.
    async supersede(oldId, replacement, { outcome, alternatives = [] } = {}) {
      const old = await db.get('decisions', oldId);
      if (!old) throw new DataError('P0002', 'decision not found');
      if (old.status !== 'Approved' && old.status !== 'Rejected') throw new DataError('23514', 'only a decided (Approved or Rejected) decision can be superseded');
      if (!outcome || !String(outcome).trim()) throw new DataError('23502', 'the new outcome is required', { column: 'outcome' });
      const created = await db.insert('decisions', { project_id: old.project_id, contact_id: old.contact_id, ...replacement, status: 'Proposed' });
      const chosen = await db.insert('decision_options', { decision_id: created.id, title: outcome, sort_order: 0 });
      for (const [i, t] of alternatives.filter(x => String(x).trim()).entries()) await db.insert('decision_options', { decision_id: created.id, title: t, sort_order: i + 1 });
      const approved = await db.update('decisions', created.id, { status: 'Approved', selected_option_id: chosen.id });
      const updated = await db.update('decisions', oldId, { status: 'Superseded', superseded_by_id: created.id });
      return { created: approved, updated };
    },
    // Record the outcome of a Proposed decision: Approved with a chosen option, or Rejected.
    async decide(id, { status, selected_option_id = null, rationale, decision_date }) {
      const d = await db.get('decisions', id);
      if (!d || d.status !== 'Proposed') throw new DataError('23514', 'only a Proposed decision can be decided');
      if (status !== 'Approved' && status !== 'Rejected') throw new DataError('23514', 'outcome must be Approved or Rejected');
      if (!rationale || !rationale.trim()) throw new DataError('23502', 'a rationale is required', { column: 'rationale' });
      return db.update('decisions', id, { status, selected_option_id: status === 'Approved' ? selected_option_id : null, rationale, ...(decision_date ? { decision_date } : {}) });
    },
    // The chain of decisions this one replaced, newest first ([] if none)
    async history(decisionId) {
      const all = await db.select('decisions');
      const chain = []; let cur = decisionId; const seen = new Set();
      for (;;) { const prev = all.find(d => d.superseded_by_id === cur); if (!prev || seen.has(prev.id)) break; seen.add(prev.id); chain.push(prev); cur = prev.id; }
      return chain;
    },
  };

  return { workspace, projects, milestones, tasks, calendar, activity, contacts, decisions };
}
