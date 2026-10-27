import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import * as pgp from 'openpgp';
import { decryptPayload } from '../src/decrypt.js';
import { encryptPGP, verifyPGP } from '../src/pgp.js';

const encoder = new TextEncoder();
const notationName = 'identity@dgpg.local';
let recipient, signer, other, signingKey, encryptionKey, directory, verifyRegisteredSignature;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'dgpg-native-'));
  await build({
    entryPoints: ['src/signatures.js'],
    outfile: join(directory, 'api.mjs'),
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: 'es2022',
    loader: { '.wasm': 'binary' },
    logLevel: 'silent',
  });
  ({ verifyRegisteredSignature } = await import('file://' + join(directory, 'api.mjs')));
  const options = {
    type: 'ecc',
    curve: 'curve25519Legacy',
    userIDs: [{ name: 'Disposable native test' }],
  };
  recipient = await pgp.generateKey(options);
  signer = await pgp.generateKey({
    ...options,
    passphrase: 'secret',
    subkeys: [{ sign: true }, { sign: false }],
  });
  other = await pgp.generateKey({ ...options, subkeys: [] });
  signingKey = await pgp.decryptKey({
    privateKey: await pgp.readPrivateKey({ armoredKey: signer.privateKey }),
    passphrase: 'secret',
  });
  encryptionKey = await pgp.readKey({ armoredKey: recipient.publicKey });
});
after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});
const metadata = (changes = {}) => ({
  version: 1,
  github: 'alice',
  filename: 'original.txt',
  publicKey: signer.publicKey,
  ...changes,
});
const notation = (value) => ({
  name: notationName,
  value: encoder.encode(typeof value === 'string' ? value : JSON.stringify(value)),
  humanReadable: true,
  critical: false,
});
async function signedMessage({
  data = encoder.encode('original'),
  notations = [notation(metadata())],
  mutate,
  filename = 'original.txt',
  keys = signingKey,
  config,
} = {}) {
  const signature = await pgp.sign({
    message: await pgp.createMessage({ binary: data }),
    signingKeys: keys,
    detached: true,
    format: 'object',
    signatureNotations: notations,
  });
  if (mutate) mutate(signature);
  return pgp.encrypt({
    message: await pgp.createMessage({ binary: data, filename }),
    encryptionKeys: encryptionKey,
    signature,
    config,
  });
}
const recover = (ciphertext) => decryptPayload({ privateKey: recipient.privateKey, ciphertext });

test('recovers authenticated native metadata and original bytes with serializable pending verification', async () => {
  const result = await recover(await signedMessage());
  assert.equal(result.encoding, 'native-pgp');
  assert.equal(result.filename, 'original.txt');
  assert.equal(result.verification.github, 'alice');
  assert.equal(result.verification.kind, 'native-pgp');
  assert.equal(result.verification.state, 'pending');
  assert.deepEqual(result.verification.manifest, result.bytes);
  assert.deepEqual(structuredClone(result.verification), result.verification);
  assert.equal(
    await verifyRegisteredSignature({
      verification: result.verification,
      registeredKeys: [signer.publicKey],
    }),
    true,
  );
  assert.equal(
    await verifyRegisteredSignature({
      verification: result.verification,
      registeredKeys: [other.publicKey],
    }),
    false,
  );
});

test('native encryption preserves text and binary for ordinary OpenPGP decryptors and protected signing subkeys', async () => {
  const { encryptNativePGP } = await import('../src/native-pgp.js');
  for (const [data, armored] of [
    [encoder.encode('\ufeff日本語\r\n'), true],
    [new Uint8Array([0, 255, 128, 10]), false],
  ]) {
    const output = await encryptNativePGP({
      data,
      armored,
      filename: '../../日本語.bin',
      github: '@ALICE',
      privateKey: signer.privateKey,
      passphrase: 'secret',
      registeredKeys: [signer.publicKey],
      recipients: [recipient.publicKey],
    });
    assert.equal(output.encoding, 'native-pgp');
    const decrypted = await pgp.decrypt({
      message: await pgp.readMessage(
        armored ? { armoredMessage: output.text } : { binaryMessage: output.bytes },
      ),
      decryptionKeys: await pgp.readPrivateKey({ armoredKey: recipient.privateKey }),
      verificationKeys: signingKey.toPublic(),
      format: 'binary',
    });
    assert.deepEqual(decrypted.data, data);
    assert.equal(decrypted.filename, '日本語.bin');
    await decrypted.signatures[0].verified;
    const packet = (await decrypted.signatures[0].signature).packets[0];
    const identity = packet.rawNotations.filter((item) => item.name === notationName);
    assert.equal(identity.length, 1);
    assert.equal(identity[0].critical, false);
    assert.equal(JSON.parse(new TextDecoder().decode(identity[0].value)).github, 'alice');
    assert.deepEqual((await recover(output.bytes)).bytes, data);
  }
});

