const task = await taskSpace(__FUMI_TASK__);
const page = task.page('p1');
const assert = (await import('node:assert/strict')).default;
const { readFile, writeFile } = await import('node:fs/promises');
const base = __FUMI_ROOT__ + 'test-results/signatures/';
const publicKey = await readFile(base + 'recipient-public.asc', 'utf8');
const secret = await readFile(base + 'recipient-secret.asc', 'utf8');
const layouts = [];
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
async function fit(stage) {
  const bounds = await page.evaluate(() => {
    const button = document.getElementById('result-panel').hidden
      ? ['command-copy-button', 'command-save-button', 'run-button']
          .map((id) => document.getElementById(id))
          .find((button) => button.checkVisibility()) || document.getElementById('run-button')
      : document.querySelector('.result-actions .primary-button:not([hidden])');
    const rect = button.getBoundingClientRect();
    const panel = document.querySelector('[role="tabpanel"]:not([hidden])');
    return {
      width: innerWidth,
      height: innerHeight,
      documentWidth: document.documentElement.scrollWidth,
      documentHeight: document.documentElement.scrollHeight,
      actionTop: rect.top,
      actionBottom: rect.bottom,
      actionVisible: button.checkVisibility(),
      panelOverflow:
        panel && !document.getElementById('main-form').hidden
          ? panel.scrollHeight - panel.clientHeight
          : 0,
    };
  });
  assert.ok(
    bounds.documentHeight <= bounds.height + 1,
    stage + ': page scroll ' + JSON.stringify(bounds),
  );
  assert.ok(bounds.documentWidth <= bounds.width, stage + ': horizontal scroll');
  if (
    !['long-file-signature', 'command-tips', 'command-cipher-path', 'web-key-tips'].includes(stage)
  )
    assert.ok(bounds.panelOverflow <= 1, stage + ': unnecessary inner form scroll');
  if (bounds.actionVisible)
    assert.ok(
      bounds.actionTop >= 0 && bounds.actionBottom <= bounds.height,
      stage + ': action outside viewport',
    );
  layouts.push({ stage, ...bounds });
}
for (const [width, height] of [
  [1440, 900],
  [1366, 768],
  [1440, 714],
  [1280, 720],
  [1024, 768],
  [375, 844],
  [390, 844],
  [375, 667],
]) {
  await page.cdp('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 600,
  });
  await page.goto(__FUMI_URL__);
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => {}))),
  );
  await page.evaluate((publicKey) => {
    window.fetch = async (url) => {
      const name = String(url).split('/').pop().split('?')[0];
      if (String(url).includes('/github-profile/'))
        return Response.json({
          id: 1,
          login: name,
          name: '長い表示名'.repeat(20),
          bio: 'A public profile biography that should not push controls out of the screen.',
        });
      return Response.json(
        name === 'receiver' && String(url).includes('type=pgp') ? [{ raw_key: publicKey }] : [],
      );
    };
  }, publicKey);
  await fit('initial');
  await page.fill('#encrypt-text', 'Layout and delivery check');
  await page.fill('#github-user', 'receiver');
  await page.waitForFunction(() => !document.getElementById('recipient-card').hidden);
  await fit('profile');
  await page.click('#run-button');
  await finished();
  assert.equal(
    await page.evaluate(() =>
      Boolean(document.getElementById('result-details') || document.getElementById('cli-command')),
    ),
    false,
  );
  assert.match(
    await page.evaluate(() => document.getElementById('delivery-title').textContent),
    /@receiver/,
  );
  const cipher = await page.evaluate(() => document.getElementById('result-text').textContent);
  await fit('encrypted');
  await page.click('#clear-button');
  await page.fill('#github-user', 'missing');
  await page.waitForFunction(() => document.getElementById('recipient-text').checkVisibility());
  await fit('manual-key');
  await page.click('#decrypt-tab');
  await page.click('#clear-button');
  await fit('method-choice');
  await page.click('#decrypt-command');
  await page.fill('#decrypt-text', cipher);
  assert.equal(
    await page.evaluate(() => document.getElementById('command-copy-button').hidden),
    true,
  );
  await fit('command-pgp-save');
  const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
  await page.click('#command-save-button');
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), 'message.txt.asc');
  await fit('command-pgp-key-choice');
  await page.selectOption('#command-key-source', 'keyring');
  await fit('command-pgp');
  await page.click('#command-tips > summary');
  await page.click('#command-cipher-path-box summary');
  await page.fill('#command-cipher-path', '~/Downloads/received message.asc');
  await fit('command-cipher-path');
  await page.click('#command-cipher-path-box summary');
  await page.click('#command-tips > summary');
  await page.click('#command-edit-cipher');
  await page.fill('#decrypt-text', '-----BEGIN AGE ENCRYPTED FILE-----\n');
  await fit('command-age-save');
  await page.selectOption('#command-input-source', 'clipboard');
  await page.selectOption('#command-key-source', 'clipboard');
  await page.evaluate(() => {
    document.getElementById('command-tips').open = true;
  });
  await page.selectOption('#command-clipboard-tool', 'pbpaste');
  await page.click('#command-tips > summary');
  await fit('command-age-clipboard');
  await page.selectOption('#command-input-source', 'file');
  if (await page.evaluate(() => document.getElementById('command-edit-cipher').checkVisibility()))
    await page.click('#command-edit-cipher');
  await page.setInputFiles('#decrypt-file', [base + 'signed.age']);
  await idle();
  await page.selectOption('#command-key-source', 'file');
  await page.fill('#command-key-path', '~/.ssh/identity with a long filename');
  await fit('command-age-file');
  await page.click('#command-tips > summary');
  await fit('command-tips');
  await page.click('#command-tips > summary');
  await page.click('#command-edit-cipher');
  await page.click('#decrypt-file-remove');
  await page.click('#decrypt-web');
  await page.fill('#decrypt-text', cipher);
  await fit('web-input');
  await page.click('#web-key-tips summary');
  await fit('web-key-tips');
  await page.click('#web-key-tips summary');
  await page.setInputFiles('#secret-file', [base + 'recipient-secret.asc']);
  await page.waitForFunction(() => document.getElementById('passphrase').checkVisibility());
  await idle();
  await fit('password');
  await page.fill('#passphrase', 'test-recipient-pass');
  await page.press('#passphrase', 'Enter');
  await finished();
  assert.equal(await page.evaluate(() => document.getElementById('delivery-guide').hidden), true);
  await fit('decrypted');
  await page.evaluate(() => {
    document.getElementById('result-text').hidden = true;
    document.getElementById('result-file').hidden = false;
    document.getElementById('result-filename').textContent = '長いファイル名'.repeat(30) + '.bin';
    document.getElementById('signature-status').hidden = false;
    document.getElementById('signature-status-message').textContent =
      '署名と公開鍵の照合結果です。'.repeat(4);
    document.getElementById('signature-details').hidden = false;
    document.getElementById('signature-details').open = true;
    document.getElementById('copy-button').hidden = true;
    document.getElementById('save-button').className = 'primary-button';
  });
  await fit('long-file-signature');
}
await writeFile(
  __FUMI_ROOT__ + 'test-results/layout-browser-report.json',
  JSON.stringify(layouts, null, 2),
);
console.log({
  passed: layouts.length,
  viewports: new Set(layouts.map((item) => item.width + 'x' + item.height)).size,
  pageOverflow: Math.max(...layouts.map((item) => item.documentHeight - item.height)),
  formOverflow: Math.max(
    ...layouts.filter((item) => !item.stage.endsWith('tips')).map((item) => item.panelOverflow),
  ),
});
