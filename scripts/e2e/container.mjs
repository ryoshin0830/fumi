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
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
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
      const id = format + (protectedKey ? '-protected' : '-plain');
      const password = protectedKey ? 'disposable-e2e-password' : '';
      const secretFile = join(root, id + '-key');
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
        run('gpg', ['--homedir', keyring, '--batch', '--import', secretFile]);
      } else {
        run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', password, '-f', secretFile]);
        publicKey = await readFile(secretFile + '.pub', 'utf8');
      }
      const original = join(root, id + '-original.txt');
      const plaintext = 'コンテナで暗号化 → ブラウザーのCopy → zshで復号。\n';
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
      });
    }

  async function terminalCase(
    fixture,
    keySource,
    inputSource,
    delivery = 'clipboard',
    shell = '/bin/zsh',
  ) {
    const id = `${fixture.id}-${keySource}-${inputSource}-${delivery}-${shell.split('/').pop()}`;
    if (process.env.FUMI_E2E_CASE && !id.includes(process.env.FUMI_E2E_CASE)) return;
    const cwd = join(root, id);
    await mkdir(cwd);
    await page.goto('http://127.0.0.1:3000');
    await page.click('#decrypt-tab');
    await page.click('#decrypt-command');
    await page.fill('#decrypt-text', fixture.ciphertext);
    if (inputSource === 'file') {
      assert.equal(await page.locator('#command-copy-button').isVisible(), false);
      const download = page.waitForEvent('download');
      await page.click('#command-save-button');
      const saved = await download;
      await saved.saveAs(join(cwd, saved.suggestedFilename()));
    } else {
      await page.selectOption('#command-input-source', 'clipboard');
    }
    await page.selectOption('#command-key-source', keySource);
    if (keySource === 'file') {
      await page.setInputFiles('#command-key-file', fixture.secretFile);
      await page.fill('#command-key-path', fixture.secretFile);
    }
    if (inputSource === 'clipboard' || keySource === 'clipboard') {
      if (!(await page.locator('#command-tips').evaluate((node) => node.open)))
        await page.click('#command-tips > summary');
      await page.selectOption('#command-clipboard-tool', 'xclip');
    }
    await page.click('#command-copy-button');
    await page.waitForFunction(
      () => document.getElementById('command-copy-label').textContent === 'コピーしました',
    );
    const command = await page.locator('#terminal-command').textContent();
    const inputs = [];
    if (keySource === 'clipboard')
      inputs.push({
        kind: 'key',
        file: fixture.secretFile,
        delivery:
          delivery === 'interrupt' ? 'interrupt' : delivery === 'paste' ? 'paste' : 'clipboard',
      });
    if (inputSource === 'clipboard') {
      if (delivery === 'wrong-paste')
        inputs.push({ kind: 'cipher', file: fixture.secretFile, delivery: 'paste' });
      inputs.push({
        kind: 'cipher',
        file: fixture.cipherFile,
        delivery: delivery === 'paste' ? 'paste' : 'clipboard',
      });
    }
    run('gpgconf', ['--homedir', keyring, '--kill', 'gpg-agent']);
    const config = join(cwd, 'config.json');
    await writeFile(
      config,
      JSON.stringify({
        id,
        cwd,
        keyring,
        command,
        inputs,
        shell,
        password: fixture.password,
        original: fixture.original,
      }),
    );
    const result = await new Promise((resolve) => {
      const process = spawn('python3', ['scripts/e2e/terminal.py', config]);
      let stdout = '',
        stderr = '';
      process.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      process.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      process.on('exit', (status) => resolve({ status, stdout, stderr }));
    });
    console.log(result.stdout.trim());
    const row = JSON.parse(result.stdout.trim());
    rows.push(row);
    assert.equal(result.status, 0, `${id}: ${JSON.stringify(row)} ${result.stderr}`);
  }

  // The reported failure: private key pasted at the ciphertext prompt must be
  // consumed and rejected, then allow the correct ciphertext without shell execution.
  await terminalCase(fixtures[0], 'clipboard', 'clipboard', 'wrong-paste');
  await terminalCase(fixtures[1], 'clipboard', 'clipboard', 'interrupt');
  for (const fixture of fixtures) {
    for (const keySource of fixture.format === 'pgp'
      ? ['keyring', 'file', 'clipboard']
      : ['file', 'clipboard'])
      for (const inputSource of ['file', 'clipboard'])
        await terminalCase(fixture, keySource, inputSource);
    await terminalCase(fixture, 'clipboard', 'clipboard', 'paste');
  }
  if (!process.env.FUMI_E2E_CASE || process.env.FUMI_E2E_CASE === 'web-visibility') {
    for (const fixture of fixtures) {
      await page.goto('http://127.0.0.1:3000');
      await page.click('#decrypt-tab');
      await page.click('#decrypt-web');
      assert.equal(
        await page.locator('#secret-text').isVisible(),
        true,
        'Private-key paste must be immediately available',
      );
      assert.equal(await page.locator('#secret-paste-button').isVisible(), true);
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
      await page.click('#decrypt-web');
      const fixture = fixtures[1];
      await page.fill('#decrypt-text', fixture.ciphertext);
      await page.fill('#secret-text', await readFile(fixture.secretFile, 'utf8'));
      await page.locator('#passphrase').waitFor({ state: 'visible' });
      const bounds = await page.evaluate(() => ({
        page: document.documentElement.scrollHeight - innerHeight,
        form:
          document.getElementById('decrypt-panel').scrollHeight -
          document.getElementById('decrypt-panel').clientHeight,
        bottom: document.getElementById('run-button').getBoundingClientRect().bottom,
      }));
      assert.equal(bounds.page, 0);
      assert.ok(bounds.form <= 1, JSON.stringify(bounds));
      assert.ok(bounds.bottom <= height);
      await page.screenshot({ path: join(output, `web-${width}x${height}.png`) });
    }
  }
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      passed: rows.length,
      browserErrors: errors,
      realClipboard: true,
      realPTY: true,
    }),
  );
} finally {
  await writeFile(join(output, 'report.json'), JSON.stringify(rows, null, 2));
  await browser?.close();
  server.kill();
  xvfb.kill();
  try {
    run('gpgconf', ['--homedir', keyring, '--kill', 'gpg-agent']);
  } catch {}
}
