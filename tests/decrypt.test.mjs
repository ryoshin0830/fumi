import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import * as pgp from 'openpgp';
import { decryptPayload, safeFilename, MAX_BYTES } from '../src/decrypt.js';
import { MAX_CONTAINER_BYTES, MAX_ENCRYPTED_BYTES } from '../src/limits.js';

let protectedKey, plainKey, foreignKey, armored, binary;
const plaintext = 'こんにちは、世界。\nYour secrets stay with you.\n';
before(async () => {
  const options = {
    type: 'ecc',
    curve: 'curve25519Legacy',
    userIDs: [{ name: 'Disposable test key' }],
  };
  protectedKey = await pgp.generateKey({ ...options, passphrase: 'test-passphrase' });
  plainKey = await pgp.generateKey(options);
  foreignKey = await pgp.generateKey(options);
  const publicKey = await pgp.readKey({ armoredKey: protectedKey.publicKey });
  armored = await pgp.encrypt({
    encryptionKeys: publicKey,
    message: await pgp.createMessage({
      binary: new TextEncoder().encode(plaintext),
      filename: 'hello.txt',
    }),
  });
  binary = await pgp.encrypt({
    encryptionKeys: publicKey,
    format: 'binary',
    message: await pgp.createMessage({
      binary: new Uint8Array([0, 255, 128, 13, 10, 1]),
      filename: '../../unsafe.bin',
    }),
  });
});

test('decrypts an armored message with a protected key and preserves text bytes', async () => {
  const result = await decryptPayload({
    privateKey: protectedKey.privateKey,
    ciphertext: armored,
    passphrase: 'test-passphrase',
  });
  assert.equal(result?.text, plaintext);
  assert.deepEqual(result.bytes, new TextEncoder().encode(plaintext));
  assert.equal(result.filename, 'hello.txt');
  assert.match(result.fingerprint, /^[a-f0-9]{40,64}$/);
  assert.equal(result.signed, false);
});

test('preserves arbitrary binary bytes and reads a binary private key', async () => {
  const key = await pgp.readPrivateKey({ armoredKey: protectedKey.privateKey });
  const result = await decryptPayload({
    privateKey: key.write(),
    ciphertext: binary,
    passphrase: 'test-passphrase',
  });
  assert.deepEqual(result?.bytes, new Uint8Array([0, 255, 128, 13, 10, 1]));
  assert.equal(result.text, null);
  assert.equal(result.filename, 'unsafe.bin');
});

test('supports an unprotected key and an empty plaintext', async () => {
  const message = await pgp.encrypt({
    encryptionKeys: await pgp.readKey({ armoredKey: plainKey.publicKey }),
    message: await pgp.createMessage({ text: '' }),
  });
  const result = await decryptPayload({
    privateKey: plainKey.privateKey,
    ciphertext: message,
    sourceName: 'empty.txt.gpg',
  });
  assert.equal(result?.text, '');
  assert.equal(result.bytes.length, 0);
  assert.equal(result.filename, 'empty.txt');
});

test('reports a missing or incorrect passphrase', async () => {
  await assert.rejects(
    decryptPayload({ privateKey: protectedKey.privateKey, ciphertext: armored }),
    /パスフレーズ/,
  );
  await assert.rejects(
    decryptPayload({
      privateKey: protectedKey.privateKey,
      ciphertext: armored,
      passphrase: 'wrong',
    }),
    /パスフレーズ/,
  );
});

test('rejects a key for a different recipient', async () => {
  await assert.rejects(
    decryptPayload({ privateKey: foreignKey.privateKey, ciphertext: armored }),
    /秘密鍵|復号/,
  );
});

test('rejects missing and malformed inputs with useful errors', async () => {
  await assert.rejects(decryptPayload({ privateKey: '', ciphertext: armored }), /秘密鍵/);
  await assert.rejects(decryptPayload({ privateKey: plainKey.privateKey, ciphertext: '' }), /暗号/);
  await assert.rejects(decryptPayload({ privateKey: 'not a key', ciphertext: armored }), /秘密鍵/);
  await assert.rejects(
    decryptPayload({ privateKey: plainKey.privateKey, ciphertext: 'not a message' }),
    /暗号/,
  );
});

