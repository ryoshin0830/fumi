import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import * as pgp from 'openpgp';
import { unzipSync, zipSync } from 'fflate';

let api, directory, signer, other;
const bytes = new Uint8Array([0, 255, 10, 13, 128, 65]);
before(async () => {
  signer = await pgp.generateKey({
    type: 'ecc',
    curve: 'curve25519Legacy',
    userIDs: [{ name: 'Same name', email: 'same@example.invalid' }],
    subkeys: [],
    passphrase: 'secret-pass',
  });
  other = await pgp.generateKey({
    type: 'ecc',
    curve: 'curve25519Legacy',
    userIDs: [{ name: 'Same name', email: 'same@example.invalid' }],
    subkeys: [],
  });
  directory = await mkdtemp(join(tmpdir(), 'dgpg-signatures-'));
  execFileSync('ssh-keygen', [
    '-q',
    '-t',
    'ed25519',
    '-N',
    '',
    '-C',
    'disposable',
    '-f',
    join(directory, 'ssh-key'),
  ]);
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
  api = await import('file://' + join(directory, 'api.mjs'));
});
after(async () => {
  await rm(directory, { recursive: true, force: true });
});
const options = () => ({
  data: bytes,
  filename: 'secret.bin',
  github: 'Alice',
  privateKey: signer.privateKey,
  passphrase: 'secret-pass',
  registeredKeys: [signer.publicKey],
});

