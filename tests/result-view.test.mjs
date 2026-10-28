import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
    'terminal-tips',
    'terminal-command',
    'terminal-key-hint',
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
  assert.equal(nodes['terminal-tips'].hidden, true);
  assert.equal(nodes['terminal-command'].textContent, '');
  renderResultView(null, 'encrypt');
  assert.equal(nodes['result-panel'].hidden, true);
  assert.equal(nodes['delivery-guide'].hidden, true);
  assert.equal(nodes['terminal-tips'].hidden, true);
});
test('optional terminal tips safely quote the saved filename for GPG', (t) => {
  const nodes = view(t);
  const filename = "message' $(printf injected).asc";
  renderResultView({ ...message, filename }, 'encrypt');
  assert.equal(nodes['terminal-tips'].hidden, false);
  assert.equal(nodes['terminal-tips'].open, false);
  const args = spawnSync('/bin/sh', [
    '-c',
    'gpg() { printf "%s\\0" "$@"; }; ' + nodes['terminal-command'].textContent,
  ]);
  assert.equal(args.status, 0);
  assert.deepEqual(args.stdout.toString().split('\0').filter(Boolean), [
    '--output',
    'restored',
    '--decrypt',
    './' + filename,
  ]);
});
test('SSH terminal tips use age and explain the matching identity path', (t) => {
  const nodes = view(t);
  renderResultView({ ...message, format: 'ssh', filename: 'message.txt.age' }, 'encrypt');
  assert.match(
    nodes['terminal-command'].textContent,
    /^age --decrypt --identity .*--output restored '\.\/message\.txt\.age'$/,
  );
  assert.match(nodes['terminal-key-hint'].textContent, /秘密鍵.*パス/);
  renderResultView(null, 'encrypt');
  assert.equal(nodes['terminal-command'].textContent, '');
});
