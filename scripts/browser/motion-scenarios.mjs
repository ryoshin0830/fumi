const task = await taskSpace(__FUMI_TASK__);
const page = task.page('p1');
const assert = (await import('node:assert/strict')).default;
const { readFile } = await import('node:fs/promises');
const publicKey = await readFile(
  __FUMI_ROOT__ + 'test-results/signatures/recipient-public.asc',
  'utf8',
);
const secretKey = await readFile(
  __FUMI_ROOT__ + 'test-results/signatures/recipient-secret.asc',
  'utf8',
);
await page.cdp('Emulation.setDeviceMetricsOverride', {
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
});
await page.goto(__FUMI_URL__);
assert.equal(
  await page.evaluate(() => Boolean(document.getElementById('recipient-preview'))),
  true,
  'recipient preview exists',
);
await page.evaluate((publicKey) => {
  window.__profiles = [];
  window.fetch = (url, options) => {
    window.__profiles.push({ url: String(url), signal: options.signal });
    if (String(url).includes('/github-keys/'))
      return Promise.resolve(
        Response.json(String(url).includes('type=pgp') ? [{ raw_key: publicKey }] : []),
      );
    if (String(url).endsWith('/slow'))
      return new Promise((resolve) => {
        window.__oldProfile = () =>
          resolve(Response.json({ id: 2, login: 'slow', name: 'Stale person', bio: '' }));
      });
    if (String(url).endsWith('/missing')) return Promise.resolve(new Response('', { status: 404 }));
    if (String(url).endsWith('/limited')) return Promise.resolve(new Response('', { status: 429 }));
    const login = String(url).split('/').pop();
    return Promise.resolve(
      Response.json({ id: 1, login, name: 'The Octocat', bio: '<script>unsafe()</script>' }),
    );
  };
}, publicKey);
await page.fill('#github-user', 'slow');
await page.waitForFunction(() => Boolean(window.__oldProfile));
await page.fill('#github-user', 'octocat');
await page.waitForFunction(
  () => document.getElementById('recipient-name').textContent === 'The Octocat',
);
await page.evaluate(() => window.__oldProfile());
assert.equal(
  await page.evaluate(() => document.getElementById('recipient-name').textContent),
  'The Octocat',
);
assert.equal(await page.evaluate(() => window.__profiles[0].signal.aborted), true);
assert.equal(
  await page.evaluate(() => document.getElementById('recipient-bio').textContent),
  '<script>unsafe()</script>',
);
assert.equal(
  await page.evaluate(() => document.getElementById('recipient-preview').querySelector('script')),
  null,
);
await page.fill('#encrypt-text', 'A private message');
assert.equal(
  await page.evaluate(() => {
    const summary = document.getElementById('recipient-card');
    const interactive = 'a, button, [role="button"], [role="link"], [tabindex]';
    return summary.matches(interactive) || Boolean(summary.querySelector(interactive));
  }),
  false,
  'recipient information is passive, not a selection or navigation action',
);
await page.click('#recipient-card');
assert.equal(await page.url(), __FUMI_URL__);
assert.equal(await page.evaluate(() => document.getElementById('result-panel').hidden), true);
await page.focus('#github-user');
await page.press('#github-user', 'Tab');
assert.equal(
  await page.evaluate(() => document.activeElement.id),
  'run-button',
  'keyboard navigation skips the passive identity and reaches the encryption action',
);
await page.fill('#github-user', 'missing');
await page.waitForFunction(() =>
  document.getElementById('recipient-status').textContent.includes('プロフィールは表示できません'),
);
assert.equal(await page.evaluate(() => document.getElementById('run-button').disabled), false);
await page.fill('#github-user', 'limited');
await page.waitForFunction(() =>
  document.getElementById('recipient-status').textContent.includes('プロフィールは表示できません'),
);
assert.equal(await page.evaluate(() => document.getElementById('run-button').disabled), false);
await page.fill('#github-user', 'octocat');
await page.waitForFunction(
  () =>
    document.getElementById('recipient-name').textContent === 'The Octocat' &&
    !document.getElementById('recipient-card').hidden,
);
await page.click('#manual-key-button');
await page.fill('#recipient-text', 'manual-public-key');
assert.equal(await page.evaluate(() => document.getElementById('recipient-preview').hidden), true);
await page.fill('#recipient-text', '');
await page.fill('#github-user', '../invalid');
assert.equal(await page.evaluate(() => document.getElementById('recipient-preview').hidden), true);
await page.click('#clear-button');
assert.equal(await page.evaluate(() => document.getElementById('recipient-preview').hidden), true);
await page.cdp('Emulation.setEmulatedMedia', {
  features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
});
assert.equal(
  await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
  true,
);
await page.fill('#github-user', 'octocat');
await page.click('#decrypt-tab');
assert.equal(await page.evaluate(() => document.getElementById('recipient-preview').hidden), true);
await page.click('#cipher-illustration');
assert.equal(
  await page.evaluate(() => document.getElementById('decrypt-tab').getAttribute('aria-selected')),
  'true',
  'decorative illustration does not change operation',
);
await page.cdp('Emulation.setEmulatedMedia', { features: [] });
await page.click('#encrypt-tab');
await page.click('#clear-button');
await page.evaluate(() => {
  const previousFetch = window.fetch;
  window.fetch = (url, options) =>
    String(url).startsWith('/api/github-keys/')
      ? new Promise((resolve) => {
          window.__releaseKey = () => resolve(Response.json([]));
        })
      : previousFetch(url, options);
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    constructor(...args) {
      super(...args);
      this.addEventListener('message', (event) => {
        if (event.data.result?.format)
          setTimeout(() => {
            window.__visibleWhenReady = !document.getElementById('result-panel').hidden;
          }, 0);
      });
    }
  };
});
const motionState = () =>
  page.evaluate(() => document.getElementById('cipher-illustration').dataset.motion);