test('signing-only OpenPGP key signs exact bytes and binds GitHub name and fingerprint', async () => {
  const packaged = await api.createSignedPackage(options());
  assert.ok(packaged?.bytes instanceof Uint8Array);
  const restored = await api.readSignedPackage(packaged.bytes);
  assert.deepEqual(restored.bytes, bytes);
  assert.equal(restored.filename, 'secret.bin');
  assert.equal(restored.verification.github, 'alice');
  assert.equal(restored.verification.type, 'pgp');
  assert.equal(
    await api.verifyRegisteredSignature({
      verification: restored.verification,
      registeredKeys: [signer.publicKey],
    }),
    true,
  );
});
test('same name/email on a different key cannot satisfy GitHub verification or signing', async () => {
  await assert.rejects(
    api.createSignedPackage({ ...options(), registeredKeys: [other.publicKey] }),
    /GitHub|一致/,
  );
  const packaged = await api.createSignedPackage(options());
  const restored = await api.readSignedPackage(packaged.bytes);
  assert.equal(
    await api.verifyRegisteredSignature({
      verification: restored.verification,
      registeredKeys: [other.publicKey],
    }),
    false,
  );
  assert.equal(
    await api.verifyRegisteredSignature({
      verification: restored.verification,
      registeredKeys: [],
    }),
    false,
  );
});
test('wrong signer passphrase and invalid GitHub usernames fail', async () => {
  await assert.rejects(
    api.createSignedPackage({ ...options(), passphrase: 'wrong' }),
    /パスフレーズ/,
  );
  await assert.rejects(
    api.createSignedPackage({ ...options(), github: 'https://evil.example/x' }),
    /GitHub/,
  );
});
test('unsigned ordinary data and unmarked ZIPs remain ordinary files', async () => {
  assert.equal(await api.readSignedPackage(bytes), null);
  assert.equal(
    await api.readSignedPackage(
      new TextEncoder().encode('An ordinary unsigned text file ending with dgpg-signed-v1'),
    ),
    null,
  );
  assert.equal(
    await api.readSignedPackage(zipSync({ 'hello.txt': new TextEncoder().encode('ordinary') })),
    null,
  );
});
test('changing payload, claimed GitHub username, signature or public key is rejected', async () => {
  const packaged = await api.createSignedPackage(options());
  const original = unzipSync(packaged.bytes);
  for (const entry of [
    'README.txt',
    'content/secret.bin',
    'signature/manifest.json',
    'signature/manifest.asc',
    'signature/content.asc',
    'signature/public.asc',
  ]) {
    const files = Object.fromEntries(
      Object.entries(original).map(([name, value]) => [name, value.slice()]),
    );
    if (entry === 'signature/manifest.json') {
      const manifest = JSON.parse(new TextDecoder().decode(files[entry]));
      manifest.github = 'mallory';
      files[entry] = new TextEncoder().encode(JSON.stringify(manifest));
    } else files[entry][Math.floor(files[entry].length / 2)] ^= 1;
    // Rebuild with the original standard archive comment.
    await assert.rejects(
      api.readSignedPackage(api.addPackageMarker(zipSync(files, { level: 0 }))),
      /署名|変更|形式|鍵/,
    );
  }
});
test('missing/extra and compressed package entries are rejected', async () => {
  const packaged = await api.createSignedPackage(options());
  const files = unzipSync(packaged.bytes);
  delete files['content/secret.bin'];
  await assert.rejects(
    api.readSignedPackage(api.addPackageMarker(zipSync(files, { level: 0 }))),
    /形式|内容/,
  );
  const extra = { ...unzipSync(packaged.bytes), '../unsafe': new Uint8Array([1]) };
  await assert.rejects(
    api.readSignedPackage(api.addPackageMarker(zipSync(extra, { level: 0 }))),
    /形式|内容/,
  );
  await assert.rejects(
    api.readSignedPackage(api.addPackageMarker(zipSync(unzipSync(packaged.bytes), { level: 6 }))),
    /形式|圧縮/,
  );
  const hidden = zipSync(extra, { level: 0 });
  const view = new DataView(hidden.buffer);
  view.setUint16(hidden.length - 14, 6, true);
  view.setUint16(hidden.length - 12, 6, true);
  await assert.rejects(api.readSignedPackage(api.addPackageMarker(hidden)), /形式|内容/);
  const orphaned = zipSync(extra, { level: 0 });
  const orphanView = new DataView(orphaned.buffer);
  const directoryStart = orphanView.getUint32(orphaned.length - 6, true);
  let seventh = directoryStart;
  for (let i = 0; i < 6; i++)
    seventh +=
      46 +
      orphanView.getUint16(seventh + 28, true) +
      orphanView.getUint16(seventh + 30, true) +
      orphanView.getUint16(seventh + 32, true);
  const noSeventhCentral = new Uint8Array(seventh + 22);
  noSeventhCentral.set(orphaned.subarray(0, seventh));
  noSeventhCentral.set(orphaned.subarray(orphaned.length - 22), seventh);
  const noSeventhView = new DataView(noSeventhCentral.buffer);
  noSeventhView.setUint16(seventh + 8, 6, true);
  noSeventhView.setUint16(seventh + 10, 6, true);
  noSeventhView.setUint32(seventh + 12, seventh - directoryStart, true);
  await assert.rejects(api.readSignedPackage(api.addPackageMarker(noSeventhCentral)), /形式|内容/);
  const renamed = packaged.bytes.slice();
  const at = new TextDecoder().decode(renamed).indexOf('content/secret.bin');
  renamed.set(new TextEncoder().encode('evil'), at);
  await assert.rejects(api.readSignedPackage(renamed), /形式|内容/);
});

test('ZIP metadata cannot turn a signed regular file into a symlink', async () => {
  const packaged = await api.createSignedPackage({
    ...options(),
    data: new TextEncoder().encode('manifest.json'),
  });
  const changed = packaged.bytes.slice();
  const view = new DataView(changed.buffer);
  const end = changed.length - 22 - 'dgpg-signed-v2'.length;
  let cursor = view.getUint32(end + 16, true);
  for (let i = 0; i < 6; i++) {
    const length = view.getUint16(cursor + 28, true);
    const name = new TextDecoder().decode(changed.subarray(cursor + 46, cursor + 46 + length));
    if (name === 'content/secret.bin') {
      view.setUint16(cursor + 4, 0x0314, true);
      view.setUint32(cursor + 38, (0o120777 << 16) >>> 0, true);
    }
    cursor += 46 + length + view.getUint16(cursor + 30, true) + view.getUint16(cursor + 32, true);
  }
  await assert.rejects(api.readSignedPackage(changed), /形式|内容/);
});

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const digest = async (data) =>
  Buffer.from(await crypto.subtle.digest('SHA-256', data)).toString('hex');
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";

