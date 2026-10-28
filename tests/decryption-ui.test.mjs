import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { createDecryptionCommand } from '../src/ui/decryption.js';

const pgp = '-----BEGIN PGP MESSAGE-----\n';
const age = '-----BEGIN AGE ENCRYPTED FILE-----\n';
const create = (options = {}) =>
  createDecryptionCommand({ data: pgp, keySource: 'keyring', ...options });
const createAge = (options = {}) =>
  create({ data: age, keySource: 'file', identity: 'recipient-key', ...options });

function argv(command, program) {
  const result = spawnSync('/bin/sh', ['-c', `${program}() { printf '%s\\0' "$@"; }; ${command}`]);
  assert.equal(result.status, 0, result.stderr.toString());
  return result.stdout.toString().split('\0').slice(0, -1);
}

test('requires an explicit key source and detects content independently of its filename', () => {
  for (const data of [pgp, age]) assert.equal(createDecryptionCommand({ data }), null);
  for (const data of [pgp, new Uint8Array([0xc1, 10, 20])]) {
    assert.equal(create({ data, sourceName: 'actually.age' }).format, 'pgp');
  }
  for (const data of [age, new TextEncoder().encode('age-encryption.org/v1\n')]) {
    assert.equal(createAge({ data, sourceName: 'actually.asc' }).format, 'ssh');
  }
  for (const data of [undefined, '', 'ordinary text', new Uint8Array([1, 2, 3])]) {
    assert.equal(create({ data, sourceName: 'message.age' }), null);
  }
});

test('keeps the ordinary GPG keyring command and exact source filename', () => {
  assert.deepEqual(create(), {
    format: 'pgp',
    filename: 'message.txt.asc',
    command: "gpg --output restored --decrypt './message.txt.asc'",
  });
  assert.equal(createAge().filename, 'message.txt.age');
  const sourceName = '  日本語 report.v2.age  ';
  const result = createAge({ sourceName, inputPath: '/saved/renamed.age' });
  assert.equal(result.filename, sourceName);
  assert.equal(argv(result.command, 'age').at(-1), '/saved/renamed.age');
});

test('POSIX passes adversarial file and identity paths as single literal arguments', () => {
  for (const path of [
    '-o',
    "a'b.age",
    '$(printf injected).age',
    '`printf injected`.age',
    'a; printf injected #.age',
    'a"b $HOME *.age',
    'dir/name.age',
    '/tmp/an absolute name.age',
  ]) {
    const expected = path.startsWith('/') ? path : './' + path;
    assert.equal(argv(create({ sourceName: path }).command, 'gpg').at(-1), expected);
    assert.equal(argv(createAge({ identity: path }).command, 'age')[2], expected);
    assert.equal(argv(create({ inputPath: path }).command, 'gpg').at(-1), expected);
  }
});

test('expands only a leading explicit identity home shorthand', () => {
  const identity = "~/.ssh/quote' $(printf injected) $HOME `id`";
  assert.equal(
    argv(createAge({ identity }).command, 'age')[2],
    process.env.HOME + '/' + identity.slice(2),
  );
  assert.equal(argv(createAge({ identity: '~someone/key' }).command, 'age')[2], './~someone/key');
});

test('expands a leading home shorthand only in an explicit ciphertext path', () => {
  const inputPath = "~/Downloads/quote' $(printf injected) $HOME `id`.asc";
  const result = create({ sourceName: 'uploaded.asc', inputPath });
  assert.equal(result.filename, 'uploaded.asc');
  assert.equal(argv(result.command, 'gpg').at(-1), process.env.HOME + '/' + inputPath.slice(2));
  assert.equal(
    create({ shell: 'powershell', inputPath }).command,
    "gpg --output restored --decrypt (Join-Path $HOME 'Downloads/quote'' $(printf injected) $HOME `id`.asc')",
  );
  assert.equal(
    argv(create({ sourceName: '~/uploaded.asc' }).command, 'gpg').at(-1),
    './~/uploaded.asc',
  );
});

test('PowerShell quotes paths literally including smart quote delimiters', () => {
  const result = createAge({
    shell: 'powershell',
    sourceName: "-report' $(Write-Output injected) $HOME.age",
    identity: "C:\\Users\\O'Brien\\$HOME key",
  });
  assert.equal(
    result.command,
    "age --decrypt --identity 'C:\\Users\\O''Brien\\$HOME key' --output restored './-report'' $(Write-Output injected) $HOME.age'",
  );
  assert.equal(
    createAge({ shell: 'powershell', identity: '~/.ssh/id' }).command,
    "age --decrypt --identity (Join-Path $HOME '.ssh/id') --output restored './message.txt.age'",
  );
  assert.match(
    createAge({ shell: 'powershell', identity: 'key’$(Get-Item secret)‘' }).command,
    /'\.\/key’’\$\(Get-Item secret\)‘‘'/,
  );
  for (const sourceName of ['C:\\Users\\me\\report.age', '\\\\server\\share\\report.age']) {
    assert.equal(create({ shell: 'powershell', sourceName }).filename, sourceName);
    assert.ok(create({ shell: 'powershell', sourceName }).command.endsWith("'" + sourceName + "'"));
  }
});

