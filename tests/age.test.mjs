import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';

let dir, api;
const keys = {};
const bytes = new TextEncoder().encode('秘密のメッセージ\n\0binary 🐈');
const go = process.env.GO || 'go';
let cli;
before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dgpg-age-test-'));
  for (const [name, type, passphrase, pem] of [
    ['ed25519', 'ed25519', '', false],
    ['rsa', 'rsa', '', false],
    ['ed25519Locked', 'ed25519', 'test passphrase 日本語', false],
    ['rsaLocked', 'rsa', 'test passphrase 日本語', false],
    ['rsaPem', 'rsa', '', true],
    ['rsaPemLocked', 'rsa', 'test passphrase 日本語', true],
    ['ecdsa', 'ecdsa', '', false],
  ]) {
    const path = join(dir, name);
    execFileSync('ssh-keygen', [
      '-q',
      '-t',
      type,
      ...(type === 'rsa' ? ['-b', '2048'] : []),
      ...(pem ? ['-m', 'PEM'] : []),
      '-N',
      passphrase,
      '-C',
      'test-only',
      '-f',
      path,
    ]);
    const publicKey = await readFile(`${path}.pub`, 'utf8');
    keys[name] = { path, publicKey, privateKey: await readFile(path, 'utf8'), passphrase };
  }
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const raw = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url');
  // SSH wire framing only; Node generates the actual key pair.
  const wire = Buffer.concat([
    Buffer.from([0, 0, 0, 11]),
    Buffer.from('ssh-ed25519'),
    Buffer.from([0, 0, 0, 32]),
    raw,
  ]);
  const pkcs8 = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
  const path = join(dir, 'ed25519Pkcs8');
  await writeFile(path, pkcs8, { mode: 0o600 });
  keys.ed25519Pkcs8 = {
    path,
    privateKey: pkcs8,
    publicKey: `ssh-ed25519 ${wire.toString('base64')}`,
    passphrase: '',
  };
  keys.encryptedPkcs8 = privateKey
    .export({ format: 'pem', type: 'pkcs8', cipher: 'aes-256-cbc', passphrase: 'test-only' })
    .toString();
  try {
    await build({
      entryPoints: ['src/age.js'],
      outfile: join(dir, 'engine.mjs'),
      bundle: true,
      format: 'esm',
      platform: 'browser',
      target: 'es2020',
      loader: { '.wasm': 'binary' },
      logLevel: 'silent',
    });
    api = await import(`file://${join(dir, 'engine.mjs')}`);
  } catch (error) {
    assert.fail(`age browser API is unavailable: ${error.message}`);
  }
  cli = join(dir, 'age');
  await writeFile(
    join(dir, 'go.mod'),
    'module dgpg.local/age-test-cli\n\ngo 1.27.3\n\nrequire filippo.io/age v1.3.2\n',
  );
  execFileSync(go, ['build', '-mod=mod', '-o', cli, 'filippo.io/age/cmd/age'], {
    cwd: dir,
    stdio: 'pipe',
  });
});
after(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

for (const name of ['ed25519', 'rsa']) {
  test(`inspect ${name} with official SSH fingerprint`, async () => {
    const result = await api.inspectSSHKey(keys[name].publicKey);
    assert.equal(result.type, name === 'rsa' ? 'ssh-rsa' : 'ssh-ed25519');
    const expected = execFileSync('ssh-keygen', ['-lf', `${keys[name].path}.pub`], {
      encoding: 'utf8',
    }).split(' ')[1];
    assert.equal(result.fingerprint, expected);
  });
}
for (const name of [
  'ed25519',
  'rsa',
  'ed25519Locked',
  'rsaLocked',
  'rsaPem',
  'rsaPemLocked',
  'ed25519Pkcs8',
]) {
  test(`${name}: official age binary and armor roundtrip`, async () => {
    const key = keys[name];
    for (const armored of [false, true]) {
      const result = await api.encryptAge({ data: bytes, recipients: [key.publicKey], armored });
      assert.ok(result.bytes instanceof Uint8Array);
      assert.equal(result.text, armored ? new TextDecoder().decode(result.bytes) : null);
      assert.match(
        new TextDecoder().decode(result.bytes),
        armored ? /^-----BEGIN AGE ENCRYPTED FILE-----/ : /^age-encryption.org\/v1\n/,
      );
      assert.deepEqual(
        await api.decryptAge({
          data: result.bytes,
          privateKey: key.privateKey,
          passphrase: key.passphrase,
        }),
        bytes,
      );
    }
  });
}
test('multiple SSH recipients can each decrypt', async () => {
  const result = await api.encryptAge({
    data: bytes,
    recipients: [keys.ed25519.publicKey, keys.rsa.publicKey],
    armored: false,
  });
  for (const key of [keys.ed25519, keys.rsa])
    assert.deepEqual(
      await api.decryptAge({ data: result.bytes, privateKey: key.privateKey }),
      bytes,
    );
});
test('wrong passphrase and missing passphrase fail safely', async () => {
  for (const name of ['ed25519Locked', 'rsaLocked', 'rsaPemLocked']) {
    const key = keys[name];
    const result = await api.encryptAge({
      data: bytes,
      recipients: [key.publicKey],
      armored: false,
    });
    for (const passphrase of ['', 'incorrect'])
      await assert.rejects(
        api.decryptAge({ data: result.bytes, privateKey: key.privateKey, passphrase }),
        passphrase ? /パスフレーズ/ : { code: 'PASSPHRASE_REQUIRED' },
      );
  }
});
test('wrong key, payload tampering, and truncation fail authentication', async () => {
  const result = await api.encryptAge({
    data: bytes,
    recipients: [keys.ed25519.publicKey],
    armored: false,
  });
  await assert.rejects(
    api.decryptAge({ data: result.bytes, privateKey: keys.rsa.privateKey }),
    /復号/,
  );
  const altered = result.bytes.slice();
  altered[altered.length - 1] ^= 1;
  for (const data of [altered, result.bytes.slice(0, -1)])
    await assert.rejects(
      api.decryptAge({ data, privateKey: keys.ed25519.privateKey }),
      /復号|破損/,
    );
});
test('unsupported and malformed SSH keys are rejected', async () => {
  for (const publicKey of [
    keys.ecdsa.publicKey,
    'ssh-ed25519 invalid',
    keys.ed25519.publicKey + keys.rsa.publicKey,
  ]) {
    await assert.rejects(api.inspectSSHKey(publicKey), /SSH|鍵|対応/);
    await assert.rejects(
      api.encryptAge({ data: bytes, recipients: [publicKey], armored: false }),
      /SSH|鍵|対応/,
    );
  }
  await assert.rejects(api.decryptAge({ data: bytes, privateKey: keys.ecdsa.privateKey }), /対応/);
  await assert.rejects(
    api.decryptAge({ data: bytes, privateKey: keys.encryptedPkcs8, passphrase: 'test-only' }),
    /秘密鍵/,
  );
  await assert.rejects(api.encryptAge({ data: bytes, recipients: [], armored: false }), /公開鍵/);
});
test('input limits are checked before cryptography', async () => {
  await assert.rejects(
    api.encryptAge({
      data: new Uint8Array(50 * 1024 ** 2 + 1),
      recipients: [keys.ed25519.publicKey],
    }),
    /50 MiB/,
  );
  await assert.rejects(
    api.decryptAge({
      data: new Uint8Array(72 * 1024 ** 2 + 1),
      privateKey: keys.ed25519.privateKey,
    }),
    /72 MiB/,
  );
  await assert.rejects(api.inspectSSHKey('x'.repeat(1024 ** 2 + 1)), /1 MiB/);
  await assert.rejects(
    api.decryptAge({ data: bytes, privateKey: 'x'.repeat(1024 ** 2 + 1) }),
    /1 MiB/,
  );
});
for (const name of ['ed25519', 'rsa', 'rsaPem', 'ed25519Pkcs8']) {
  test(`${name}: standard age CLI decrypts browser output and browser decrypts CLI output`, async () => {
    const key = keys[name];
    for (const armored of [false, true]) {
      const result = await api.encryptAge({ data: bytes, recipients: [key.publicKey], armored });
      const fromBrowser = join(dir, `${name}-${armored}.age`);
      await writeFile(fromBrowser, result.bytes);
      assert.deepEqual(
        new Uint8Array(execFileSync(cli, ['--decrypt', '-i', key.path, fromBrowser])),
        bytes,
      );
      const cliOutput = execFileSync(
        cli,
        ['--encrypt', ...(armored ? ['--armor'] : []), '-r', key.publicKey],
        { input: bytes },
      );
      assert.deepEqual(
        await api.decryptAge({ data: new Uint8Array(cliOutput), privateKey: key.privateKey }),
        bytes,
      );
    }
  });
}

test('empty plaintext and string/ArrayBuffer inputs roundtrip', async () => {
  for (const data of ['', new ArrayBuffer(0), bytes.buffer]) {
    const result = await api.encryptAge({
      data,
      recipients: [keys.ed25519.publicKey],
      armored: true,
    });
    const restored = await api.decryptAge({
      data: result.text,
      privateKey: keys.ed25519.privateKey,
    });
    assert.deepEqual(
      restored,
      typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data),
    );
  }
});
test('malformed age header and armored payload are rejected', async () => {
  for (const armored of [false, true]) {
    const result = await api.encryptAge({
      data: bytes,
      recipients: [keys.ed25519.publicKey],
      armored,
    });
    const altered = result.bytes.slice();
    altered[armored ? Math.floor(altered.length / 2) : 1] ^= 1;
    await assert.rejects(
      api.decryptAge({ data: altered, privateKey: keys.ed25519.privateKey }),
      /復号|破損/,
    );
  }
});
test('50 MiB exact plaintext boundary roundtrips and oversized decrypted output is rejected', async () => {
  const data = new Uint8Array(50 * 1024 ** 2);
  data[0] = 123;
  data[data.length - 1] = 234;
  const result = await api.encryptAge({
    data,
    recipients: [keys.ed25519.publicKey],
    armored: false,
  });
  assert.deepEqual(
    await api.decryptAge({ data: result.bytes, privateKey: keys.ed25519.privateKey }),
    data,
  );
  const oversized = execFileSync(cli, ['--encrypt', '-r', keys.ed25519.publicKey], {
    input: Buffer.alloc(data.length + 1),
    maxBuffer: 73 * 1024 ** 2,
  });
  await assert.rejects(
    api.decryptAge({ data: new Uint8Array(oversized), privateKey: keys.ed25519.privateKey }),
    /50 MiB/,
  );
});
test('browser bundle also runs in a worker without Node imports', async () => {
  const { Worker } = await import('node:worker_threads');
  const path = join(dir, 'worker.mjs');
  await writeFile(
    path,
    `import { parentPort } from 'node:worker_threads';\nimport { inspectSSHKey } from './engine.mjs';\nparentPort.once('message', async key => {\n try { parentPort.postMessage(await inspectSSHKey(key)); }\n catch (error) { parentPort.postMessage({ error: error.message }); }\n});`,
  );
  const worker = new Worker(path);
  try {
    const result = await new Promise((resolve, reject) => {
      worker.once('message', resolve);
      worker.once('error', reject);
      worker.postMessage(keys.ed25519.publicKey);
    });
    assert.equal(result.type, 'ssh-ed25519');
    assert.match(result.fingerprint, /^SHA256:/);
  } finally {
    await worker.terminate();
  }
});
