import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { generateKey } from 'openpgp';

const root = await mkdtemp('/tmp/fumi-e2e-');
const output = '/app/test-results/container';
await mkdir(output, { recursive: true });
const keyring = join(root, 'gnupg');
await mkdir(keyring, { mode: 0o700 });
const run = (program, args, options = {}) =>
  execFileSync(program, args, { stdio: 'pipe', ...options });
const xvfb = spawn('Xvfb', [':99', '-screen', '0', '1440x900x24', '-nolisten', 'tcp']);
const server = spawn('node', ['node_modules/next/dist/bin/next', 'start', '-p', '3000'], {
  stdio: ['ignore', 'ignore', 'inherit'],
});
let browser;
const rows = [];
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if ((await fetch('http://127.0.0.1:3000')).ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({
    executablePath: '/usr/bin/chromium',
    headless: false,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ozone-platform=x11'],
  });
  const context = await browser.newContext({
    locale: 'ja-JP',
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const finished = () =>
    page.waitForFunction(
      () =>
        !document.getElementById('result-panel').hidden &&
        document.getElementById('workspace').getAttribute('aria-busy') === 'false',
    );

  const fixtures = [];
  for (const format of ['pgp', 'ssh'])
    for (const protectedKey of [false, true]) {
      const prefix = format + (protectedKey ? '-protected' : '-plain');
      const password = protectedKey ? 'disposable-e2e-password' : '';
      const secretFile = join(root, prefix + '-key');
      let publicKey;
      if (format === 'pgp') {
        const key = await generateKey({
          type: 'ecc',
          curve: 'curve25519Legacy',
          userIDs: [{ name: 'Disposable container test' }],
          passphrase: password || undefined,
        });
        publicKey = key.publicKey;
        await writeFile(secretFile, key.privateKey, { mode: 0o600 });
      } else {
        run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', password, '-f', secretFile]);
        publicKey = await readFile(secretFile + '.pub', 'utf8');
      }
      for (const binary of protectedKey ? [false] : [false, true]) {
        const id = prefix + (binary ? '-binary' : '-text');
        const plaintext = binary
          ? 'binary\u0000\u001b[31munsafe terminal bytes'
          : '復号結果が端末に表示されます。\nコンテナE2Eで確認。';
        const original = join(root, id + '-original');
        await writeFile(original, plaintext);
        await page.goto('http://127.0.0.1:3000');
        await page.click('#manual-key-button');
        await page.fill('#recipient-text', publicKey);
        await page.fill('#encrypt-text', plaintext);
        await page.click('#run-button');
        await finished();
        const ciphertext = await page.locator('#result-text').textContent();
        const cipherFile = join(root, id + (format === 'pgp' ? '.asc' : '.age'));
        const download = page.waitForEvent('download');
        await page.click('#save-button');
        await (await download).saveAs(cipherFile);
        assert.equal(await readFile(cipherFile, 'utf8'), ciphertext);
        fixtures.push({
          id,
          format,
          protectedKey,
          password,
          secretFile,
          original,
          ciphertext,
          cipherFile,
          binary,
        });
      }
    }

  async function terminalCase(fixture, scenario = 'paste') {
    const id = fixture.id + '-' + scenario;
    if (process.env.FUMI_E2E_CASE && !id.includes(process.env.FUMI_E2E_CASE)) return;
    const cwd = join(root, id);
    await mkdir(cwd);
    await writeFile(join(cwd, 'restored'), 'existing file must stay');
    await page.goto('http://127.0.0.1:3000');
    await page.click('#decrypt-tab');
    await page.click('#decrypt-command');
    assert.equal(await page.locator('#terminal-command').isVisible(), true);
    assert.equal(await page.locator('#decrypt-text').isVisible(), false);
    assert.equal(
      await page
        .locator(
          '#command-decryption select, #command-decryption details, #command-decryption textarea, #command-decryption input',
        )
        .count(),
      0,
    );
    await page.click('#command-copy-button');
    await page.waitForFunction(
      () => document.getElementById('command-copy-label').textContent === 'コピーしました',
    );
    const command = await page.locator('#terminal-command').textContent();
    assert.doesNotMatch(command, /pbpaste|xclip|Get-Clipboard|--output restored/);
    let cipherFile = fixture.cipherFile;
    if (scenario === 'tampered') {
      const lines = fixture.ciphertext.split('\n');
      const index = lines.findLastIndex((line) => /^[A-Za-z0-9+/]{10,}={0,2}$/.test(line));
      assert.ok(index > 0);
      lines[index] = (lines[index][0] === 'A' ? 'B' : 'A') + lines[index].slice(1);
      cipherFile = join(cwd, 'tampered');
      await writeFile(cipherFile, lines.join('\n'));
    }
    const cipher = { kind: 'cipher', file: cipherFile };
    const secret = { kind: 'key', file: fixture.secretFile };
    const inputs = [cipher, secret];
    if (scenario === 'wrong-cipher') inputs.unshift({ kind: 'cipher', file: fixture.secretFile });
    if (scenario === 'wrong-key') inputs.splice(1, 0, { kind: 'key', file: cipherFile });
    if (scenario === 'blank') {
      inputs.unshift({ kind: 'cipher', delivery: 'blank' });
      inputs.splice(2, 0, { kind: 'key', delivery: 'blank' });
    }
    if (scenario === 'interrupt-cipher')
      inputs.splice(0, inputs.length, { kind: 'cipher', delivery: 'interrupt' });
    if (scenario === 'interrupt-key') inputs.splice(1, 1, { kind: 'key', delivery: 'interrupt' });
    const config = join(cwd, 'config.json');
    await writeFile(
      config,
      JSON.stringify({
        id,
        cwd,
        keyring,
        command,
        inputs,
        password: fixture.password,
        original: fixture.original,
        binary: fixture.binary,
        expectFailure: scenario === 'tampered',
      }),
    );
    const result = await new Promise((resolve) => {
      const child = spawn('python3', ['scripts/e2e/terminal.py', config]);
      let stdout = '',
        stderr = '';
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      child.on('exit', (status) => resolve({ status, stdout, stderr }));
    });
    console.log(result.stdout.trim());
    const row = JSON.parse(result.stdout.trim());
    rows.push(row);
    assert.equal(result.status, 0, id + ': ' + JSON.stringify(row) + ' ' + result.stderr);
  }

  for (const fixture of fixtures) await terminalCase(fixture);
  const pgpPlain = fixtures.find((f) => f.format === 'pgp' && !f.protectedKey && !f.binary);
  const sshPlain = fixtures.find((f) => f.format === 'ssh' && !f.protectedKey && !f.binary);
  const protectedPgp = fixtures.find((f) => f.format === 'pgp' && f.protectedKey);
  await terminalCase(pgpPlain, 'wrong-cipher');
  await terminalCase(sshPlain, 'wrong-key');
  await terminalCase(protectedPgp, 'blank');
  await terminalCase(pgpPlain, 'interrupt-cipher');
  await terminalCase(protectedPgp, 'interrupt-key');
  await terminalCase(pgpPlain, 'tampered');
  await terminalCase(sshPlain, 'tampered');

  if (!process.env.FUMI_E2E_CASE) {
    for (const fixture of fixtures.filter((f) => !f.binary)) {
      await page.goto('http://127.0.0.1:3000');
      await page.click('#decrypt-tab');
      await page.click('#decrypt-web');
      assert.equal(await page.locator('#secret-text').isVisible(), true);
      await page.fill('#decrypt-text', fixture.ciphertext);
      await page.fill('#secret-text', await readFile(fixture.secretFile, 'utf8'));
      if (fixture.protectedKey) {
        await page.locator('#passphrase').waitFor({ state: 'visible' });
        assert.equal(await page.locator('#secret-text').isVisible(), true);
        await page.fill('#passphrase', fixture.password);
        await page.click('#run-button');
      }
      await finished();
      assert.equal(
        await page.locator('#result-text').textContent(),
        await readFile(fixture.original, 'utf8'),
      );
    }
    for (const [width, height] of [
      [1440, 900],
      [1366, 768],
      [375, 667],
      [390, 844],
    ]) {
      await page.setViewportSize({ width, height });
      await page.goto('http://127.0.0.1:3000');
      await page.click('#decrypt-tab');
      await page.click('#decrypt-command');
      await page.evaluate(() =>
        Promise.all(
          document
            .getAnimations()
            .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
            .map((animation) => animation.finished.catch(() => {})),
        ),
      );
      const commandBounds = await page.evaluate(() => ({
        page: document.documentElement.scrollHeight - innerHeight,
        form:
          document.getElementById('decrypt-panel').scrollHeight -
          document.getElementById('decrypt-panel').clientHeight,
        code: document.getElementById('terminal-command').getBoundingClientRect().height,
        bottom: document.getElementById('command-copy-button').getBoundingClientRect().bottom,
      }));
      assert.equal(commandBounds.page, 0);
      assert.ok(commandBounds.form <= 1);
      assert.ok(commandBounds.code > 200);
      assert.ok(commandBounds.bottom <= height);
      await page.screenshot({ path: join(output, 'command-' + width + 'x' + height + '.png') });
      await page.click('#decrypt-web');
      await page.fill('#decrypt-text', protectedPgp.ciphertext);
      await page.fill('#secret-text', await readFile(protectedPgp.secretFile, 'utf8'));
      await page.locator('#passphrase').waitFor({ state: 'visible' });
      assert.ok(
        await page.evaluate(
          () =>
            document.documentElement.scrollHeight <= innerHeight + 1 &&
            document.getElementById('decrypt-panel').scrollHeight <=
              document.getElementById('decrypt-panel').clientHeight + 1,
        ),
      );
      await page.screenshot({ path: join(output, 'web-' + width + 'x' + height + '.png') });
    }
  }
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      passed: rows.length,
      browserErrors: errors,
      realClipboard: true,
      realPTY: true,
      visibleText: true,
      overwritePrompts: false,
    }),
  );
} finally {
  await writeFile(join(output, 'report.json'), JSON.stringify(rows, null, 2));
  await browser?.close();
  server.kill();
  xvfb.kill();
}
