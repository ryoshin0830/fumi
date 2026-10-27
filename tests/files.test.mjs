import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeFilename, decodeText, detectFormat } from '../src/files.js';

test('filename truncation never leaves a lone surrogate that changes during ZIP encoding', () => {
  const name = safeFilename('a'.repeat(179) + '🐈.png');
  assert.equal(new TextDecoder().decode(new TextEncoder().encode(name)), name);
});

test('derives restored filenames from age/PGP inputs and strips unsafe paths', () => {
  assert.equal(safeFilename('', 'report.pdf.age'), 'report.pdf');
  assert.equal(safeFilename('', 'report.pdf.gpg'), 'report.pdf');
  assert.equal(safeFilename('../../unsafe.txt'), 'unsafe.txt');
  assert.equal(safeFilename('CON'), '_CON');
  assert.equal(safeFilename('a'.repeat(179) + '.hidden'), 'a'.repeat(179));
});
test('previews only valid UTF-8 without binary control characters', () => {
  assert.equal(
    decodeText(new TextEncoder().encode('日本語\n<script>safe text</script>')),
    '日本語\n<script>safe text</script>',
  );
  assert.equal(decodeText(new Uint8Array([0xff, 0xfe])), null);
  assert.equal(decodeText(new Uint8Array([65, 0, 66])), null);
  assert.equal(decodeText(new Uint8Array()), '');
});
test('detects standard age and OpenPGP inputs without relying on extensions', () => {
  assert.equal(detectFormat('-----BEGIN AGE ENCRYPTED FILE-----\n'), 'ssh');
  assert.equal(detectFormat(new TextEncoder().encode('age-encryption.org/v1\n')), 'ssh');
  assert.equal(detectFormat('-----BEGIN PGP MESSAGE-----\n'), 'pgp');
  assert.equal(detectFormat(new Uint8Array([0xc1, 10, 20])), 'pgp');
  assert.equal(detectFormat('ordinary text'), null);
  assert.equal(detectFormat(undefined), null);
});
