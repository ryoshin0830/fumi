const task = await taskSpace(__FUMI_TASK__);
const page = task.page('p1');
const assert = (await import('node:assert/strict')).default;
const { readFile } = await import('node:fs/promises');
const base = __FUMI_ROOT__ + 'test-results/signatures/';
const publicKey = await readFile(base + 'recipient-public.asc', 'utf8');
const ssh = await readFile(base + 'signer-ssh.pub', 'utf8');
await page.goto(__FUMI_URL__);
assert.equal(await page.evaluate(() => Boolean(document.querySelector('.intro-link'))), false);
assert.equal(
  await page.evaluate(() => document.getElementById('recipient-text').checkVisibility()),
  false,
);
await page.click('#decrypt-tab');
assert.equal(
  await page.evaluate(() => document.getElementById('passphrase').checkVisibility()),
  false,
);
await page.click('#encrypt-tab');
await page.evaluate(
  ({ publicKey }) => {
    window.fetch = async (url) => {
      const username = String(url).split('/').pop().split('?')[0];
      if (String(url).includes('/github-profile/'))
        return Response.json({ id: 1, login: username, name: username, bio: '' });
      if (username === 'offline') throw new TypeError('offline');
      return Response.json(
        username === 'receiver' && String(url).includes('type=pgp') ? [{ raw_key: publicKey }] : [],
      );
    };
  },
  { publicKey },
);
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
async function clear(mode) {
  await page.click('#' + mode + '-tab');
  await page.click('#clear-button');
  if (mode === 'decrypt') {
    await page.click('#decrypt-web');
  }
}
await page.fill('#github-user', 'receiver');
await page.waitForFunction(() => !document.getElementById('recipient-card').hidden);
assert.equal(
  await page.evaluate(() => document.getElementById('recipient-text').checkVisibility()),
  false,
);
await page.fill('#github-user', 'missing');
await page.waitForFunction(() => document.getElementById('recipient-text').checkVisibility());
assert.equal(
  await page.evaluate(() => document.getElementById('github-user').checkVisibility()),
  true,
  'lookup never hides a username being edited',
);
assert.match(
  await page.evaluate(() => document.getElementById('recipient-reason').textContent),
  /公開鍵.*登録|公開鍵.*見つかり/,
);
await page.fill('#github-user', 'offline');
await page.waitForFunction(() => document.getElementById('recipient-text').checkVisibility());
assert.match(
  await page.evaluate(() => document.getElementById('recipient-reason').textContent),
  /取得|接続|確認/,
);
await page.fill('#recipient-text', publicKey);
await page.click('#github-key-button');
assert.deepEqual(
  await page.evaluate(() => ({
    username: document.getElementById('github-user').value,
    key: document.getElementById('recipient-text').value,
    hidden: document.getElementById('recipient-key-box').hidden,
  })),
  { username: '', key: '', hidden: true },
);
for (const [format, key, locked, plain, password] of [
  [
    'pgp',
    publicKey,
    'recipient-secret.asc',
    'recipient-secret-unprotected.asc',
    'test-recipient-pass',
  ],
  ['ssh', ssh, 'signer-ssh', 'signer-ssh-unprotected', 'test-sign-pass'],
]) {
  await clear('encrypt');
  await page.fill('#encrypt-text', 'Progressive disclosure round trip');
  await page.fill('#github-user', 'missing');
  await page.waitForFunction(() => document.getElementById('recipient-text').checkVisibility());
  await page.fill('#recipient-text', key);
  await page.click('#run-button');
  await finished();
  const cipher = await page.evaluate(() => document.getElementById('result-text').textContent);
  await clear('decrypt');
  await page.fill('#decrypt-text', cipher);

  await page.fill('#secret-text', await readFile(base + locked, 'utf8'));
  await page.waitForFunction(() => document.getElementById('passphrase').checkVisibility());
  await idle();
  assert.equal(await page.evaluate(() => document.getElementById('result-panel').hidden), true);
  await page.fill('#passphrase', 'wrong');
  await page.click('#run-button');
  await idle();
  assert.equal(
    await page.evaluate(() => document.getElementById('passphrase').checkVisibility()),
    true,
  );
  await page.fill('#passphrase', password);
  await page.click('#run-button');
  await finished();
  assert.equal(
    await page.evaluate(() => document.getElementById('result-text').textContent),
    'Progressive disclosure round trip',
  );
  await clear('decrypt');
  await page.fill('#decrypt-text', cipher);

  await page.fill('#secret-text', await readFile(base + plain, 'utf8'));
  await finished();
  assert.equal(
    await page.evaluate(() => document.getElementById('result-text').textContent),
    'Progressive disclosure round trip',
  );
  assert.equal(
    await page.evaluate(() => document.getElementById('passphrase').checkVisibility()),
    false,
  );
  await page.click('#edit-result-button');
  assert.equal(await page.evaluate(() => document.getElementById('result-panel').hidden), true);
  if (format === 'pgp') {
    await page.fill('#secret-text', await readFile(base + 'other-secret.asc', 'utf8'));
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.field-error')].some((node) => node.checkVisibility()),
    );
    await idle();
    assert.equal(
      await page.evaluate(() => document.getElementById('passphrase').checkVisibility()),
      false,
      'a wrong key is not a password requirement',
    );
  }
}
await clear('decrypt');
await page.evaluate(() => {
  const original = File.prototype.arrayBuffer;
  File.prototype.arrayBuffer = function () {
    return new Promise((resolve) => {
      window.__finishRead = async () => {
        File.prototype.arrayBuffer = original;
        resolve(await original.call(this));
      };
    });
  };
  window.__decryptCalls = 0;
  const send = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function (message, ...rest) {
    if (message.action === 'decrypt') window.__decryptCalls++;
    return send.call(this, message, ...rest);
  };
});
await page.fill('#decrypt-text', await readFile(base + 'legacy-native.asc', 'utf8'));

await page.fill('#secret-text', await readFile(base + 'recipient-secret-unprotected.asc', 'utf8'));
await page.setInputFiles('#decrypt-file', [base + 'legacy-native.asc']);
await page.waitForFunction(() => Boolean(window.__finishRead));
await page.click('#cancel-button');
await page.evaluate(() => window.__finishRead());
await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 800)));
assert.equal(
  await page.evaluate(() => window.__decryptCalls),
  0,
  'cancelled file reads cannot restart old decryption',
);
assert.equal(
  await page.evaluate(() => document.getElementById('run-button').checkVisibility()),
  true,
  'cancelled automatic work has an explicit retry',
);
await clear('decrypt');
console.log(
  'PASS: default GitHub, contextual missing/unavailable key fallback, manual GPG/SSH, automatic protected/unprotected decryption, wrong password/key, and Edit without auto-resubmit.',
);
