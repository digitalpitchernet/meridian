// Pure Company Vault helpers: the directory shape (one row per version chain), link targets and search.
import { LINK_TARGETS } from '../data/schema-vault.js';

// what a document can link to, how it reads and where it goes (column -> label, route)
export const LINK_KINDS = {
  project_id: { label: 'Project', href: id => `#/projects/${id}` },
  milestone_id: { label: 'Milestone', href: id => `#/milestones/${id}` },
  task_id: { label: 'Task', href: id => `#/tasks/${id}` },
  decision_id: { label: 'Decision', href: id => `#/decisions/${id}` },
  contact_id: { label: 'Contact', href: id => `#/contacts/${id}` },
  transaction_id: { label: 'Transaction', href: id => `#/finances/transactions/${id}` },
  commitment_id: { label: 'Funding commitment', href: () => '#/finances/funding' },
  requirement_id: { label: 'Funding requirement', href: id => `#/finances/funding/${id}` },
};

export const linkTarget = l => { const column = LINK_TARGETS.find(c => l[c] != null); return { column, id: l[column] }; };

// One row per version chain, at its latest version. chain: newest first. links: every link on any version of the chain.
export function vaultRows(docs, links) {
  const next = new Map(docs.filter(d => d.previous_version_id).map(d => [d.previous_version_id, d]));
  const byId = new Map(docs.map(d => [d.id, d]));
  return docs.filter(d => !next.has(d.id)).map(latest => {
    const chain = []; let cur = latest; const seen = new Set();
    while (cur && !seen.has(cur.id)) { seen.add(cur.id); chain.push(cur); cur = byId.get(cur.previous_version_id); }
    const ids = new Set(chain.map(d => d.id));
    return { doc: latest, chain, links: links.filter(l => ids.has(l.document_id)) };
  });
}

export const docMatches = (d, q) => { const s = q.trim().toLowerCase(); return !s || `${d.title} ${d.original_filename} ${d.category}`.toLowerCase().includes(s); };

export function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const SORTS = {
  updated: { label: 'Recently changed', cmp: (a, b) => (a.doc.updated_at < b.doc.updated_at ? 1 : -1) },
  title: { label: 'Title', cmp: (a, b) => a.doc.title.localeCompare(b.doc.title) },
  created: { label: 'Recently added', cmp: (a, b) => (a.doc.created_at < b.doc.created_at ? 1 : -1) },
  size: { label: 'Largest', cmp: (a, b) => b.doc.size_bytes - a.doc.size_bytes },
};
