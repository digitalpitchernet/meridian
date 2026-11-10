// FICTIONAL Company Vault metadata for Kestrel Ridge Studio. These rows describe documents that do NOT exist:
// no file bytes are stored anywhere in the development build, so every checksum below is the SHA-256 of a
// "fictional:" label, not of a real file. The Vault screen says so on every document.
import { TABLES } from '../schema.js';
import { sha256 } from '../sha256.js';
import { LINK_TARGETS } from '../schema-vault.js';

const full = (table, partial) => Object.fromEntries(Object.keys(TABLES[table].columns).map(c => [c, c in partial ? partial[c] : null]));

export function buildVaultFixtures({ B, ts, fid, profile, refs }) {
  const V = n => fid('v', n), L = n => fid('v', 200 + n);
  // [n, day, title, category, filename, mime, size, version, previous, archived]
  const docs = [
    [1, -110, 'Certificate of incorporation', 'Legal', 'certificate-of-incorporation.pdf', 'application/pdf', 182344, 1, null, false],
    [2, -108, 'Founders’ agreement', 'Legal', 'founders-agreement-signed.pdf', 'application/pdf', 412880, 1, null, false],
    [3, -40, 'Founders’ agreement', 'Legal', 'founders-agreement-amended.pdf', 'application/pdf', 436120, 2, 2, false],
    [4, -44, 'Seed pitch deck', 'Marketing', 'kestrel-seed-deck-v1.pdf', 'application/pdf', 3820112, 1, null, false],
    [5, -30, 'Seed pitch deck', 'Marketing', 'kestrel-seed-deck-v2.pdf', 'application/pdf', 4011876, 2, 4, false],
    [6, -9, 'Seed pitch deck', 'Marketing', 'kestrel-seed-deck-v3.pdf', 'application/pdf', 4103550, 3, 5, false],
    [7, -19, 'Lumen Angels term sheet', 'Legal', 'lumen-angels-term-sheet.pdf', 'application/pdf', 221004, 1, null, false],
    [8, -41, 'Regional innovation grant sanction letter', 'Financial', 'grant-sanction-letter.pdf', 'application/pdf', 98112, 1, null, false],
    [9, -50, 'Invoice INV-2026-011, Halden Foods', 'Financial', 'INV-2026-011.pdf', 'application/pdf', 64220, 1, null, false],
    [10, -89, 'Studio lease agreement', 'Administrative', 'studio-lease-agreement.pdf', 'application/pdf', 1288400, 1, null, false],
    [11, -36, 'Illustrator contract, brand system', 'Administrative', 'illustrator-contract.pdf', 'application/pdf', 154330, 1, null, false],
    [12, -24, 'Beta architecture notes', 'Technical', 'beta-architecture.md', 'text/markdown', 18842, 1, null, false],
    [13, -100, 'Studio landing page brief', 'Marketing', 'landing-page-brief.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 40960, 1, null, true],
    [14, -60, 'Hosting quote, previous vendor', 'Administrative', 'hosting-quote-old-vendor.pdf', 'application/pdf', 77310, 1, null, true],
  ];
  const documents = docs.map(([n, day, title, category, filename, mime, size, version, prev, archived]) => full('documents', {
    id: V(n), business_id: B, title, category, storage_provider: 'supabase_storage', storage_key: `${B}/documents/${V(n)}/${filename}`,
    original_filename: filename, mime_type: mime, size_bytes: size, sha256: sha256(`fictional:${filename}`), version_number: version,
    previous_version_id: prev ? V(prev) : null, is_archived: archived, uploaded_by: profile, created_at: ts(day, 12), updated_at: ts(archived ? -5 : day, 12),
  }));

  // [n, document, target column, target id]
  const links = [
    [1, 1, 'project_id', refs.P(5)], [2, 1, 'milestone_id', refs.M(7)], [3, 3, 'project_id', refs.P(5)],
    [4, 6, 'project_id', refs.P(2)], [5, 6, 'requirement_id', refs.H(1)], [6, 6, 'contact_id', refs.C(3)], [7, 5, 'milestone_id', refs.M(4)],
    [8, 7, 'commitment_id', refs.H(14)], [9, 7, 'contact_id', refs.C(3)],
    [10, 8, 'transaction_id', refs.X(13)], [11, 8, 'commitment_id', refs.H(13)],
    [12, 9, 'transaction_id', refs.X(11)], [13, 9, 'contact_id', refs.C(2)],
    [14, 10, 'transaction_id', refs.X(4)], [15, 11, 'transaction_id', refs.X(14)], [16, 11, 'project_id', refs.P(3)],
    [17, 12, 'project_id', refs.P(1)], [18, 12, 'task_id', refs.T(1)], [19, 13, 'project_id', refs.P(6)], [20, 14, 'decision_id', refs.D(1)],
  ];
  const document_links = links.map(([n, doc, col, target]) => full('document_links', {
    id: L(n), business_id: B, document_id: V(doc), ...Object.fromEntries(LINK_TARGETS.map(c => [c, c === col ? target : null])), created_at: ts(-20, 13),
  }));

  return { documents, document_links, integration_connections: [] };
}
