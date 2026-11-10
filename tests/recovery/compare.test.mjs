// Self-test for compare.mjs: node tests/recovery/compare.test.mjs
import assert from 'node:assert/strict';
import { diff, classify, area } from './compare.mjs';

const obj = (over = {}) => ({ id: 'o1', owner: null, owner_id: null, created_at: 't0', updated_at: 't0', last_accessed_at: 't0', version: 'v1',
  metadata: { size: 65536, mimetype: 'application/octet-stream', eTag: '"abc"', cacheControl: 'no-cache', lastModified: 't0' }, ...over });
const fp = (objects, extra = {}) => ({ migrations: ['1', '2'], tables: { transactions: { rows: 3, md5: 'x' } },
  storage_objects: { rows: Object.keys(objects).length, objects }, finance: { b: { available_cash: '1500.00' } }, ...extra });
const S = 'company-vault/biz/recovery/sentinel.bin', M = 'company-vault/not-a-uuid/x.pdf';
const re = new Set([S]);

// 1. identical fingerprints: no differences
assert.deepEqual(diff(fp({ [S]: obj(), [M]: obj({ id: 'o2' }) }), fp({ [S]: obj(), [M]: obj({ id: 'o2' }) })), []);

// 2. the four re-upload fields on a re-uploaded object are platform_generated, each with a reason
{
  const t = obj({ updated_at: 't1', last_accessed_at: 't1', version: 'v2', metadata: { ...obj().metadata, lastModified: 't1' } });
  const c = classify(diff(fp({ [S]: obj() }), fp({ [S]: t })), re);
  assert.equal(c.length, 4);
  assert.ok(c.every(d => d.class === 'platform_generated' && d.reason));
  assert.ok(c.some(d => d.path === `storage_objects > objects > ${S} > metadata > lastModified`));
}

// 3. the same field on an object R-06 did NOT re-upload is unexpected
assert.equal(classify(diff(fp({ [M]: obj() }), fp({ [M]: obj({ updated_at: 't1' }) })), re)[0].class, 'unexpected');

// 4. id, owner_id, size, mimetype, eTag, cacheControl changes are unexpected even on a re-uploaded object
for (const t of [obj({ id: 'new' }), obj({ owner_id: 'u' }), obj({ metadata: { ...obj().metadata, size: 1 } }),
  obj({ metadata: { ...obj().metadata, mimetype: 'text/plain' } }), obj({ metadata: { ...obj().metadata, eTag: '"zzz"' } }),
  obj({ metadata: { ...obj().metadata, cacheControl: 'no-store' } })]) {
  const c = classify(diff(fp({ [S]: obj() }), fp({ [S]: t })), re);
  assert.equal(c.length, 1); assert.equal(c[0].class, 'unexpected', JSON.stringify(c));
}

// 5. a missing or extra object is unexpected
assert.equal(classify(diff(fp({ [S]: obj() }), fp({})), re)[0].class, 'unexpected');

// 6. money compared as text: '1500.00' vs '1500.0' is a difference; non-storage areas are always unexpected
{
  const c = classify(diff(fp({}), fp({}, { finance: { b: { available_cash: '1500.0' } } })), re);
  assert.equal(c.length, 1); assert.equal(c[0].class, 'unexpected'); assert.equal(area(c[0]), 'finance');
}
assert.equal(classify(diff(fp({}), fp({}, { tables: { transactions: { rows: 3, md5: 'y' } } })), re)[0].class, 'unexpected');

// 7. metadata null on one side (object never had bytes) is unexpected, not a re-upload field
assert.equal(classify(diff(fp({ [S]: obj({ metadata: null }) }), fp({ [S]: obj() })), re)[0].class, 'unexpected');

console.log('compare.mjs: all assertions passed');
