import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { decryptPayload } from '../src/decrypt.js';

const exec = promisify(execFile);
const home = await mkdtemp(path.join(tmpdir(), 'dgpg-gpg-'));
await chmod(home, 0o700);
const destination = new URL('../test-results/fixtures/', import.meta.url);
await mkdir(destination, { recursive: true });
const uid = 'dgpg disposable compatibility test <dgpg@example.invalid>';
const passphrase = 'dgpg-test-only';
const gpg = (args) =>
  exec(
    'gpg',
    [
      '--homedir',
      home,
      '--batch',
      '--yes',
      '--pinentry-mode',
      'loopback',
      '--passphrase',
      passphrase,
      ...args,
    ],
    { encoding: 'buffer', maxBuffer: 8 * 1024 * 1024 },
  );
try {
  await gpg(['--quick-generate-key', uid, 'future-default', 'default', '0']);
  const text = new TextEncoder().encode(
    'GnuPGで暗号化したメッセージです。\r\n\n改行もそのまま復元します。\n<script>window.injected = true</script>\n',
  );
  const binary = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0, 0xff, 0xfe, 0x80, 13, 10, 0x7f]);
  await writeFile(path.join(home, 'message.txt'), text);
  await writeFile(path.join(home, 'payload.bin'), binary);
  await gpg([
    '--trust-model',
    'always',
    '--recipient',
    uid,
    '--output',
    path.join(home, 'message.asc'),
    '--armor',
    '--encrypt',
    path.join(home, 'message.txt'),
  ]);
  await gpg([
    '--trust-model',
    'always',
    '--recipient',
    uid,
    '--output',
    path.join(home, 'payload.bin.gpg'),
    '--encrypt',
    path.join(home, 'payload.bin'),
  ]);
  const armoredKey = (await gpg(['--armor', '--export-secret-keys', uid])).stdout;
  const binaryKey = (await gpg(['--export-secret-keys', uid])).stdout;
  const publicKey = (await gpg(['--armor', '--export', uid])).stdout;
  const ciphertext = await readFile(path.join(home, 'message.asc'));
  const ciphertextBinary = await readFile(path.join(home, 'payload.bin.gpg'));
  const result = await decryptPayload({
    privateKey: armoredKey.toString(),
    ciphertext: ciphertext.toString(),
    passphrase,
  });
  assert.deepEqual(result.bytes, text);
  const resultBinary = await decryptPayload({
    privateKey: new Uint8Array(binaryKey),
    ciphertext: new Uint8Array(ciphertextBinary),
    passphrase,
  });
  assert.deepEqual(resultBinary.bytes, binary);
  for (const [name, bytes] of Object.entries({
    'public.asc': publicKey,
    'secret.asc': armoredKey,
    'secret.gpg': binaryKey,
    'message.asc': ciphertext,
    'payload.bin.gpg': ciphertextBinary,
    'expected.txt': text,
    'expected.bin': binary,
  })) {
    await writeFile(new URL(name, destination), bytes);
  }
  console.log(
    'GnuPG interoperability passed: armored text and binary ciphertext/private keys match original bytes. Disposable browser fixtures: test-results/fixtures.',
  );
} finally {
  await exec('gpgconf', ['--homedir', home, '--kill', 'gpg-agent']).catch(() => {});
  await rm(home, { recursive: true, force: true });
}
