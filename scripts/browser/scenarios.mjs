const task = await taskSpace(__FUMI_TASK__);
console.log({ taskSpaceId: task.spaceId });
const page = task.page('p1');
await page.cdp('Page.addScriptToEvaluateOnNewDocument', {
  source: "localStorage.setItem('fumi-locale', 'ja');",
});
const { readFile, writeFile } = await import('node:fs/promises');
const { randomBytes } = await import('node:crypto');
const assert = (await import('node:assert/strict')).default;
const root = __FUMI_ROOT__;
const base = root + 'test-results/signatures/';
const keys = {
  ...JSON.parse(await readFile(base + 'public-responses.json', 'utf8')),
  recipient: await readFile(base + 'recipient-public.asc', 'utf8'),
};
const secret = await readFile(base + 'recipient-secret.asc', 'utf8');
const sshSecret = await readFile(base + 'signer-ssh', 'utf8');
const original = '明日の待ち合わせは10時です。\n<script>window.injected=true</script>\n';
const passed = [];
await page.cdp('Emulation.setDeviceMetricsOverride', {
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
});
await page.cdp('Page.addScriptToEvaluateOnNewDocument', {
  source:
    "window.__errors=[];window.__csp=[];addEventListener('error',e=>window.__errors.push(e.message));addEventListener('unhandledrejection',e=>window.__errors.push(String(e.reason)));addEventListener('securitypolicyviolation',e=>window.__csp.push(e.violatedDirective));",
});
await page.goto(__FUMI_URL__);
assert.equal(
  await page.evaluate(() =>
    ['demo-button', 'include-signature', 'flow-progress', 'next-button'].every(
      (id) => !document.getElementById(id),
    ),
  ),
  true,
);
await page.evaluate((keys) => {
  window.__keyMode = 'match';
  window.__requests = [];
  window.fetch = async (url, options = {}) => {
    window.__requests.push({
      url: String(url),
      method: options.method || 'GET',
      body: options.body || null,
      credentials: options.credentials,
    });
    if (String(url).startsWith('/api/github-profile/'))
      return Response.json({
        id: 1,
        login: String(url).split('/').pop(),
        name: 'Recipient',
        bio: '',
      });
    if (window.__keyMode === 'offline') throw new TypeError('Failed to fetch');
    if (window.__keyMode === 'limit')
      return new Response('{"message":"rate limit"}', {
        status: 429,
        headers: { 'retry-after': '90' },
      });
    const make = () =>
      new Response(
        JSON.stringify(
          window.__keyMode === 'mismatch' ||
            (window.__keyMode === 'ssh-only' && String(url).includes('type=pgp'))
            ? []
            : String(url).includes('type=pgp')
              ? [{ raw_key: String(url).includes('/alice-pgp?') ? keys.pgp : keys.recipient }]
              : [{ key: keys.ssh }],
        ),
      );
    if (window.__keyMode === 'delay')
      return new Promise((resolve) => {
        window.__releaseFetch = () => {
          resolve(make());
          window.__released = true;
        };
      });
    return make();
  };
}, keys);
const value = (id) => page.evaluate((id) => document.getElementById(id).textContent, id);
const visible = (id) => page.evaluate((id) => document.getElementById(id).checkVisibility(), id);
const idle = () =>
  page.waitForFunction(
    () => document.getElementById('workspace').getAttribute('aria-busy') === 'false',
    undefined,
    { timeout: 30000 },
  );
const finished = () =>
  page.waitForFunction(
    () =>
      !document.getElementById('result-panel').hidden &&
      document.getElementById('workspace').getAttribute('aria-busy') === 'false',
    undefined,
    { timeout: 30000 },
  );