test('native encryption requires the current registered signing key', async () => {
  const { encryptNativePGP } = await import('../src/native-pgp.js');
  await assert.rejects(
    encryptNativePGP({
      data: encoder.encode('test'),
      github: 'alice',
      privateKey: signer.privateKey,
      passphrase: 'secret',
      recipients: [recipient.publicKey],
      registeredKeys: [other.publicKey],
    }),
    /GitHub/,
  );
});

test('rejects invalid, duplicate, oversized identity metadata and multiple signatures', async () => {
  for (const value of [
    '{bad',
    metadata({ version: 2 }),
    metadata({ github: 'ALICE' }),
    metadata({ filename: '../bad' }),
    metadata({ publicKey: other.publicKey }),
    { ...metadata(), extra: true },
    metadata({ filename: 'x'.repeat(61 * 1024) }),
  ]) {
    await assert.rejects(
      recover(await signedMessage({ notations: [notation(value)] })),
      /署名|identity|metadata/i,
    );
  }
  await assert.rejects(
    recover(await signedMessage({ notations: [notation(metadata()), notation(metadata())] })),
    /署名/,
  );
  await assert.rejects(
    recover(
      await signedMessage({
        keys: [signingKey, await pgp.readPrivateKey({ armoredKey: other.privateKey })],
      }),
    ),
    /署名/,
  );
});

test('rejects unhashed identity metadata instead of trusting it', async () => {
  const body = new Uint8Array(
    8 + encoder.encode(notationName).length + encoder.encode(JSON.stringify(metadata())).length,
  );
  body[0] = 0x80;
  const view = new DataView(body.buffer);
  view.setUint16(4, encoder.encode(notationName).length);
  view.setUint16(6, encoder.encode(JSON.stringify(metadata())).length);
  body.set(encoder.encode(notationName), 8);
  body.set(encoder.encode(JSON.stringify(metadata())), 8 + encoder.encode(notationName).length);
  for (const signatureType of [
    pgp.enums.signature.binary,
    pgp.enums.signature.standalone,
    pgp.enums.signature.certGeneric,
  ]) {
    await assert.rejects(
      recover(
        await signedMessage({
          notations: [],
          mutate: (signature) => {
            signature.packets[0].unhashedSubpackets.push({ type: 20, critical: false, body });
            signature.packets[0].signatureType = signatureType;
            signature.packets[0].signatureData[1] = signatureType;
          },
        }),
      ),
      /署名/,
    );
  }
});

for (const signatureType of [pgp.enums.signature.standalone, pgp.enums.signature.certGeneric]) {
  test(`rejects identity metadata after changing its hashed signature type to ${signatureType}`, async () => {
    for (const compression of [pgp.enums.compression.uncompressed, pgp.enums.compression.zlib]) {
      const ciphertext = await signedMessage({
        config: { preferredCompressionAlgorithm: compression },
        mutate: (signature) => {
          const packet = signature.packets[0];
          packet.signatureType = signatureType;
          packet.signatureData[1] = signatureType;
        },
      });
      await assert.rejects(recover(ciphertext), /署名/);
    }
  });

  test(`rejects an extra non-data signature of type ${signatureType} alongside a valid native identity`, async () => {
    const extra = await pgp.sign({
      message: await pgp.createMessage({ binary: encoder.encode('original') }),
      signingKeys: signingKey,
      detached: true,
      format: 'object',
    });
    extra.packets[0].signatureType = signatureType;
    extra.packets[0].signatureData[1] = signatureType;
    const ciphertext = await signedMessage({
      mutate: (signature) => signature.packets.push(extra.packets[0]),
    });
    await assert.rejects(recover(ciphertext), /署名/);
  });
}

