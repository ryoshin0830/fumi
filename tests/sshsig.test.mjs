import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';

let dir, api, age;
const keys = {};
const data = new TextEncoder().encode('署名対象\n\0binary 🐈');
const go = process.env.GO || 'go';
before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dgpg-sshsig-test-'));
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
    keys[name] = {
      path,
      publicKey: await readFile(`${path}.pub`, 'utf8'),
      privateKey: await readFile(path, 'utf8'),
      passphrase,
    };
  }
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const raw = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url');
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
  await writeFile(`${path}.pub`, keys.ed25519Pkcs8.publicKey);
  keys.encryptedPkcs8 = privateKey
    .export({ format: 'pem', type: 'pkcs8', cipher: 'aes-256-cbc', passphrase: 'test-only' })
    .toString();
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
});
after(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

function signatureFields(signature) {
  const b = Buffer.from(signature.replace(/-----[^\n]+-----/g, '').replace(/\s/g, ''), 'base64');
  let offset = 10;
  const field = () => {
    const size = b.readUInt32BE(offset);
    offset += 4;
    const value = b.subarray(offset, offset + size);
    offset += size;
    return value;
  };
  field();
  const namespace = field().toString();
  field();
  const hash = field().toString();
  const inner = field();
  return { namespace, hash, algorithm: inner.subarray(4, 4 + inner.readUInt32BE(0)).toString() };
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
  test(`${name}: derive signing key, sign, verify and OpenSSH verifies browser SSHSIG`, async () => {
    assert.equal(typeof api.getSSHSigningKey, 'function');
    assert.equal(typeof api.signSSH, 'function');
    assert.equal(typeof api.verifySSH, 'function');
    const key = keys[name];
    const identity = await api.getSSHSigningKey(key);
    assert.equal(
      identity.publicKey.trim(),
      key.publicKey.trim().split(/\s+/).slice(0, 2).join(' '),
    );
    const expectedType = name.startsWith('rsa') ? 'ssh-rsa' : 'ssh-ed25519';
    assert.equal(identity.type, expectedType);
    const expectedFingerprint = execFileSync('ssh-keygen', ['-lf', `${key.path}.pub`], {
      encoding: 'utf8',
    }).split(' ')[1];
    assert.equal(identity.fingerprint, expectedFingerprint);
    const result = await api.signSSH({ data, ...key });
    const { signature, ...metadata } = result;
    assert.deepEqual(metadata, identity);
    assert.match(signature, /^-----BEGIN SSH SIGNATURE-----\n/);
    assert.deepEqual(signatureFields(signature), {
      namespace: 'dgpg',
      hash: 'sha512',
      algorithm: expectedType === 'ssh-rsa' ? 'rsa-sha2-512' : 'ssh-ed25519',
    });
    assert.deepEqual(await api.verifySSH({ data, signature, publicKey: identity.publicKey }), {
      type: identity.type,
      fingerprint: identity.fingerprint,
    });
    const signaturePath = join(dir, `${name}.browser.sig`);
    const allowedPath = join(dir, `${name}.allowed`);
    await writeFile(signaturePath, signature);
    await writeFile(allowedPath, `test ${identity.publicKey.trim()}\n`);
    const output = execFileSync(
      'ssh-keygen',
      ['-Y', 'verify', '-f', allowedPath, '-I', 'test', '-n', 'dgpg', '-s', signaturePath],
      { input: data, encoding: 'utf8' },
    );
    assert.match(output, /Good "dgpg" signature/);
  });
}
for (const name of ['ed25519', 'rsa', 'rsaPem']) {
  test(`${name}: browser verifies ssh-keygen -Y signatures and rejects key/data/namespace/hash mismatches`, async () => {
    const key = keys[name];
    for (const [namespace, hash] of [
      ['dgpg', 'sha512'],
      ['file', 'sha512'],
      ['dgpg', 'sha256'],
    ]) {
      const path = join(dir, `${name}-${namespace}-${hash}.message`);
      await writeFile(path, data);
      execFileSync(
        'ssh-keygen',
        ['-Y', 'sign', '-f', key.path, '-n', namespace, '-O', `hashalg=${hash}`, path],
        { stdio: 'pipe' },
      );
      const signature = await readFile(`${path}.sig`, 'utf8');
      const request = { data, signature, publicKey: key.publicKey };
      if (namespace !== 'dgpg' || hash !== 'sha512')
        await assert.rejects(api.verifySSH(request), /署名/);
      else {
        assert.equal(
          (await api.verifySSH(request)).type,
          name.startsWith('rsa') ? 'ssh-rsa' : 'ssh-ed25519',
        );
        await assert.rejects(
          api.verifySSH({ ...request, data: new Uint8Array([...data, 1]) }),
          /署名/,
        );
        await assert.rejects(
          api.verifySSH({ ...request, publicKey: keys.ecdsa.publicKey }),
          /対応|署名|鍵/,
        );
        await assert.rejects(
          api.verifySSH({
            ...request,
            publicKey: keys[name.startsWith('rsa') ? 'ed25519' : 'rsa'].publicKey,
          }),
          /署名/,
        );
      }
    }
  });
}
test('private key parser rejects missing/wrong passwords and unsupported keys without leaking secrets', async () => {
  for (const name of ['ed25519Locked', 'rsaLocked', 'rsaPemLocked']) {
    for (const passphrase of ['', 'incorrect']) {
      const request = { ...keys[name], passphrase };
      await assert.rejects(api.getSSHSigningKey(request), /パスフレーズ/);
      await assert.rejects(api.signSSH({ ...request, data }), /パスフレーズ/);
    }
  }
  for (const privateKey of [keys.ecdsa.privateKey, keys.encryptedPkcs8, 'not a private key']) {
    await assert.rejects(
      api.getSSHSigningKey({ privateKey, passphrase: 'test-only' }),
      /対応|秘密鍵/,
    );
    await assert.rejects(api.signSSH({ data, privateKey }), /対応|秘密鍵/);
  }
});
test('SSHSIG validates malformed signatures, public keys, data and 1MiB key/signature limits', async () => {
  const request = { data, signature: 'invalid', publicKey: keys.ed25519.publicKey };
  await assert.rejects(api.verifySSH(request), /署名/);
  const { signature } = await api.signSSH({ data, ...keys.ed25519 });
  for (const publicKey of ['invalid', keys.ed25519.publicKey + keys.rsa.publicKey])
    await assert.rejects(api.verifySSH({ ...request, signature, publicKey }), /鍵/);
  for (const field of ['signature', 'publicKey'])
    await assert.rejects(
      api.verifySSH({ ...request, signature, [field]: 'x'.repeat(1024 ** 2 + 1) }),
      /1 MiB/,
    );
  for (const field of ['privateKey', 'passphrase'])
    await assert.rejects(
      api.getSSHSigningKey({ ...keys.ed25519, [field]: 'x'.repeat(1024 ** 2 + 1) }),
      /1 MiB/,
    );
  await assert.rejects(
    api.signSSH({ ...keys.ed25519, data: new Uint8Array(52 * 1024 ** 2 + 1) }),
    /52 MiB/,
  );
  await assert.rejects(
    api.verifySSH({ ...request, signature, data: new Uint8Array(52 * 1024 ** 2 + 1) }),
    /52 MiB/,
  );
  for (const data of ['', new ArrayBuffer(0), new Uint8Array([0, 255]).buffer]) {
    const signed = await api.signSSH({ data, ...keys.ed25519 });
    await api.verifySSH({ data, signature: signed.signature, publicKey: signed.publicKey });
  }
});
test('age container allowance reaches exactly52MiB while default50MiB and encrypted72MiB remain bounded', async () => {
  const key = keys.ed25519;
  await assert.rejects(
    api.encryptAge({ data: new Uint8Array(50 * 1024 ** 2 + 1), recipients: [key.publicKey] }),
    /50 MiB/,
  );
  await assert.rejects(
    api.encryptAge({
      data: new Uint8Array(52 * 1024 ** 2 + 1),
      recipients: [key.publicKey],
      container: true,
    }),
    /52 MiB/,
  );
  await assert.rejects(
    api.decryptAge({ data: new Uint8Array(72 * 1024 ** 2 + 1), ...key, container: true }),
    /72 MiB/,
  );
  const plaintext = new Uint8Array(52 * 1024 ** 2);
  plaintext[0] = 123;
  plaintext[plaintext.length - 1] = 234;
  const encrypted = await api.encryptAge({
    data: plaintext,
    recipients: [key.publicKey],
    container: true,
  });
  await assert.rejects(api.decryptAge({ data: encrypted.bytes, ...key }), /50 MiB/);
  assert.deepEqual(
    await api.decryptAge({ data: encrypted.bytes, ...key, container: true }),
    plaintext,
  );
  age = join(dir, 'age');
  await writeFile(
    join(dir, 'go.mod'),
    'module dgpg.local/sshsig-test-cli\n\ngo 1.27.3\n\nrequire filippo.io/age v1.3.2\n',
  );
  execFileSync(go, ['build', '-mod=mod', '-o', age, 'filippo.io/age/cmd/age'], {
    cwd: dir,
    stdio: 'pipe',
  });
  const oversized = execFileSync(age, ['--encrypt', '-r', key.publicKey], {
    input: Buffer.alloc(plaintext.length + 1),
    maxBuffer: 73 * 1024 ** 2,
  });
  await assert.rejects(
    api.decryptAge({ data: new Uint8Array(oversized), ...key, container: true }),
    /52 MiB/,
  );
});
