import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createDecryptionCommand } from '../src/ui/decryption.js';

const pgp = '-----BEGIN PGP MESSAGE-----\n';
const age = '-----BEGIN AGE ENCRYPTED FILE-----\n';

function argv(command, program) {
  const result = spawnSync('/bin/sh', ['-c', `${program}() { printf '%s\\0' "$@"; }; ${command}`]);
  assert.equal(result.status, 0, result.stderr.toString());
  return result.stdout.toString().split('\0').slice(0, -1);
}

test('selects commands from text and binary headers, independently of extension', () => {
  for (const data of [pgp, new Uint8Array([0xc1, 10, 20])]) {
    const result = createDecryptionCommand({ data, sourceName: 'actually.age' });
    assert.equal(result.format, 'pgp');
    assert.deepEqual(argv(result.command, 'gpg'), [
      '--output',
      'restored',
      '--decrypt',
      './actually.age',
    ]);
  }
  for (const data of [age, new TextEncoder().encode('age-encryption.org/v1\n')]) {
    assert.equal(createDecryptionCommand({ data, sourceName: 'actually.asc' }).format, 'ssh');
  }
});

test('uses the exact uploaded filename or the matching paste download filename', () => {
  assert.deepEqual(createDecryptionCommand({ data: pgp }), {
    format: 'pgp',
    filename: 'message.txt.asc',
    command: "gpg --output restored --decrypt './message.txt.asc'",
  });
  assert.equal(createDecryptionCommand({ data: age }).filename, 'message.txt.age');
  const sourceName = '  日本語 report.v2.age  ';
  const result = createDecryptionCommand({ data: age, sourceName });
  assert.equal(result.filename, sourceName);
  assert.equal(argv(result.command, 'age').at(-1), './' + sourceName);
});

test('POSIX passes adversarial filenames as one literal argument', () => {
  for (const sourceName of [
    '-o',
    "a'b.age",
    '$(printf injected).age',
    '`printf injected`.age',
    'a; printf injected #.age',
    'a"b $HOME *.age',
    'a\nb.age',
    'dir/name.age',
    '/tmp/an absolute name.age',
  ]) {
    const result = createDecryptionCommand({ data: pgp, sourceName });
    assert.equal(result.filename, sourceName);
    assert.deepEqual(argv(result.command, 'gpg'), [
      '--output',
      'restored',
      '--decrypt',
      sourceName.startsWith('/') ? sourceName : './' + sourceName,
    ]);
  }
});

test('POSIX expands only a leading identity home shorthand with the actual HOME', () => {
  const result = createDecryptionCommand({ data: age });
  assert.deepEqual(argv(result.command, 'age'), [
    '--decrypt',
    '--identity',
    process.env.HOME + '/.ssh/id_ed25519',
    '--output',
    'restored',
    './message.txt.age',
  ]);
  const identity = "~/.ssh/quote' $(printf injected) $HOME `id`";
  assert.equal(
    argv(createDecryptionCommand({ data: age, identity }).command, 'age')[2],
    process.env.HOME + '/' + identity.slice(2),
  );
});

test('POSIX keeps other identity paths literal without expansion or execution', () => {
  for (const identity of [
    "a'b",
    '$HOME/private key',
    'key$(printf injected)',
    '~someone/key',
    '/tmp/key with spaces',
    'keys/~/id',
    '--output',
  ]) {
    assert.equal(
      argv(createDecryptionCommand({ data: age, identity }).command, 'age')[2],
      identity,
    );
  }
});

test('PowerShell doubles apostrophes and keeps expressions in literal arguments', () => {
  const result = createDecryptionCommand({
    data: age,
    shell: 'powershell',
    sourceName: "-report' $(Write-Output injected) $HOME.age",
    identity: "C:\\Users\\O'Brien\\$HOME key",
  });
  assert.equal(
    result.command,
    "age --decrypt --identity 'C:\\Users\\O''Brien\\$HOME key' --output restored './-report'' $(Write-Output injected) $HOME.age'",
  );
  assert.equal(
    createDecryptionCommand({ data: pgp, shell: 'powershell' }).command,
    "gpg --output restored --decrypt './message.txt.asc'",
  );
});

test('PowerShell uses Join-Path for the leading identity home shorthand', () => {
  assert.equal(
    createDecryptionCommand({ data: age, shell: 'powershell' }).command,
    "age --decrypt --identity (Join-Path $HOME '.ssh/id_ed25519') --output restored './message.txt.age'",
  );
  const result = createDecryptionCommand({
    data: age,
    shell: 'powershell',
    identity: "~/.ssh/O'Brien $(Get-Item secret)",
  });
  assert.match(result.command, /\(Join-Path \$HOME '\.ssh\/O''Brien \$\(Get-Item secret\)'\)/);
});

test('PowerShell preserves absolute Windows input filenames', () => {
  for (const sourceName of ['C:\\Users\\me\\report.age', '\\\\server\\share\\report.age']) {
    assert.equal(
      createDecryptionCommand({ data: age, shell: 'powershell', sourceName }).filename,
      sourceName,
    );
    assert.ok(
      createDecryptionCommand({ data: pgp, shell: 'powershell', sourceName }).command.endsWith(
        "'" + sourceName + "'",
      ),
    );
  }
});

test('PowerShell also escapes its smart single-quote delimiters', () => {
  const result = createDecryptionCommand({
    data: age,
    shell: 'powershell',
    sourceName: 'a’b‘c.age',
    identity: 'key’$(Get-Item secret)‘',
  });
  assert.match(result.command, /'key’’\$\(Get-Item secret\)‘‘'/);
  assert.ok(result.command.endsWith("'./a’’b‘‘c.age'"));
});

test('unknown data returns null even when its filename looks encrypted', () => {
  for (const data of [undefined, '', 'ordinary text', new Uint8Array([1, 2, 3])]) {
    assert.equal(createDecryptionCommand({ data, sourceName: 'message.age' }), null);
  }
});

test('rejects unsupported shells with an explanatory Japanese error', () => {
  assert.throws(() => createDecryptionCommand({ data: pgp, shell: 'cmd' }), /シェル/);
});

test('age requires a nonempty identity without NUL or control characters', () => {
  for (const identity of [
    '',
    '  ',
    'key\0file',
    'key\nfile',
    'key\tfile',
    'key\x7ffile',
    'key\u0085file',
  ]) {
    assert.throws(() => createDecryptionCommand({ data: age, identity }), /秘密鍵.*パス/);
  }
});

test('GPG does not need or validate an unused identity', () => {
  for (const identity of ['', 'bad\0key', 'C:\\keys\\id']) {
    assert.equal(createDecryptionCommand({ data: pgp, identity }).format, 'pgp');
  }
});

test('POSIX rejects Windows drive and UNC paths instead of silently changing them', () => {
  for (const path of [
    'C:\\keys\\id',
    'D:/keys/id',
    'C:relative',
    '\\\\host\\share\\id',
    '//host/share/id',
  ]) {
    assert.throws(() => createDecryptionCommand({ data: age, identity: path }), /PowerShell/);
    assert.throws(() => createDecryptionCommand({ data: pgp, sourceName: path }), /PowerShell/);
  }
});

test('rejects a NUL filename that cannot be passed to a process literally', () => {
  assert.throws(() => createDecryptionCommand({ data: pgp, sourceName: 'a\0b.asc' }), /ファイル名/);
});
