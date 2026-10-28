import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { createDecryptionCommand } from '../src/ui/decryption.js';

const block = (type) =>
  '-----BEGIN ' + type + '-----\ndisposable test data\n-----END ' + type + '-----\n';
const pgp = block('PGP MESSAGE');
const key = block('PGP PRIVATE KEY BLOCK');

test('one paste command handles both formats without clipboard configuration', () => {
  const command = createDecryptionCommand();
  assert.equal(typeof command, 'string');
  for (const text of ['暗号文を貼り付け', '秘密鍵を貼り付け', 'gpg', 'age', '復号した内容'])
    assert.ok(command.includes(text), text);
  assert.doesNotMatch(command, /pbpaste|wl-paste|xclip|message\.txt|--output restored/);
  assert.ok(command.indexOf('stty -echo') < command.indexOf('暗号文を貼り付け'));
  assert.throws(() => createDecryptionCommand('cmd'), /PowerShell|環境/);
});

async function fixture(output, fail = false) {
  const directory = await mkdtemp(join(tmpdir(), 'fumi-paste-test-'));
  await mkdir(join(directory, 'bin'));
  await writeFile(join(directory, 'output'), output);
  await writeFile(join(directory, 'restored'), 'existing file');
  const script =
    '#!/bin/sh\ncase " $* " in *" --import "*) exit 0;; esac\n' +
    'while [ "$#" -gt 0 ]; do\nif [ "$1" = --output ]; then shift; destination=$1; fi\nshift\ndone\n' +
    'cat "$FUMI_TEST_OUTPUT" > "$destination"\nexit ' +
    (fail ? '19' : '0') +
    '\n';
  for (const tool of ['gpg', 'age'])
    await writeFile(join(directory, 'bin', tool), script, { mode: 0o700 });
  await writeFile(join(directory, 'bin', 'gpgconf'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  const env = {
    ...process.env,
    PATH: join(directory, 'bin') + delimiter + process.env.PATH,
    FUMI_TEST_OUTPUT: join(directory, 'output'),
  };
  const execute = (input) =>
    spawnSync('/bin/sh', ['-c', createDecryptionCommand()], {
      cwd: directory,
      env,
      input,
      encoding: 'utf8',
    });
  return { directory, execute, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

test('verified text is displayed and an existing restored file is untouched', async () => {
  const f = await fixture('復号した文章。\n');
  try {
    const result = f.execute(pgp + key);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '復号した文章。\n');
    assert.equal(await readFile(join(f.directory, 'restored'), 'utf8'), 'existing file');
  } finally {
    await f.cleanup();
  }
});

test('wrong blocks, blank lines and shell-looking paste are retried without evaluation', async () => {
  const f = await fixture('correct result');
  try {
    const result = f.execute('\n' + key + 'touch injected\n' + pgp + pgp + key);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes('correct result'));
    assert.ok(!(await readdir(f.directory)).includes('injected'));
    assert.match(result.stderr, /もう一度/);
  } finally {
    await f.cleanup();
  }
});

test('failed decryption never displays partial plaintext', async () => {
  const f = await fixture('UNAUTHENTICATED CONTENT', true);
  try {
    const result = f.execute(pgp + key);
    assert.notEqual(result.status, 0);
    assert.ok(!result.stdout.includes('UNAUTHENTICATED CONTENT'));
    assert.equal(await readFile(join(f.directory, 'restored'), 'utf8'), 'existing file');
  } finally {
    await f.cleanup();
  }
});

test('binary and terminal control bytes are saved uniquely instead of printed', async () => {
  for (const data of [
    Buffer.from([0, 1, 255]),
    Buffer.from('text\u001b[31m'),
    Buffer.from('text\u009b31m'),
  ]) {
    const f = await fixture(data);
    try {
      const result = f.execute(pgp + key);
      assert.equal(result.status, 0, result.stderr);
      assert.ok(!result.stdout.includes('\u001b'));
      const saved = (await readdir(f.directory)).filter((name) => name.startsWith('restored-'));
      assert.equal(saved.length, 1);
      assert.deepEqual(await readFile(join(f.directory, saved[0])), data);
      assert.ok(result.stdout.includes(saved[0]));
      assert.equal(await readFile(join(f.directory, 'restored'), 'utf8'), 'existing file');
    } finally {
      await f.cleanup();
    }
  }
});

test('incomplete input fails without printing a key or result', async () => {
  const f = await fixture('not released');
  try {
    const result = f.execute(pgp + '-----BEGIN PGP PRIVATE KEY BLOCK-----\n');
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
  } finally {
    await f.cleanup();
  }
});

test('PowerShell has the same paste flow, verified display and cleanup', () => {
  const command = createDecryptionCommand('powershell');
  assert.doesNotMatch(command, /Get-Clipboard|--output restored/);
  for (const text of ['-AsSecureString', 'finally', 'Remove-Item', 'GetString', '復号した内容'])
    assert.ok(command.includes(text), text);
});
