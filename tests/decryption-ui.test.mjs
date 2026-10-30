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
    '#!/bin/sh\nfor argument do source=$argument; done\n' +
    'case " $* " in *" --import "*) cat "$source" > "$FUMI_TEST_KEY"; exit 0;; esac\n' +
    'cat "$source" > "$FUMI_TEST_CIPHER"\n' +
    'while [ "$#" -gt 0 ]; do\nif [ "$1" = --output ]; then shift; destination=$1; fi\nshift\ndone\n' +
    'if [ -s "$FUMI_TEST_OUTPUT" ]; then cat "$FUMI_TEST_OUTPUT" > "$destination"; fi\nexit ' +
    (fail ? '19' : '0') +
    '\n';
  for (const tool of ['gpg', 'age'])
    await writeFile(join(directory, 'bin', tool), script, { mode: 0o700 });
  await writeFile(join(directory, 'bin', 'gpgconf'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  const env = {
    ...process.env,
    PATH: join(directory, 'bin') + delimiter + process.env.PATH,
    FUMI_TEST_OUTPUT: join(directory, 'output'),
    FUMI_TEST_KEY: join(directory, 'received-key'),
    FUMI_TEST_CIPHER: join(directory, 'received-cipher'),
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

for (const [format, cipher, secret] of [
  ['armored-pgp', pgp, key],
  ['binary-pgp', Buffer.from([0xc1, 3, 0, 255]), Buffer.from([0xc5, 0, 255])],
  ['armored-age', block('AGE ENCRYPTED FILE'), block('OPENSSH PRIVATE KEY')],
  ['raw-age', Buffer.from('age-encryption.org/v1\n\x00\xff'), 'AGE-SECRET-KEY-1TEST\n'],
]) {
  test(`${format} files are read as bytes and even UTF-8 output is saved privately`, async () => {
    const f = await fixture('text file contents\r\n');
    try {
      const cipherName = '暗号文 with spaces';
      const keyName = 'key $(touch injected)';
      await writeFile(join(f.directory, cipherName), cipher);
      await writeFile(join(f.directory, keyName), secret);
      const result = f.execute(`"${cipherName}"\n'${keyName}'\n`);
      assert.equal(result.status, 0, result.stderr);
      assert.ok(!result.stdout.includes('text file contents'));
      const saved = (await readdir(f.directory)).filter((name) => name.startsWith('restored-'));
      assert.equal(saved.length, 1);
      assert.equal(await readFile(join(f.directory, saved[0]), 'utf8'), 'text file contents\r\n');
      const { stat } = await import('node:fs/promises');
      assert.equal((await stat(join(f.directory, saved[0]))).mode & 0o777, 0o600);
      assert.deepEqual(await readFile(join(f.directory, 'received-cipher')), Buffer.from(cipher));
      if (format.includes('pgp'))
        assert.deepEqual(await readFile(join(f.directory, 'received-key')), Buffer.from(secret));
      assert.deepEqual(await readFile(join(f.directory, cipherName)), Buffer.from(cipher));
      assert.deepEqual(await readFile(join(f.directory, keyName)), Buffer.from(secret));
      assert.equal(await readFile(join(f.directory, 'restored'), 'utf8'), 'existing file');
      assert.ok(!(await readdir(f.directory)).includes('injected'));
    } finally {
      await f.cleanup();
    }
  });
}

test('missing paths and wrong file types retry before accepting a file and a pasted key', async () => {
  const f = await fixture(Buffer.from([0, 255]));
  try {
    await writeFile(join(f.directory, 'cipher'), pgp);
    await writeFile(join(f.directory, 'key'), key);
    const result = f.execute('missing file\nkey\ncipher\n' + key);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /もう一度/);
    assert.equal((await readdir(f.directory)).filter((n) => n.startsWith('restored-')).length, 1);
  } finally {
    await f.cleanup();
  }
});

test('pasted text can use a key file and failed file decryption saves no partial output', async () => {
  for (const fail of [false, true]) {
    const f = await fixture('authenticated text', fail);
    try {
      await writeFile(join(f.directory, 'key'), key);
      await writeFile(join(f.directory, 'cipher'), pgp);
      const result = f.execute((fail ? 'cipher\n' : pgp) + 'key\n');
      assert.equal(result.status, fail ? 19 : 0, result.stderr);
      assert.equal(result.stdout.includes('authenticated text'), !fail);
      assert.equal((await readdir(f.directory)).filter((n) => n.startsWith('restored-')).length, 0);
    } finally {
      await f.cleanup();
    }
  }
});

test('an empty age file is saved even when age succeeds without creating its output', async () => {
  const f = await fixture(Buffer.alloc(0));
  try {
    await writeFile(join(f.directory, 'cipher.age'), block('AGE ENCRYPTED FILE'));
    const result = f.execute('cipher.age\nAGE-SECRET-KEY-1TEST\n');
    assert.equal(result.status, 0, result.stderr);
    const saved = (await readdir(f.directory)).filter((name) => name.startsWith('restored-'));
    assert.equal(saved.length, 1);
    assert.equal((await readFile(join(f.directory, saved[0]))).length, 0);
  } finally {
    await f.cleanup();
  }
});

test('PowerShell has the same paste flow, verified display and cleanup', () => {
  const command = createDecryptionCommand('powershell');
  assert.doesNotMatch(command, /Get-Clipboard|--output restored/);
  for (const text of ['-AsSecureString', 'finally', 'Remove-Item', 'GetString', '復号した内容'])
    assert.ok(command.includes(text), text);
  for (const text of ['ファイルパス', '-LiteralPath', 'ReadAllBytes', 'WriteAllBytes'])
    assert.ok(command.includes(text), text);
});