async function submit() {
  await page.focus('#run-button');
  await page.press('#run-button', 'Enter');
}
async function clear(mode = 'encrypt') {
  await page.click('#' + mode + '-tab');
  await page.click('#clear-button');
  if (mode === 'decrypt') {
    await page.click('#decrypt-web');
  }
}
async function advanced() {
  if (!(await page.evaluate(() => document.getElementById('recipient-text').checkVisibility())))
    await page.click('#manual-key-button');
}
async function encrypt(text = original, recipient = 'receiver') {
  await clear();
  await page.fill('#encrypt-text', text);
  await page.fill('#github-user', recipient);
  await submit();
  await finished();
}
async function decrypt(cipher, privateKey = secret, password = 'test-recipient-pass') {
  await clear('decrypt');
  await page.fill('#decrypt-text', cipher);

  await page.fill('#secret-text', privateKey);
  await page.waitForSelector('#passphrase', { state: 'visible' });
  await page.fill('#passphrase', password);
  await submit();
  await finished();
}
async function shot(name) {
  await page.evaluate(() => window.scrollTo(0, 0));
  const data = await page.cdp('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  });
  await writeFile(root + 'test-results/minimal-' + name + '.png', Buffer.from(data.data, 'base64'));
}
const layouts = [];
for (const [width, height] of [
  [375, 844],
  [768, 1000],
  [1024, 900],
  [1440, 714],
]) {
  await page.cdp('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width === 375,
  });
  const bounds = await page.evaluate(() => ({
    width: innerWidth,
    document: document.documentElement.scrollWidth,
    action: document.getElementById('run-button').getBoundingClientRect().bottom,
    height: innerHeight,
  }));
  assert.equal(bounds.width, bounds.document);
  assert.ok(bounds.action <= bounds.height);
  layouts.push(bounds);
  await shot('initial-' + width);
}
await encrypt();
const cipher = await value('result-text');
assert.match(cipher, /^-----BEGIN PGP MESSAGE-----/);
assert.equal(await visible('result-text'), true);
assert.equal(
  await page.evaluate(() =>
    document.getElementById('copy-button').classList.contains('primary-button'),
  ),
  true,
);
assert.equal(await visible('result-file'), false);
assert.equal(await page.evaluate(() => document.getElementById('result-details')), null);
await shot('ciphertext');
await page.evaluate(() =>
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async (text) => {
        window.__copied = text;
      },
    },
  }),
);
await page.click('#copy-button');
assert.equal(await page.evaluate(() => window.__copied), cipher);
await page.evaluate(() =>
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async () => {
        throw new Error('denied');
      },
    },
  }),
);
await page.click('#copy-button');
assert.equal(await page.evaluate(() => getSelection().toString().trimEnd()), cipher.trimEnd());
await decrypt(cipher);
assert.equal(await value('result-text'), original);
assert.equal(await page.evaluate(() => Boolean(window.injected)), false);
passed.push(
  'one-submit GitHub encryption; ciphertext is immediately visible; full copy and denied-clipboard fallback; exact text decryption',
);
await page.evaluate(() => {
  window.__keyMode = 'ssh-only';
});
await encrypt();
const sshCipher = await value('result-text');
assert.match(sshCipher, /^-----BEGIN AGE ENCRYPTED FILE-----/);
assert.equal(await visible('result-text'), true);
await decrypt(sshCipher, sshSecret, 'test-sign-pass');
assert.equal(await value('result-text'), original);
await page.evaluate(() => {
  window.__keyMode = 'match';
});
passed.push(
  'plain GitHub usernames prefer GPG when present and automatically use SSH/age for text and files when GPG is absent',
);
await page.click('#edit-result-button');
assert.equal(await page.evaluate(() => document.getElementById('decrypt-text').value), sshCipher);
await page.click('#encrypt-tab');
await page.fill('#encrypt-text', 'draft message');
await page.click('#decrypt-tab');
assert.equal(await page.evaluate(() => document.getElementById('secret-text').value), sshSecret);
await page.click('#encrypt-tab');
assert.equal(
  await page.evaluate(() => document.getElementById('encrypt-text').value),
  'draft message',
);
passed.push('edit and switching operations preserve separate drafts and keys');
await clear();
await page.fill('#encrypt-text', original);
await page.fill('#github-user', 'https://example.com/receiver');
const beforeInvalidRecipient = await page.evaluate(() => window.__requests.length);
await submit();
await idle();
assert.equal(await visible('recipient-error'), true);
assert.equal(await visible('result-panel'), false);
assert.equal(await page.evaluate(() => window.__requests.length), beforeInvalidRecipient);
assert.equal(await page.evaluate(() => document.getElementById('encrypt-text').value), original);
passed.push(
  'invalid GitHub recipients preserve the draft and are rejected before any network request',
);
await clear();
await page.fill('#encrypt-text', original);
await page.fill('#github-user', 'wrong recipient');
await advanced();
await page.fill('#recipient-text', keys.recipient);
assert.equal(await visible('github-recipient'), false);
const requestCount = await page.evaluate(() => window.__requests.length);
await submit();
await finished();
assert.equal(await page.evaluate(() => window.__requests.length), requestCount);
await page.click('#edit-result-button');
await advanced();
await page.fill('#recipient-text', 'bad key');

