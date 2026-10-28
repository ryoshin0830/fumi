import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProfile, loadGitHubProfile } from '../src/profiles.js';

const profile = { id: 1, login: 'octocat', name: 'The Octocat', bio: 'Hello' };

test('normalizes only bounded public identity fields', () => {
  assert.deepEqual(
    normalizeProfile({ ...profile, token: 'private', avatar_url: 'https://evil.test' }, 'Octocat'),
    profile,
  );
  assert.deepEqual(
    normalizeProfile({ id: 1, login: 'octocat', name: null, bio: null }, 'octocat'),
    {
      id: 1,
      login: 'octocat',
      name: 'octocat',
      bio: '',
    },
  );
  const result = normalizeProfile(
    { ...profile, name: 'x'.repeat(200), bio: 'y'.repeat(500) },
    'octocat',
  );
  assert.equal(result.name.length, 80);
  assert.equal(result.bio.length, 160);
  for (const data of [
    null,
    [],
    { ...profile, id: -1 },
    { ...profile, id: 1.5 },
    { ...profile, login: 'someone-else' },
    { ...profile, login: '../octocat' },
  ])
    assert.throws(() => normalizeProfile(data, 'octocat'));
});

test('accepts existing supported recipient forms and requests only public profiles', async () => {
  for (const backend of [true, false]) {
    const result = await loadGitHubProfile('https://github.com/octocat.gpg', {
      backend,
      fetcher: async (url, options) => {
        assert.equal(
          url,
          backend ? '/api/github-profile/octocat' : 'https://api.github.com/users/octocat',
        );
        assert.equal(options.credentials, 'omit');
        assert.equal(options.redirect, 'error');
        assert.equal(options.referrerPolicy, 'no-referrer');
        assert.ok(options.signal instanceof AbortSignal);
        return Response.json(profile);
      },
    });
    assert.deepEqual(result, profile);
  }
});

test('invalid recipients and aborted work do not issue requests', async () => {
  const fetcher = () => assert.fail('unexpected request');
  await assert.rejects(loadGitHubProfile('https://evil.test/octocat', { fetcher }));
  await assert.rejects(loadGitHubProfile('octocat', { fetcher, signal: AbortSignal.abort() }), {
    name: 'AbortError',
  });
});

test('profile errors remain advisory, specific, and bounded', async () => {
  for (const [status, pattern] of [
    [404, /見つかりません/],
    [429, /制限/],
    [403, /制限/],
    [500, /取得/],
  ])
    await assert.rejects(
      loadGitHubProfile('octocat', {
        fetcher: async () => new Response('upstream-private', { status }),
      }),
      pattern,
    );
  await assert.rejects(
    loadGitHubProfile('octocat', { fetcher: async () => new Response('x'.repeat(65537)) }),
    /大きすぎ/,
  );
});
