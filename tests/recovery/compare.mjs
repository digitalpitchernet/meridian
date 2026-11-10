// Compare two reconcile.sql fingerprints (source, target). Every difference is returned and classified;
// nothing is dropped. Used by drill.mjs; self-test: node tests/recovery/compare.test.mjs
//
//   exact               no difference at all
//   platform_generated  a field the Storage API rewrites when R-06 re-uploads an object's bytes, on an object
//                       R-06 actually re-uploaded. Recorded in the evidence with its reason; does not fail the drill.
//   unexpected          anything else. Fails the drill.

// The only fields allowed to differ, and only on objects R-06 re-uploaded. Anything not listed (id, owner, owner_id,
// created_at, metadata.size, metadata.mimetype, metadata.eTag, metadata.cacheControl, user_metadata, ...) must be exact.
export const STORAGE_REUPLOAD_FIELDS = {
  updated_at: 'set to the time of the R-06 upload',
  last_accessed_at: 'set by Storage when R-06 writes and reads the object back',
  version: 'Storage assigns a new version id to every upload',
  'metadata.lastModified': 'object-store timestamp of the R-06 upload',
};

export function diff(source, target) {
  const out = [];
  (function walk(x, y, path) {
    const obj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
    if (obj(x) && obj(y)) {
      for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) walk(x[k], y[k], [...path, k]);
    } else if (JSON.stringify(x) !== JSON.stringify(y)) {
      out.push({ path, source: x, target: y });
    }
  })(source, target, []);
  return out;
}

// reuploaded: Set of 'bucket/name' keys that R-06 copied bytes for
export function classify(diffs, reuploaded) {
  return diffs.map(d => {
    const [top, sub, key, ...field] = d.path;
    const reason = top === 'storage_objects' && sub === 'objects' && reuploaded.has(key) && field.length
      ? STORAGE_REUPLOAD_FIELDS[field.join('.')] : undefined;
    // path segments are joined with ' > ' because object names contain '/' and '.'
    return { path: d.path.join(' > '), source: d.source, target: d.target, class: reason ? 'platform_generated' : 'unexpected', ...(reason ? { reason } : {}) };
  });
}

// area of a classified difference, for the per-step verdicts in drill.mjs
export const area = d => d.path.split(' > ')[0];