test('rejects invalid selections and all control characters in used paths', () => {
  assert.throws(() => create({ shell: 'cmd' }), /シェル/);
  assert.throws(() => create({ inputSource: 'network' }), /暗号文/);
  assert.throws(() => create({ keySource: 'network' }), /秘密鍵/);
  assert.throws(() => createAge({ keySource: 'keyring' }), /秘密鍵/);
  for (const value of [
    '',
    '  ',
    'key\0file',
    'key\nfile',
    'key\tfile',
    'key\x7ffile',
    'key\u0085file',
  ]) {
    assert.throws(() => createAge({ identity: value }), /秘密鍵.*パス/);
  }
  for (const value of ['a\0b', 'a\nb', 'a\tb', 'a\x7fb', 'a\u0085b']) {
    assert.throws(() => create({ sourceName: value }), /ファイル名/);
    assert.throws(() => create({ inputPath: value }), /暗号文.*パス/);
  }
  for (const identity of ['', 'bad\0key', 'C:\\keys\\id']) {
    assert.equal(create({ identity }).format, 'pgp');
  }
});

test('file-key paths reject flattened key material before it can enter generated commands', () => {
  for (const identity of ['ssh-key backup', 'ssh-private-key copy'])
    assert.ok(create({ data: age, keySource: 'file', identity }).command.includes(identity));
  const material = [
    '-----BEGIN OPENSSH PRIVATE KEY-----b3BlbnNzaC1rZXktdjE=-----END OPENSSH PRIVATE KEY-----',
    '-----BEGIN PGP PRIVATE KEY BLOCK-----disposable-secret-----END PGP PRIVATE KEY BLOCK-----',
    '-----BEGIN PRIVATE KEY-----disposable-secret-----END PRIVATE KEY-----',
    '-----BEGIN RSA PRIVATE KEY-----disposable-secret-----END RSA PRIVATE KEY-----',
    '-----BEGIN EC PRIVATE KEY-----disposable-secret-----END EC PRIVATE KEY-----',
    '-----BEGIN ENCRYPTED PRIVATE KEY-----disposable-secret-----END ENCRYPTED PRIVATE KEY-----',
    '  AGE-SECRET-KEY-1DISPOSABLESECRET  ',
    'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA disposable-public',
    '-----BEGIN PGP PUBLIC KEY BLOCK-----disposable-public-----END PGP PUBLIC KEY BLOCK-----',
  ];
  for (const data of [pgp, age])
    for (const shell of ['posix', 'powershell'])
      for (const identity of material) {
        assert.throws(
          () => create({ data, shell, keySource: 'file', identity }),
          (error) => {
            assert.match(error.message, /ファイル.*クリップボード/);
            assert.ok(!error.message.includes(identity));
            return true;
          },
        );
      }
});

test('POSIX rejects Windows paths instead of silently changing them', () => {
  for (const path of [
    'C:\\keys\\id',
    'D:/keys/id',
    'C:relative',
    '\\\\host\\share\\id',
    '//host/share/id',
  ]) {
    assert.throws(() => createAge({ identity: path }), /PowerShell/);
    assert.throws(() => create({ sourceName: path }), /PowerShell/);
    assert.throws(() => create({ inputPath: path }), /PowerShell/);
  }
});

test('clipboard commands require a selected known native tool on POSIX', () => {
  for (const clipboardTool of ['', 'pbpaste; id', 'Get-Clipboard']) {
    assert.throws(() => create({ inputSource: 'clipboard', clipboardTool }), /クリップボード/);
    assert.throws(() => createAge({ keySource: 'clipboard', clipboardTool }), /クリップボード/);
  }
  for (const [clipboardTool, expected] of [
    ['pbpaste', 'pbpaste'],
    ['wl-paste', 'wl-paste --no-newline'],
    ['xclip', 'xclip -selection clipboard -out'],
  ]) {
    const command = create({ inputSource: 'clipboard', clipboardTool }).command;
    assert.ok(command.includes(expected));
    assert.ok(!command.includes(pgp));
    assert.ok(command.indexOf('暗号文をコピーして Enter') < command.indexOf(expected));
    assert.ok(!command.includes("'./message.txt.asc'"));
    assert.match(command, /IFS= read -r .*\|\| exit/);
  }
});

