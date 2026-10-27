import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import * as pgp from 'openpgp';
import { inspectPGPKeys, encryptPGP } from '../src/pgp.js';
import { decryptPayload } from '../src/decrypt.js';

let key, mixed;
before(async () => {
  key = await pgp.generateKey({
    type: 'ecc',
    curve: 'curve25519Legacy',
    userIDs: [{ name: 'Recipient' }],
  });
  mixed = await pgp.generateKey({
    type: 'ecc',
    curve: 'curve25519Legacy',
    userIDs: [{ name: 'Mixed protection' }],
    subkeys: [{ passphrase: 'correct-pass' }],
  });
});
test('inspects usable public keys and encrypts exact binary bytes', async () => {
  const recipients = await inspectPGPKeys(key.publicKey);
  assert.equal(recipients.length, 1);
  assert.equal(recipients[0].label, 'Recipient');
  const data = new Uint8Array([0, 255, 10, 13, 128, 5]);
  const result = await encryptPGP({
    data,
    recipients: recipients.map((x) => x.key),
    filename: 'test.bin',
    armored: false,
  });
  assert.equal(result.text, null);
  const restored = await decryptPayload({ privateKey: key.privateKey, ciphertext: result.bytes });
  assert.deepEqual(restored.bytes, data);
  assert.equal(restored.filename, 'test.bin');
});
test('creates interoperable armored text without normalizing line endings', async () => {
  const data = new TextEncoder().encode('hello\n世界\r\n');
  const result = await encryptPGP({
    data,
    recipients: [key.publicKey],
    filename: 'message.txt',
    armored: true,
  });
  assert.match(result?.text || '', /BEGIN PGP MESSAGE/);
  const restored = await decryptPayload({ privateKey: key.privateKey, ciphertext: result.text });
  assert.deepEqual(restored.bytes, data);
});
test('rejects secret keys accidentally supplied as public keys', async () => {
  await assert.rejects(inspectPGPKeys(key.privateKey), /公開鍵/);
});
test('excludes signing-only keys', async () => {
  const signingOnly = await pgp.generateKey({
    type: 'ecc',
    curve: 'curve25519Legacy',
    userIDs: [{ name: 'Sign only' }],
    subkeys: [],
  });
  assert.deepEqual(await inspectPGPKeys(signingOnly.publicKey), []);
});

test('excludes expired recipient keys', async () => {
  const expired = await pgp.generateKey({
    type: 'ecc',
    curve: 'curve25519Legacy',
    userIDs: [{ name: 'Expired' }],
    date: new Date('2020-01-01'),
    keyExpirationTime: 1,
  });
  assert.deepEqual(await inspectPGPKeys(expired.publicKey), []);
});
test('unlocks protected encryption subkeys even when the primary key is already unlocked', async () => {
  const encrypted = await pgp.encrypt({
    message: await pgp.createMessage({ text: 'mixed key works' }),
    encryptionKeys: await pgp.readKey({ armoredKey: mixed.publicKey }),
  });
  const restored = await decryptPayload({
    privateKey: mixed.privateKey,
    ciphertext: encrypted,
    passphrase: 'correct-pass',
  });
  assert.equal(restored.text, 'mixed key works');
});

test('decrypts secret-subkey exports with a dummy primary and no passphrase', async () => {
  const subkeyOnly = await pgp.readPrivateKey({ armoredKey: key.privateKey });
  subkeyOnly.keyPacket.makeDummy();
  const encrypted = await pgp.encrypt({
    message: await pgp.createMessage({ text: 'subkey-only works' }),
    encryptionKeys: await pgp.readKey({ armoredKey: key.publicKey }),
  });
  const restored = await decryptPayload({ privateKey: subkeyOnly.armor(), ciphertext: encrypted });
  assert.equal(restored.text, 'subkey-only works');
});