test('rejects tampered ciphertext without releasing plaintext', async () => {
  const damaged = binary.slice();
  damaged[damaged.length - 8] ^= 0xff;
  await assert.rejects(
    decryptPayload({
      privateKey: protectedKey.privateKey,
      ciphertext: damaged,
      passphrase: 'test-passphrase',
    }),
    /復号/,
  );
});

test('rejects errors after the encrypted packet without releasing plaintext', async () => {
  const damaged = new Uint8Array(binary.length + 2);
  damaged.set(binary);
  damaged.set([0xe7, 0], binary.length); // Unknown critical packet after valid encrypted content.
  await assert.rejects(
    decryptPayload({
      privateKey: protectedKey.privateKey,
      ciphertext: damaged,
      passphrase: 'test-passphrase',
    }),
    /暗号文|復号/,
  );
});

test('marks signed plaintext as signed without claiming verification', async () => {
  const signingKey = await pgp.readPrivateKey({ armoredKey: plainKey.privateKey });
  const message = await pgp.encrypt({
    encryptionKeys: signingKey.toPublic(),
    signingKeys: signingKey,
    message: await pgp.createMessage({ text: 'signed' }),
  });
  const result = await decryptPayload({ privateKey: plainKey.privateKey, ciphertext: message });
  assert.equal(result?.text, 'signed');
  assert.equal(result.signed, true);
});

test('sanitizes filenames and derives safe fallbacks', () => {
  assert.equal(safeFilename('../../secret.txt', ''), 'secret.txt');
  assert.equal(safeFilename('C:\\temp\\secret.txt', ''), 'secret.txt');
  assert.equal(safeFilename('', 'report.pdf.gpg'), 'report.pdf');
  assert.equal(safeFilename('', ''), 'decrypted.txt');
  assert.equal(safeFilename('..', ''), 'decrypted.txt');
  assert.equal(safeFilename('a\u202eb\u0000.txt', ''), 'ab.txt');
  assert.equal(safeFilename('CON', ''), '_CON');
});

test('rejects inputs larger than the documented limit', async () => {
  await assert.rejects(
    decryptPayload({
      privateKey: plainKey.privateKey,
      ciphertext: new Uint8Array(MAX_ENCRYPTED_BYTES + 1),
    }),
    /72 MB/,
  );
});

test('stops compressed messages that expand above the output limit', async () => {
  const message = await pgp.encrypt({
    encryptionKeys: await pgp.readKey({ armoredKey: plainKey.publicKey }),
    message: await pgp.createMessage({ binary: new Uint8Array(MAX_BYTES + 1).fill(65) }),
    config: { preferredCompressionAlgorithm: pgp.enums.compression.zlib },
  });
  await assert.rejects(
    decryptPayload({ privateKey: plainKey.privateKey, ciphertext: message }),
    /50 MB/,
  );
  const container = await decryptPayload({
    privateKey: plainKey.privateKey,
    ciphertext: message,
    container: true,
  });
  assert.equal(container.bytes.length, MAX_BYTES + 1);
});

test('stops compressed containers that expand above the container limit', async () => {
  const message = await pgp.encrypt({
    encryptionKeys: await pgp.readKey({ armoredKey: plainKey.publicKey }),
    message: await pgp.createMessage({ binary: new Uint8Array(MAX_CONTAINER_BYTES + 1).fill(65) }),
    config: { preferredCompressionAlgorithm: pgp.enums.compression.zlib },
  });
  await assert.rejects(
    decryptPayload({ privateKey: plainKey.privateKey, ciphertext: message, container: true }),
    /50 MB/,
  );
});

test('supports armored data selected as a file, including a UTF-8 BOM', async () => {
  const result = await decryptPayload({
    privateKey: new TextEncoder().encode('\ufeff' + protectedKey.privateKey),
    ciphertext: new TextEncoder().encode(armored),
    passphrase: 'test-passphrase',
  });
  assert.equal(result.text, plaintext);
});
