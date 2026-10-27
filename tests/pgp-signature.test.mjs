import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as pgp from 'openpgp';
import { getPGPSigningKey, signPGP, verifyPGP } from '../src/pgp.js';

test('protected signing subkey works while primary/encryption packets remain protected', async () => {
  const pair = await pgp.generateKey({
    type: 'ecc',
    curve: 'curve25519Legacy',
    userIDs: [{ name: 'signing subkey' }],
    passphrase: 'correct-pass',
    subkeys: [{ sign: true }, { sign: false }],
  });
  const identity = await getPGPSigningKey({
    privateKey: pair.privateKey,
    passphrase: 'correct-pass',
  });
  const data = new TextEncoder().encode('test');
  const signature = await signPGP({
    data,
    privateKey: pair.privateKey,
    passphrase: 'correct-pass',
  });
  assert.equal(
    (await verifyPGP({ data, signature, publicKey: identity.publicKey, current: true }))
      .fingerprint,
    identity.fingerprint,
  );
});
test('historical signature does not establish current validity of an expired GitHub key', async () => {
  const created = new Date(Date.now() - 120000);
  const pair = await pgp.generateKey({
    type: 'ecc',
    curve: 'curve25519Legacy',
    userIDs: [{ name: 'expired' }],
    subkeys: [],
    date: created,
    keyExpirationTime: 30,
  });
  const data = new TextEncoder().encode('historical');
  const signature = await pgp.sign({
    message: await pgp.createMessage({ binary: data }),
    signingKeys: await pgp.readPrivateKey({ armoredKey: pair.privateKey }),
    detached: true,
    date: new Date(created.getTime() + 1000),
  });
  assert.ok(await verifyPGP({ data, signature, publicKey: pair.publicKey }));
  await assert.rejects(
    verifyPGP({ data, signature, publicKey: pair.publicKey, current: true }),
    /expir|signing|valid/i,
  );
});