await submit();
await idle();
assert.equal(await visible('recipient-error'), true);
assert.equal(await page.evaluate(() => !document.getElementById('recipient-key-box').hidden), true);
passed.push(
  'manual public keys visibly replace GitHub recipients, work offline, and stay visible on validation errors',
);
await clear();
await page.fill('#encrypt-text', randomBytes(120000).toString('base64'));
await page.fill('#github-user', 'receiver.gpg');
await submit();
await finished();
assert.equal(await visible('preview-hint'), true);
await page.click('#copy-button');
assert.match(await value('result-error'), /保存/);
assert.equal(await page.evaluate(() => document.activeElement.id), 'save-button');
const largeDownloadPromise = page.waitForEvent('download', { timeout: 30000 });
await page.click('#save-button');
await (await largeDownloadPromise).saveAs(base + 'minimal-large.asc');
assert.ok(
  (await readFile(base + 'minimal-large.asc', 'utf8')).endsWith('-----END PGP MESSAGE-----\n'),
);
await page.evaluate(() =>
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async (text) => {
        window.__copiedLarge = text;
      },
    },
  }),
);
await page.click('#copy-button');
assert.equal(await visible('result-error'), false);
assert.equal(
  await page.evaluate(() => window.__copiedLarge),
  await readFile(base + 'minimal-large.asc', 'utf8'),
);
passed.push(
  'large previews are explicitly limited; failed clipboard never presents truncated ciphertext as a complete manual copy',
);
await writeFile(base + 'payload.bin', new Uint8Array([0, 255, 128, 13, 10, 42]));
await clear();
await page.evaluate(() => {
  window.__keyMode = 'ssh-only';
});
await page.setInputFiles('#encrypt-file', [base + 'payload.bin']);
await idle();
await page.fill('#github-user', 'receiver');
await submit();
await finished();
assert.match(await value('result-filename'), /\.age$/);
await page.evaluate(() => {
  window.__keyMode = 'match';
});
assert.equal(await visible('result-text'), false);
assert.equal(await visible('copy-button'), false);
assert.equal(
  await page.evaluate(() =>
    document.getElementById('save-button').classList.contains('primary-button'),
  ),
  true,
);
const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
await page.click('#save-button');
await (await downloadPromise).saveAs(base + 'minimal.age');
await clear('decrypt');
await page.setInputFiles('#decrypt-file', [base + 'minimal.age']);
await idle();
await page.setInputFiles('#secret-file', [base + 'signer-ssh']);
await idle();
await page.waitForSelector('#passphrase', { state: 'visible' });
await page.fill('#passphrase', 'wrong');
await submit();
await idle();
assert.equal(await visible('secret-error'), true);
await page.waitForSelector('#passphrase', { state: 'visible' });
await page.fill('#passphrase', 'test-sign-pass');
await submit();
await finished();
const restoredPromise = page.waitForEvent('download', { timeout: 30000 });
await page.click('#save-button');
await (await restoredPromise).saveAs(base + 'minimal-restored.bin');
assert.deepEqual(
  await readFile(base + 'minimal-restored.bin'),
  await readFile(base + 'payload.bin'),
);
passed.push(
  'file attachment, age output and protected SSH-key decryption preserve exact binary bytes; wrong passwords retain inputs',
);
for (const [keyMode, state] of [
  ['match', 'verified'],
  ['mismatch', 'mismatch'],
  ['offline', 'unavailable'],
]) {
  await page.evaluate((mode) => {
    window.__keyMode = mode;
  }, keyMode);
  await decrypt(await readFile(base + 'legacy-native.asc', 'utf8'));
  assert.match(
    await page.evaluate(() => document.getElementById('signature-status').className),
    new RegExp(state),
  );
  assert.equal(await visible('signature-status'), true);
}
await page.evaluate(() => {
  window.__keyMode = 'match';
});
await page.click('#retry-verification');
await idle();
assert.match(
  await page.evaluate(() => document.getElementById('signature-status').className),
  /verified/,
);
await decrypt(await readFile(base + 'legacy-signed.asc', 'utf8'));
assert.match(
  await page.evaluate(() => document.getElementById('signature-status').className),
  /verified/,
);
await clear('decrypt');
await page.fill('#decrypt-text', await readFile(base + 'legacy-native.asc', 'utf8'));

