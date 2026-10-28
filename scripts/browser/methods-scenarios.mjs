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
async function editCipher() {
  if (await visible('command-edit-cipher')) await page.click('#command-edit-cipher');
}
async function saveCipher(filename, contents, target = filename) {
  const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
  await page.click('#command-save-button');
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), filename);
  await download.saveAs(base + target);
  assert.deepEqual(await readFile(base + target), Buffer.from(contents));
}
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
// Exercise the native radio group's keyboard behavior with a retained secret draft.
await page.focus('#decrypt-web');
await page.press('#decrypt-web', 'ArrowRight');
await page.waitForFunction(() => document.getElementById('decrypt-command').checked);
assert.equal(await visible('secret-text'), false);
assert.equal(await visible('passphrase'), false);
assert.equal(await page.evaluate(() => document.getElementById('command-key-path').value), '');
assert.equal(
  await page.evaluate(
    () =>
      document.getElementById('command-shell').value ===
      (/Win/i.test(navigator.platform) ? 'powershell' : 'posix'),
  ),
  true,
);
await page.fill('#decrypt-text', pgp);
await page.waitForFunction(() => !document.getElementById('command-source-options').hidden);
assert.equal(await value('command-input-source'), 'file');
assert.equal(await value('command-key-source'), '');
assert.equal(await visible('command-key-source'), false, 'save precedes key configuration');
assert.equal(await visible('command-cipher-path'), false);
assert.equal(await visible('command-save-button'), true);
assert.equal(await visible('command-copy-button'), false);
assert.equal(await visible('command-output'), false);
assert.equal(await command(), '');
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
await saveCipher('message.txt.asc', pgp, 'methods-command-pasted.asc');
assert.equal(await visible('command-cipher-summary'), true);
assert.equal(await visible('decrypt-text'), false);
assert.equal(await visible('command-key-source'), true);
assert.equal(await value('command-key-source'), '', 'saving cannot choose a private key');
assert.equal(await value('command-cipher-path'), 'message.txt.asc');
assert.equal(await visible('command-save-button'), true, 'saved text remains downloadable');
assert.equal(await command(), '');
assert.equal(
  await page.evaluate(() => document.getElementById('command-copy-button').disabled),
  true,
);
await page.selectOption('#command-key-source', 'keyring');
await page.waitForFunction(() =>
  document.getElementById('terminal-command').textContent.startsWith('gpg '),
);
assert.equal(await command(), "gpg --output restored --decrypt './message.txt.asc'");
await page.click('#command-tips > summary');
await page.click('#command-cipher-path-box summary');
await page.fill('#command-cipher-path', "~/Downloads/received's.asc");
assert.match(await command(), /received'\\''s\.asc/);
await page.fill('#command-cipher-path', 'message.txt.asc');
await page.click('#command-cipher-path-box summary');
await page.click('#command-tips > summary');
await page.click('#command-copy-button');
await page.waitForFunction(
  () => document.getElementById('command-copy-label').textContent === 'コピーしました',
);
assert.deepEqual(await page.evaluate(() => window.__methodClipboard), [await command()]);
// Editing invalidates the saved bytes even when the format stays the same.
await editCipher();
await page.fill('#decrypt-text', pgp + '\n');
assert.equal(await visible('command-output'), false);
assert.equal(await visible('command-copy-button'), false);
assert.equal(await visible('command-key-source'), false);
assert.equal(await command(), '');
await saveCipher('message.txt.asc', pgp + '\n', 'methods-command-pasted-edited.asc');
assert.equal(await visible('command-cipher-summary'), true);
assert.equal(await visible('command-output'), true);
await editCipher();
await page.fill('#decrypt-text', age);
assert.equal(await value('command-key-source'), '', 'age cannot retain a GPG keyring selection');
assert.equal(await visible('command-output'), false);
assert.equal(await visible('command-key-path'), false);
await page.selectOption('#command-input-source', 'clipboard');
assert.equal(await visible('command-cipher-summary'), true);
assert.equal(await visible('command-key-source'), true);
await page.selectOption('#command-input-source', 'file');
assert.equal(await visible('command-cipher-summary'), false);
assert.equal(
  await visible('command-copy-button'),
  false,
  'clipboard choice cannot mark text as saved',
);
assert.equal(await visible('command-key-source'), false);
await saveCipher('message.txt.age', age, 'methods-command-pasted.age');
assert.equal(
  await page.evaluate(() => document.getElementById('command-keyring-option').disabled),
  true,
);
await page.selectOption('#command-key-source', 'file');
assert.equal(await value('command-key-path'), '');
assert.equal(await command(), '', 'an empty private-key path cannot produce a command');
// Choosing a command identity uses File.name without reading private-key bytes.
await page.evaluate(() => {
  window.__methodKeyReads = 0;
  window.__methodRestoreKeyReads = [];
  for (const [prototype, methods] of [
    [File.prototype, ['arrayBuffer', 'text', 'stream']],
    [
      FileReader.prototype,
      ['readAsArrayBuffer', 'readAsText', 'readAsBinaryString', 'readAsDataURL'],
    ],
  ]) {
    for (const name of methods) {
      const original = prototype[name];
      window.__methodRestoreKeyReads.push(() => {
        prototype[name] = original;
      });
      prototype[name] = function () {
        window.__methodKeyReads++;
        throw new Error('Command mode must never read a private-key file');
      };
    }
  }
});
await page.setInputFiles('#command-key-file', [base + 'signer-ssh']);
await settled();
assert.equal(await value('command-key-path'), 'signer-ssh');
assert.equal(await page.evaluate(() => window.__methodKeyReads), 0);
assert.equal(await page.evaluate(() => window.__methodDecryptCalls), 0);
assert.equal(await value('secret-text'), protectedKey);
await page.evaluate(() => window.__methodRestoreKeyReads.forEach((restore) => restore()));
await page.fill('#command-key-path', protectedKey);
assert.equal(await command(), '', 'key contents must never be embedded as a path');
assert.equal(await visible('command-error'), true);
assert.equal(
  await page.evaluate(() => document.getElementById('command-error').textContent.includes('BEGIN')),
  false,
  'path errors do not repeat private-key contents',
);
assert.equal(
  await page.evaluate(() => document.getElementById('command-copy-label').textContent),
  'コマンドをコピー',
);
await page.click('#command-tips > summary');
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
await page.evaluate(() => {
  window.__methodClipboardFails = false;
});
await page.fill('#command-key-path', '~/.ssh/test-key');
await page.selectOption('#command-shell', 'posix');
// Clipboard sources generate terminal prompts; selecting them never reads the browser clipboard.
await page.selectOption('#command-input-source', 'clipboard');
assert.equal(await visible('command-cipher-summary'), true);
assert.equal(await visible('command-save-button'), false);
assert.equal(await visible('command-cipher-path'), false);
await page.selectOption('#command-clipboard-tool', '');
assert.equal(await command(), '');
await page.selectOption('#command-clipboard-tool', 'pbpaste');
assert.equal(await value('command-shell'), 'posix');
assert.match(await command(), /暗号文をコピーして Enter/);
assert.match(await command(), /IFS= read -r fumi_enter/);
assert.match(await command(), /pbpaste > /);
await page.selectOption('#command-key-source', 'clipboard');
assert.equal(await visible('command-key-path'), false);
const bothClipboard = await command();
assert.ok(
  bothClipboard.indexOf('秘密鍵をコピーして Enter') <
    bothClipboard.indexOf('暗号文をコピーして Enter'),
);
assert.equal((bothClipboard.match(/pbpaste > /g) || []).length, 2);
assert.equal((bothClipboard.match(/IFS= read -r fumi_enter/g) || []).length, 2);
assert.equal(bothClipboard.includes(protectedKey), false);
assert.equal(bothClipboard.includes(age), false);
await page.selectOption('#command-clipboard-tool', 'powershell');
assert.equal(await value('command-shell'), 'powershell');
assert.equal((await command()).includes('Get-Clipboard -Raw'), true);
await page.selectOption('#command-clipboard-tool', 'wl-paste');
assert.equal(await value('command-shell'), 'posix');
assert.match(await command(), /wl-paste --no-newline/);
await page.selectOption('#command-clipboard-tool', 'xclip');
assert.match(await command(), /xclip -selection clipboard -out/);
await page.selectOption('#command-shell', 'powershell');
assert.equal(await value('command-clipboard-tool'), 'powershell');
await page.selectOption('#command-shell', 'posix');
assert.notEqual(await value('command-clipboard-tool'), 'powershell');
assert.equal(await page.evaluate(() => window.__methodClipboardReads), 0);
await page.selectOption('#command-key-source', 'file');
await page.fill('#command-key-path', '~/.ssh/test-key');
assert.equal(await value('command-input-source'), 'clipboard');
await editCipher();
await page.setInputFiles('#decrypt-file', [base + 'signed.age']);
await idle();
assert.equal(
  await value('command-input-source'),
  'file',
  'binary ciphertext requires a file source',
);
assert.equal(
  await page.evaluate(() => document.getElementById('command-cipher-clipboard-option').disabled),
  true,
  'binary age data cannot use text clipboard commands',
);
assert.equal(await visible('command-cipher-summary'), true);
assert.equal(await value('command-cipher-path'), 'signed.age');
assert.equal(await visible('command-save-button'), false);
assert.match(await command(), /'\.\/signed\.age'$/);
await editCipher();
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
await page.click('#secret-paste summary');
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
if (!(await page.evaluate(() => document.getElementById('secret-paste').open)))
  await page.click('#secret-paste summary');
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
  'PASS: explicit input sources, saved-byte invalidation, file names without private-key reads, prompted OS clipboard commands, keyboard and submit isolation, safe paste/copy fallback, rejected key paths, draft retention, cancelled key reads, and real web round trip.',
);
