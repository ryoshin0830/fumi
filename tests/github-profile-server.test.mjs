import { test } from 'node:test';
import assert from 'node:assert/strict';
import { githubProfileResponse, githubAvatarResponse } from '../server/github-profile.mjs';
import { GET as profileGET } from '../app/api/github-profile/[username]/route.js';
import { GET as avatarGET } from '../app/api/github-avatar/[id]/route.js';

const data = { id: 1, login: 'octocat', name: 'The Octocat', bio: null };
const html = ({ id = '1', login = 'octocat', name = 'The Octocat', bio = '' } = {}) =>
  `<!doctype html><html><head>
  <meta content="${login}" property="profile:username">
  <meta property="og:image" content="https://avatars.githubusercontent.com/u/${id}?v=4">
  </head><body><h1><span itemprop="name">${name}</span></h1>
  <div class="user-profile-bio" data-bio-text="${bio}"></div></body></html>`;
const htmlResponse = (body = html()) =>
  new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } });
const req = (suffix = '', options) =>
  new Request('http://localhost/api/github-profile/octocat' + suffix, options);
const noFetch = () => assert.fail('upstream must not be contacted');
const call = (fetcher, request = req(), username = 'octocat') =>
  githubProfileResponse(request, { username, fetcher });

test('profile proxy fixes the upstream URL, removes private inputs and returns only public fields', async () => {
  const response = await call(
    async (url, options) => {
      assert.equal(url, 'https://github.com/octocat');
      assert.equal(options.credentials, 'omit');
      assert.equal(options.method, 'GET');
      assert.equal(options.redirect, 'error');
      assert.equal(options.cache, 'no-store');
      assert.equal(options.referrerPolicy, 'no-referrer');
      assert.equal(options.headers.Accept, 'text/html');
      assert.doesNotMatch(JSON.stringify(options), /private-marker|cookie|authorization/i);
      return htmlResponse();
    },
    req('', { headers: { cookie: 'private-marker', authorization: 'private-marker' } }),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('vercel-cdn-cache-control'), 'public, max-age=300');
  assert.deepEqual(await response.json(), { ...data, bio: '' });
});

test('HTML parsing decodes entities and accepts ordinary profiles above 64 KiB', async () => {
  const response = await call(async () =>
    htmlResponse(
      '<!--' +
        'x'.repeat(70000) +
        '-->' +
        html({ name: 'Shin &amp; &#x3057;&#x3093;', bio: 'A &quot;public&quot; bio' }),
    ),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    id: 1,
    login: 'octocat',
    name: 'Shin & しん',
    bio: 'A "public" bio',
  });
});

test('empty display names and missing biographies fall back to the GitHub login', async () => {
  const response = await call(async () => htmlResponse(html({ name: '' })));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { id: 1, login: 'octocat', name: 'octocat', bio: '' });
});

test('fake HTML inside comments and scripts cannot supply profile metadata', async () => {
  const fake = '<meta property="profile:username" content="wrong-user">';
  const response = await call(async () =>
    htmlResponse(`<!--${fake}--><script>${fake}</script>${html()}`),
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).login, 'octocat');
  const missing = await call(async () => htmlResponse(`<!--${html()}-->`));
  assert.equal(missing.status, 502);
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
    assert.equal(response.headers.get('vercel-cdn-cache-control'), null);
    assert.doesNotMatch(await response.text(), /upstream-private/);
  }
  for (const response of [
    htmlResponse(html({ login: 'other' })),
    htmlResponse(html({ id: 'not-an-id' })),
    htmlResponse(html({ id: '9007199254740992' })),
    htmlResponse(html().replace('https://avatars.githubusercontent.com/', 'https://evil.test/')),
    htmlResponse('<html>private</html>'),
    Response.json(data),
    htmlResponse('x'.repeat(2 * 1024 * 1024 + 1)),
    new Response(html(), {
      headers: { 'content-type': 'text/html', 'content-length': String(2 * 1024 * 1024 + 1) },
    }),
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
            controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1));
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
      : htmlResponse(),
  );
  assert.equal(
    (await profileGET(req(), { params: Promise.resolve({ username: 'octocat' }) })).status,
    200,
  );
  assert.equal((await avatarGET(req(), { params: Promise.resolve({ id: '1' }) })).status, 200);
});