test('recovers compressed native identity and exact bytes', async () => {
  const restored = await recover(
    await signedMessage({ config: { preferredCompressionAlgorithm: pgp.enums.compression.zlib } }),
  );
  assert.equal(restored.encoding, 'native-pgp');
  assert.deepEqual(restored.bytes, encoder.encode('original'));
});

for (const version of [3, 5]) {
  test(`rejects native signatures with unsupported wire version ${version}`, async () => {
    for (const compression of [pgp.enums.compression.uncompressed, pgp.enums.compression.zlib]) {
      const ciphertext = await signedMessage({
        config: { preferredCompressionAlgorithm: compression },
        mutate: (signature) => {
          signature.packets[0].signatureData[0] = version;
        },
      });
      await assert.rejects(recover(ciphertext), /署名|復号/);
    }
  });

  test(`rejects an extra unsupported version ${version} signature beside valid native identity`, async () => {
    const extra = await pgp.sign({
      message: await pgp.createMessage({ binary: encoder.encode('original') }),
      signingKeys: signingKey,
      detached: true,
      format: 'object',
    });
    extra.packets[0].signatureData[0] = version;
    for (const compression of [pgp.enums.compression.uncompressed, pgp.enums.compression.zlib]) {
      const ciphertext = await signedMessage({
        config: { preferredCompressionAlgorithm: compression },
        mutate: (signature) => signature.packets.push(extra.packets[0]),
      });
      await assert.rejects(recover(ciphertext), /署名|復号/);
    }
  });
}

test('preserves unsupported-signature wire bytes when they are ordinary literal file data', async () => {
  const signature = await pgp.sign({
    message: await pgp.createMessage({ binary: encoder.encode('original') }),
    signingKeys: signingKey,
    detached: true,
    format: 'object',
    signatureNotations: [notation(metadata())],
  });
  signature.packets[0].signatureData[0] = 3;
  const data = signature.write();
  const ciphertext = await pgp.encrypt({
    message: await pgp.createMessage({ binary: data }),
    encryptionKeys: encryptionKey,
  });
  const restored = await recover(ciphertext);
  assert.deepEqual(restored.bytes, data);
  assert.equal(restored.signed, false);
  assert.equal(restored.verification, undefined);
});

test('counts outer supported signatures alongside a compressed native identity', async () => {
  const data = encoder.encode('original');
  const inner = await pgp.sign({
    message: await pgp.createMessage({ binary: data }),
    signingKeys: signingKey,
    format: 'object',
    signatureNotations: [notation(metadata())],
  });
  const outer = inner.compress(pgp.enums.compression.zlib);
  const extra = await pgp.sign({
    message: await pgp.createMessage({ binary: data }),
    signingKeys: signingKey,
    detached: true,
    format: 'object',
  });
  extra.packets[0].signatureType = pgp.enums.signature.standalone;
  extra.packets[0].signatureData[1] = pgp.enums.signature.standalone;
  outer.packets.unshift(extra.packets[0]);
  await assert.rejects(
    recover(await pgp.encrypt({ message: outer, encryptionKeys: encryptionKey })),
    /署名/,
  );
});

test('verifies an outer native identity around compressed plain content', async () => {
  const data = encoder.encode('original');
  const outer = (await pgp.createMessage({ binary: data })).compress(pgp.enums.compression.zlib);
  const signature = await pgp.sign({
    message: await pgp.createMessage({ binary: data }),
    signingKeys: signingKey,
    detached: true,
    format: 'object',
    signatureNotations: [notation(metadata())],
  });
  outer.packets.unshift(signature.packets[0]);
  const restored = await recover(
    await pgp.encrypt({ message: outer, encryptionKeys: encryptionKey }),
  );
  assert.deepEqual(restored.bytes, data);
  assert.equal(restored.encoding, 'native-pgp');
  assert.equal(restored.signed, true);
  assert.equal(restored.verification.github, 'alice');
});

