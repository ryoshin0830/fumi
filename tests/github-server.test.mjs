import { test } from 'node:test';
import assert from 'node:assert/strict';
import { githubKeysResponse } from '../server/github-keys.mjs';
import { GET, runtime, dynamic } from '../app/api/github-keys/[username]/route.js';

const pgp = '-----BEGIN PGP PUBLIC KEY BLOCK-----\n\nYWJj\n-----END PGP PUBLIC KEY BLOCK-----';
const ssh = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMockKey user@example';
const request = (query = 'type=pgp', options = {}) =>
  new Request(`http://localhost/api/github-keys/octocat?${query}`, options);
const call = (fetcher, { username = 'octocat', query = 'type=pgp', req = request(query) } = {}) =>
  githubKeysResponse(req, { username, fetcher });
const noFetch = () => {
  throw new Error('upstream must not be contacted');
};

test('GET route awaits Promise params and exports dynamic Node runtime', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(pgp));
  const response = await GET(request(), { params: Promise.resolve({ username: 'octocat' }) });
  assert.equal(runtime, 'nodejs');
  assert.equal(dynamic, 'force-dynamic');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), [{ raw_key: pgp }]);
});

test('uses only direct fixed-origin public URLs and forwards no private request inputs', async () => {
  const secret = 'private-cookie-passphrase';
  const req = request('type=ssh', {
    headers: { cookie: secret, authorization: secret, 'x-private': secret },
  });
  const response = await call(
    async (url, options) => {
      assert.equal(url, 'https://github.com/octocat.keys');
      assert.equal(options.method, 'GET');
      assert.equal(options.credentials, 'omit');
      assert.equal(options.redirect, 'error');
      assert.equal(options.cache, 'no-store');
      assert.equal(options.referrerPolicy, 'no-referrer');
      assert.ok(options.signal instanceof AbortSignal);
      assert.equal(options.body, undefined);
      assert.doesNotMatch(
        JSON.stringify(options),
        /private-cookie-passphrase|authorization|cookie|x-private/i,
      );
      return new Response(`${ssh}\nssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQMock\n`);
    },
    { req },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('content-type'), /application\/json/);
  assert.deepEqual(await response.json(), [
    { key: ssh },
    { key: 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQMock' },
  ]);
});

test('PGP requests use the direct .gpg page and preserve complete concatenated armor', async () => {
  const publicKeys = `${pgp}\n\n${pgp}\n`;
  const response = await call(async (url) => {
    assert.equal(url, 'https://github.com/octocat.gpg');
    return new Response(publicKeys, { headers: { 'content-type': 'text/plain' } });
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), [{ raw_key: publicKeys.trim() }]);
});

test('accepts valid 1–39 character usernames without changing their path', async () => {
  for (const username of ['a', 'A-b9', 'x'.repeat(39)]) {
    const response = await call(
      async (url) => {
        assert.equal(url, `https://github.com/${username}.gpg`);
        return new Response('');
      },
      { username },
    );
    assert.equal(response.status, 200);
  }
});

test('rejects invalid usernames before any upstream fetch', async () => {
  for (const username of [
    '',
    undefined,
    null,
    42,
    'a--b',
    '-a',
    'a-',
    'a_b',
    'a'.repeat(40),
    '../foo',
    'a.gpg',
    'a/b',
    'a?x=1',
    'a#x',
    'https://evil.test',
    'a\n',
    '日本',
  ]) {
    const response = await githubKeysResponse(request(), { username, fetcher: noFetch });
    assert.equal(response.status, 400, String(username));
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
});

test('rejects missing, unknown, duplicate and private query fields', async () => {
  for (const query of [
    '',
    'type=',
    'type=PGP',
    'type=other',
    'type=pgp&type=pgp',
    'type=ssh&url=https://evil.test',
    'type=ssh&plaintext=secret',
  ]) {
    assert.equal((await call(noFetch, { query })).status, 400, query);
  }
});

test('rejects other methods without reading request bodies', async () => {
  const req = request('type=pgp', { method: 'POST', body: 'private-input' });
  req.text = noFetch;
  const response = await call(noFetch, { req });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'GET');
});

test('empty pages return empty arrays for either key type', async () => {
  for (const type of ['pgp', 'ssh']) {
    const response = await call(async () => new Response(' \n\r\n'), { query: `type=${type}` });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), []);
  }
});

test('malformed or HTML public pages produce bounded JSON errors without reflecting upstream text', async () => {
  for (const [type, text, contentType] of [
    ['pgp', '<html>private-upstream-marker</html>', 'text/html'],
    ['pgp', 'not an armored key private-upstream-marker', 'text/plain'],
    ['pgp', `${pgp}\nprivate-upstream-marker`, 'text/plain'],
    ['pgp', '-----BEGIN PGP PRIVATE KEY BLOCK-----\nprivate-upstream-marker', 'text/plain'],
    ['ssh', '<html>private-upstream-marker</html>', 'text/plain'],
    ['ssh', `${ssh}\nprivate-upstream-marker`, 'text/plain'],
  ]) {
    const response = await call(
      async () => new Response(text, { headers: { 'content-type': contentType } }),
      { query: `type=${type}` },
    );
    assert.equal(response.status, 502);
    const body = await response.text();
    assert.doesNotMatch(body, /private-upstream-marker|<html>/);
    assert.ok(body.length < 300);
    assert.match(JSON.parse(body).message, /公開鍵|形式/);
  }
});

test('404 remains a public-key-not-found error', async () => {
  const response = await call(async () => new Response('secret-upstream-body', { status: 404 }));
  assert.equal(response.status, 404);
  assert.match((await response.json()).message, /見つかりません/);
});

