/**
 * Regression tests for parseCloudinaryUrl.
 *
 * Each case below is a URL shape the previous regex (/\/v\d+\/(.+)\./)
 * mishandled, which is what made deletion unreliable.
 *
 * Run: node scripts/test-cloudinary-url.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The module uses the '@/' alias, so load it by path for a plain node run.
const source = readFileSync(new URL('../src/lib/cloudinaryUrl.js', import.meta.url), 'utf8');
const { parseCloudinaryUrl, normaliseEntry } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
);

const base = 'https://res.cloudinary.com/demo';

const cases = [
  ['plain image', `${base}/image/upload/v1712345678/abc123.jpg`, 'abc123', 'image'],
  ['inside a folder', `${base}/image/upload/v1712345678/syncnote/abc123.png`, 'syncnote/abc123', 'image'],
  ['no version segment', `${base}/image/upload/syncnote/abc123.png`, 'syncnote/abc123', 'image'],
  ['no file extension', `${base}/image/upload/v1712345678/abc123`, 'abc123', 'image'],
  ['transformation prefix', `${base}/image/upload/w_500,c_fill/v1712345678/abc123.jpg`, 'abc123', 'image'],
  ['chained transformations', `${base}/image/upload/w_500,c_fill/e_blur:100/v1712345678/abc123.jpg`, 'abc123', 'image'],
  ['percent-encoded name', `${base}/image/upload/v1712345678/my%20photo.jpg`, 'my photo', 'image'],
  ['dots in the public id', `${base}/image/upload/v1712345678/my.photo.v2.jpg`, 'my.photo.v2', 'image'],
  // Raw assets keep their extension as part of the public ID.
  ['raw pdf', `${base}/raw/upload/v1712345678/report.pdf`, 'report.pdf', 'raw'],
  ['raw in a folder', `${base}/raw/upload/v1712345678/docs/report.docx`, 'docs/report.docx', 'raw'],
  ['video', `${base}/video/upload/v1712345678/clip.mp4`, 'clip', 'video'],
  ['nested folders', `${base}/image/upload/v1712345678/a/b/c/photo.jpg`, 'a/b/c/photo', 'image'],
  ['authenticated delivery', `${base}/image/authenticated/v1712345678/secret.jpg`, 'secret', 'image'],
];

let failures = 0;

for (const [label, url, expectedId, expectedType] of cases) {
  const actual = parseCloudinaryUrl(url);
  try {
    assert.equal(actual?.publicId, expectedId, `publicId for "${label}"`);
    assert.equal(actual?.resourceType, expectedType, `resourceType for "${label}"`);
    console.log(`  ok   ${label.padEnd(24)} -> ${actual.publicId} (${actual.resourceType})`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${label.padEnd(24)} -> ${JSON.stringify(actual)}  ${error.message}`);
  }
}

// Non-Cloudinary and malformed input must be reported, not guessed at.
for (const [label, url] of [
  ['not a URL', 'nonsense'],
  ['non-Cloudinary URL', 'https://example.com/photo.jpg'],
  ['empty string', ''],
  ['null', null],
]) {
  try {
    assert.equal(parseCloudinaryUrl(url), null, label);
    console.log(`  ok   ${label.padEnd(24)} -> null`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${label}: ${error.message}`);
  }
}

// Legacy entries normalise into the current record shape.
const legacyString = normaliseEntry(`${base}/image/upload/v1/old.jpg`, 'image');
assert.equal(legacyString.publicId, 'old');
assert.equal(legacyString.resourceType, 'image');

const legacyFile = normaliseEntry({ url: `${base}/raw/upload/v1/old.pdf`, date: 'yesterday' }, 'raw');
assert.equal(legacyFile.publicId, 'old.pdf');
assert.equal(legacyFile.date, 'yesterday', 'legacy fields survive normalisation');

// An unparseable URL yields a null public ID rather than a wrong one, so the
// record stays removable from Firestore without deleting someone else's asset.
const unparseable = normaliseEntry('https://example.com/photo.jpg', 'image');
assert.equal(unparseable.publicId, null);
console.log('  ok   legacy entry normalisation');

if (failures) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log('\nAll cloudinaryUrl tests passed');
