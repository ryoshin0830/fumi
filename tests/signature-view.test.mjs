import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderSignatureView } from '../src/ui/signature.js';
import { setLocale, setText } from '../src/i18n.js';

test('signature retry announcements translate after signature controls render again', () => {
  const nodes = new Map();
  const previous = globalThis.document;
  globalThis.document = {
    documentElement: {},
    dispatchEvent() {},
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, { isConnected: true, textContent: '', setAttribute() {} });
      return nodes.get(id);
    },
  };
  try {
    const result = {
      text: 'original',
      verification: { state: 'verified', github: 'alice', type: 'pgp', fingerprint: '1234' },
    };
    setLocale('en', null);
    const source = renderSignatureView(result, 'decrypt');
    assert.equal(source, 'GitHubの公開鍵で検証できました');
    setText(document.getElementById('live-status'), source);
    // Finishing the retry job renders controls once more before the next locale change.
    renderSignatureView(result, 'decrypt');
    for (const locale of ['fr', 'ar', 'en']) {
      setLocale(locale, null);
      assert.equal(
        nodes.get('live-status').textContent,
        nodes.get('signature-status-title').textContent,
      );
    }
  } finally {
    globalThis.document = previous;
  }
});