async function shellFixture(fifo = false) {
  const directory = await mkdtemp(join(tmpdir(), 'fumi-command-test-'));
  const bin = join(directory, 'bin');
  await mkdir(bin);
  const scripts = {
    pbpaste:
      '#!/bin/sh\nprintf "clipboard\\n" >> "$FUMI_LOG"\n[ "$FUMI_FAIL_CLIPBOARD" != 1 ] || exit 17\ncat "$FUMI_CLIPBOARD"\n',
    gpg: '#!/bin/sh\nprintf "gpg %s\\n" "$*" >> "$FUMI_LOG"\ncase " $* " in *" --import "*) [ "$FUMI_FAIL_IMPORT" != 1 ]; exit $?;; esac\n[ "$FUMI_FAIL_DECRYPT" != 1 ] || exit 19\ncat > restored\n',
    age: '#!/bin/sh\nprintf "age %s\\n" "$*" >> "$FUMI_LOG"\n[ "$FUMI_FAIL_DECRYPT" != 1 ] || exit 19\ncat > restored\n',
    gpgconf: '#!/bin/sh\nprintf "gpgconf %s\\n" "$*" >> "$FUMI_LOG"\n',
    mktemp:
      '#!/bin/sh\nfumi_test_tmp=$(/usr/bin/mktemp "$@") || exit\nprintf "%s" "$fumi_test_tmp" > "$FUMI_TEMP_LOG"\nprintf "%s" "$fumi_test_tmp"\n',
  };
  for (const [name, script] of Object.entries(scripts))
    await writeFile(join(bin, name), script, { mode: 0o700 });
  const env = {
    ...process.env,
    PATH: bin + delimiter + process.env.PATH,
    FUMI_LOG: join(directory, 'log'),
    FUMI_CLIPBOARD: join(directory, 'clipboard'),
    FUMI_TEMP_LOG: join(directory, 'temporary'),
  };
  await writeFile(env.FUMI_LOG, '');
  if (fifo) assert.equal(spawnSync('mkfifo', [env.FUMI_CLIPBOARD]).status, 0);
  else await writeFile(env.FUMI_CLIPBOARD, 'copied shell command, overwritten before each read');
  return { directory, env, fifo, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

async function runWithPrompts(command, fixture, contents, extraEnv = {}) {
  const child = spawn('/bin/sh', ['-c', command], {
    cwd: fixture.directory,
    env: { ...fixture.env, ...extraEnv },
  });
  let stderr = '',
    prompts = 0,
    handled = 0;
  let pending = Promise.resolve();
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
    const count = (stderr.match(/Enter/g) || []).length;
    while (handled < count) {
      const index = handled++;
      pending = pending.then(async () => {
        assert.ok(index < contents.length, 'unexpected extra prompt');
        if (contents[index] === null) {
          child.kill('SIGTERM');
          return;
        }
        const copy = writeFile(fixture.env.FUMI_CLIPBOARD, contents[index]);
        if (!fixture.fifo) await copy;
        if (index === 0 && command.includes('mktemp')) {
          const temporary = await readFile(fixture.env.FUMI_TEMP_LOG, 'utf8');
          assert.equal((await stat(temporary)).mode & 0o777, 0o700);
        }
        prompts++;
        child.stdin.write('\n');
        await copy;
      });
    }
  });
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('prompt timeout: ' + stderr));
    }, 10000);
    child.on('error', reject);
    child.on('close', (status) => {
      clearTimeout(timer);
      resolve({ status, stderr });
    });
  });
  await pending;
  return { ...result, prompts };
}

test('both clipboard sources are acquired after separate prompts and cleaned without default GPG import', async () => {
  for (const data of [pgp, age]) {
    const fixture = await shellFixture();
    try {
      const command = create({
        data,
        keySource: 'clipboard',
        inputSource: 'clipboard',
        clipboardTool: 'pbpaste',
      }).command;
      const secret = 'disposable secret only in fake clipboard';
      const ciphertext = Buffer.from([1, 0, 2, 10, 10]);
      assert.ok(!command.includes(secret));
      const result = await runWithPrompts(command, fixture, [secret, ciphertext]);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.prompts, 2);
      assert.ok(
        result.stderr.indexOf('秘密鍵をコピーして Enter') <
          result.stderr.indexOf('暗号文をコピーして Enter'),
      );
      assert.deepEqual(await readFile(join(fixture.directory, 'restored')), ciphertext);
      const temporary = await readFile(fixture.env.FUMI_TEMP_LOG, 'utf8');
      await assert.rejects(stat(temporary), { code: 'ENOENT' });
      const log = await readFile(fixture.env.FUMI_LOG, 'utf8');
      if (data === pgp) {
        for (const line of log.split('\n').filter((line) => line.startsWith('gpg ')))
          assert.ok(line.includes('--homedir ' + temporary));
        assert.ok(log.includes('gpgconf --homedir ' + temporary + ' --kill gpg-agent'));
      }
    } finally {
      await fixture.cleanup();
    }
  }
});

