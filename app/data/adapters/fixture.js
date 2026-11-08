// DEVELOPMENT ADAPTER. In-memory tables seeded with fictional fixtures, persisted to browser storage.
// It is NOT a backend and does not stand in for one: it exists so screens are built against the real data contract
// before the Supabase adapter is authorised. It emulates, per data/schema.js:
//   column privileges (insert/update grants), row-level business scoping (RLS USING / WITH CHECK),
//   NOT NULL, CHECK (enum, length, pattern, range, table checks), FKs with cascade / set null,
//   BEFORE triggers (updated_at, task completion sync) and AFTER record_activity() (append-only activity_records).
// Errors carry the Postgres SQLSTATE so the future Supabase adapter can surface identical codes to screens.
import { TABLES, SQLSTATE } from '../schema.js';

export class DataError extends Error {
  constructor(code, message, details) { super(message); this.name = 'DataError'; this.code = code; this.details = details; }
}

const clone = v => (v === undefined ? v : structuredClone(v));
const initcap = s => s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

export function createFixtureAdapter({ seed, session, storage = null, storageKey = 'meridian.dev.v1', now = () => new Date(), uuid = () => crypto.randomUUID() }) {
  const VERSION = 2; // bump when fixtures change shape: older browser snapshots are reseeded
  let db;
  const listeners = new Set();

  const load = () => {
    if (storage) {
      try {
        const saved = JSON.parse(storage.getItem(storageKey) || 'null');
        if (saved && saved.version === VERSION && saved.business_id === session.business_id) return saved.tables;
      } catch { /* unreadable snapshot: reseed */ }
    }
    return seed();
  };
  const save = () => {
    if (!storage) return;
    try { storage.setItem(storageKey, JSON.stringify({ version: VERSION, business_id: session.business_id, saved_at: now().toISOString(), tables: db })); }
    catch (e) { console.warn('[dev adapter] could not persist development data', e); }
  };
  db = load();
  for (const t of Object.keys(TABLES)) db[t] ||= [];

  const spec = table => {
    const s = TABLES[table];
    if (!s) throw new DataError('42P01', `relation "public.${table}" does not exist`);
    return s;
  };
  const rows = table => db[table];
  const visible = (table, r) => r.business_id === session.business_id || (table === 'businesses' && r.id === session.business_id);
  const emit = change => { for (const fn of listeners) { try { fn(change); } catch (e) { console.error(e); } } };

  function checkColumn(table, col, c, v) {
    if (v === null || v === undefined) {
      if (c.notNull) throw new DataError(SQLSTATE.notNull, `null value in column "${col}" of relation "${table}" violates not-null constraint`, { column: col });
      return;
    }
    const fail = why => { throw new DataError(SQLSTATE.check, `new row for relation "${table}" violates check constraint on "${col}"${why ? ` (${why})` : ''}`, { column: col }); };
    if (c.enum && !c.enum.includes(v)) fail(`must be one of ${c.enum.join(', ')}`);
    if (c.len) { const n = String(v).trim().length; if (n < c.len[0] || n > c.len[1]) fail(`length ${c.len[0]}–${c.len[1]}`); }
    if (c.rawLen) { const n = String(v).length; if (n < c.rawLen[0] || n > c.rawLen[1]) fail(`length ${c.rawLen[0]}–${c.rawLen[1]}`); }
    if (c.pattern && !c.pattern.test(String(v))) fail('format');
    if (c.between && (Number(v) < c.between[0] || Number(v) > c.between[1] || !Number.isInteger(Number(v)))) fail(`${c.between[0]}–${c.between[1]}`);
    if (c.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new DataError('22007', `invalid input syntax for type date: "${v}"`, { column: col });
    if (c.type === 'timestamptz' && Number.isNaN(Date.parse(v))) throw new DataError('22007', `invalid input syntax for type timestamp with time zone: "${v}"`, { column: col });
    if (c.type === 'bool' && typeof v !== 'boolean') fail('boolean');
  }

  function validate(table, row) {
    const s = spec(table);
    for (const [col, c] of Object.entries(s.columns)) checkColumn(table, col, c, row[col]);
    for (const fk of s.fks || []) {
      const v = row[fk.col];
      // composite FKs: the parent must be in the same business, and match any extra column pairs (fk.match: refCol -> ownCol)
      if (v != null && !rows(fk.ref).some(r => r.id === v && r.business_id === row.business_id && Object.entries(fk.match || {}).every(([rc, oc]) => r[rc] === row[oc]))) {
        throw new DataError(SQLSTATE.fk, `insert or update on table "${table}" violates foreign key constraint on "${fk.col}"`, { column: fk.col });
      }
    }
    for (const chk of s.checks || []) {
      const res = chk(row);
      if (res !== true) throw new DataError(SQLSTATE.check, `new row for relation "${table}" violates check constraint "${res}"`, { constraint: res });
    }
  }

  function applyDefaults(table, row) {
    for (const [col, c] of Object.entries(spec(table).columns)) {
      if (row[col] !== undefined) continue;
      if (c.default === 'uuid') row[col] = uuid();
      else if (c.default === 'now') row[col] = now().toISOString();
      else if (c.default === 'today') row[col] = now().toISOString().slice(0, 10);
      else if (typeof c.default === 'function') row[col] = c.default();
      else if (c.default !== undefined) row[col] = c.default;
      else row[col] = null;
    }
  }

  // BEFORE triggers
  function beforeWrite(table, row, op, changedCols) {
    const s = spec(table);
    if (s.sync === 'taskCompletion' && (op === 'insert' || changedCols.includes('status'))) {
      if (row.status === 'Done' && row.completed_at == null) row.completed_at = now().toISOString();
      else if (row.status !== 'Done') row.completed_at = null;
    }
    if (op === 'update' && 'updated_at' in s.columns) row.updated_at = now().toISOString();
  }

  // AFTER record_activity(): event 'table.op', summary 'Table op: label', metadata { status }
  function recordActivity(table, op, row) {
    if (!spec(table).activity) return;
    const label = row.name ?? row.title ?? row.funder_name ?? row.description ?? row.filename ?? '';
    const act = {
      id: uuid(), business_id: row.business_id, actor_type: 'user', actor_id: session.profile_id,
      event_type: `${table}.${op}`, entity_table: table, entity_id: row.id,
      summary: `${initcap(table)} ${op}${label ? ': ' + label : ''}`.slice(0, 500),
      metadata: row.status ? { status: row.status } : {}, created_at: now().toISOString(),
    };
    rows('activity_records').push(act);
    emit({ table: 'activity_records', op: 'insert', row: clone(act) });
  }

  function cascadeDelete(table, deleted) {
    for (const [childTable, child] of Object.entries(TABLES)) {
      for (const fk of child.fks || []) {
        if (fk.ref !== table) continue;
        for (const r of [...rows(childTable)]) {
          if (r[fk.col] !== deleted.id || r.business_id !== deleted.business_id) continue;
          if (fk.onDelete === 'cascade') deleteRow(childTable, r);
          else { r[fk.col] = null; if ('updated_at' in child.columns) r.updated_at = now().toISOString(); emit({ table: childTable, op: 'update', row: clone(r) }); }
        }
      }
    }
  }
  function deleteRow(table, r) {
    db[table] = rows(table).filter(x => x !== r);
    cascadeDelete(table, r);
    recordActivity(table, 'delete', r);
    emit({ table, op: 'delete', row: clone(r) });
  }

  function matches(r, { eq = {}, in: inF = {}, is = {} }) {
    for (const [k, v] of Object.entries(eq)) if (r[k] !== v) return false;
    for (const [k, vs] of Object.entries(inF)) if (!vs.includes(r[k])) return false;
    for (const [k, v] of Object.entries(is)) if ((r[k] ?? null) !== v) return false;
    return true;
  }
  function sortRows(list, order = []) {
    if (!order.length) return list;
    return list.sort((a, b) => {
      for (const { col, asc = true, nullsLast = true } of order) {
        const x = a[col], y = b[col];
        if (x === y) continue;
        if (x == null) return nullsLast ? 1 : -1;
        if (y == null) return nullsLast ? -1 : 1;
        return (x < y ? -1 : 1) * (asc ? 1 : -1);
      }
      return 0;
    });
  }

  const adapter = {
    kind: 'development',
    label: 'Development data (fictional)',

    async select(table, query = {}) {
      spec(table);
      const out = sortRows(rows(table).filter(r => visible(table, r) && matches(r, query)), query.order);
      return clone(query.limit ? out.slice(0, query.limit) : out);
    },

    async get(table, id) {
      spec(table);
      return clone(rows(table).find(r => r.id === id && visible(table, r)) ?? null);
    },

    async insert(table, input) {
      const s = spec(table);
      if (s.insert === false) throw new DataError(SQLSTATE.privilege, `permission denied for table ${table}`);
      for (const col of Object.keys(input)) {
        if (!(col in s.columns)) throw new DataError('42703', `column "${col}" of relation "${table}" does not exist`, { column: col });
        if (Array.isArray(s.insert) && !s.insert.includes(col)) throw new DataError(SQLSTATE.privilege, `permission denied for table ${table}`, { column: col });
      }
      const row = { ...clone(input), business_id: input.business_id ?? session.business_id };
      if (row.business_id !== session.business_id) throw new DataError(SQLSTATE.privilege, `new row violates row-level security policy for table "${table}"`);
      applyDefaults(table, row);
      const pk = s.pk || ['id'];
      if (rows(table).some(r => pk.every(c => r[c] === row[c]))) throw new DataError(SQLSTATE.unique, `duplicate key value violates unique constraint "${table}_pkey"`);
      beforeWrite(table, row, 'insert', Object.keys(input));
      validate(table, row);
      rows(table).push(row);
      recordActivity(table, 'insert', row);
      save();
      emit({ table, op: 'insert', row: clone(row) });
      return clone(row);
    },

    async update(table, id, patch) {
      const s = spec(table);
      for (const col of Object.keys(patch)) {
        if (!(col in s.columns)) throw new DataError('42703', `column "${col}" of relation "${table}" does not exist`, { column: col });
        if (!s.update || !s.update.includes(col)) throw new DataError(SQLSTATE.privilege, `permission denied for table ${table}`, { column: col });
      }
      const current = rows(table).find(r => r.id === id && visible(table, r));
      if (!current) return null; // RLS USING: an invisible row updates zero rows, as PostgREST reports
      const next = { ...clone(current), ...clone(patch) };
      beforeWrite(table, next, 'update', Object.keys(patch));
      validate(table, next);
      Object.assign(current, next);
      recordActivity(table, 'update', current);
      save();
      emit({ table, op: 'update', row: clone(current) });
      return clone(current);
    },

    async remove(table, id) {
      const s = spec(table);
      if (!s.delete) throw new DataError(SQLSTATE.privilege, `permission denied for table ${table}`);
      const current = rows(table).find(r => r.id === id && visible(table, r));
      if (!current) return false;
      deleteRow(table, current);
      save();
      return true;
    },

    // filtered writes, as PostgREST does with ?col=eq.value (needed for composite-key tables such as project_contacts)
    async updateWhere(table, eq, patch) {
      const s = spec(table);
      for (const col of Object.keys(patch)) if (!s.update || !s.update.includes(col)) throw new DataError(SQLSTATE.privilege, `permission denied for table ${table}`, { column: col });
      const hits = rows(table).filter(r => visible(table, r) && matches(r, { eq }));
      for (const r of hits) {
        const next = { ...clone(r), ...clone(patch) };
        beforeWrite(table, next, 'update', Object.keys(patch)); validate(table, next); Object.assign(r, next);
        recordActivity(table, 'update', r); emit({ table, op: 'update', row: clone(r) });
      }
      if (hits.length) save();
      return clone(hits);
    },
    async removeWhere(table, eq) {
      if (!spec(table).delete) throw new DataError(SQLSTATE.privilege, `permission denied for table ${table}`);
      const hits = rows(table).filter(r => visible(table, r) && matches(r, { eq }));
      for (const r of hits) deleteRow(table, r);
      if (hits.length) save();
      return hits.length;
    },

    async rpc(name) {
      if (name === 'get_current_business_id') return session.business_id;
      throw new DataError('42883', `function public.${name} is not available in the development adapter`);
    },

    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    // development-only controls (not part of the data contract)
    dev: {
      reset() { db = seed(); for (const t of Object.keys(TABLES)) db[t] ||= []; save(); emit({ table: '*', op: 'reset' }); },
      snapshotSavedAt() { try { return JSON.parse(storage?.getItem(storageKey) || 'null')?.saved_at ?? null; } catch { return null; } },
    },
  };
  return adapter;
}
