// M4.2 Company Vault: archive-only documents, version chains, entity links (migration 6), metadata-only development data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixtureAdapter, DataError } from '../../app/data/adapters/fixture.js';
import { buildFixtures, DEV_BUSINESS_ID, DEV_PROFILE_ID } from '../../app/data/fixtures/dev-fixtures.js';
import { createRepositories } from '../../app/data/repositories.js';
import { LINK_TARGETS } from '../../app/data/schema-vault.js';
import { vaultRows, linkTarget, docMatches } from '../../app/modules/vault-model.js';

const TODAY = '2026-11-08';
const make = () => {
  let clock = new Date('2026-11-08T06:00:00Z');
  const db = createFixtureAdapter({ seed: () => buildFixtures(TODAY), session: { business_id: DEV_BUSINESS_ID, profile_id: DEV_PROFILE_ID }, now: () => (clock = new Date(clock.getTime() + 1000)) });
  return { db, repo: createRepositories(db) };
};
const code = async (p, c) => { await assert.rejects(p, e => e instanceof DataError && e.code === c, `expected SQLSTATE ${c}`); };
const meta = (name = 'board-minutes.pdf') => ({ title: 'Board minutes', category: 'Legal', original_filename: name, mime_type: 'application/pdf', size_bytes: 1200, sha256: 'ab'.repeat(32) });

test('vault: the development build stores no file bytes, and says so', async () => {
  const { repo } = make();
  assert.equal(repo.documents.filesStored, false);
  for (const d of await repo.documents.list()) assert.ok(d.storage_key.startsWith(`${DEV_BUSINESS_ID}/`), 'keys stay inside the business folder');
});

test('vault: archive-only. No delete for anyone; archive and restore are the only status changes', async () => {
  const { repo, db } = make();
  const [doc] = await repo.documents.list({ eq: { is_archived: false } });
  assert.equal(repo.documents.remove, undefined, 'no delete operation is exposed');
  await code(db.remove('documents', doc.id), '42501');
  const links = await repo.documentLinks.forDocument(doc.id);
  assert.equal((await repo.documents.archive(doc.id)).is_archived, true);
  assert.equal((await repo.documentLinks.forDocument(doc.id)).length, links.length, 'archiving keeps every link');
  assert.equal((await repo.documents.restore(doc.id)).is_archived, false);
});

test('vault: only title, category and is_archived are client-writable; file metadata is fixed (42501)', async () => {
  const { repo } = make();
  const [doc] = await repo.documents.list();
  for (const patch of [{ storage_key: `${DEV_BUSINESS_ID}/x` }, { sha256: 'cd'.repeat(32) }, { size_bytes: 1 }, { version_number: 9 }, { previous_version_id: null }, { uploaded_by: null }, { mime_type: 'text/plain' }]) {
    await code(repo.documents.update(doc.id, patch), '42501');
  }
  const u = await repo.documents.update(doc.id, { title: 'Renamed', category: 'Other' });
  assert.equal(`${u.title}/${u.category}`, 'Renamed/Other');
  await code(repo.documents.update(doc.id, { category: 'Secret' }), '23514');
});

test('vault: recording metadata enforces the migration CHECKs and defaults uploaded_by to the caller', async () => {
  const { repo, db } = make();
  const d = await repo.documents.record(meta());
  assert.equal(`${d.version_number}/${d.uploaded_by}/${d.is_archived}/${d.storage_provider}`, `1/${DEV_PROFILE_ID}/false/supabase_storage`);
  await code(repo.documents.record({ ...meta(), sha256: 'not-a-hash' }), '23514');
  await code(repo.documents.record({ ...meta(), size_bytes: 52428801 }), '23514'); // 50 MB bucket limit
  await code(db.insert('documents', { ...meta(), storage_provider: 'supabase_storage', storage_key: 'another-business/x.pdf' }), '23514'); // chk_documents_key_scope
  await code(db.insert('documents', { ...meta(), storage_provider: 'supabase_storage', storage_key: d.storage_key }), '23505'); // uq_documents_object
  await code(db.insert('documents', { ...meta(), storage_provider: 'supabase_storage', storage_key: `${DEV_BUSINESS_ID}/y`, uploaded_by: DEV_PROFILE_ID }), '42501'); // not insert-granted
  assert.deepEqual((await db.select('activity_records', { eq: { entity_id: d.id } })).map(a => a.event_type), ['documents.insert']); // INSERT only
  await repo.documents.archive(d.id);
  assert.equal((await db.select('activity_records', { eq: { entity_id: d.id } })).length, 1);
});

