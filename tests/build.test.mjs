import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

test('standalone HTML contains only embedded assets and matching CSP hashes', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)];
  assert.equal(scripts.length, 1);
  assert.equal(styles.length, 1);
  for (const [, content] of [...scripts, ...styles]) {
    assert.ok(html.includes(`sha256-${createHash('sha256').update(content).digest('base64')}`));
  }
  assert.match(html, /connect-src https:\/\/api.github.com;/);
  assert.match(html, /worker-src blob:/);
  assert.match(html, /form-action 'none'/);
  assert.doesNotMatch(html, /<(?:script|link|img|iframe)[^>]+(?:src|href)=["']https?:/i);
  assert.doesNotMatch(html, /__(?:CSP|SCRIPT|STYLES|LICENSE|KEY_SOURCE|KEY_DESCRIPTION)__/);
});

test('Next.js serves the web build with a same-origin-only connection policy', async () => {
  const { GET } = await import('../app/route.js');
  const response = await GET();
  const html = await response.text();
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('content-security-policy'), /connect-src 'self';/);
  assert.doesNotMatch(response.headers.get('content-security-policy'), /api\.github\.com/);
  assert.match(html, /<meta name="dgpg-key-source" content="server"\s*\/?>/);
  assert.doesNotMatch(html, /__(?:KEY_SOURCE|KEY_DESCRIPTION)__/);
  for (const [, content] of html.matchAll(/<(?:script|style)>([\s\S]*?)<\/(?:script|style)>/g))
    assert.ok(html.includes(`sha256-${createHash('sha256').update(content).digest('base64')}`));
});

test('web HTML stays small and loads its crypto worker from a same-origin hashed static asset', async () => {
  const html = await readFile(new URL('../.generated/web.html', import.meta.url), 'utf8');
  assert.ok(
    Buffer.byteLength(html) < 200 * 1024,
    'Web HTML must not embed the multi-megabyte crypto worker',
  );
  const workerPath = html.match(/\/assets\/crypto-worker-[A-Z0-9]+\.js/)?.[0];
  assert.ok(workerPath, 'Web build must reference a content-hashed worker');
  const worker = await readFile(new URL('../public' + workerPath, import.meta.url), 'utf8');
  assert.ok(worker.length > 100000, 'Worker must contain the actual bundled crypto engine');
  assert.match(html, /worker-src 'self';/);
  assert.doesNotMatch(html, /worker-src blob:/);
});
