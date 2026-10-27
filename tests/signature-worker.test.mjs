import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import * as pgp from 'openpgp';
import { zipSync } from 'fflate';

let directory, worker, pgpPair, pgpSigner, sshPrivate, sshPublic, legacyEncrypt;
let sequence = 0;
const pending = new Map();
const rpc = (action, payload) =>
  new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, action, payload });
  });
const encryptFixture = (payload) =>
  payload.signer ? legacyEncrypt(payload) : rpc('encrypt', payload);
const original = new Uint8Array([0, 255, 10, 13, 128, 42]);
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'dgpg-signature-worker-'));
  pgpPair = await pgp.generateKey({
    type: 'ecc',
    curve: 'curve25519Legacy',
    userIDs: [{ name: 'recipient' }],
  });
  pgpSigner = await pgp.generateKey({
    type: 'ecc',
    curve: 'curve25519Legacy',
    userIDs: [{ name: 'sign-only' }],
    subkeys: [],
    passphrase: 'test-pass',
  });
  const path = join(directory, 'ssh-key');
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', 'test-pass', '-f', path]);
  sshPrivate = await readFile(path, 'utf8');
  sshPublic = await readFile(path + '.pub', 'utf8');
  await build({
    entryPoints: ['src/crypto-worker.js'],
    outfile: join(directory, 'worker-bundle.mjs'),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    loader: { '.wasm': 'binary' },
    logLevel: 'silent',
  });
  await build({
    entryPoints: ['scripts/legacy-encryption.mjs'],
    outfile: join(directory, 'legacy.mjs'),
    target: 'es2022',
    bundle: true,
    format: 'esm',
    platform: 'browser',
    loader: { '.wasm': 'binary' },
    logLevel: 'silent',
  });
  ({ legacyEncrypt } = await import('file://' + join(directory, 'legacy.mjs')));
  await writeFile(
    join(directory, 'worker.mjs'),
    `import {parentPort} from 'node:worker_threads';globalThis.self=globalThis;globalThis.postMessage=data=>parentPort.postMessage(data);await import('./worker-bundle.mjs');parentPort.on('message',data=>self.onmessage({data}));`,
  );
  worker = new Worker(join(directory, 'worker.mjs'));
  worker.on('message', (data) => {
    const task = pending.get(data.id);
    pending.delete(data.id);
    data.error ? task.reject(new Error(data.error)) : task.resolve(data.result);
  });
  worker.on('error', (error) => {
    for (const task of pending.values()) task.reject(error);
    pending.clear();
  });
});
after(async () => {
  await worker?.terminate();
  await rm(directory, { recursive: true, force: true });
});
test('sample generation is not exposed by the application worker', async () => {
  await assert.rejects(rpc('demo', {}), /処理|対応/);
});
test('the application rejects signing instead of silently downgrading it', async () => {
  await assert.rejects(
    rpc('encrypt', {
      data: original,
      format: 'pgp',
      recipients: [pgpPair.publicKey],
      filename: 'message.txt',
      armored: true,
      signer: {
        github: 'alice',
        privateKey: pgpSigner.privateKey,
        passphrase: 'test-pass',
        registeredKeys: [pgpSigner.publicKey],
      },
    }),
    /署名/,
  );
});
for (const signerType of ['pgp', 'ssh'])
  for (const format of ['pgp', 'ssh']) {
    test(`${signerType} signed data restores with ${format} recipient format`, async () => {
      const signer = {
        github: 'alice',
        privateKey: signerType === 'pgp' ? pgpSigner.privateKey : sshPrivate,
        passphrase: 'test-pass',
        registeredKeys: [signerType === 'pgp' ? pgpSigner.publicKey : sshPublic],
      };
      const encrypted = await encryptFixture({
        data: original,
        format,
        recipients: [format === 'pgp' ? pgpPair.publicKey : sshPublic],
        filename: 'binary.dat',
        armored: true,
        signer,
      });
      const native = signerType === 'pgp' && format === 'pgp';
      assert.equal(encrypted.encoding, native ? 'native-pgp' : 'signed-zip');
      assert.equal(
        encrypted.filename,
        native ? 'binary.dat.asc' : `binary.dat.signed.zip.${format === 'pgp' ? 'asc' : 'age'}`,
      );
      const restored = await rpc('decrypt', {
        data: encrypted.text,
        privateKey: format === 'pgp' ? pgpPair.privateKey : sshPrivate,
        passphrase: format === 'ssh' ? 'test-pass' : '',
        sourceName: encrypted.filename,
      });
      assert.deepEqual(restored.bytes, original);
      assert.equal(restored.filename, 'binary.dat');
      assert.equal(restored.verification.github, 'alice');
      assert.equal(restored.verification.type, signerType);
      assert.equal(restored.encoding, native ? 'native-pgp' : 'signed-zip');
      assert.equal(
        (
          await rpc('verify-github', {
            verification: restored.verification,
            registeredKeys: signer.registeredKeys,
          })
        ).matched,
        true,
      );
      assert.equal(
        (await rpc('verify-github', { verification: restored.verification, registeredKeys: [] }))
          .matched,
        false,
      );
    });
  }
