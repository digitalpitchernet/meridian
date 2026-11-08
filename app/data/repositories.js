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
    createParticipant: (row) => db.insert('participants', row),
    updateParticipant: (id, patch) => db.update('participants', id, patch),
    removeParticipant: (id) => db.remove('participants', id),
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

  // ---- M3: finance (migrations 3-5). Amounts are numeric text; derived figures come only from views and RPCs. ----
  const accounts = {
    list: () => db.select('financial_accounts', { order: [{ col: 'name' }] }),
    get: (id) => db.get('financial_accounts', id),
    create: (row) => db.insert('financial_accounts', row),
    update: (id, patch) => db.update('financial_accounts', id, patch), // name, institution, is_active, notes only
    balances: (asOf = null) => db.rpc('get_account_balances', { p_as_of: asOf }),
    availableCash: (asOf = null) => db.rpc('get_available_cash', { p_as_of: asOf }),
    categories: () => db.select('financial_categories', { order: [{ col: 'kind' }, { col: 'name' }] }),
    createCategory: (row) => db.insert('financial_categories', row),
    updateCategory: (id, patch) => db.update('financial_categories', id, patch),
    removeCategory: (id) => db.remove('financial_categories', id),
    recurring: () => db.select('recurring_transactions', { order: [{ col: 'next_due_date' }] }),
  };

  const transactions = {
    list: (q = {}) => db.select('transactions', { order: [{ col: 'transaction_date', asc: false }, { col: 'created_at', asc: false }], ...q }),
    get: (id) => db.get('transactions', id),
    // append-only: create, annotate (category, description, reference, notes) or reverse; never edit amounts or delete
    create: (row) => db.insert('transactions', row),
    annotate: (id, patch) => db.update('transactions', id, patch),
    reverse: (id, reason) => db.rpc('reverse_transaction', { p_transaction_id: id, p_reason: reason }),
    settlements: () => db.select('vw_settlement_status', { order: [{ col: 'transaction_date' }] }),
    contributions: () => db.select('vw_participant_contribution_summary', { order: [{ col: 'full_name' }] }),
  };

  const funding = {
    requirements: () => db.select('funding_requirements', { order: [{ col: 'needed_by' }, { col: 'created_at' }] }),
    requirementSummaries: () => db.select('vw_funding_requirement_summary'),
    getRequirement: (id) => db.get('funding_requirements', id),
    createRequirement: (row) => db.insert('funding_requirements', row),
    updateRequirement: (id, patch) => db.update('funding_requirements', id, patch),
    removeRequirement: (id) => db.remove('funding_requirements', id),
    commitments: (q = {}) => db.select('vw_funding_commitment_status', { order: [{ col: 'expected_payment_date' }], ...q }),
    commitmentRows: () => db.select('funding_commitments'),
    createCommitment: (row) => db.insert('funding_commitments', row),
    updateCommitment: (id, patch) => db.update('funding_commitments', id, patch),
    revokeCommitment: (id, reason) => db.rpc('revoke_funding_commitment', { p_commitment_id: id, p_reason: reason }),
    allocations: (q = {}) => db.select('payment_allocations', { order: [{ col: 'created_at' }], ...q }),
    allocate: (row) => db.insert('payment_allocations', row),
    reverseAllocation: (id, reason) => db.rpc('reverse_payment_allocation', { p_allocation_id: id, p_reason: reason }),
  };

  const capital = {
    structures: () => db.select('capital_structures', { order: [{ col: 'is_current', asc: false }, { col: 'effective_date', asc: false }] }),
    structureSummaries: () => db.select('vw_capital_structure_summary'),
    targets: () => db.select('capital_targets', { order: [{ col: 'target_date' }] }),
    targetSummaries: () => db.select('vw_capital_target_summary'),
    allocations: () => db.select('participant_capital_allocations', { order: [{ col: 'created_at' }] }),
    createStructure: (row) => db.insert('capital_structures', row),
    updateStructure: (id, patch) => db.update('capital_structures', id, patch),
    createTarget: (row) => db.insert('capital_targets', row),
    updateTarget: (id, patch) => db.update('capital_targets', id, patch),
    removeTarget: (id) => db.remove('capital_targets', id),
    createAllocation: (row) => db.insert('participant_capital_allocations', row),
    updateAllocation: (id, patch) => db.update('participant_capital_allocations', id, patch),
    removeAllocation: (id) => db.remove('participant_capital_allocations', id),
  };

  const imports = {
    batches: () => db.select('import_batches', { order: [{ col: 'created_at', asc: false }] }),
    get: (id) => db.get('import_batches', id),
    rows: (batchId) => db.select('import_batch_rows', { eq: { batch_id: batchId }, order: [{ col: 'row_index' }] }),
    // Stage = one batch insert, then one insert of all rows (a single PostgREST request with the Supabase adapter).
    // payloads: [{ date, amount, type, description }] exactly as read from the file; the server parses and validates.
    async stage({ account_id, filename, file_checksum_sha256 }, payloads) {
      const batch = await db.insert('import_batches', { account_id, filename, file_checksum_sha256 });
      for (const [i, payload] of payloads.entries()) await db.insert('import_batch_rows', { batch_id: batch.id, row_index: i, payload });
      return batch;
    },
    resolve: (rowId, resolution, replaceId = null) => db.update('import_batch_rows', rowId, { resolution, replace_transaction_id: resolution === 'replace' ? replaceId : null }),
    commit: (batchId) => db.rpc('commit_import_batch', { p_batch_id: batchId }),
    discard: (batchId) => db.remove('import_batches', batchId), // staged only; a committed batch is permanent (42501)
  };

  return { workspace, projects, milestones, tasks, calendar, activity, contacts, decisions, accounts, transactions, funding, capital, imports };
}
