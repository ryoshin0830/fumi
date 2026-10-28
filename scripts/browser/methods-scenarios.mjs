const task = await taskSpace(__FUMI_TASK__);
const page = task.page('p1');
const assert = (await import('node:assert/strict')).default;
const { readFile } = await import('node:fs/promises');
const base = __FUMI_ROOT__ + 'test-results/signatures/';
const publicKey = await readFile(base + 'recipient-public.asc', 'utf8');
const protectedKey = await readFile(base + 'recipient-secret.asc', 'utf8');
const unprotectedKey = await readFile(base + 'recipient-secret-unprotected.asc', 'utf8');
const sshPublicKey = await readFile(base + 'signer-ssh.pub', 'utf8');
const plaintext = 'Method selection browser round trip';
const visible = (id) => page.evaluate((id) => document.getElementById(id).checkVisibility(), id);
const command = () => page.evaluate(() => document.getElementById('terminal-command').textContent);
const idle = () =>
  page.waitForFunction(
    () => document.getElementById('workspace').getAttribute('aria-busy') === 'false',
  );
const finished = () =>
  page.waitForFunction(
    () =>
      !document.getElementById('result-panel').hidden &&
      document.getElementById('workspace').getAttribute('aria-busy') === 'false',
    undefined,
    { timeout: 30000 },
  );
// An absent operation must remain absent beyond the application's 600 ms debounce.
const settled = () => page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 800)));
await page.goto(__FUMI_URL__);
await page.click('#manual-key-button');
await page.fill('#encrypt-text', plaintext);
await page.fill('#recipient-text', publicKey);
await page.click('#run-button');
await finished();
const pgp = await page.evaluate(() => document.getElementById('result-text').textContent);
assert.match(pgp, /^-----BEGIN PGP MESSAGE-----/);
assert.equal(await page.evaluate(() => Boolean(document.getElementById('terminal-tips'))), false);
await page.click('#edit-result-button');
await page.click('#clear-button');
await page.click('#manual-key-button');
await page.fill('#encrypt-text', plaintext);
await page.fill('#recipient-text', sshPublicKey);
await page.click('#run-button');
await finished();
const age = await page.evaluate(() => document.getElementById('result-text').textContent);
assert.match(age, /^-----BEGIN AGE ENCRYPTED FILE-----/);
await page.click('#decrypt-tab');
assert.deepEqual(
  await page.evaluate(() =>
    ['decrypt-web', 'decrypt-command'].map((id) => ({
      type: document.getElementById(id).type,
      checked: document.getElementById(id).checked,
    })),
  ),
  [
    { type: 'radio', checked: false },
    { type: 'radio', checked: false },
  ],
);
for (const id of ['decrypt-content', 'secret-text', 'passphrase'])
  assert.equal(await visible(id), false, id + ' initially hidden');
