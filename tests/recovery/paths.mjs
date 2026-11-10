// Storage API URL path for a bucket and object name: every segment percent-encoded, '/' separators kept.
// Refuses empty, '.' and '..' segments so a crafted name cannot change which object the URL addresses.
// Self-test: node tests/recovery/paths.test.mjs
export function storagePath(bucket, name) {
  const segs = [bucket, ...String(name).split('/')];
  for (const s of segs) if (s === '' || s === '.' || s === '..') throw new Error(`unsafe storage path segment in ${JSON.stringify(`${bucket}/${name}`)}`);
  return segs.map(encodeURIComponent).join('/');
}