test('v2 uses exactly six readable STORE members and binds its bilingual README', async () => {
  const packaged = await api.createSignedPackage(options());
  assert.equal(decoder.decode(packaged.bytes.subarray(-14)), 'dgpg-signed-v2');
  const files = unzipSync(packaged.bytes);
  assert.deepEqual(Object.keys(files), [
    'README.txt',
    'content/secret.bin',
    'signature/manifest.json',
    'signature/manifest.asc',
    'signature/content.asc',
    'signature/public.asc',
  ]);
  assert.deepEqual(files['content/secret.bin'], bytes);
  const manifest = JSON.parse(decoder.decode(files['signature/manifest.json']));
  assert.equal(manifest.version, 2);
  assert.equal(manifest.readmeSha256, await digest(files['README.txt']));
  const readme = decoder.decode(files['README.txt']);
  assert.match(readme, /日本語/);
  assert.match(readme, /English/);
  assert.match(readme, /age/);
  assert.match(readme, /GitHub/);
  assert.ok(readme.includes("gpg --verify './signature/content.asc' './content/secret.bin'"));
  assert.ok(readme.includes("gpg --verify './signature/manifest.asc' './signature/manifest.json'"));
  assert.ok(files['README.txt'].length <= 64 * 1024);
  const verification = await pgp.verify({
    message: await pgp.createMessage({ binary: bytes }),
    signature: await pgp.readSignature({
      armoredSignature: decoder.decode(files['signature/content.asc']),
    }),
    verificationKeys: await pgp.readKey({ armoredKey: signer.publicKey }),
  });
  await verification.signatures[0].verified;
  assert.equal((await api.readSignedPackage(packaged.bytes)).encoding, 'signed-zip');
});

test('original Japanese, apostrophe, leading dash and reserved names stay under content and are shell quoted', async () => {
  for (const filename of [
    "日本語's.txt",
    '-leading.txt',
    'README.txt',
    'manifest.json',
    'public.asc',
    '../outside.txt',
  ]) {
    const packaged = await api.createSignedPackage({ ...options(), filename });
    const files = unzipSync(packaged.bytes);
    const safe = filename === '../outside.txt' ? 'outside.txt' : filename;
    assert.deepEqual(files['content/' + safe], bytes);
    assert.ok(decoder.decode(files['README.txt']).includes(quote('./content/' + safe)));
    assert.equal((await api.readSignedPackage(packaged.bytes)).filename, safe);
  }
});

test('legacy v1 four-member packages still recover and verify', async () => {
  const manifest = encoder.encode(
    JSON.stringify({
      version: 1,
      context: 'dgpg-signed',
      github: 'alice',
      type: 'pgp',
      fingerprint: (await pgp.readKey({ armoredKey: signer.publicKey })).getFingerprint(),
      filename: 'legacy.bin',
      size: bytes.length,
      sha256: await digest(bytes),
    }),
  );
  const privateKey = await pgp.decryptKey({
    privateKey: await pgp.readPrivateKey({ armoredKey: signer.privateKey }),
    passphrase: 'secret-pass',
  });
  const signature = await pgp.sign({
    message: await pgp.createMessage({ binary: manifest }),
    signingKeys: privateKey,
    detached: true,
    format: 'armored',
  });
  const archive = api.addPackageMarker(
    zipSync(
      {
        'manifest.json': manifest,
        data: bytes,
        'signature.asc': encoder.encode(signature),
        'public.key': encoder.encode(signer.publicKey),
      },
      { level: 0 },
    ),
    1,
  );
  const result = await api.readSignedPackage(archive);
  assert.deepEqual(result.bytes, bytes);
  assert.equal(result.filename, 'legacy.bin');
  assert.equal(result.encoding, 'signed-zip');
  assert.equal(
    await api.verifyRegisteredSignature({
      verification: result.verification,
      registeredKeys: [signer.publicKey],
    }),
    true,
  );
});