test('clipboard read failure, import failure, decryption failure, interruption and prompt EOF stop safely and clean up', async () => {
  for (const [failure, expected] of [
    ['FUMI_FAIL_CLIPBOARD', 'no-decrypt'],
    ['FUMI_FAIL_IMPORT', 'no-decrypt'],
    ['FUMI_FAIL_DECRYPT', 'decrypt'],
    ['EOF', 'no-decrypt'],
    ['TERM', 'no-decrypt'],
  ]) {
    const fixture = await shellFixture();
    try {
      const command = create({
        keySource: 'clipboard',
        inputSource: 'clipboard',
        clipboardTool: 'pbpaste',
      }).command;
      const result =
        failure === 'EOF'
          ? spawnSync('/bin/sh', ['-c', command], {
              cwd: fixture.directory,
              env: fixture.env,
              input: '',
              encoding: 'utf8',
            })
          : await runWithPrompts(
              command,
              fixture,
              failure === 'TERM' ? [null] : ['secret', 'cipher'],
              { [failure]: '1' },
            );
      assert.notEqual(result.status, 0);
      const log = await readFile(fixture.env.FUMI_LOG, 'utf8');
      assert.equal(log.includes('--decrypt'), expected === 'decrypt');
      const temporary = await readFile(fixture.env.FUMI_TEMP_LOG, 'utf8');
      await assert.rejects(stat(temporary), { code: 'ENOENT' });
      assert.ok(log.includes('gpgconf --homedir ' + temporary + ' --kill gpg-agent'));
    } finally {
      await fixture.cleanup();
    }
  }
});

test('PowerShell clipboard/key isolation has scoped cleanup, native failure checks and sequential prompts', () => {
  for (const data of [pgp, age]) {
    const command = create({
      data,
      keySource: 'clipboard',
      inputSource: 'clipboard',
      shell: 'powershell',
    }).command;
    assert.match(command, /^& \{/);
    assert.match(command, /try \{/);
    assert.match(command, /finally \{/);
    assert.match(command, /Remove-Item/);
    assert.match(command, /SetAccessRuleProtection/);
    assert.match(command, /\$LASTEXITCODE -ne 0/);
    assert.equal((command.match(/Get-Clipboard -Raw/g) || []).length, 2);
    assert.ok(command.indexOf('秘密鍵をコピーして Enter') < command.indexOf('Get-Clipboard -Raw'));
    assert.ok(command.indexOf('暗号文をコピーして Enter') > command.indexOf('Get-Clipboard -Raw'));
    assert.ok(
      command.lastIndexOf('Get-Clipboard -Raw') > command.indexOf('暗号文をコピーして Enter'),
    );
    assert.ok(!command.includes("'./message.txt"));
    if (data === pgp) {
      assert.match(command, /gpgconf --homedir \$fumiTemp --kill gpg-agent/);
      assert.match(command, /gpg --no-options --homedir \$fumiTemp --batch --import/);
      assert.match(command, /gpg --no-options --homedir \$fumiTemp --output/);
    }
  }
});

test('FIFO clipboard stubs stream one payload per prompt without a pipeline failure blind spot', async () => {
  const fixture = await shellFixture(true);
  try {
    const command = create({
      keySource: 'clipboard',
      inputSource: 'clipboard',
      clipboardTool: 'pbpaste',
    }).command;
    const result = await runWithPrompts(command, fixture, ['one secret', 'one ciphertext']);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.prompts, 2);
    assert.equal(await readFile(join(fixture.directory, 'restored'), 'utf8'), 'one ciphertext');
  } finally {
    await fixture.cleanup();
  }
});

test('PowerShell removes temporary keys even when stopping its temporary agent fails', () => {
  const command = create({
    shell: 'powershell',
    keySource: 'file',
    identity: 'disposable.asc',
  }).command;
  assert.match(command, /try \{\n\s+gpgconf[^]*finally \{\n\s+Remove-Item/);
});