await page.fill('#secret-text', secret);
await page.waitForSelector('#passphrase', { state: 'visible' });
await page.fill('#passphrase', 'test-recipient-pass');
await page.evaluate(() => {
  window.__keyMode = 'delay';
  window.__released = false;
  delete window.__releaseFetch;
});
await submit();
await page.waitForFunction(() => Boolean(window.__releaseFetch), undefined, { timeout: 30000 });
assert.equal(await visible('result-cancel-button'), true);
assert.equal(
  await page.evaluate(
    () =>
      document.getElementById('copy-button').disabled &&
      document.getElementById('save-button').disabled,
  ),
  true,
);
await page.click('#result-cancel-button');
await page.evaluate(() => window.__releaseFetch());
await page.waitForFunction(() => window.__released);
assert.match(
  await page.evaluate(() => document.getElementById('signature-status').className),
  /unavailable/,
);
await page.evaluate(() => {
  window.__keyMode = 'match';
});
for (const name of ['tampered.asc', 'unsupported-native.asc']) {
  await clear('decrypt');
  await page.fill('#decrypt-text', await readFile(base + name, 'utf8'));

  await page.fill('#secret-text', secret);
  await page.waitForSelector('#passphrase', { state: 'visible' });
  await page.fill('#passphrase', 'test-recipient-pass');
  await submit();
  await idle();
  assert.equal(await visible('result-panel'), false);
  assert.equal(
    await page.evaluate(() =>
      [...document.querySelectorAll('.field-error')].some(
        (node) => node.checkVisibility() && node.textContent.trim(),
      ),
    ),
    true,
  );
}
passed.push(
  'existing native and ZIP signatures remain readable; current-key mismatch/offline/retry stay visible; tampering never releases plaintext',
);
await clear();
await page.fill('#encrypt-text', 'cancelled draft');
await page.fill('#github-user', 'delayed.gpg');
await page.evaluate(() => {
  window.__keyMode = 'delay';
  window.__released = false;
  delete window.__releaseFetch;
});
await submit();
await page.waitForFunction(() => Boolean(window.__releaseFetch), undefined, { timeout: 30000 });
await page.click('#cancel-button');
await page.evaluate(() => window.__releaseFetch());
await page.waitForFunction(() => window.__released);
assert.equal(await visible('result-panel'), false);
assert.equal(
  await page.evaluate(() => document.getElementById('encrypt-text').value),
  'cancelled draft',
);
await page.evaluate(() => {
  window.__keyMode = 'limit';
});
await page.fill('#github-user', 'limited.gpg');
await submit();
await idle();
assert.match(await value('recipient-reason'), /取得できません/);
await advanced();
await page.fill('#recipient-text', keys.recipient);
await submit();
await finished();
passed.push(
  'cancelled lookup cannot replace a draft; rate limits remain recoverable by supplying a public key',
);
const telemetry = await page.evaluate(() => ({
  errors: window.__errors,
  csp: window.__csp,
  requests: window.__requests,
}));
assert.deepEqual(telemetry.errors, []);
assert.deepEqual(telemetry.csp, []);
for (const request of telemetry.requests) {
  assert.match(
    request.url,
    /^\/api\/github-(?:keys\/[a-z0-9-]+\?type=(pgp|ssh)|profile\/[a-z0-9-]+)$/,
  );
  assert.equal(request.method, 'GET');
  assert.equal(request.body, null);
  assert.equal(request.credentials, 'omit');
}
await writeFile(
  root + 'test-results/minimal-browser-report.json',
  JSON.stringify(
    {
      passed,
      layouts,
      requests: telemetry.requests.length,
      errors: telemetry.errors,
      csp: telemetry.csp,
    },
    null,
    2,
  ) + '\n',
);
console.log({
  passed,
  layouts,
  requests: telemetry.requests.length,
  errors: telemetry.errors,
  csp: telemetry.csp,
});
if (!__FUMI_KEEP__) await task.finish({ keep: [] });
