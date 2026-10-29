const task = await taskSpace(__FUMI_TASK__);
const page = await task.newPage();
const assert = (await import('node:assert/strict')).default;
const { readFile } = await import('node:fs/promises');
const root = __FUMI_ROOT__;
const base = root + 'test-results/signatures/';
const { locales, messages } = await import('file://' + root + 'src/i18n.js');
const publicKey = await readFile(base + 'recipient-public.asc', 'utf8');
const secret = await readFile(base + 'recipient-secret.asc', 'utf8');
const keys = JSON.parse(await readFile(base + 'public-responses.json', 'utf8'));
const passed = [];
console.log({ taskSpaceId: task.spaceId, page: page.label });
await page.cdp('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    window.__errors=[];window.__csp=[];
    addEventListener('error',e=>window.__errors.push(e.message));
    addEventListener('unhandledrejection',e=>window.__errors.push(String(e.reason)));
    addEventListener('securitypolicyviolation',e=>window.__csp.push(e.violatedDirective));
    const scenario = new URLSearchParams(location.search).get('i18n-test');
    Object.defineProperty(navigator,'languages',{get:()=>scenario==='detect'?['xx','zh-Hant-HK','en']:['en-US']});
    if(scenario==='detect')localStorage.setItem('fumi-locale','invalid-test-value');
    if(scenario==='blocked')Object.defineProperty(window,'localStorage',{get(){throw Error('blocked for test')}});
  `,
});
const url = new URL(__FUMI_URL__);
url.searchParams.set('i18n-test', 'detect');
await page.goto(url.href);
await page.waitForFunction(() => document.documentElement.lang === 'zh-TW');
passed.push('ordered browser preferences and Chinese script negotiation');
await page.selectOption('#language-select', 'de');
url.searchParams.set('i18n-test', 'saved');
await page.goto(url.href);
assert.equal(await page.evaluate(() => document.documentElement.lang), 'de');
passed.push('explicit language choice survives navigation and overrides browser preference');
url.searchParams.set('i18n-test', 'blocked');
await page.goto(url.href);
assert.equal(await page.evaluate(() => document.documentElement.lang), 'en');
await page.selectOption('#language-select', 'ar');
assert.equal(await page.evaluate(() => document.documentElement.dir), 'rtl');
passed.push('blocked storage allows detection and switching');
url.searchParams.set('i18n-test', 'saved');
await page.goto(url.href);
await page.selectOption('#language-select', 'en');
await page.evaluate(
  ({ publicKey, keys }) => {
    window.fetch = async (url) => {
      const value = String(url);
      if (value.includes('/api/github-profile/'))
        return new Response(
          JSON.stringify({
            id: 123,
            login: 'receiver',
            name: 'Receiver 秘密鍵',
            bio: 'Do not translate this profile',
          }),
        );
      return new Response(
        JSON.stringify(
          value.includes('type=pgp')
            ? [{ raw_key: value.includes('/alice-pgp?') ? keys.pgp : publicKey }]
            : [{ key: keys.ssh }],
        ),
      );
    };
  },
  { publicKey, keys },
);
const original = '秘密鍵 is user text. مرحبا <script>window.injected=true</script>';
await page.fill('#encrypt-text', original);
await page.fill('#github-user', 'receiver');
await page.waitForSelector('#recipient-card', { state: 'visible' });
const profile = await page.evaluate(() =>
  ['recipient-name', 'recipient-login', 'recipient-bio'].map(
    (id) => document.getElementById(id).textContent,
  ),
);
for (const [index, locale] of locales.entries()) {
  await page.selectOption('#language-select', locale);
  const state = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    dir: document.documentElement.dir,
    title: document.title,
    tab: document.getElementById('encrypt-tab').textContent.trim(),
    input: document.getElementById('encrypt-text').value,
    profile: ['recipient-name', 'recipient-login', 'recipient-bio'].map(
      (id) => document.getElementById(id).textContent,
    ),
  }));
  assert.equal(state.lang, locale);
  assert.equal(state.dir, locale === 'ar' ? 'rtl' : 'ltr');
  assert.equal(state.title, messages['Fumi — 暗号化・復号'][index]);
  assert.equal(state.tab, messages['暗号化'][index]);
  assert.equal(state.input, original);
  assert.deepEqual(state.profile, profile);
  await page.cdp('Emulation.setDeviceMetricsOverride', {
    width: 375,
    height: 812,
    deviceScaleFactor: 1,
    mobile: true,
  });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    true,
    locale + ' mobile page overflow',
  );
}
passed.push(
  'all eleven languages, accessible controls, profile/input preservation and 375px layout',
);
await page.selectOption('#language-select', 'en');
await page.cdp('Emulation.setDeviceMetricsOverride', {
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
});
await page.screenshot({ path: root + 'test-results/i18n-en-desktop.png' });
await page.click('#run-button');
await page.waitForFunction(
  () =>
    !document.getElementById('result-panel').hidden &&
    document.getElementById('workspace').getAttribute('aria-busy') === 'false',
  undefined,
  { timeout: 30000 },
);
const encrypted = await page.evaluate(() => document.getElementById('result-text').textContent);
assert.match(encrypted, /^-----BEGIN PGP MESSAGE-----/);
for (const locale of ['fr', 'ar', 'ja']) {
  await page.selectOption('#language-select', locale);
  assert.equal(
    await page.evaluate(() => document.getElementById('result-text').textContent),
    encrypted,
  );
}
passed.push('real encryption result preserved across language changes');
await page.click('#clear-button');
await page.click('#decrypt-tab');
await page.click('#decrypt-command');
const command = await page.evaluate(() => document.getElementById('terminal-command').textContent);
for (const locale of ['en', 'fr', 'ar']) {
  await page.selectOption('#language-select', locale);
  assert.equal(
    await page.evaluate(() => document.getElementById('terminal-command').textContent),
    command,
  );
  assert.equal(
    await page.evaluate(() =>
      document.getElementById('terminal-command').getAttribute('aria-label'),
    ),
    messages['復号コマンド'][locales.indexOf(locale)],
  );
}
passed.push('terminal command unchanged while its accessible name switches');
await page.click('#decrypt-web');
await page.fill('#decrypt-text', encrypted);
await page.fill('#secret-text', secret);
await page.waitForSelector('#passphrase', { state: 'visible' });
await page.fill('#passphrase', 'wrong');
await page.click('#run-button');
await page.waitForFunction(
  () => document.getElementById('workspace').getAttribute('aria-busy') === 'false',
);
await page.selectOption('#language-select', 'en');
assert.match(
  await page.evaluate(() => document.getElementById('secret-error').textContent),
  /password/i,
);
await page.selectOption('#language-select', 'fr');
assert.match(
  await page.evaluate(() => document.getElementById('secret-error').textContent),
  /mot de passe/i,
);
await page.fill('#passphrase', 'test-recipient-pass');
await page.click('#run-button');
await page.waitForFunction(
  () =>
    !document.getElementById('result-panel').hidden &&
    document.getElementById('workspace').getAttribute('aria-busy') === 'false',
  undefined,
  { timeout: 30000 },
);
assert.equal(
  await page.evaluate(() => document.getElementById('result-text').textContent),
  original,
);
assert.equal(await page.evaluate(() => Boolean(window.injected)), false);
await page.selectOption('#language-select', 'ar');
assert.equal(
  await page.evaluate(() => document.getElementById('result-text').textContent),
  original,
);
await page.cdp('Emulation.setDeviceMetricsOverride', {
  width: 375,
  height: 812,
  deviceScaleFactor: 1,
  mobile: true,
});
await page.screenshot({ path: root + 'test-results/i18n-ar-mobile.png' });
passed.push(
  'localized password failure and exact real decryption, including user text resembling interface copy',
);
await page.click('#clear-button');
await page.click('#decrypt-web');
await page.fill('#decrypt-text', await readFile(base + 'legacy-native.asc', 'utf8'));
await page.fill('#secret-text', secret);
await page.waitForSelector('#passphrase', { state: 'visible' });
await page.fill('#passphrase', 'test-recipient-pass');
await page.click('#run-button');
await page.waitForFunction(
  () =>
    document.getElementById('signature-status').classList.contains('verified') &&
    document.getElementById('workspace').getAttribute('aria-busy') === 'false',
  undefined,
  { timeout: 30000 },
);
const signer = await page.evaluate(() =>
  ['signature-account', 'signature-fingerprint'].map(
    (id) => document.getElementById(id).textContent,
  ),
);
assert.ok(signer[0] && signer[1]);
for (const locale of ['en', 'fr', 'ar']) {
  await page.selectOption('#language-select', locale);
  assert.deepEqual(
    await page.evaluate(() =>
      ['signature-account', 'signature-fingerprint'].map(
        (id) => document.getElementById(id).textContent,
      ),
    ),
    signer,
  );
  assert.equal(
    await page.evaluate(() => document.getElementById('signature-status-title').textContent),
    messages['GitHubの公開鍵で検証できました'][locales.indexOf(locale)],
  );
}
passed.push('verified signer identity and fingerprint survive language changes');
await page.click('#clear-button');
await page.click('#encrypt-tab');
await page.setInputFiles('#encrypt-file', [base + 'payload.bin']);
await page.waitForSelector('#encrypt-file-pane', { state: 'visible' });
for (const locale of ['en', 'ar', 'ja']) {
  await page.selectOption('#language-select', locale);
  assert.equal(
    await page.evaluate(() => document.getElementById('encrypt-file-name').textContent),
    'payload.bin',
  );
}
passed.push('selected binary file retained across language changes');
const issues = await page.evaluate(() => ({ errors: window.__errors, csp: window.__csp }));
assert.deepEqual(issues.errors, []);
assert.deepEqual(issues.csp, []);
// Embedded HTML has no locale network dependency, and uses the same crypto path.
await page.goto('file://' + root + 'index.html');
await page.selectOption('#language-select', 'de');
await page.fill('#encrypt-text', original);
await page.click('#manual-key-button');
await page.fill('#recipient-text', publicKey);
await page.click('#run-button');
await page.waitForFunction(
  () =>
    !document.getElementById('result-panel').hidden &&
    document.getElementById('workspace').getAttribute('aria-busy') === 'false',
  undefined,
  { timeout: 30000 },
);
assert.match(
  await page.evaluate(() => document.getElementById('result-text').textContent),
  /^-----BEGIN PGP MESSAGE-----/,
);
await page.selectOption('#language-select', 'ar');
assert.equal(await page.evaluate(() => document.documentElement.dir), 'rtl');
passed.push('standalone embedded HTML switches language and performs real offline encryption');
console.log(JSON.stringify({ passed }, null, 2));
await page.close();
if (!__FUMI_KEEP__) await task.finish({ keep: [] });