test('unsigned text ending in the package marker remains ordinary data', async () => {
  const data = new TextEncoder().encode('ordinary text ending in dgpg-signed-v1');
  const encrypted = await encryptFixture({
    data,
    format: 'pgp',
    recipients: [pgpPair.publicKey],
    filename: 'ordinary.txt',
    armored: true,
  });
  const restored = await rpc('decrypt', { data: encrypted.text, privateKey: pgpPair.privateKey });
  assert.deepEqual(restored.bytes, data);
  assert.equal(restored.verification, undefined);
});
test('native OpenPGP signature interoperates with GnuPG', async () => {
  const encrypted = await encryptFixture({
    data: original,
    format: 'pgp',
    recipients: [pgpPair.publicKey],
    filename: 'binary.dat',
    armored: true,
    signer: {
      github: 'alice',
      privateKey: pgpSigner.privateKey,
      passphrase: 'test-pass',
      registeredKeys: [pgpSigner.publicKey],
    },
  });
  const restored = await rpc('decrypt', { data: encrypted.text, privateKey: pgpPair.privateKey });
  const verification = restored.verification;
  const keyFile = join(directory, 'public.asc'),
    signatureFile = join(directory, 'signature.asc'),
    manifestFile = join(directory, 'manifest.json');
  await writeFile(keyFile, pgpSigner.publicKey);
  await writeFile(signatureFile, verification.signature);
  await writeFile(manifestFile, verification.manifest);
  execFileSync('gpg', ['--homedir', directory, '--batch', '--import', keyFile], { stdio: 'pipe' });
  execFileSync(
    'gpg',
    ['--homedir', directory, '--batch', '--verify', signatureFile, manifestFile],
    { stdio: 'pipe' },
  );
  const privateFile = join(directory, 'secret.asc');
  await writeFile(privateFile, pgpSigner.privateKey);
  execFileSync(
    'gpg',
    [
      '--homedir',
      directory,
      '--batch',
      '--pinentry-mode',
      'loopback',
      '--passphrase',
      'test-pass',
      '--import',
      privateFile,
    ],
    { stdio: 'pipe' },
  );
  const cliSignature = join(directory, 'from-cli.asc');
  execFileSync(
    'gpg',
    [
      '--homedir',
      directory,
      '--batch',
      '--yes',
      '--pinentry-mode',
      'loopback',
      '--passphrase',
      'test-pass',
      '--armor',
      '--output',
      cliSignature,
      '--detach-sign',
      manifestFile,
    ],
    { stdio: 'pipe' },
  );
  const fromCLI = { ...verification, signature: await readFile(cliSignature, 'utf8') };
  assert.equal(
    (await rpc('verify-github', { verification: fromCLI, registeredKeys: [pgpSigner.publicKey] }))
      .matched,
    true,
  );
  execFileSync('gpgconf', ['--homedir', directory, '--kill', 'gpg-agent']);
});