test('vault: versions chain through previous_version_id; only the latest takes a new version', async () => {
  const { repo } = make();
  const deck = (await repo.documents.list()).find(d => d.title === 'Seed pitch deck' && d.version_number === 3);
  const chain = await repo.documents.versions(deck.id);
  assert.deepEqual(chain.map(d => d.version_number), [3, 2, 1]);
  assert.deepEqual((await repo.documents.versions(chain[2].id)).map(d => d.id), chain.map(d => d.id), 'any version finds the whole chain');
  await code(repo.documents.newVersion(chain[1].id, meta('deck-branch.pdf')), '23514');
  const { title, category, ...file } = meta('kestrel-seed-deck-v4.pdf');
  const v4 = await repo.documents.newVersion(deck.id, file);
  assert.equal(`${v4.version_number}/${v4.previous_version_id}/${v4.title}/${v4.category}`, `4/${deck.id}/Seed pitch deck/Marketing`, 'title and category carry over');
  const rows = vaultRows(await repo.documents.list(), await repo.documentLinks.list());
  const latest = rows.filter(r => r.chain.some(d => d.id === deck.id));
  assert.equal(latest.length, 1, 'the directory lists a chain once, at its latest version');
  assert.equal(`${latest[0].doc.id}/${latest[0].chain.length}`, `${v4.id}/4`);
});

test('vault: links target exactly one supported record, once; unlinking leaves the document', async () => {
  const { repo, db } = make();
  const doc = await repo.documents.record(meta());
  const [project] = await db.select('projects');
  const [contact] = await db.select('contacts');
  const [tx] = await db.select('transactions');
  const l1 = await repo.documentLinks.link(doc.id, 'project_id', project.id);
  await repo.documentLinks.link(doc.id, 'contact_id', contact.id);
  await repo.documentLinks.link(doc.id, 'transaction_id', tx.id);
  await code(repo.documentLinks.link(doc.id, 'project_id', project.id), '23505'); // same record twice
  await code(db.insert('document_links', { document_id: doc.id }), '23514'); // no target
  await code(db.insert('document_links', { document_id: doc.id, project_id: project.id, contact_id: contact.id }), '23514'); // two targets
  await code(repo.documentLinks.link(doc.id, 'project_id', '00000000-0000-4000-8000-0000000000ee'), '23503'); // unknown record
  await code(db.update('document_links', l1.id, { project_id: null }), '42501'); // links are never edited, only removed
  assert.equal(await repo.documentLinks.unlink(l1.id), true);
  assert.ok(await repo.documents.get(doc.id));
  assert.equal((await repo.documentLinks.forDocument(doc.id)).length, 2);
  assert.equal(LINK_TARGETS.length, 8);
});

test('vault: deleting a linked project removes only the link (ON DELETE CASCADE); the document survives', async () => {
  const { repo, db } = make();
  const doc = await repo.documents.record(meta());
  const p = await db.insert('projects', { name: 'Temp project' });
  await repo.documentLinks.link(doc.id, 'project_id', p.id);
  await db.remove('projects', p.id);
  assert.equal((await repo.documentLinks.forDocument(doc.id)).length, 0);
  assert.ok(await repo.documents.get(doc.id));
});

test('vault-model: directory folds version chains; link targets and search', async () => {
  const { repo } = make();
  const [docs, links] = await Promise.all([repo.documents.list(), repo.documentLinks.list()]);
  const rows = vaultRows(docs, links);
  assert.equal(rows.length, docs.length - 3, 'two older deck versions and one older agreement version are folded into their chains');
  const term = rows.find(r => r.doc.title === 'Lumen Angels term sheet');
  assert.deepEqual(term.links.map(l => linkTarget(l).column).sort(), ['commitment_id', 'contact_id']);
  const deck = rows.find(r => r.doc.title === 'Seed pitch deck');
  assert.equal(deck.links.length, 4, 'links on every version of a chain show on the chain');
  assert.ok(docMatches(term.doc, 'lumen'));
  assert.ok(docMatches(term.doc, 'TERM-SHEET.pdf'));
  assert.ok(!docMatches(term.doc, 'invoice'));
});
