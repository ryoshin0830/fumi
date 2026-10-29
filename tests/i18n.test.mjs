import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  locales,
  resolveLocale,
  readLocale,
  setLocale,
  getLocale,
  t,
  localizeError,
  messages,
} from '../src/i18n.js';

test('language negotiation respects saved locale and ordered browser preferences', () => {
  assert.equal(resolveLocale(['fr-CA', 'ja']), 'fr');
  assert.equal(resolveLocale(['zz', 'de-DE']), 'de');
  assert.equal(resolveLocale(['ja'], 'ar'), 'ar');
  assert.equal(resolveLocale(['ko-KR'], '<script>'), 'ko');
  assert.equal(resolveLocale(['xx']), 'en');
  assert.equal(resolveLocale([]), 'en');
  assert.equal(resolveLocale(['EN-us']), 'en');
});
test('Chinese script takes priority over region, with traditional regions recognized', () => {
  for (const locale of ['zh-TW', 'zh-HK', 'zh-MO', 'zh-Hant', 'zh-Hant-CN'])
    assert.equal(resolveLocale([locale]), 'zh-TW');
  for (const locale of ['zh', 'zh-CN', 'zh-SG', 'zh-Hans-TW'])
    assert.equal(resolveLocale([locale]), 'zh-CN');
});
test('locale persistence stores only explicit valid choices and tolerates blocked storage', () => {
  const values = new Map();
  const storage = { getItem: (k) => values.get(k), setItem: (k, v) => values.set(k, v) };
  assert.equal(readLocale(['es'], storage), 'es');
  assert.equal(values.size, 0);
  setLocale('de', storage);
  assert.deepEqual([...values], [['fumi-locale', 'de']]);
  assert.equal(readLocale(['es'], storage), 'de');
  const blocked = {
    getItem() {
      throw Error('blocked');
    },
    setItem() {
      throw Error('blocked');
    },
  };
  assert.equal(readLocale(['pt-BR'], blocked), 'pt');
  assert.doesNotThrow(() => setLocale('ar', blocked));
  assert.equal(getLocale(), 'ar');
  assert.throws(() => setLocale('invalid', storage), RangeError);
});
test('all eleven catalogs contain complete nonempty translations and matching placeholders', () => {
  assert.equal(locales.length, 11);
  const placeholders = (text) => [...text.matchAll(/\{\w+\}/g)].map((m) => m[0]).sort();
  for (const [source, translations] of Object.entries(messages)) {
    assert.equal(translations.length, locales.length, source);
    for (const translation of translations) {
      assert.ok(typeof translation === 'string' && translation.trim(), source);
      assert.deepEqual(placeholders(translation), placeholders(source), source);
    }
  }
});
test('messages interpolate values literally and unknown diagnostics use a safe translation', () => {
  setLocale('en', null);
  assert.equal(
    t('ファイルは{limit} MB以下にしてください。', { limit: 50 }),
    'Choose a file no larger than 50 MB.',
  );
  assert.equal(
    t('{recipient} の秘密鍵でのみ開けます。', { recipient: '<script>$&' }),
    'Only the private key for <script>$& can open this.',
  );
  assert.match(
    localizeError('秘密鍵を解除できません。パスフレーズが正しいか確認してください。'),
    /password/i,
  );
  assert.doesNotMatch(localizeError('Unknown sensitive data'), /sensitive/);
  assert.match(localizeError('__proto__'), /Could not complete/);
  assert.match(localizeError('constructor'), /Could not complete/);
});

test('diagnostic aliases are sentences with valid targets, including variable retry times', async () => {
  const { aliases } = await import('../src/locales.js');
  for (const [source, target] of Object.entries(aliases)) {
    assert.ok(messages[target], target);
    assert.ok(source.endsWith('。') || source.endsWith('…'), source);
    assert.doesNotMatch(source, /\n|\$\{|\b(?:const|function|return)\b/, source);
  }
  setLocale('en', null);
  assert.match(
    localizeError('GitHubの取得上限に達しました。再取得の目安は15:45です。'),
    /GitHub.*request limit.*(?:15:45|03:45|3:45)/,
  );
  assert.match(localizeError('秘密鍵を入力するか、ファイルを選択してください。'), /private key/);
  assert.match(localizeError('暗号文は72 MB以下にしてください。'), /72 MB/);
  assert.match(
    localizeError(
      'OpenPGP: GitHubの公開鍵が見つかりません。ユーザー名と鍵の公開状態を確認してください。 SSH: GitHubへの接続がタイムアウトしました。もう一度取得するか、公開鍵を直接入力してください。',
    ),
    /OpenPGP: .*SSH: .*timed out/,
  );
});
test('every static interface message and translated attribute has a catalog entry', async () => {
  const { readFile } = await import('node:fs/promises');
  const { parse } = await import('parse5');
  const html = await readFile(new URL('../src/template.html', import.meta.url), 'utf8');
  function walk(node) {
    for (const attr of node.attrs || [])
      if (attr.name.startsWith('data-i18n')) assert.ok(messages[attr.value], attr.value);
    for (const child of node.childNodes || []) walk(child);
  }
  walk(parse(html));
});
test('explicit text bindings update without reading or changing unregistered user content', () => {
  const user = { isConnected: true, textContent: '秘密鍵' };
  const label = { isConnected: true, textContent: '' };
  const originalDocument = globalThis.document;
  globalThis.document = { documentElement: {}, getElementById: () => null, dispatchEvent() {} };
  try {
    setLocale('en', null);
    // No full rerender, no mutation observer and no changes to unregistered text.
    return import('../src/i18n.js')
      .then(({ setText, clearText }) => {
        setText(label, '秘密鍵');
        assert.equal(label.textContent, 'Private key');
        setLocale('fr', null);
        assert.equal(label.textContent, 'Clé privée');
        assert.equal(user.textContent, '秘密鍵');
        const status = { isConnected: true, textContent: '' };
        setText(status, () => label.textContent);
        setText(label, '秘密鍵');
        setText(status, () => label.textContent);
        setLocale('en', null);
        assert.equal(status.textContent, 'Private key');
        clearText(label);
        label.textContent = 'Alice';
        setLocale('ar', null);
        assert.equal(label.textContent, 'Alice');
      })
      .finally(() => {
        globalThis.document = originalDocument;
      });
  } catch (error) {
    globalThis.document = originalDocument;
    throw error;
  }
});
