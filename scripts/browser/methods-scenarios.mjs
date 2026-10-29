const task = await taskSpace(__FUMI_TASK__);
const page = task.page('p1');
await page.cdp('Page.addScriptToEvaluateOnNewDocument', {
  source: "localStorage.setItem('fumi-locale', 'ja');",
});
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
const value = (id) => page.evaluate((id) => document.getElementById(id).value, id);
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
assert.equal(await page.evaluate(() => Boolean(document.getElementById('secret-paste'))), false);
assert.equal(await visible('secret-text'), true);

await page.fill('#secret-text', protectedKey);
await page.evaluate(() => {
  window.__methodDecryptCalls = 0;
  const send = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function (message, ...rest) {
    if (message.action === 'decrypt') window.__methodDecryptCalls++;
    return send.call(this, message, ...rest);
  };
  window.__methodClipboard = [];
  window.__methodClipboardReads = 0;
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      async readText() {
        window.__methodClipboardReads++;
        if (window.__methodDelayRead)
          return new Promise((resolve) => {
            window.__methodReleasePaste = resolve;
          });
        if (window.__methodReadFails) throw new Error('Clipboard denied by test');
        return window.__methodClipboardText;
      },
      async writeText(text) {
        if (window.__methodClipboardFails) throw new Error('Clipboard denied by test');
        window.__methodClipboard.push(text);
      },
    },
  });
});
// The command method is available before any ciphertext is entered in the page.
await page.focus('#decrypt-web');
await page.press('#decrypt-web', 'ArrowRight');
await page.waitForFunction(() => document.getElementById('decrypt-command').checked);
assert.equal(await visible('decrypt-text'), false);
assert.equal(await visible('secret-text'), false);
assert.equal(await visible('terminal-command'), true);
assert.equal(await visible('command-copy-button'), true);
assert.equal(
  await page.evaluate(
    () =>
      document
        .getElementById('command-decryption')
        .querySelectorAll('input, textarea, select, details').length,
  ),
  0,
);
assert.equal(await page.evaluate(() => !!document.getElementById('command-tips')), false);
assert.equal((await command()).includes(protectedKey), false);
assert.match(await command(), /暗号文を貼り付け/);
assert.match(await command(), /秘密鍵を貼り付け/);
await page.press('#terminal-command', 'Control+Enter');
await page.press('#terminal-command', 'Meta+Enter');
await page.evaluate(() => document.getElementById('main-form').requestSubmit());
await settled();
assert.equal(await page.evaluate(() => window.__methodDecryptCalls), 0);
await page.click('#command-copy-button');
await page.waitForFunction(
  () => document.getElementById('command-copy-label').textContent === 'コピーしました',
);
assert.deepEqual(await page.evaluate(() => window.__methodClipboard), [await command()]);
await page.evaluate(() => {
  window.__methodClipboardFails = true;
});
await page.click('#command-copy-button');
await page.waitForFunction(() => !document.getElementById('command-error').hidden);
assert.equal(await page.evaluate(() => getSelection().toString()), await command());
await page.evaluate(() => {
  window.__methodClipboardFails = false;
});
await page.click('#decrypt-web');
assert.equal(await value('secret-text'), protectedKey);
await page.fill('#decrypt-text', pgp);
await page.waitForFunction(() => document.getElementById('passphrase').checkVisibility());
await idle();
assert.equal(await value('secret-text'), protectedKey);
assert.equal(await value('decrypt-text'), pgp);
await page.fill('#passphrase', 'test-recipient-pass');
const callsBeforeSwitch = await page.evaluate(() => window.__methodDecryptCalls);
await page.click('#decrypt-command');
await settled();
assert.equal(await page.evaluate(() => window.__methodDecryptCalls), callsBeforeSwitch);
assert.equal(await value('passphrase'), '');
await page.click('#clear-button');
assert.equal(await visible('decrypt-content'), false);
assert.equal(await value('secret-text'), '');
// Clipboard permission denial leaves a focused manual fallback for both fields.
await page.click('#decrypt-web');
await page.evaluate(() => {
  window.__methodReadFails = true;
});
await page.click('#decrypt-paste-button');
await page.waitForFunction(() => !document.getElementById('decrypt-error').hidden);
assert.equal(await page.evaluate(() => document.activeElement.id), 'decrypt-text');
await page.fill('#decrypt-text', pgp);
await page.fill('#decrypt-text', '');
await page.evaluate((pgp) => {
  window.__methodReadFails = false;
  window.__methodClipboardText = pgp;
}, pgp);
await page.click('#decrypt-paste-button');
assert.equal(await value('decrypt-text'), pgp);
assert.equal(await page.evaluate(() => window.__methodClipboardReads), 2);
// A pending paste belongs to the operation and draft that requested it.
const callsBeforeLatePaste = await page.evaluate(() => window.__methodDecryptCalls);
await page.evaluate(() => {
  window.__methodDelayRead = true;
  window.__methodReleasePaste = null;
});
await page.click('#decrypt-paste-button');
await page.waitForFunction(() => Boolean(window.__methodReleasePaste));
await page.click('#encrypt-tab');
await page.click('#decrypt-tab');
await page.evaluate((age) => window.__methodReleasePaste(age), age);
await settled();
assert.equal(
  await value('decrypt-text'),
  pgp,
  'late paste cannot overwrite a draft after tab changes',
);
assert.equal(await page.evaluate(() => window.__methodDecryptCalls), callsBeforeLatePaste);
await page.evaluate(() => {
  window.__methodReleasePaste = null;
});
await page.click('#decrypt-paste-button');
await page.waitForFunction(() => Boolean(window.__methodReleasePaste));
await page.fill('#decrypt-text', pgp + '\n');
await page.evaluate((age) => window.__methodReleasePaste(age), age);
await settled();
assert.equal(
  await value('decrypt-text'),
  pgp + '\n',
  'late paste cannot overwrite a newer manual edit',
);
assert.equal(await page.evaluate(() => window.__methodDecryptCalls), callsBeforeLatePaste);
await page.evaluate(() => {
  window.__methodDelayRead = false;
});
await page.fill('#decrypt-text', pgp);