async function legacyPackage() {
  const manifest = new TextEncoder().encode(
    JSON.stringify({
      version: 1,
      context: 'dgpg-signed',
      github: 'alice',
      type: 'pgp',
      fingerprint: (await pgp.readKey({ armoredKey: pgpSigner.publicKey })).getFingerprint(),
      filename: 'legacy.bin',
      size: original.length,
      sha256: createHash('sha256').update(original).digest('hex'),
    }),
  );
  const signingKey = await pgp.decryptKey({
    privateKey: await pgp.readPrivateKey({ armoredKey: pgpSigner.privateKey }),
    passphrase: 'test-pass',
  });
  const signature = await pgp.sign({
    message: await pgp.createMessage({ binary: manifest }),
    signingKeys: signingKey,
    detached: true,
    format: 'armored',
  });
  const archive = zipSync(
    {
      'manifest.json': manifest,
      data: original,
      'signature.asc': new TextEncoder().encode(signature),
      'public.key': new TextEncoder().encode(pgpSigner.publicKey),
    },
    { level: 0 },
  );
  const marker = new TextEncoder().encode('dgpg-signed-v1');
  const bytes = new Uint8Array(archive.length + marker.length);
  bytes.set(archive);
  bytes.set(marker, archive.length);
  new DataView(bytes.buffer).setUint16(archive.length - 2, marker.length, true);
  return bytes;
}

test('existing v1 signed ciphertext still restores original bytes and GitHub identity', async () => {
  const bytes = await legacyPackage();
  const ciphertext = await pgp.encrypt({
    message: await pgp.createMessage({ binary: bytes, filename: 'legacy.signed.zip' }),
    encryptionKeys: await pgp.readKey({ armoredKey: pgpPair.publicKey }),
    format: 'armored',
  });
  const restored = await rpc('decrypt', { data: ciphertext, privateKey: pgpPair.privateKey });
  assert.deepEqual(restored.bytes, original);
  assert.equal(restored.filename, 'legacy.bin');
  assert.equal(restored.verification.github, 'alice');
  assert.equal(
    (
      await rpc('verify-github', {
        verification: restored.verification,
        registeredKeys: [pgpSigner.publicKey],
      })
    ).matched,
    true,
  );
});

test('native PGP signing preserves an original ZIP even when it has a legacy package marker', async () => {
  const data = await legacyPackage();
  const encrypted = await encryptFixture({
    data,
    format: 'pgp',
    recipients: [pgpPair.publicKey],
    filename: 'archive.zip',
    armored: false,
    signer: {
      github: 'alice',
      privateKey: pgpSigner.privateKey,
      passphrase: 'test-pass',
      registeredKeys: [pgpSigner.publicKey],
    },
  });
  const restored = await rpc('decrypt', { data: encrypted.bytes, privateKey: pgpPair.privateKey });
  assert.deepEqual(restored.bytes, data);
  assert.equal(restored.filename, 'archive.zip');
  assert.equal(restored.encoding, 'native-pgp');
});

test('native PGP and signed age preserve the exact 50 MiB plaintext boundary', async () => {
  const data = new Uint8Array(50 * 1024 ** 2);
  data[0] = 17;
  data[data.length - 1] = 239;
  for (const format of ['pgp', 'ssh']) {
    const signer = {
      github: 'alice',
      privateKey: format === 'pgp' ? pgpSigner.privateKey : sshPrivate,
      passphrase: 'test-pass',
      registeredKeys: [format === 'pgp' ? pgpSigner.publicKey : sshPublic],
    };
    const encrypted = await encryptFixture({
      data,
      format,
      recipients: [format === 'pgp' ? pgpPair.publicKey : sshPublic],
      filename: 'boundary.bin',
      armored: false,
      signer,
    });
    const restored = await rpc('decrypt', {
      data: encrypted.bytes,
      privateKey: format === 'pgp' ? pgpPair.privateKey : sshPrivate,
      passphrase: format === 'ssh' ? 'test-pass' : '',
    });
    assert.deepEqual(restored.bytes, data);
    assert.equal(restored.filename, 'boundary.bin');
    assert.equal(
      (
        await rpc('verify-github', {
          verification: restored.verification,
          registeredKeys: signer.registeredKeys,
        })
      ).matched,
      true,
    );
  }
});
