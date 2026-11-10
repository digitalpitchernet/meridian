// Self-test for paths.mjs: node tests/recovery/paths.test.mjs
import assert from 'node:assert/strict';
import { storagePath } from './paths.mjs';

const biz = 'bdf4f43c-47d8-4907-8b96-8d6698f46062';
// plain keys are unchanged; separators kept
assert.equal(storagePath('company-vault', `${biz}/recovery/sentinel-1.bin`), `company-vault/${biz}/recovery/sentinel-1.bin`);
// spaces
assert.equal(storagePath('company-vault', `${biz}/Board minutes Q1.pdf`), `company-vault/${biz}/Board%20minutes%20Q1.pdf`);
// Unicode (NFC é, Devanagari, emoji)
assert.equal(storagePath('company-vault', `${biz}/résumé.pdf`), `company-vault/${biz}/r%C3%A9sum%C3%A9.pdf`);
assert.equal(storagePath('company-vault', `${biz}/अनुबंध.pdf`), `company-vault/${biz}/${encodeURIComponent('अनुबंध')}.pdf`);
assert.equal(storagePath('company-vault', `${biz}/📄.pdf`), `company-vault/${biz}/%F0%9F%93%84.pdf`);
// reserved URL characters inside a segment are encoded, so they cannot become query, fragment or extra path
for (const [raw, enc] of [['a#b', 'a%23b'], ['a?b', 'a%3Fb'], ['100%', '100%25'], ['a&b=c', 'a%26b%3Dc'], ['a+b', 'a%2Bb'],
  ['a:b', 'a%3Ab'], ['a@b', 'a%40b'], ['a;b', 'a%3Bb'], ['a,b', 'a%2Cb'], ['a\\b', 'a%5Cb'], ['[x]', '%5Bx%5D']]) {
  assert.equal(storagePath('company-vault', `${biz}/${raw}`), `company-vault/${biz}/${enc}`, raw);
}
// an already-encoded-looking name is encoded again (it is a literal name, not an escape)
assert.equal(storagePath('company-vault', `${biz}/a%2Fb`), `company-vault/${biz}/a%252Fb`);
// the bucket is encoded too
assert.equal(storagePath('my bucket', 'x'), 'my%20bucket/x');
// round trip: decoding each segment gives back the original name
const name = `${biz}/dir with space/é#?%&+.pdf`;
assert.equal(storagePath('company-vault', name).split('/').slice(1).map(decodeURIComponent).join('/'), name);
// unsafe segments are refused
for (const bad of ['', '/x', 'x/', 'x//y', './x', 'x/../y', '..']) assert.throws(() => storagePath('company-vault', bad), /unsafe/, bad);
assert.throws(() => storagePath('', 'x'), /unsafe/);

console.log('paths.mjs: all assertions passed');