await page.click('#decrypt-web');
assert.equal(await visible('secret-file'), true);
assert.equal(await page.evaluate(() => document.getElementById('secret-paste').open), false);
assert.equal(await visible('secret-text'), false);
await page.click('#secret-paste summary');
await page.fill('#secret-text', protectedKey);
await page.evaluate(() => {
  window.__methodDecryptCalls = 0;
  const send = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function (message, ...rest) {
    if (message.action === 'decrypt') window.__methodDecryptCalls++;
    return send.call(this, message, ...rest);
  };
  window.__methodClipboard = [];
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      async writeText(text) {
        if (window.__methodClipboardFails) throw new Error('Clipboard denied by test');
        window.__methodClipboard.push(text);
      },
    },
  });
});
// Exercise the native radio group's keyboard behavior with a retained secret draft.
await page.focus('#decrypt-web');
await page.press('#decrypt-web', 'ArrowRight');
await page.waitForFunction(() => document.getElementById('decrypt-command').checked);
assert.equal(await visible('secret-text'), false);
assert.equal(await visible('passphrase'), false);
assert.equal(
  await page.evaluate(() => document.getElementById('command-key-path').value),
  '~/.ssh/id_ed25519',
);
assert.equal(
  await page.evaluate(
    () =>
      document.getElementById('command-shell').value ===
      (/Win/i.test(navigator.platform) ? 'powershell' : 'posix'),
  ),
  true,
);
await page.fill('#decrypt-text', pgp);
await page.waitForFunction(() =>
  document.getElementById('terminal-command').textContent.startsWith('gpg '),
);
assert.equal(await command(), "gpg --output restored --decrypt './message.txt.asc'");
assert.equal(await visible('command-key-path'), false);
await page.press('#decrypt-text', 'Control+Enter');
await page.press('#decrypt-text', 'Meta+Enter');
// Exercise the form submit guard as well as the keyboard shortcut guards.
await page.evaluate(() => document.getElementById('main-form').requestSubmit());
await settled();
assert.equal(
  await page.evaluate(() => window.__methodDecryptCalls),
  0,
  'command mode cannot submit a retained secret to a worker',
);
assert.equal(await page.evaluate(() => document.getElementById('result-panel').hidden), true);
await page.click('#command-copy-button');
await page.waitForFunction(
  () => document.getElementById('command-copy-label').textContent === 'コピーしました',
);
assert.deepEqual(await page.evaluate(() => window.__methodClipboard), [await command()]);
const pgpDownloadPromise = page.waitForEvent('download', { timeout: 30000 });
await page.click('#command-save-button');
const pgpDownload = await pgpDownloadPromise;
assert.equal(pgpDownload.suggestedFilename(), 'message.txt.asc');
await pgpDownload.saveAs(base + 'methods-command-pasted.asc');
assert.deepEqual(await readFile(base + 'methods-command-pasted.asc'), Buffer.from(pgp));
await page.fill('#decrypt-text', age);
await page.waitForFunction(() =>
  document.getElementById('terminal-command').textContent.startsWith('age '),
);
assert.equal(
  await page.evaluate(() => document.getElementById('command-copy-label').textContent),
  'コマンドをコピー',
);
await page.click('#command-tips summary');
await page.selectOption('#command-shell', 'posix');
const identity = "~/.ssh/key with 'quotes'";
await page.fill('#command-key-path', identity);
assert.equal(
  await command(),
  "age --decrypt --identity \"$HOME\"/'.ssh/key with '\\''quotes'\\''' --output restored './message.txt.age'",
);
await page.fill('#command-key-path', "C:\\Users\\Test Person\\key's");
await page.waitForFunction(() => !document.getElementById('command-error').hidden);
assert.match(
  await page.evaluate(() => document.getElementById('command-error').textContent),
  /PowerShell/,
);
assert.equal(
  await page.evaluate(() => document.getElementById('command-copy-button').disabled),
  true,
);
assert.equal(await command(), '');
await page.selectOption('#command-shell', 'powershell');
assert.equal(
  await command(),
  "age --decrypt --identity 'C:\\Users\\Test Person\\key''s' --output restored './message.txt.age'",
);
await page.press('#command-key-path', 'Enter');
await settled();
assert.equal(await page.evaluate(() => window.__methodDecryptCalls), 0);
await page.evaluate(() => {
  window.__methodClipboardFails = true;
});
await page.click('#command-copy-button');
await page.waitForFunction(() => !document.getElementById('command-error').hidden);
assert.equal(
  await page.evaluate(() => getSelection().toString()),
  await command(),
  'failed clipboard writes select only the displayed command',
);
assert.equal(await page.evaluate(() => document.activeElement.id), 'terminal-command');
const ageDownloadPromise = page.waitForEvent('download', { timeout: 30000 });
await page.click('#command-save-button');
const ageDownload = await ageDownloadPromise;
assert.equal(ageDownload.suggestedFilename(), 'message.txt.age');
await ageDownload.saveAs(base + 'methods-command-pasted.age');
assert.deepEqual(await readFile(base + 'methods-command-pasted.age'), Buffer.from(age));
await page.setInputFiles('#decrypt-file', [base + 'signed.age']);
await page.waitForFunction(() => !document.getElementById('decrypt-file-pane').hidden);
await idle();
assert.equal(await visible('command-save-button'), false);
assert.match(await command(), /'\.\/signed\.age'$/);
await page.click('#decrypt-file-remove');
await page.fill('#decrypt-text', pgp);
await page.click('#decrypt-web');
await page.waitForFunction(() => document.getElementById('passphrase').checkVisibility());
await idle();
assert.equal(
  await page.evaluate(() => document.getElementById('secret-text').value),
  protectedKey,
  'secret draft survives method changes',
);
assert.equal(
  await page.evaluate(() => document.getElementById('decrypt-text').value),
  pgp,
  'ciphertext draft survives method changes',
);
await page.fill('#passphrase', 'test-recipient-pass');
const callsBeforeSwitch = await page.evaluate(() => window.__methodDecryptCalls);
await page.click('#decrypt-command');
await settled();
assert.equal(
  await page.evaluate(() => window.__methodDecryptCalls),
  callsBeforeSwitch,
  'switching with a password cannot start another decrypt',
);
assert.equal(
  await page.evaluate(() => document.getElementById('passphrase').value),
  '',
  'method changes clear the password',
);
await page.click('#clear-button');
assert.deepEqual(
  await page.evaluate(() =>
    ['decrypt-web', 'decrypt-command'].map((id) => document.getElementById(id).checked),
  ),
  [false, false],
);
assert.equal(await visible('decrypt-content'), false);
assert.equal(await page.evaluate(() => document.getElementById('secret-text').value), '');
// A method change cancels a private-key file read before it can commit a draft.
await page.click('#decrypt-web');
await page.evaluate(() => {
  window.__methodDecryptCalls = 0;
  const original = File.prototype.arrayBuffer;
  File.prototype.arrayBuffer = function () {
    return new Promise((resolve) => {
      window.__methodReleaseRead = async () => {
        File.prototype.arrayBuffer = original;
        resolve(await original.call(this));
      };
    });
  };
});
await page.setInputFiles('#secret-file', [base + 'recipient-secret.asc']);
await page.waitForFunction(() => Boolean(window.__methodReleaseRead));
await page.click('#decrypt-command');
await page.evaluate(() => window.__methodReleaseRead());
await idle();
await settled();
assert.equal(await page.evaluate(() => window.__methodDecryptCalls), 0);
assert.equal(await page.evaluate(() => document.getElementById('result-panel').hidden), true);
assert.equal(
  await page.evaluate(() => document.getElementById('secret-file-name').textContent),
  '',
);
await page.click('#decrypt-web');
assert.equal(
  await visible('secret-file-pane'),
  false,
  'cancelled private-key file was never committed',
);
// Finish with a real unsigned web round trip, independent of signed legacy fixtures.
await page.click('#secret-paste summary');
await page.fill('#decrypt-text', pgp);
await page.fill('#secret-text', unprotectedKey);
await finished();
assert.equal(
  await page.evaluate(() => document.getElementById('result-text').textContent),
  plaintext,
);
assert.equal(await visible('passphrase'), false);
await page.click('#edit-result-button');
await page.click('#clear-button');
console.log(
  'PASS: explicit methods, keyboard selection, isolated commands and shortcuts, draft retention, shell quoting, safe clipboard fallback, exact ciphertext downloads, cancelled key reads, and real unprotected web round trip.',
);