test('preserves 429 and Retry-After without copying unrelated headers', async () => {
  for (const retry of ['90', 'Wed, 28 Oct 2026 00:00:00 GMT']) {
    const response = await call(
      async () =>
        new Response('secret-upstream-body', {
          status: 429,
          headers: { 'retry-after': retry, 'set-cookie': 'secret', 'x-private': 'secret' },
        }),
    );
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('retry-after'), retry);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(response.headers.get('x-private'), null);
    assert.match((await response.json()).message, /上限|rate limit/);
  }
});

test('generic 403 refusal stays distinguishable from actual rate limits', async () => {
  const response = await call(
    async () =>
      new Response('<html>Access denied</html>', {
        status: 403,
        headers: { 'x-ratelimit-remaining': '42' },
      }),
  );
  assert.equal(response.status, 403);
  const { message } = await response.json();
  assert.match(message, /403|拒否/);
  assert.doesNotMatch(message, /上限|rate limit/);
});

test('a generic refusal linking rate-limit documentation is not quota evidence', async () => {
  const response = await call(
    async () =>
      new Response('Access denied. See rate limit documentation for more information.', {
        status: 403,
      }),
  );
  assert.equal(response.status, 403);
});

test('proven primary and secondary limits normalize to 429 with retry metadata', async () => {
  for (const [body, headers] of [
    ['denied', { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1793145600' }],
    [
      'You have exceeded a secondary rate limit',
      { 'retry-after': '120', 'x-ratelimit-remaining': '42' },
    ],
  ]) {
    const response = await call(async () => new Response(body, { status: 403, headers }));
    assert.equal(response.status, 429);
    if (headers['retry-after']) assert.equal(response.headers.get('retry-after'), '120');
    if (headers['x-ratelimit-reset']) {
      assert.equal(response.headers.get('x-ratelimit-remaining'), '0');
      assert.equal(response.headers.get('x-ratelimit-reset'), '1793145600');
    }
  }
});

test('redirects and other upstream failures never become successful key responses', async () => {
  for (const status of [301, 302, 307, 308, 500, 503]) {
    const response = await call(
      async () =>
        new Response('secret-upstream-body', {
          status,
          headers: { location: 'https://evil.test' },
        }),
    );
    assert.equal(response.status, 502);
    assert.doesNotMatch(await response.text(), /secret-upstream-body|evil\.test/);
  }
});

test('transport failures return bounded errors without leaking exception details', async () => {
  const response = await call(async () => {
    throw new Error('private-token-example');
  });
  assert.equal(response.status, 502);
  assert.doesNotMatch(await response.text(), /private-token-example/);
});

test('oversized Content-Length cancels the response before reading', async () => {
  let cancelled = false;
  const body = new ReadableStream({
    cancel() {
      cancelled = true;
    },
  });
  const response = await call(
    async () => new Response(body, { headers: { 'content-length': String(1024 * 1024 + 1) } }),
  );
  assert.equal(response.status, 502);
  assert.equal(cancelled, true);
});

test('stream size is bounded even without Content-Length and cancels excess data', async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(1024 * 1024));
      controller.enqueue(new Uint8Array(1));
    },
    cancel() {
      cancelled = true;
    },
  });
  const response = await call(async () => new Response(body));
  assert.equal(response.status, 502);
  assert.equal(cancelled, true);
});

test('exactly 1MiB public text succeeds and decoding rejects invalid UTF-8', async () => {
  const text = `${ssh}${' '.repeat(1024 * 1024 - Buffer.byteLength(ssh))}`;
  assert.equal((await call(async () => new Response(text), { query: 'type=ssh' })).status, 200);
  assert.equal((await call(async () => new Response(new Uint8Array([0xff])))).status, 502);
});

test('15-second deadline aborts stalled fetches and returns 504', async (t) => {
  let signal;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = call(async (_url, options) => {
    signal = options.signal;
    return new Promise(() => {});
  });
  await Promise.resolve();
  t.mock.timers.tick(14999);
  assert.equal(signal.aborted, false);
  t.mock.timers.tick(1);
  const response = await pending;
  assert.equal(signal.aborted, true);
  assert.equal(response.status, 504);
});

test('deadline also bounds stalled body reads and cancels the stream', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let cancelled = false;
  const body = new ReadableStream({
    cancel() {
      cancelled = true;
    },
  });
  const pending = call(async () => new Response(body));
  await Promise.resolve();
  await Promise.resolve();
  t.mock.timers.tick(15000);
  assert.equal((await pending).status, 504);
  assert.equal(cancelled, true);
});

test('already-cancelled requests do not fetch', async () => {
  const controller = new AbortController();
  controller.abort();
  assert.equal(
    (await call(noFetch, { req: request('type=pgp', { signal: controller.signal }) })).status,
    499,
  );
});

test('client cancellation aborts upstream fetch and returns an HTTP error', async () => {
  const controller = new AbortController();
  let upstreamSignal;
  const pending = call(
    async (_url, options) => {
      upstreamSignal = options.signal;
      return new Promise(() => {});
    },
    { req: request('type=pgp', { signal: controller.signal }) },
  );
  controller.abort('private-abort-reason');
  const response = await pending;
  assert.equal(upstreamSignal.aborted, true);
  assert.equal(response.status, 499);
  assert.doesNotMatch(await response.text(), /private-abort-reason/);
});

test('cancels a late response if the fetcher resolves after client cancellation', async () => {
  const controller = new AbortController();
  let resolveFetch;
  let cancelled = false;
  const pending = call(
    () =>
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    { req: request('type=pgp', { signal: controller.signal }) },
  );
  controller.abort();
  assert.equal((await pending).status, 499);
  resolveFetch(
    new Response(
      new ReadableStream({
        cancel() {
          cancelled = true;
        },
      }),
    ),
  );
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(cancelled, true);
});
