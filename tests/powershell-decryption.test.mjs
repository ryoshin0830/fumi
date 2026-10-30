import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir, EOL } from 'node:os';
import { join } from 'node:path';
import { createDecryptionCommand } from '../src/ui/decryption.js';

const pwsh = process.env.FUMI_PWSH || 'pwsh';
const available =
  spawnSync(pwsh, ['-NoProfile', '-NonInteractive', '-Command', 'exit 0']).status === 0;

test(
  'PowerShell reads literal file paths, binary data and identities after long comments',
  { skip: !available },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fumi-powershell-'));
    try {
      const command = createDecryptionCommand('powershell');
      const functions = command.slice(
        command.indexOf('  function Read-FumiLine'),
        command.indexOf('  try {\n    $fumiTemp ='),
      );
      const cases = [
        {
          bytes: Buffer.from([193, 0, 255]),
          expected: '^-----BEGIN PGP MESSAGE-----',
          tags: [193],
        },
        {
          bytes: Buffer.from([197, 0, 255]),
          expected: '^-----BEGIN PGP PRIVATE KEY BLOCK-----',
          tags: [197],
        },
        {
          bytes: Buffer.from('age-encryption.org/v1\n\0data'),
          expected: '^age-encryption.org/v1',
          tags: [],
        },
        {
          bytes: Buffer.from('#' + 'comment'.repeat(100) + '\nAGE-SECRET-KEY-1TEST\n'),
          expected: '(?m)^AGE-SECRET-KEY-1',
          tags: [],
        },
      ];
      for (const [index, item] of cases.entries()) {
        const path = join(directory, '秘密鍵 [literal] $(touch injected) ' + index);
        await writeFile(path, item.bytes);
        const result = spawnSync(
          pwsh,
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `& {
        $ErrorActionPreference = 'Stop'
        ${functions}
        $script:lines = @($env:FUMI_READER_INPUT | ConvertFrom-Json)
        $script:position = 0
        function Read-FumiLine([string]$prompt) {
          if ($script:position -ge $script:lines.Count) { throw 'Input was rejected' }
          return $script:lines[$script:position++]
        }
        $result = Read-FumiBlock 'test' $env:FUMI_READER_EXPECTED @($env:FUMI_READER_TAGS | ConvertFrom-Json)
        [Console]::Out.WriteLine('FUMI_RESULT:' + $result.FromFile + ':' + [Convert]::ToBase64String($result.Bytes))
      }`,
          ],
          {
            env: {
              ...process.env,
              FUMI_READER_INPUT: JSON.stringify([join(directory, 'missing'), '"' + path + '"']),
              FUMI_READER_EXPECTED: item.expected,
              FUMI_READER_TAGS: JSON.stringify(item.tags),
            },
            encoding: 'utf8',
            timeout: 15000,
          },
        );
        assert.equal(result.status, 0, `case ${index}: ` + result.stderr + result.stdout);
        assert.ok(result.stdout.includes('FUMI_RESULT:True:' + item.bytes.toString('base64')));
      }
      // The original pasted-block reader must still return normalized armor bytes.
      const armor = ['-----BEGIN PGP MESSAGE-----', 'test', '-----END PGP MESSAGE-----'];
      const script = `& { $ErrorActionPreference = 'Stop'; ${functions}
      $script:lines = @($env:FUMI_READER_INPUT | ConvertFrom-Json); $script:position = 0
      function Read-FumiLine([string]$prompt) { return $script:lines[$script:position++] }
      $result = Read-FumiBlock 'test' '^-----BEGIN PGP MESSAGE-----'
      [Console]::Out.WriteLine('FUMI_RESULT:' + $result.FromFile + ':' + [Convert]::ToBase64String($result.Bytes))
    }`;
      const result = spawnSync(pwsh, ['-NoProfile', '-NonInteractive', '-Command', script], {
        env: { ...process.env, FUMI_READER_INPUT: JSON.stringify(armor) },
        encoding: 'utf8',
        timeout: 15000,
      });
      assert.equal(result.status, 0, result.stderr);
      assert.ok(
        result.stdout.includes(
          'FUMI_RESULT:False:' + Buffer.from(armor.join(EOL)).toString('base64'),
        ),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