test('rejects invalid outer native identity around compressed plain content', async () => {
  const outer = (await pgp.createMessage({ binary: encoder.encode('tampered') })).compress(
    pgp.enums.compression.zlib,
  );
  const signature = await pgp.sign({
    message: await pgp.createMessage({ binary: encoder.encode('original') }),
    signingKeys: signingKey,
    detached: true,
    format: 'object',
    signatureNotations: [notation(metadata())],
  });
  outer.packets.unshift(signature.packets[0]);
  await assert.rejects(
    recover(await pgp.encrypt({ message: outer, encryptionKeys: encryptionKey })),
    /署名/,
  );
});

test('rejects unsupported outer signatures around compressed plain content', async () => {
  for (const version of [3, 5]) {
    const data = encoder.encode('original');
    const outer = (await pgp.createMessage({ binary: data })).compress(pgp.enums.compression.zlib);
    const signature = await pgp.sign({
      message: await pgp.createMessage({ binary: data }),
      signingKeys: signingKey,
      detached: true,
      format: 'object',
      signatureNotations: [notation(metadata())],
    });
    signature.packets[0].signatureData[0] = version;
    outer.packets.unshift(signature.packets[0]);
    await assert.rejects(
      recover(await pgp.encrypt({ message: outer, encryptionKeys: encryptionKey })),
      /署名|復号/,
    );
  }
});

test('rejects authenticated metadata and plaintext tampering before exposing data', async () => {
  await assert.rejects(
    recover(
      await signedMessage({
        mutate: (signature) => {
          const packet = signature.packets[0];
          const offset = Buffer.from(packet.signatureData).indexOf('alice');
          assert.ok(offset >= 0);
          packet.signatureData[offset] = 'b'.charCodeAt(0);
        },
      }),
    ),
    /署名/,
  );
  const signature = await pgp.sign({
    message: await pgp.createMessage({ binary: encoder.encode('original') }),
    signingKeys: signingKey,
    detached: true,
    format: 'object',
    signatureNotations: [notation(metadata())],
  });
  const ciphertext = await pgp.encrypt({
    message: await pgp.createMessage({
      binary: encoder.encode('tampered'),
      filename: 'original.txt',
    }),
    encryptionKeys: encryptionKey,
    signature,
  });
  await assert.rejects(recover(ciphertext), /署名/);
});

test('signed filename is authoritative even when unauthenticated literal filename differs', async () => {
  const result = await recover(await signedMessage({ filename: 'changed.txt' }));
  assert.equal(result.filename, 'original.txt');
});

test('ordinary external signatures and unsigned data remain supported without identity claims', async () => {
  const external = await recover(
    await signedMessage({ notations: [{ ...notation('external'), name: 'other@example.org' }] }),
  );
  assert.equal(external.signed, true);
  assert.equal(external.verification, undefined);
  const unsigned = await recover(
    await pgp.encrypt({
      message: await pgp.createMessage({ binary: encoder.encode('unsigned') }),
      encryptionKeys: encryptionKey,
    }),
  );
  assert.equal(unsigned.signed, false);
  assert.equal(unsigned.verification, undefined);
});

test('outer external data signatures remain present without claiming GitHub identity', async () => {
  const data = encoder.encode('external\r\n');
  for (const type of ['binary', 'text', 'standalone']) {
    const outer = (await pgp.createMessage({ binary: data })).compress(pgp.enums.compression.zlib);
    const message = await pgp.createMessage(
      type === 'text' ? { text: 'external\r\n' } : { binary: data },
    );
    const signature = await pgp.sign({
      message,
      signingKeys: signingKey,
      detached: true,
      format: 'object',
    });
    if (type === 'standalone') {
      signature.packets[0].signatureType = pgp.enums.signature.standalone;
      signature.packets[0].signatureData[1] = pgp.enums.signature.standalone;
    }
    outer.packets.unshift(signature.packets[0]);
    const restored = await recover(
      await pgp.encrypt({ message: outer, encryptionKeys: encryptionKey }),
    );
    assert.deepEqual(restored.bytes, data);
    assert.equal(restored.signed, type !== 'standalone');
    assert.equal(restored.verification, undefined);
  }
});

test('PGP verification accepts direct file bytes larger than the old manifest limit', async () => {
  const data = new Uint8Array(32 * 1024).fill(65);
  const signature = await pgp.sign({
    message: await pgp.createMessage({ binary: data }),
    signingKeys: signingKey,
    detached: true,
  });
  assert.ok(await verifyPGP({ data, signature, publicKey: signer.publicKey, current: true }));
});

