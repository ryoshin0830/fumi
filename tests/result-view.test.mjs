import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderResultView } from '../src/ui/result.js';

function view(t) {
  const ids = [
    'result-panel',
    'result-text',
    'copy-label',
    'result-title',
    'result-target',
    'result-file',
    'result-filename',
    'result-size',
    'preview-hint',
    'copy-button',
    'save-button',
    'result-details',
    'result-format',
    'cli-help',
    'cli-command',
    'delivery-guide',
    'delivery-title',
    'delivery-note',
  ];
  const nodes = Object.fromEntries(
    ids.map((id) => [id, { hidden: true, textContent: '', dataset: {} }]),
  );
  const original = globalThis.document;
  globalThis.document = { getElementById: (id) => nodes[id] };
  t.after(() => (original ? (globalThis.document = original) : delete globalThis.document));
  return nodes;
}
const message = {
  text: 'encrypted text',
  bytes: new TextEncoder().encode('encrypted text'),
  filename: 'message.txt.asc',
  format: 'pgp',
  recipient: '@octocat',
};

test('encrypted text explains how to send it and names the actual GitHub key holder', (t) => {
  const nodes = view(t);
  renderResultView(message, 'encrypt');
  assert.equal(nodes['delivery-guide'].hidden, false);
  assert.match(nodes['delivery-title'].textContent, /@octocat.*秘密鍵/);
  assert.match(nodes['delivery-note'].textContent, /コピー.*メール.*SNS/);
  assert.equal(nodes['result-text'].textContent, message.text);
});
test('manual-key file guidance does not invent a GitHub identity', (t) => {
  const nodes = view(t);
  renderResultView({ ...message, text: null, recipient: '' }, 'encrypt');
  assert.equal(nodes['delivery-guide'].hidden, false);
  assert.match(nodes['delivery-title'].textContent, /指定した公開鍵.*秘密鍵/);
  assert.doesNotMatch(nodes['delivery-title'].textContent, /@/);
  assert.match(nodes['delivery-note'].textContent, /保存.*ファイル/);
  assert.equal(nodes['save-button'].className, 'primary-button');
});
test('decryption and empty views contain no delivery guidance or technical output', (t) => {
  const nodes = view(t);
  renderResultView({ ...message, text: 'recovered text' }, 'decrypt');
  assert.equal(nodes['delivery-guide'].hidden, true);
  assert.equal(nodes['result-text'].textContent, 'recovered text');
  assert.equal(nodes['cli-command'].textContent, '');
  assert.equal(nodes['result-format'].textContent, '');
  renderResultView(null, 'encrypt');
  assert.equal(nodes['result-panel'].hidden, true);
  assert.equal(nodes['delivery-guide'].hidden, true);
});