await page.evaluate(() => {
  window.__methodReadFails = true;
});
await page.click('#secret-paste-button');
await page.waitForFunction(() => !document.getElementById('secret-error').hidden);
assert.equal(await page.evaluate(() => document.activeElement.id), 'secret-text');
const callsBeforePaths = await page.evaluate(() => window.__methodDecryptCalls);
await page.evaluate(() => {
  window.__methodReadFails = false;
  window.__methodClipboardText = '~/.ssh/id_ed25519';
});
await page.click('#secret-paste-button');
await settled();
assert.equal(await value('secret-text'), '~/.ssh/id_ed25519');
assert.equal(await visible('secret-error'), true);
assert.equal(await page.evaluate(() => window.__methodDecryptCalls), callsBeforePaths);
for (const path of [
  '~/.ssh/id_ed25519',
  '/home/test/.ssh/id_ed25519',
  'C:\\Users\\Test\\key',
  '\\\\server\\keys\\private',
  './private-key',
  'keys/id_ed25519',
  '.\\private-key',
  '%USERPROFILE%\\.ssh\\id_ed25519',
  'private.asc',
]) {
  await page.fill('#secret-text', path);
  await settled();
  assert.equal(await visible('secret-error'), true, path);
  assert.match(
    await page.evaluate(() => document.getElementById('secret-error').textContent),
    /ファイル/,
  );
  assert.equal(
    await page.evaluate(() => window.__methodDecryptCalls),
    callsBeforePaths,
    path + ' is a path, not key contents',
  );
}
// A method change cancels a private-key file read before it can commit a draft.
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

await page.fill('#decrypt-text', pgp);
await page.evaluate((unprotectedKey) => {
  window.__methodReadFails = false;
  window.__methodClipboardText = unprotectedKey;
}, unprotectedKey);
await page.click('#secret-paste-button');
await finished();
assert.equal(
  await page.evaluate(() => document.getElementById('result-text').textContent),
  plaintext,
);
assert.equal(await visible('passphrase'), false);
await page.click('#edit-result-button');
await page.click('#clear-button');
console.log(
  'PASS: visible universal command and Copy only, no command-mode crypto, copy fallback, browser paste/path guidance, draft retention, cancelled reads and real web decryption.',
);
