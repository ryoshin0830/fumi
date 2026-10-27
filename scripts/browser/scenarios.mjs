const task = await taskSpace(__FUMI_TASK__);
console.log({ taskSpaceId: task.spaceId });
const page = task.page('p1');
const { readFile, writeFile } = await import('node:fs/promises');
const { default: assert } = await import('node:assert/strict');
const root = __FUMI_ROOT__;
const base = root + 'test-results/signatures/';
const publicKeys = JSON.parse(await readFile(base + 'public-responses.json', 'utf8'));
const receiver = await readFile(base + 'recipient-secret.asc', 'utf8');
const signerPGP = await readFile(base + 'signer-secret.asc', 'utf8');
const signerSSH = await readFile(base + 'signer-ssh', 'utf8');
const original = '新しい画面でも元の内容を保持します。\n<script>window.injected=true</script>\n';
const passed = [];
await writeFile(base + 'payload.bin', new Uint8Array([0, 255, 128, 13, 10, 42]));
await page.cdp('Emulation.setDeviceMetricsOverride', {
  width: 1440,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: false,
});
await page.cdp('Page.addScriptToEvaluateOnNewDocument', {
  source:
    "window.__errors=[];window.__csp=[];addEventListener('error',e=>window.__errors.push(e.message));addEventListener('unhandledrejection',e=>window.__errors.push(String(e.reason)));addEventListener('securitypolicyviolation',e=>window.__csp.push(e.violatedDirective));",
});
await page.goto(__FUMI_URL__);
await page.evaluate((keys) => {
  window.__keyMode = 'match';
  window.__requests = [];
  window.fetch = async (url, options = {}) => {
    window.__requests.push({
      url: String(url),
      method: options.method || 'GET',
      credentials: options.credentials,
      body: options.body || null,
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
          window.__keyMode === 'mismatch'
            ? []
            : String(url).includes('type=pgp')
              ? [{ raw_key: keys.pgp }]
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
}, publicKeys);
const value = (id) => page.evaluate((id) => document.getElementById(id).textContent, id);
const visible = (id) => page.evaluate((id) => document.getElementById(id).checkVisibility(), id);
const stage = () =>
  page.evaluate(() =>
    Number(document.querySelector('[data-go-step][aria-current="step"]').dataset.goStep),
  );
const signature = () => page.evaluate(() => document.getElementById('signature-status').className);
const idle = () =>
  page.waitForFunction(() => document.getElementById('cancel-button').hidden, undefined, {
    timeout: 30000,
  });
const finished = () =>
  page.waitForFunction(
    () =>
      !document.getElementById('result-panel').hidden &&
      document.getElementById('cancel-button').hidden,
    undefined,
    { timeout: 30000 },
  );
const shot = async (name) => {
  const capture = await page.cdp('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  });
  await writeFile(root + 'test-results/' + name + '.png', Buffer.from(capture.data, 'base64'));
};
async function reset(mode) {
  await page.click('#' + mode + '-tab');
  await page.click('#clear-button');
}
async function content(mode, text) {
  await reset(mode);
  await page.fill('#' + mode + '-text', text);
  await page.click('#next-button');
}
async function manualRecipient() {
  await page.click('#manual-keys > summary');
  await page.setInputFiles('#recipient-file', [base + 'recipient-public.asc']);
  await idle();
  await page.click('#next-button');
}
async function signing(type = 'pgp') {
  if (!(await page.evaluate(() => document.getElementById('additional-options').open)))
    await page.click('#additional-options > summary');
  await page.click('#include-signature');
  await page.fill('#signer-github', type === 'pgp' ? 'alice-pgp' : 'alice-ssh');
  await page.fill('#signer-text', type === 'pgp' ? signerPGP : signerSSH);
  await page.fill('#signer-passphrase', type === 'pgp' ? 'test-sign-pass' : 'test-sign-pass');
}
async function decrypt(cipher, key = receiver, pass = 'test-recipient-pass') {
  await content('decrypt', cipher);
  await page.fill('#secret-text', key);
  await page.fill('#passphrase', pass);
  await page.click('#run-button');
  await finished();
}
for (const { width, height } of [
  { width: 375, height: 844 },
  { width: 1440, height: 714 },
  { width: 1440, height: 1000 },
]) {
  await page.cdp('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width === 375,
  });
  assert.equal(
    await page.evaluate(
      () => document.getElementById('next-button').getBoundingClientRect().bottom <= innerHeight,
    ),
    true,
    `The first action must fit at ${width}×${height}`,
  );
  await shot(`approachable-initial-${width}x${height}`);
}
assert.equal(await stage(), 0);
assert.equal(await visible('github-user'), false);
assert.equal(await visible('include-signature'), false);
assert.equal(await visible('secret-text'), false);
assert.equal(await page.evaluate(() => document.getElementById('next-button').disabled), true);
assert.equal(await visible('flow-hint'), true);
assert.match(await value('flow-hint'), /入力|ファイル/);
assert.equal(await visible('sample-invitation'), true);
await page.fill('#encrypt-text', '   ');
assert.equal(await page.evaluate(() => document.getElementById('next-button').disabled), true);
await page.fill('#encrypt-text', original);
assert.equal(await visible('sample-invitation'), false);
await page.evaluate(() => document.getElementById('demo-button').click());
await idle();
assert.equal(await page.evaluate(() => document.getElementById('encrypt-text').value), original);
await page.press('#encrypt-text', 'ControlOrMeta+Enter');
assert.equal(await stage(), 1);
assert.equal(await page.evaluate(() => document.activeElement.id), 'operation-title');
assert.equal(await visible('encrypt-text'), false);
assert.equal(await page.evaluate(() => document.getElementById('next-button').disabled), true);
await page.click('#back-button');
assert.equal(await stage(), 0);
assert.equal(await page.evaluate(() => document.getElementById('encrypt-text').value), original);
await page.click('#decrypt-tab');
assert.equal(await stage(), 0);
await page.fill('#decrypt-text', 'not an encrypted message');
assert.equal(await page.evaluate(() => document.getElementById('next-button').disabled), true);
await page.click('#encrypt-tab');
assert.equal(await page.evaluate(() => document.getElementById('encrypt-text').value), original);
await page.click('#next-button');
await page.fill('#github-user', 'not a valid username');
await page.press('#github-user', 'Tab');
assert.equal(await page.evaluate(() => document.activeElement.id), 'lookup-button');
await page.fill('#github-user', '');
await manualRecipient();
assert.equal(await stage(), 2);
assert.equal(
  await page.evaluate(() => document.getElementById('include-signature').checked),
  false,
);
assert.equal(await visible('signer-text'), false);
assert.equal(await page.evaluate(() => document.getElementById('signer-text').disabled), true);
assert.equal(await visible('include-signature'), false);
assert.equal(await page.evaluate(() => document.getElementById('additional-options').open), false);
assert.match(await value('review-content'), /新しい画面/);
assert.match(await value('review-opening'), /GPG/);
await page.click('[data-edit-step="0"]');
assert.equal(await stage(), 0);
assert.equal(await page.evaluate(() => document.getElementById('encrypt-text').value), original);
await page.click('#next-button');
await page.click('#next-button');
await page.click('[data-edit-step="1"]');
assert.equal(await stage(), 1);
assert.equal(await visible('recipient-card'), true);
await page.click('#next-button');
passed.push(
  'empty-state guidance is visible; samples cannot overwrite drafts; later controls stay hidden; keyboard navigation, review edits and per-mode drafts work',
);
await signing();
await page.fill('#signer-passphrase', 'wrong');
await page.click('#additional-options > summary');
await page.click('#run-button');
await idle();
assert.equal(await visible('signer-error'), true);
assert.equal(await page.evaluate(() => document.getElementById('additional-options').open), true);
assert.equal(await page.evaluate(() => document.activeElement.id), 'signer-error');
assert.match(await value('signer-error'), /パスフレーズ/);
assert.equal(await stage(), 2);
await page.fill('#signer-passphrase', 'test-sign-pass');
await page.click('#run-button');
await finished();
assert.match(await signature(), /created/);
assert.equal(await visible('main-form'), false);
assert.equal(
  await page.evaluate(() => document.getElementById('result-preview-disclosure').open),
  false,
);
assert.equal(await page.evaluate(() => document.getElementById('result-details').open), false);
assert.equal(await visible('result-handoff'), true);
assert.match(await value('result-handoff'), /メールやチャット/);
assert.match(await value('result-handoff'), /秘密鍵/);
assert.match(await value('result-title'), /渡す準備/);
const ciphertextPGP = await value('result-text');
assert.equal(await value('result-filename'), 'message.txt.asc');
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
assert.equal(
  await page.evaluate(() => document.getElementById('result-preview-disclosure').open),
  true,
);
assert.equal(
  await page.evaluate(() => getSelection().toString().trimEnd()),
  ciphertextPGP.trimEnd(),
);
assert.equal(await visible('result-text'), true);
await page.click('#edit-result-button');
assert.equal(await stage(), 2);
assert.equal(await page.evaluate(() => document.getElementById('signer-text').value), signerPGP);
await page.click('[data-go-step="0"]');
assert.equal(await page.evaluate(() => document.getElementById('encrypt-text').value), original);
passed.push(
  'optional signature fields appear on request; errors stay visible; result hides inputs and encrypted preview; denied clipboard opens manual-copy fallback; editing preserves inputs',
);
await decrypt(ciphertextPGP);
assert.equal(await visible('result-handoff'), false);
assert.match(await signature(), /verified/);
assert.equal(await value('result-text'), original);
assert.equal(
  await page.evaluate(() => document.getElementById('decrypt-tab').getBoundingClientRect().y >= 0),
  true,
);
assert.equal(
  await page.evaluate(() => document.getElementById('result-preview-disclosure').open),
  true,
);
assert.equal(await page.evaluate(() => Boolean(window.injected)), false);
const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
await page.click('#save-button');
const download = await downloadPromise;
await download.saveAs(base + 'guided-restored.txt');
assert.equal(await readFile(base + 'guided-restored.txt', 'utf8'), original);
for (const [keyMode, expected] of [
  ['mismatch', 'mismatch'],
  ['offline', 'unavailable'],
]) {
  await page.evaluate((mode) => {
    window.__keyMode = mode;
  }, keyMode);
  await decrypt(ciphertextPGP);
  assert.match(await signature(), new RegExp(expected));
  assert.equal(await visible('signature-status'), true);
}
await page.evaluate(() => {
  window.__keyMode = 'match';
});
await page.click('#retry-verification');
await finished();
assert.match(await signature(), /verified/);
passed.push(
  'native signed text restores exact bytes and saves; current-key mismatch/offline remain visible and retry uses the current key',
);
await content('encrypt', original);
await manualRecipient();
await signing('ssh');
assert.match(await value('review-opening'), /ZIP/);
await page.click('#run-button');
await finished();
const sshSignedPGP = await value('result-text');
await decrypt(sshSignedPGP);
assert.match(await signature(), /verified/);
passed.push(
  'protected SSH signing key works with OpenPGP recipient; the recipient opening/ZIP explanation appears before encryption',
);
await reset('encrypt');
await page.click('[data-input="encrypt"][data-kind="file"]');
await page.setInputFiles('#encrypt-file', [base + 'payload.bin']);
await idle();
await page.click('#next-button');
await page.fill('#github-user', 'alice-ssh.keys');
await page.click('#lookup-button');
await idle();
await page.click('#next-button');
assert.match(await value('review-opening'), /GPGでは開けません/);
await signing();
await page.click('#run-button');
await finished();
assert.equal(await visible('copy-button'), false);
assert.doesNotMatch(await value('result-description'), /コピー/);
assert.doesNotMatch(await value('delivery-instruction'), /コピー/);
const agePromise = page.waitForEvent('download', { timeout: 30000 });
await page.click('#save-button');
const ageDownload = await agePromise;
await ageDownload.saveAs(base + 'guided-signed.age');
await reset('decrypt');
await page.click('[data-input="decrypt"][data-kind="file"]');
await page.setInputFiles('#decrypt-file', [base + 'guided-signed.age']);
await idle();
await page.click('#next-button');
await page.fill('#secret-text', signerSSH);
await page.fill('#passphrase', 'test-sign-pass');
await page.click('#run-button');
await finished();
assert.match(await signature(), /verified/);
const binaryPromise = page.waitForEvent('download', { timeout: 30000 });
await page.click('#save-button');
const binary = await binaryPromise;
await binary.saveAs(base + 'guided-restored.bin');
assert.deepEqual(
  await readFile(base + 'guided-restored.bin'),
  await readFile(base + 'payload.bin'),
);
passed.push(
  'age binary with a PGP signature restores the original name and bytes; distinct GPG/age behavior is disclosed at review',
);
for (const fixture of ['tampered.asc', 'unsupported-native.asc']) {
  await content('decrypt', await readFile(base + fixture, 'utf8'));
  await page.fill('#secret-text', receiver);
  await page.fill('#passphrase', 'test-recipient-pass');
  await page.click('#run-button');
  await idle();
  assert.equal(await page.evaluate(() => document.getElementById('result-panel').hidden), true);
  assert.equal(
    await page.evaluate(() =>
      ['operation-error', 'decrypt-content-error', 'secret-error'].some(
        (id) =>
          document.getElementById(id).textContent &&
          document.getElementById(id).getClientRects().length,
      ),
    ),
    true,
  );
}
await content('decrypt', '-----BEGIN PGP MESSAGE-----\n\ninvalid-data\n-----END PGP MESSAGE-----');
await page.fill('#secret-text', receiver);
await page.fill('#passphrase', 'test-recipient-pass');
await page.click('#run-button');
await idle();
assert.equal(await stage(), 0);
assert.equal(await visible('decrypt-content-error'), true);
assert.equal(await page.evaluate(() => document.activeElement.id), 'decrypt-content-error');
await decrypt(await readFile(base + 'external-signed.asc', 'utf8'));
assert.match(await signature(), /external/);
assert.equal(
  await page.evaluate(() => document.getElementById('signature-account-line').hidden),
  true,
);
passed.push(
  'corrupt/unsupported signatures never expose plaintext; malformed data returns to its visible error step; external signatures do not claim a GitHub identity',
);
await content('decrypt', ciphertextPGP);
await page.fill('#secret-text', receiver);
await page.fill('#passphrase', 'test-recipient-pass');
await page.evaluate(() => {
  window.__keyMode = 'delay';
  window.__released = false;
  delete window.__releaseFetch;
});
await page.click('#run-button');
await page.waitForFunction(() => Boolean(window.__releaseFetch), undefined, { timeout: 30000 });
assert.match(await signature(), /pending/);
assert.equal(await visible('result-cancel-button'), true);
assert.equal(await page.evaluate(() => document.getElementById('save-button').disabled), true);
await page.click('#result-cancel-button');
assert.match(await signature(), /unavailable/);
await page.evaluate(() => window.__releaseFetch());
await page.waitForFunction(() => window.__released);
assert.match(await signature(), /unavailable/);
await page.evaluate(() => {
  window.__keyMode = 'match';
});
await page.click('#privacy-options > summary');
await page.click('#clear-all-button');
await page.click('#encrypt-tab');
assert.equal(await stage(), 0);
assert.equal(
  await page.evaluate(() =>
    ['signer-text', 'signer-passphrase', 'secret-text'].every(
      (id) => document.getElementById(id).value === '',
    ),
  ),
  true,
);
await decrypt(ciphertextPGP);
await reset('encrypt');
await page.click('#demo-button');
await idle();
assert.equal(await stage(), 2);
assert.equal(await page.evaluate(() => document.activeElement.id), 'operation-title');
await page.click('#run-button');
await finished();
assert.equal(await page.evaluate(() => document.getElementById('signature-status').hidden), true);
assert.equal(await visible('try-decrypt-button'), false);
assert.equal(await visible('sample-decrypt-hint'), true);
await page.evaluate(() => document.getElementById('try-decrypt-button').click());
await page.click('#decrypt-tab');
assert.equal(await value('result-text'), original);
assert.equal(await page.evaluate(() => document.getElementById('secret-text').value), receiver);
assert.equal(
  await page.evaluate(() => document.getElementById('passphrase').value),
  'test-recipient-pass',
);
await page.click('#clear-button');
await page.click('#encrypt-tab');
assert.equal(await visible('try-decrypt-button'), true);
await page.click('#try-decrypt-button');
assert.equal(await stage(), 1);
assert.equal(await page.evaluate(() => document.activeElement.id), 'operation-title');
await page.click('#run-button');
await finished();
assert.match(await value('result-text'), /Fumiへようこそ/);
passed.push(
  'pending GitHub checks have a visible cancellation action; late responses cannot change cancelled results; clear-all resets progress/secrets; the trial completes a full round trip',
);
await reset('encrypt');
await page.click('[data-input="encrypt"][data-kind="file"]');
await page.setInputFiles('#encrypt-file', [base + 'payload.bin']);
await idle();
assert.equal(await visible('sample-invitation'), false);
await page.evaluate(() => document.getElementById('demo-button').click());
await idle();
assert.equal(await stage(), 0);
assert.match(await value('encrypt-file-name'), /payload.bin/);
assert.equal(await page.evaluate(() => document.getElementById('recipient-card').hidden), true);
assert.equal(await page.evaluate(() => document.getElementById('run-button').disabled), true);
passed.push(
  'sample activation is unavailable for a selected file and cannot replace its draft or assign a disposable recipient',
);
await content('encrypt', 'layout and recovery');
await manualRecipient();
await signing();
const layouts = [];
for (const width of [375, 768, 1024, 1440]) {
  await page.cdp('Emulation.setDeviceMetricsOverride', {
    width,
    height: width === 375 ? 844 : 1000,
    deviceScaleFactor: 1,
    mobile: width === 375,
  });
  const bounds = await page.evaluate(() => ({
    width: innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  assert.equal(bounds.width, bounds.document);
  layouts.push(bounds);
  if (width === 375) await shot('guided-mobile-signing');
}
await page.press('#include-signature', 'Space');
assert.equal(
  await page.evaluate(() => document.getElementById('include-signature').checked),
  false,
);
await page.click('[data-go-step="1"]');
await page.evaluate(() => {
  window.__keyMode = 'limit';
});
await page.fill('#github-user', 'limited-user');
await page.click('#lookup-button');
await idle();
assert.equal(await visible('github-recovery'), true);
assert.match(await value('github-error'), /取得上限/);
const count = await page.evaluate(() => window.__requests.length);
await page.click('#lookup-button');
await idle();
assert.equal(await page.evaluate(() => window.__requests.length), count);
await page.click('#open-manual-keys');
await page.fill('#recipient-text', await readFile(base + 'recipient-public.asc', 'utf8'));
await page.click('#use-key-button');
await idle();
await page.click('#next-button');
await page.click('#run-button');
await finished();
assert.match(await signature(), /none/);
await page.click('#edit-result-button');
await signing();
await page.click('#run-button');
await idle();
assert.equal(await visible('signer-error'), true);
assert.equal(await page.evaluate(() => document.getElementById('include-signature').checked), true);
assert.equal(await page.evaluate(() => document.getElementById('result-panel').hidden), true);
passed.push(
  '375–1440px layouts fit; keyboard toggles work; rate-limit recovery and manual import remain usable; requested signatures are never silently disabled',
);
const telemetry = await page.evaluate(() => ({
  errors: window.__errors,
  csp: window.__csp,
  requests: window.__requests,
}));
assert.deepEqual(telemetry.errors, []);
assert.deepEqual(telemetry.csp, []);
for (const request of telemetry.requests) {
  assert.match(request.url, /^\/api\/github-keys\/[a-z0-9-]+\?type=(pgp|ssh)$/);
  assert.equal(request.method, 'GET');
  assert.equal(request.credentials, 'omit');
  assert.equal(request.body, null);
}
await writeFile(
  root + 'test-results/guided-browser-report.json',
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
await task.finish({ keep: [] });