test('native encryption supports signing-only keys and rejects missing passphrases', async () => {
  const { encryptNativePGP } = await import('../src/native-pgp.js');
  const options = {
    data: encoder.encode('signing-only'),
    github: 'alice',
    recipients: [recipient.publicKey],
  };
  const output = await encryptNativePGP({
    ...options,
    privateKey: other.privateKey,
    registeredKeys: [other.publicKey],
  });
  assert.deepEqual((await recover(output.bytes)).bytes, options.data);
  await assert.rejects(
    encryptNativePGP({
      ...options,
      privateKey: signer.privateKey,
      registeredKeys: [signer.publicKey],
    }),
    /パスフレーズ/,
  );
});

test('oversized identity notation fails clearly before native encryption', async () => {
  const { encryptNativePGP } = await import('../src/native-pgp.js');
  const large = await pgp.generateKey({
    type: 'ecc',
    curve: 'curve25519Legacy',
    userIDs: Array.from({ length: 100 }, (_, i) => ({ name: `${i} ${'x'.repeat(400)}` })),
    subkeys: [],
  });
  await assert.rejects(
    encryptNativePGP({
      data: encoder.encode('test'),
      github: 'alice',
      recipients: [recipient.publicKey],
      privateKey: large.privateKey,
      registeredKeys: [large.publicKey],
    }),
    /60 KiB/,
  );
});

test('native literal filenames over 255 UTF-8 bytes fail instead of corrupting payloads', async () => {
  const { encryptNativePGP } = await import('../src/native-pgp.js');
  const options = {
    data: encoder.encode('test'),
    recipients: [recipient.publicKey],
    filename: '日'.repeat(86),
    github: 'alice',
    privateKey: other.privateKey,
    registeredKeys: [other.publicKey],
  };
  await assert.rejects(encryptNativePGP(options), /ファイル名.*255/);
  await assert.rejects(encryptPGP(options), /ファイル名.*255/);
});

test('identity signatures must use binary signatures to bind exact line-ending bytes', async () => {
  const signature = await pgp.sign({
    message: await pgp.createMessage({ text: 'line\n' }),
    signingKeys: signingKey,
    detached: true,
    format: 'object',
    signatureNotations: [notation(metadata())],
  });
  const ciphertext = await pgp.encrypt({
    message: await pgp.createMessage({ binary: encoder.encode('line\r\n') }),
    encryptionKeys: encryptionKey,
    signature,
  });
  await assert.rejects(recover(ciphertext), /署名/);
});

test('offline local verification accepts historical signatures but GitHub checks the actual expired issuer subkey', async () => {
  const created = new Date(Date.now() - 120000);
  const pair = await pgp.generateKey({
    type: 'ecc',
    curve: 'curve25519Legacy',
    userIDs: [{ name: 'Expired issuer, valid primary' }],
    date: created,
    subkeys: [{ sign: true, keyExpirationTime: 30 }],
  });
  const key = await pgp.readPrivateKey({ armoredKey: pair.privateKey });
  assert.ok(await key.getSigningKey());
  const data = encoder.encode('historical issuer');
  const signature = await pgp.sign({
    message: await pgp.createMessage({ binary: data }),
    signingKeys: key,
    signingKeyIDs: [key.subkeys[0].getKeyID()],
    date: new Date(created.getTime() + 1000),
    detached: true,
    format: 'object',
    signatureNotations: [notation(metadata({ publicKey: pair.publicKey }))],
  });
  const ciphertext = await pgp.encrypt({
    message: await pgp.createMessage({ binary: data }),
    encryptionKeys: encryptionKey,
    signature,
  });
  const restored = await recover(ciphertext);
  assert.deepEqual(restored.bytes, data);
  assert.equal(restored.verification.state, 'pending');
  assert.equal(
    await verifyRegisteredSignature({
      verification: restored.verification,
      registeredKeys: [pair.publicKey],
    }),
    false,
  );
  await assert.rejects(
    verifyPGP({ data, signature: signature.armor(), publicKey: pair.publicKey, current: true }),
    /expir|signing|valid/i,
  );
});