test('v2 parser rejects BOM-disguised names and incorrect matching CRC metadata', async () => {
  const packaged = await api.createSignedPackage(options());
  const files = unzipSync(packaged.bytes);
  const disguised = Object.fromEntries(
    Object.entries(files).map(([name, value]) => [
      name === 'README.txt' ? '\uFEFF' + name : name,
      value,
    ]),
  );
  await assert.rejects(
    api.readSignedPackage(api.addPackageMarker(zipSync(disguised, { level: 0 }))),
    /形式|内容/,
  );
  const changed = packaged.bytes.slice();
  const view = new DataView(changed.buffer);
  const end = changed.length - 22 - 'dgpg-signed-v2'.length;
  const central = view.getUint32(end + 16, true);
  const local = view.getUint32(central + 42, true);
  view.setUint32(central + 16, 0, true);
  view.setUint32(local + 14, 0, true);
  await assert.rejects(api.readSignedPackage(changed), /形式|内容/);
});

test('PGP direct-file verification handles content larger than the historical manifest limit', async () => {
  const data = new Uint8Array(32 * 1024 + 1).fill(255);
  const packaged = await api.createSignedPackage({ ...options(), data });
  assert.deepEqual((await api.readSignedPackage(packaged.bytes)).bytes, data);
});

test('SSH packages expose native direct and manifest verification commands with safe filenames', async () => {
  const path = join(directory, 'ssh-key');
  const privateKey = await readFile(path, 'utf8');
  const publicKey = await readFile(path + '.pub', 'utf8');
  const filename = "-日本語'; touch INJECTED; '.bin";
  const packaged = await api.createSignedPackage({
    data: bytes,
    filename,
    github: 'Alice',
    privateKey,
    registeredKeys: [publicKey],
  });
  const restored = await api.readSignedPackage(packaged.bytes);
  assert.deepEqual(restored.bytes, bytes);
  assert.equal(restored.verification.type, 'ssh');
  assert.equal(
    await api.verifyRegisteredSignature({
      verification: restored.verification,
      registeredKeys: [publicKey],
    }),
    true,
  );
  const files = unzipSync(packaged.bytes);
  assert.deepEqual(Object.keys(files), [
    'README.txt',
    'content/' + filename,
    'signature/manifest.json',
    'signature/manifest.sig',
    'signature/content.sig',
    'signature/public.pub',
  ]);
  const extracted = join(directory, 'extracted');
  await mkdir(join(extracted, 'content'), { recursive: true });
  await mkdir(join(extracted, 'signature'));
  for (const [name, data] of Object.entries(files)) await writeFile(join(extracted, name), data);
  const commands = decoder
    .decode(files['README.txt'])
    .split('\n')
    .filter((line) => /^(awk |ssh-keygen |shasum )/.test(line));
  const output = execFileSync('/bin/sh', ['-c', commands.join('\n')], {
    cwd: extracted,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  assert.equal(output.match(/Good "dgpg" signature/g)?.length, 2);
  await assert.rejects(readFile(join(extracted, 'INJECTED')), /ENOENT/);
  for (const name of ['signature/manifest.sig', 'signature/content.sig']) {
    const tampered = { ...files, [name]: files[name].slice() };
    tampered[name][60] ^= 1;
    await assert.rejects(
      api.readSignedPackage(api.addPackageMarker(zipSync(tampered, { level: 0 }))),
      /署名|形式/,
    );
  }
});

test('ZIP names require UTF-8 flags for non-ASCII and local metadata must agree', async () => {
  const packaged = await api.createSignedPackage({ ...options(), filename: '日本語.bin' });
  const end = packaged.bytes.length - 22 - 'dgpg-signed-v2'.length;
  const originalView = new DataView(packaged.bytes.buffer);
  let central = originalView.getUint32(end + 16, true);
  central += 46 + originalView.getUint16(central + 28, true);
  const local = originalView.getUint32(central + 42, true);
  const noUTF8 = packaged.bytes.slice();
  const flags = new DataView(noUTF8.buffer);
  flags.setUint16(central + 8, 0, true);
  flags.setUint16(local + 6, 0, true);
  await assert.rejects(api.readSignedPackage(noUTF8), /形式|内容/);
  for (const [localField, centralField] of [
    [4, 6],
    [10, 12],
    [12, 14],
  ]) {
    const changed = packaged.bytes.slice();
    const view = new DataView(changed.buffer);
    view.setUint16(local + localField, view.getUint16(central + centralField, true) ^ 1, true);
    await assert.rejects(api.readSignedPackage(changed), /形式|内容/);
  }
});

test('v2 rejects traversal, directory, duplicate, mixed-signature, oversized and invalid-flag members', async () => {
  const packaged = await api.createSignedPackage(options());
  const original = unzipSync(packaged.bytes);
  for (const replacement of [
    '../secret.bin',
    '/secret.bin',
    'content/../secret.bin',
    'content/dir/secret.bin',
    'content\\secret.bin',
    'content/',
    'signature/content.sig',
  ]) {
    const files = Object.fromEntries(
      Object.entries(original).map(([name, value]) => [
        name === 'content/secret.bin' ? replacement : name,
        value,
      ]),
    );
    await assert.rejects(
      api.readSignedPackage(api.addPackageMarker(zipSync(files, { level: 0 }))),
      /形式|内容/,
    );
  }
  const end = packaged.bytes.length - 22 - 'dgpg-signed-v2'.length;
  const originalView = new DataView(packaged.bytes.buffer);
  const central = originalView.getUint32(end + 16, true);
  const local = originalView.getUint32(central + 42, true);
  for (const flag of [1, 8, 0x40, 0x1000]) {
    const changed = packaged.bytes.slice();
    const view = new DataView(changed.buffer);
    view.setUint16(central + 8, flag, true);
    view.setUint16(local + 6, flag, true);
    await assert.rejects(api.readSignedPackage(changed), /形式|内容/);
  }
  const oversized = packaged.bytes.slice();
  const size = new DataView(oversized.buffer);
  for (const offset of [central + 20, central + 24, local + 18, local + 22])
    size.setUint32(offset, 64 * 1024 + 1, true);
  await assert.rejects(api.readSignedPackage(oversized), /形式|内容/);
  const duplicate = packaged.bytes.slice();
  const duplicateView = new DataView(duplicate.buffer);
  let cursor = central;
  const matching = [];
  for (let i = 0; i < 6; i++) {
    const length = duplicateView.getUint16(cursor + 28, true);
    const name = decoder.decode(duplicate.subarray(cursor + 46, cursor + 46 + length));
    if (/^signature\/(manifest|content)\.asc$/.test(name)) matching.push(cursor);
    cursor += 46 + length;
  }
  duplicate.set(encoder.encode('signature/content.asc'), matching[0] + 46);
  await assert.rejects(api.readSignedPackage(duplicate), /形式|内容/);
  const wrongMarker = packaged.bytes.slice();
  wrongMarker[wrongMarker.length - 1] = '1'.charCodeAt(0);
  await assert.rejects(api.readSignedPackage(wrongMarker), /形式|内容/);
});

test('filename truncation cannot leave an unencodable surrogate in the signed name', async () => {
  const packaged = await api.createSignedPackage({
    ...options(),
    filename: 'a'.repeat(179) + '🐈.txt',
  });
  const result = await api.readSignedPackage(packaged.bytes);
  assert.deepEqual(result.bytes, bytes);
  assert.equal(result.filename, 'a'.repeat(179) + '\ufffd');
});

test('PGP README commands verify both native detached signatures in an isolated keyring', async () => {
  const filename = "-日本語's.bin";
  const packaged = await api.createSignedPackage({ ...options(), filename });
  const files = unzipSync(packaged.bytes);
  const extracted = join(directory, 'pgp-extracted');
  const keyring = join(directory, 'gnupg');
  await mkdir(join(extracted, 'content'), { recursive: true });
  await mkdir(join(extracted, 'signature'));
  await mkdir(keyring, { mode: 0o700 });
  for (const [name, data] of Object.entries(files)) await writeFile(join(extracted, name), data);
  const commands = decoder
    .decode(files['README.txt'])
    .split('\n')
    .filter((line) => /^(gpg |shasum )/.test(line));
  execFileSync('/bin/sh', ['-c', commands.join('\n')], {
    cwd: extracted,
    env: { ...process.env, GNUPGHOME: keyring, LC_ALL: 'C' },
    stdio: 'pipe',
  });
});

test('legacy SSH v1 recovers native SSHSIG manifests with strict four-member boundaries', async () => {
  const privatePath = join(directory, 'ssh-key');
  const publicKey = (await readFile(privatePath + '.pub', 'utf8')).trim();
  const fingerprint = execFileSync('ssh-keygen', ['-lf', privatePath + '.pub'], {
    encoding: 'utf8',
  }).split(' ')[1];
  const manifest = encoder.encode(
    JSON.stringify({
      version: 1,
      context: 'dgpg-signed',
      github: 'alice',
      type: 'ssh',
      fingerprint,
      filename: 'legacy.bin',
      size: bytes.length,
      sha256: await digest(bytes),
    }),
  );
  const manifestPath = join(directory, 'legacy-manifest.json');
  await writeFile(manifestPath, manifest);
  execFileSync(
    'ssh-keygen',
    ['-Y', 'sign', '-f', privatePath, '-n', 'dgpg', '-O', 'hashalg=sha512', manifestPath],
    { stdio: 'pipe' },
  );
  const files = {
    'manifest.json': manifest,
    data: bytes,
    'signature.asc': new Uint8Array(await readFile(manifestPath + '.sig')),
    'public.key': encoder.encode(publicKey),
  };
  const makeArchive = (files) => api.addPackageMarker(zipSync(files, { level: 0 }), 1);
  const restored = await api.readSignedPackage(makeArchive(files));
  assert.deepEqual(restored.bytes, bytes);
  assert.equal(restored.filename, 'legacy.bin');
  assert.equal(
    await api.verifyRegisteredSignature({
      verification: restored.verification,
      registeredKeys: [publicKey],
    }),
    true,
  );
  await assert.rejects(
    api.readSignedPackage(makeArchive({ ...files, 'README.txt': encoder.encode('extra') })),
    /形式|内容/,
  );
  await assert.rejects(
    api.readSignedPackage(makeArchive({ ...files, data: new Uint8Array([1]) })),
    /形式|内容|署名/,
  );
  await assert.rejects(
    api.readSignedPackage(api.addPackageMarker(zipSync(files, { level: 6 }), 1)),
    /形式|内容/,
  );
});

test('manifest JSON primitives, arrays and non-string digest fields produce bounded format errors', async () => {
  const packaged = await api.createSignedPackage(options());
  const original = unzipSync(packaged.bytes);
  const manifest = JSON.parse(decoder.decode(original['signature/manifest.json']));
  for (const value of [
    null,
    true,
    1,
    'manifest',
    [],
    {},
    { ...manifest, sha256: { toString: null, valueOf: null } },
    { ...manifest, readmeSha256: { toString: null, valueOf: null } },
  ]) {
    const files = { ...original, 'signature/manifest.json': encoder.encode(JSON.stringify(value)) };
    await assert.rejects(
      api.readSignedPackage(api.addPackageMarker(zipSync(files, { level: 0 }))),
      /形式|内容/,
    );
  }
});