const idle = () =>
  page.waitForFunction(
    () => document.getElementById('workspace').getAttribute('aria-busy') === 'false',
  );
async function heldOperation(name) {
  await page.fill('#encrypt-text', 'Private words that must never enter the decorative letter');
  await page.fill('#github-user', name + '.gpg');
  await page.evaluate(() => {
    delete window.__releaseKey;
  });
  await page.click('#run-button');
  await page.waitForFunction(() => Boolean(window.__releaseKey));
  assert.equal(await motionState(), 'working');
  assert.equal(
    await page.evaluate(() =>
      document.getElementById('cipher-illustration').textContent.includes('Private words'),
    ),
    false,
  );
}
for (const [name, button] of [
  ['cancel-motion', '#cancel-button'],
  ['clear-motion', '#clear-button'],
  ['switch-motion', '#decrypt-tab'],
]) {
  await heldOperation(name);
  await page.click(button);
  assert.equal(await motionState(), 'idle');
  await page.evaluate(() => window.__releaseKey());
  await idle();
  assert.equal(await page.evaluate(() => document.getElementById('result-panel').hidden), true);
  await page.click('#encrypt-tab');
  await page.click('#clear-button');
}
await page.fill('#encrypt-text', 'A real encrypted message');
await page.click('#manual-key-button');
await page.fill('#recipient-text', 'invalid public key');
await page.click('#run-button');
await idle();
assert.equal(await motionState(), 'idle');
await page.fill('#recipient-text', publicKey);
await page.cdp('Emulation.setEmulatedMedia', {
  features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
});
await page.click('#run-button');
await page.waitForFunction(() => !document.getElementById('result-panel').hidden);
await idle();
await page.waitForFunction(() => window.__visibleWhenReady === true);
assert.equal(await motionState(), 'complete');
assert.equal(
  await page.evaluate(
    () => getComputedStyle(document.querySelector('.private-letter')).transitionDuration,
  ),
  '0s',
);
const cipher = await page.evaluate(() => document.getElementById('result-text').textContent);
assert.match(cipher, /^-----BEGIN PGP MESSAGE-----/);
await page.click('#decrypt-tab');
await page.click('#decrypt-web');
await page.click('#secret-paste summary');
await page.fill('#decrypt-text', cipher);
if (!(await page.evaluate(() => document.getElementById('secret-paste').open)))
  await page.click('#secret-paste summary');
await page.fill('#secret-text', secretKey);
await page.waitForSelector('#passphrase', { state: 'visible' });
await page.fill('#passphrase', 'test-recipient-pass');
await page.click('#run-button');
await page.waitForFunction(() => !document.getElementById('result-panel').hidden);
await idle();
assert.equal(
  await page.evaluate(() => document.getElementById('result-text').textContent),
  'A real encrypted message',
);
await page.cdp('Emulation.setEmulatedMedia', { features: [] });
await page.click('#encrypt-tab');
await page.click('#clear-button');
console.log(
  'PASS: recipient preview, stale responses, safe text, advisory errors; real encryption/decryption, motion cancellation, failure, reduced motion and immediate result access.',
);
