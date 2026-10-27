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
const original = '署名付きメッセージです。\n<script>window.injected=true</script>\n';
const passed = [];
await writeFile(base + 'payload.bin', new Uint8Array([0, 255, 128, 13, 10, 42]));
await page.cdp('Emulation.setDeviceMetricsOverride', {
  width: 1440,
  height: 1200,
  deviceScaleFactor: 1,
  mobile: false,
});
await page.cdp('Page.addScriptToEvaluateOnNewDocument', {
  source: `window.__errors=[];window.__csp=[];window.addEventListener('error',e=>window.__errors.push(e.message));window.addEventListener('unhandledrejection',e=>window.__errors.push(String(e.reason)));window.addEventListener('securitypolicyviolation',e=>window.__csp.push(e.violatedDirective));`,
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
          String(url).includes('/gpg_keys?') || String(url).includes('type=pgp')
            ? window.__keyMode === 'mismatch'
              ? []
              : [{ raw_key: keys.pgp }]
            : window.__keyMode === 'mismatch'
              ? []
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
const state = () => page.evaluate(() => document.getElementById('signature-status').className);
assert.equal(
  await page.evaluate(() => document.getElementById('include-signature').checked),
  false,
);
assert.equal(
  await page.evaluate(
    () =>
      document.getElementById('signer-fields').hidden &&
      document.getElementById('signer-text').disabled,
  ),
  true,
);
await page.screenshot({ path: root + 'test-results/signature-default-desktop.png' });
await page.fill('#encrypt-text', original);
await page.click('#manual-keys > summary');
await page.setInputFiles('#recipient-file', [base + 'recipient-public.asc']);
await idle();
await page.click('#include-signature');
assert.equal(await page.evaluate(() => document.getElementById('signer-fields').hidden), false);
await page.fill('#signer-github', 'alice-pgp');
await page.fill('#signer-text', signerPGP);
await page.fill('#signer-passphrase', 'wrong');
assert.match(
  await page.evaluate(() => document.getElementById('signing-delivery-title').textContent),
  /GPGでそのまま/,
);
await page.click('#run-button');
await idle();
assert.match(
  await page.evaluate(() => document.getElementById('signer-error').textContent),
  /パスフレーズ/,
);
assert.equal(await page.evaluate(() => document.getElementById('result-panel').hidden), true);
await page.fill('#signer-passphrase', 'test-sign-pass');
await page.click('#run-button');
await finished();
assert.match(await state(), /created/);
assert.equal(
  await page.evaluate(() => document.getElementById('result-filename').textContent),
  'message.txt.asc',
);
assert.doesNotMatch(
  await page.evaluate(() => document.getElementById('cli-description').textContent),
  /ZIP/,
);
assert.match(
  await page.evaluate(() => document.getElementById('cli-description').textContent),
  /同時に署名/,
);
const ciphertextPGP = await page.evaluate(() => document.getElementById('result-text').textContent);
passed.push(
  'upfront native-GPG explanation matches direct .asc output and CLI help; protected signing key and wrong-passphrase recovery work',
);
await page.click('#decrypt-tab');
await page.fill('#decrypt-text', ciphertextPGP);
await page.fill('#secret-text', receiver);
await page.fill('#passphrase', 'test-recipient-pass');
await page.click('#run-button');
await finished();
assert.match(await state(), /verified/);
assert.equal(
  await page.evaluate(() => document.getElementById('signature-account').textContent),
  '@alice-pgp',
);
assert.equal(
  await page.evaluate(() => document.getElementById('signature-account-label').textContent),
  '署名者',
);
assert.equal(
  await page.evaluate(() => document.getElementById('result-text').textContent),
  original,
);
assert.equal(await page.evaluate(() => 'injected' in window), false);
await page.evaluate(() =>
  document.getElementById('result-panel').scrollIntoView({ block: 'start', behavior: 'instant' }),
);
await page.waitForFunction(
  () => getComputedStyle(document.getElementById('result-panel')).opacity === '1',
);
await page.screenshot({ path: root + 'test-results/next-native-verified.png' });
const download = page.waitForEvent('download', { timeout: 10000 });
await page.click('#save-button');
const file = await download;
assert.equal(file.suggestedFilename(), 'message.txt');
await file.saveAs(base + 'restored.txt');
assert.equal(await readFile(base + 'restored.txt', 'utf8'), original);
passed.push(
  'signed PGP decrypts, automatically matches GitHub public key, shows username and saves exact original data',
);
await page.evaluate(() => {
  window.__keyMode = 'mismatch';
});
await page.click('#run-button');
await finished();
assert.match(await state(), /mismatch/);
assert.equal(
  await page.evaluate(() => document.getElementById('signature-account-label').textContent),
  '署名者（申告）',
);
assert.equal(await page.evaluate(() => document.getElementById('save-button').disabled), false);
await page.evaluate(() => {
  window.__keyMode = 'match';
});
await page.click('#retry-verification');
await idle();
assert.match(await state(), /verified/);
await page.evaluate(() => {
  window.__keyMode = 'offline';
});
await page.click('#run-button');
await finished();
assert.match(await state(), /unavailable/);
assert.equal(
  await page.evaluate(() => document.getElementById('result-text').textContent),
  original,
);
await page.evaluate(() => {
  window.__keyMode = 'match';
});
await page.click('#retry-verification');
await idle();
assert.match(await state(), /verified/);
passed.push(
  'key removal/mismatch and offline are never shown as verified; retry uses current GitHub key',
);
await page.click('#encrypt-tab');
await page.fill('#signer-github', 'alice-ssh');
await page.fill('#signer-text', signerSSH);
await page.fill('#signer-passphrase', 'test-sign-pass');
assert.match(
  await page.evaluate(() => document.getElementById('signing-delivery-title').textContent),
  /ZIPを展開/,
);
await page.click('#run-button');
await finished();
assert.match(
  await page.evaluate(() => document.getElementById('signature-algorithm').textContent),
  /OpenSSH/,
);
const ciphertextSSHSigner = await page.evaluate(
  () => document.getElementById('result-text').textContent,
);
await page.click('#decrypt-tab');
await page.fill('#decrypt-text', ciphertextSSHSigner);
await page.click('#run-button');
await finished();
assert.match(await state(), /verified/);
assert.equal(
  await page.evaluate(() => document.getElementById('signature-account').textContent),
  '@alice-ssh',
);
passed.push(
  'protected SSH signing key works with OpenPGP recipient, standard SSHSIG verifies against .keys',
);
await page.click('#encrypt-tab');
await page.click('#manual-keys > summary');
await page.fill('#recipient-text', publicKeys.ssh);
await page.click('#use-key-button');
await idle();
await page.fill('#signer-github', 'alice-pgp');
await page.fill('#signer-text', signerPGP);
await page.click('[data-input="encrypt"][data-kind="file"]');
await page.setInputFiles('#encrypt-file', [base + 'payload.bin']);
await idle();
await page.click('#run-button');
await finished();
assert.match(
  await page.evaluate(() => document.getElementById('result-filename').textContent),
  /payload\.bin\.signed\.zip\.age$/,
);
assert.match(
  await page.evaluate(() => document.getElementById('result-description').textContent),
  /ZIPを展開/,
);
assert.match(
  await page.evaluate(() => document.getElementById('cli-command').textContent),
  /unzip -n/,
);
const ageDownload = page.waitForEvent('download', { timeout: 10000 });
await page.click('#save-button');
const ageFile = await ageDownload;
await ageFile.saveAs(base + 'signed.age');
await page.click('#decrypt-tab');
await page.click('[data-input="decrypt"][data-kind="file"]');
await page.setInputFiles('#decrypt-file', [base + 'signed.age']);
await idle();
await page.fill('#secret-text', signerSSH);
await page.fill('#passphrase', 'test-sign-pass');
await page.click('#run-button');
await finished();
assert.match(await state(), /verified/);
assert.equal(
  await page.evaluate(() => document.getElementById('result-filename').textContent),
  'payload.bin',
);
await page.evaluate(() =>
  document.getElementById('result-panel').scrollIntoView({ block: 'start', behavior: 'instant' }),
);
await page.waitForFunction(
  () => getComputedStyle(document.getElementById('result-panel')).opacity === '1',
);
await page.screenshot({ path: root + 'test-results/next-age-verified.png' });
const binaryDownload = page.waitForEvent('download', { timeout: 10000 });
await page.click('#save-button');
const binary = await binaryDownload;
await binary.saveAs(base + 'restored.bin');
assert.deepEqual(await readFile(base + 'restored.bin'), await readFile(base + 'payload.bin'));
passed.push(
  'PGP signer works with age encrypted binary; automatic unwrap restores original filename and every byte',
);
await page.click('[data-input="decrypt"][data-kind="text"]');
await page.fill('#decrypt-text', await readFile(base + 'tampered.asc', 'utf8'));
await page.fill('#secret-text', receiver);
await page.fill('#passphrase', 'test-recipient-pass');
await page.click('#run-button');
await idle();
assert.equal(await page.evaluate(() => document.getElementById('result-panel').hidden), true);
assert.match(
  await page.evaluate(() =>
    [...document.querySelectorAll('.field-error,#operation-error')]
      .map((x) => x.textContent)
      .join(' '),
  ),
  /署名|変更/,
);
assert.equal(await page.evaluate(() => document.getElementById('result-text').textContent), '');
passed.push('tampered signed payload is blocked before plaintext is exposed');
await page.fill('#decrypt-text', await readFile(base + 'unsupported-native.asc', 'utf8'));
await page.click('#run-button');
await idle();
assert.equal(await page.evaluate(() => document.getElementById('result-panel').hidden), true);
assert.equal(await page.evaluate(() => document.getElementById('result-text').textContent), '');
assert.match(
  await page.evaluate(() =>
    [...document.querySelectorAll('.field-error,#operation-error')]
      .filter((x) => !x.hidden)
      .map((x) => x.textContent)
      .join(' '),
  ),
  /復号/,
);
passed.push(
  'unsupported native signature packets fail closed before showing plaintext or an unsigned result',
);
await page.fill('#decrypt-text', await readFile(base + 'external-signed.asc', 'utf8'));
await page.click('#run-button');
await finished();
assert.match(await state(), /external/);
assert.match(
  await page.evaluate(() => document.getElementById('signature-status-title').textContent),
  /OpenPGP署名あり・GitHub未照合/,
);
assert.equal(
  await page.evaluate(() => document.getElementById('signature-account-line').hidden),
  true,
);
assert.equal(
  await page.evaluate(() => document.getElementById('result-text').textContent),
  'External OpenPGP signed message',
);
passed.push(
  'external outer OpenPGP signature is shown as present without claiming a GitHub identity',
);
await page.fill('#decrypt-text', ciphertextPGP);
await page.evaluate(() => {
  window.__keyMode = 'delay';
  window.__released = false;
});
await page.click('#run-button');
await page.waitForFunction(() => Boolean(window.__releaseFetch), undefined, { timeout: 20000 });
assert.match(await state(), /pending/);
assert.equal(await page.evaluate(() => document.getElementById('save-button').disabled), true);
await page.click('#cancel-button');
assert.match(await state(), /unavailable/);
await page.evaluate(() => window.__releaseFetch());
await page.waitForFunction(() => window.__released);
await page.click('#clear-all-button');
await page.click('#encrypt-tab');
await page.fill('#encrypt-text', 'new draft');
await page.click('#manual-keys > summary');
await page.setInputFiles('#recipient-file', [base + 'recipient-public.asc']);
await idle();
assert.equal(await page.evaluate(() => document.getElementById('result-panel').hidden), true);
assert.equal(
  await page.evaluate(() => document.getElementById('include-signature').checked),
  false,
);
await page.click('#run-button');
await finished();
assert.match(await state(), /none/);
assert.equal(
  await page.evaluate(() =>
    ['signer-github', 'signer-text', 'signer-passphrase'].every(
      (id) => document.getElementById(id).value === '',
    ),
  ),
  true,
);
passed.push(
  'cancelled verification cannot overwrite new data; clear-all erases signer inputs; signature remains optional',
);
await page.click('#clear-all-button');
await page.click('[data-input="encrypt"][data-kind="file"]');
await page.setInputFiles('#encrypt-file', [base + 'payload.bin']);
await idle();
await page.click('#demo-button');
await idle();
await page.click('[data-input="encrypt"][data-kind="file"]');
assert.equal(
  await page.evaluate(
    () =>
      document.getElementById('run-button').disabled &&
      document.getElementById('recipient-card').hidden,
  ),
  true,
);
passed.push('returning to an earlier real file after Sample clears disposable sample recipient');
await page.click('#clear-all-button');
await page.click('#include-signature');
await page.waitForFunction(
  () =>
    getComputedStyle(document.querySelector('.switch-track')).backgroundColor ===
    'rgb(0, 102, 204)',
);
const layouts = [];
for (const width of [375, 768, 1024, 1440]) {
  await page.cdp('Emulation.setDeviceMetricsOverride', {
    width,
    height: width === 375 ? 844 : 1200,
    deviceScaleFactor: 1,
    mobile: width === 375,
  });
  const bounds = await page.evaluate(() => ({
    width: innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  assert.equal(bounds.width, bounds.document);
  layouts.push(bounds);
  if (width === 375) {
    await page.evaluate(() =>
      document
        .getElementById('signing-section')
        .scrollIntoView({ block: 'start', behavior: 'instant' }),
    );
    const shot = await page.cdp('Page.captureScreenshot', { format: 'png' });
    await writeFile(
      root + 'test-results/next-mobile-settings.png',
      Buffer.from(shot.data, 'base64'),
    );
  }
}
await page.evaluate(() => scrollTo(0, 0));
await page.screenshot({ path: root + 'test-results/signature-desktop-settings.png' });
await page.press('#include-signature', 'Space');
assert.equal(
  await page.evaluate(() => document.getElementById('include-signature').checked),
  false,
);
await page.evaluate(() => {
  window.__keyMode = 'limit';
});
await page.fill('#github-user', 'limited-user');
await page.click('#lookup-button');
await idle();
assert.equal(await page.evaluate(() => document.getElementById('github-recovery').hidden), false);
assert.match(
  await page.evaluate(() => document.getElementById('github-error').textContent),
  /取得上限.*再取得の目安/,
);
assert.equal(
  await page.evaluate(
    () => (document.getElementById('github-error').textContent.match(/取得上限/g) || []).length,
  ),
  1,
);
assert.equal(
  await page.evaluate(() => document.getElementById('github-gpg-page').href),
  'https://github.com/limited-user.gpg',
);
const limitedRequests = await page.evaluate(() => window.__requests.length);
await page.click('#lookup-button');
await idle();
assert.equal(await page.evaluate(() => window.__requests.length), limitedRequests);
await page.evaluate(() =>
  document
    .getElementById('github-recovery')
    .scrollIntoView({ block: 'center', behavior: 'instant' }),
);
await page.screenshot({ path: root + 'test-results/next-key-recovery.png' });
await page.click('#open-manual-keys');
assert.equal(await page.evaluate(() => document.getElementById('manual-keys').open), true);
await page.fill('#recipient-text', await readFile(base + 'recipient-public.asc', 'utf8'));
await page.click('#use-key-button');
await idle();
await page.fill('#encrypt-text', 'Public key import works during a retrieval limit');
await page.click('#run-button');
await finished();
assert.match(await state(), /none/);
assert.equal(await page.evaluate(() => window.__requests.length), limitedRequests);
passed.push(
  'rate-limit errors show once with retry time and key-page links; early retries make no requests; manual key import and unsigned encryption still work',
);
await page.click('#include-signature');
await page.fill('#signer-github', 'alice-pgp');
await page.fill('#signer-text', signerPGP);
await page.fill('#signer-passphrase', 'test-sign-pass');
await page.click('#run-button');
await idle();
assert.equal(await page.evaluate(() => document.getElementById('include-signature').checked), true);
assert.equal(await page.evaluate(() => document.getElementById('result-panel').hidden), true);
assert.match(
  await page.evaluate(() => document.getElementById('signer-error').textContent),
  /署名用のGitHub公開鍵を照合できません/,
);
assert.equal(await page.evaluate(() => window.__requests.length), limitedRequests);
passed.push(
  'a blocked current-key lookup never reuses stale identity data or silently disables requested signatures',
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
passed.push(
  'desktop/mobile layouts and keyboard switch work; only username-bearing public-key GETs, no secret payloads or errors',
);
await writeFile(
  root + 'test-results/next-browser-report.json',
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
  ),
);
console.log({
  passed,
  layouts,
  requests: telemetry.requests.length,
  errors: telemetry.errors,
  csp: telemetry.csp,
});

await task.finish({ keep: [] });
