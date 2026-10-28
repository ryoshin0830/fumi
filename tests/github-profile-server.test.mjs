import { test } from 'node:test';
import assert from 'node:assert/strict';
import { githubProfileResponse, githubAvatarResponse } from '../server/github-profile.mjs';
import { GET as profileGET } from '../app/api/github-profile/[username]/route.js';
import { GET as avatarGET } from '../app/api/github-avatar/[id]/route.js';

const data = { id: 1, login: 'octocat', name: 'The Octocat', bio: null };
const req = (suffix = '', options) =>
  new Request('http://localhost/api/github-profile/octocat' + suffix, options);
const noFetch = () => assert.fail('upstream must not be contacted');
const call = (fetcher, request = req(), username = 'octocat') =>
  githubProfileResponse(request, { username, fetcher });

test('profile proxy fixes the upstream URL, removes private inputs and returns only public fields', async () => {
  const response = await call(
    async (url, options) => {
      assert.equal(url, 'https://api.github.com/users/octocat');
      assert.equal(options.credentials, 'omit');
      assert.equal(options.method, 'GET');
      assert.equal(options.redirect, 'error');
      assert.equal(options.cache, 'no-store');
      assert.equal(options.referrerPolicy, 'no-referrer');
      assert.doesNotMatch(JSON.stringify(options), /private-marker|cookie|authorization/i);
      return Response.json({ ...data, location: 'extra-field', avatar_url: 'https://evil.test' });
    },
    req('', { headers: { cookie: 'private-marker', authorization: 'private-marker' } }),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { ...data, bio: '' });
});

test('invalid profile paths, queries and methods never reach GitHub', async () => {
  for (const username of ['', '../a', 'x/y', 'x--y', 'a'.repeat(40), '日本', null])
    assert.equal((await call(noFetch, req(), username)).status, 400);
  assert.equal((await call(noFetch, req('?url=https://evil.test'))).status, 400);
  const response = await call(noFetch, req('', { method: 'POST', body: 'private' }));
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'GET');
});

test('unavailable, malformed and oversized profiles have safe errors', async () => {
  for (const status of [404, 403, 429, 502]) {
    const response = await call(async () => new Response('upstream-private', { status }));
    assert.equal(response.status, status === 403 ? 429 : status);
    assert.doesNotMatch(await response.text(), /upstream-private/);
  }
  for (const response of [
    Response.json({ ...data, login: 'other' }),
    new Response('<html>private</html>'),
    new Response('x'.repeat(65537)),
  ])
    assert.equal((await call(async () => response)).status, 502);
  assert.equal(
    (
      await call(async () => {
        throw new TypeError('private-error');
      })
    ).status,
    502,
  );
});

test('profile response limits apply to streamed bytes without content-length', async () => {
  let cancelled = false;
  const response = await call(
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(65537));
          },
          cancel() {
            cancelled = true;
          },
        }),
      ),
  );
  assert.equal(response.status, 502);
  assert.equal(cancelled, true);
});

test('caller cancellation and 8-second upstream timeout abort the request', async (t) => {
  const controller = new AbortController();
  const pendingFetch = (_url, { signal }) =>
    new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  const pending = call(pendingFetch, req('', { signal: controller.signal }));
  controller.abort();
  assert.equal((await pending).status, 499);
  assert.equal((await call(noFetch, req('', { signal: AbortSignal.abort() }))).status, 499);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const timed = call(pendingFetch);
  t.mock.timers.tick(8000);
  assert.equal((await timed).status, 504);
});

test('avatar proxy accepts only positive numeric IDs and fixed-origin bounded raster images', async () => {
  for (const id of ['0', '-1', '../x', '1?url=x', '01', '1e2', '9007199254740992'])
    assert.equal((await githubAvatarResponse(req(), { id, fetcher: noFetch })).status, 400);
  const response = await githubAvatarResponse(req(), {
    id: '1',
    fetcher: async (url) => {
      assert.equal(url, 'https://avatars.githubusercontent.com/u/1?s=96&v=4');
      return new Response(new Uint8Array([137, 80, 78, 71]), {
        headers: { 'content-type': 'image/png' },
      });
    },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  for (const [type, size] of [
    ['image/svg+xml', 100],
    ['text/html', 100],
    ['image/png', 262145],
  ])
    assert.equal(
      (
        await githubAvatarResponse(req(), {
          id: '1',
          fetcher: async () =>
            new Response(new Uint8Array(size), { headers: { 'content-type': type } }),
        })
      ).status,
      502,
    );
});

test('new routes await their dynamic params', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url) =>
    url.includes('avatars.')
      ? new Response(new Uint8Array([137, 80, 78, 71]), {
          headers: { 'content-type': 'image/png' },
        })
      : Response.json(data),
  );
  assert.equal(
    (await profileGET(req(), { params: Promise.resolve({ username: 'octocat' }) })).status,
    200,
  );
  assert.equal((await avatarGET(req(), { params: Promise.resolve({ id: '1' }) })).status, 200);
});
