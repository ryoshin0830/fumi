import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGitHub, resolveGitHub } from '../src/recipients.js';

test('normalizes GitHub handles and .gpg/.keys/profile URLs', () => {
  assert.deepEqual(parseGitHub(' @octocat '), { username: 'octocat', preferred: null });
  assert.deepEqual(parseGitHub('https://github.com/octocat.gpg'), {
    username: 'octocat',
    preferred: 'pgp',
  });
  assert.deepEqual(parseGitHub('github.com/octocat.keys'), {
    username: 'octocat',
    preferred: 'ssh',
  });
  assert.deepEqual(parseGitHub('https://github.com/octocat/'), {
    username: 'octocat',
    preferred: null,
  });
});
test('rejects arbitrary hosts, userinfo, fragments, paths and invalid account names', () => {
  for (const input of [
    'https://evil.example/octocat',
    'https://github.com@evil.example/octocat',
    'https://github.com/octocat/repo',
    'a--b',
    '-name',
    'name-',
    '',
    'a'.repeat(40),
    'https://github.com/a?x=1',
    'https://github.com/a#x',
  ]) {
    assert.throws(() => parseGitHub(input), /GitHub/);
  }
});
test('requests only the fixed public API, without credentials, and returns keys', async () => {
  const requests = [];
  const fakeFetch = async (url, options) => {
    requests.push({ url, options });
    return new Response(
      JSON.stringify(
        url.includes('gpg_keys')
          ? [{ raw_key: 'armored-public-key' }]
          : [{ key: 'ssh-ed25519 example' }],
      ),
      { status: 200 },
    );
  };
  const result = await resolveGitHub('octocat.keys', { fetcher: fakeFetch });
  assert.deepEqual(result?.pgp, []);
  assert.deepEqual(result.ssh, ['ssh-ed25519 example']);
  assert.equal(result.preferred, 'ssh');
  assert.equal(result.errors.length, 0);
  assert.equal(requests.length, 1);
  assert.ok(requests[0].url.includes('/keys?'));
  for (const { url, options } of requests) {
    assert.equal(new URL(url).origin, 'https://api.github.com');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.referrerPolicy, 'no-referrer');
  }
});
test('keeps rate limit and missing keys distinct', async () => {
  const result = await resolveGitHub('octocat', {
    fetcher: async (url) =>
      url.includes('gpg_keys')
        ? new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '0' } })
        : new Response('[]'),
  });
  assert.equal(result?.errors.length, 1);
  assert.match(result.errors[0], /上限/);
});
test('follows bounded pagination and keeps all registered keys', async () => {
  let calls = 0;
  const result = await resolveGitHub('octocat', {
    fetcher: async (url) => {
      if (url.includes('gpg_keys')) return new Response('[]');
      calls++;
      const page = Number(new URL(url).searchParams.get('page'));
      return new Response(
        JSON.stringify(
          Array.from({ length: page === 1 ? 100 : 1 }, (_, i) => ({ key: `ssh-rsa ${page}-${i}` })),
        ),
      );
    },
  });
  assert.equal(result?.ssh.length, 101);
  assert.equal(calls, 2);
});
test('honors cancellation instead of silently substituting another format', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    resolveGitHub('octocat', {
      signal: controller.signal,
      fetcher: async () => {
        throw new Error('should not fetch');
      },
    }),
    /中止|abort/i,
  );
});

test('signature verification requests only the relevant key type', async () => {
  const requests = [];
  const result = await resolveGitHub('octocat', {
    keyType: 'pgp',
    fetcher: async (url) => {
      requests.push(url);
      return new Response('[{"raw_key":"public-key"}]');
    },
  });
  assert.equal(requests.length, 1);
  assert.ok(requests[0].includes('/gpg_keys?'));
  assert.deepEqual(result.pgp, ['public-key']);
  assert.deepEqual(result.ssh, []);
});

test('an explicit .gpg URL requests only OpenPGP keys', async () => {
  const requests = [];
  const result = await resolveGitHub('https://github.com/octocat.gpg', {
    fetcher: async (url) => {
      requests.push(url);
      return new Response('[{"raw_key":"pgp-key"}]');
    },
  });
  assert.equal(requests.length, 1);
  assert.match(requests[0], /\/gpg_keys\?/);
  assert.deepEqual(result.pgp, ['pgp-key']);
  assert.deepEqual(result.ssh, []);
});

test('recipient lookups reuse public keys for one minute, while identity checks fetch fresh keys', async (t) => {
  let clock = Date.now(),
    calls = 0,
    key = 'old';
  t.mock.method(Date, 'now', () => clock);
  const fetcher = async () => {
    calls++;
    return new Response(JSON.stringify([{ raw_key: key }]));
  };
  await resolveGitHub('octocat.gpg', { fetcher });
  key = 'current';
  const cached = await resolveGitHub('Octocat.gpg', { fetcher });
  assert.equal(calls, 1);
  assert.equal(cached.cached, true);
  assert.deepEqual(cached.pgp, ['old']);
  const fresh = await resolveGitHub('octocat.gpg', { fetcher, fresh: true });
  assert.equal(calls, 2);
  assert.equal(fresh.cached, false);
  assert.deepEqual(fresh.pgp, ['current']);
  clock += 60001;
  await resolveGitHub('octocat.gpg', { fetcher });
  assert.equal(calls, 3);
});

test('clear-all can discard the in-memory public-key cache', async () => {
  const { clearGitHubKeyCache } = await import('../src/recipients.js');
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return new Response('[]');
  };
  await resolveGitHub('octocat.keys', { fetcher });
  clearGitHubKeyCache();
  await resolveGitHub('octocat.keys', { fetcher });
  assert.equal(calls, 2);
});

test('rate limits show a retry time, deduplicate both endpoint errors and suppress premature retries', async (t) => {
  let clock = Date.now(),
    calls = 0;
  t.mock.method(Date, 'now', () => clock);
  const reset = Math.floor(clock / 1000) + 120;
  const fetcher = async () => {
    calls++;
    return new Response('{"message":"API rate limit exceeded"}', {
      status: 403,
      headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) },
    });
  };
  const result = await resolveGitHub('octocat', { fetcher });
  assert.equal(result.errors.length, 1);
  assert.equal(result.retryAt, reset * 1000);
  assert.match(result.errors[0], /再取得の目安/);
  const firstCalls = calls;
  await resolveGitHub('another-user.keys', { fetcher, fresh: true });
  assert.equal(calls, firstCalls);
  clock = reset * 1000 + 1;
  await resolveGitHub('octocat.keys', { fetcher, fresh: true });
  assert.equal(calls, firstCalls + 1);
});

test('403 without rate-limit evidence is not reported as quota exhaustion', async () => {
  const result = await resolveGitHub('octocat.keys', {
    fetcher: async () =>
      new Response('{"message":"Forbidden"}', {
        status: 403,
        headers: { 'x-ratelimit-remaining': '42' },
      }),
  });
  assert.match(result.errors[0], /403/);
  assert.doesNotMatch(result.errors[0], /上限|回数|再取得の目安/);
  assert.equal(result.retryAt, null);
});

test('secondary limits respect Retry-After even when the primary budget remains', async (t) => {
  const clock = Date.now();
  t.mock.method(Date, 'now', () => clock);
  const result = await resolveGitHub('octocat.keys', {
    fetcher: async () =>
      new Response('{"message":"You have exceeded a secondary rate limit"}', {
        status: 403,
        headers: { 'x-ratelimit-remaining': '42', 'retry-after': '90' },
      }),
  });
  assert.equal(result.retryAt, clock + 90000);
  assert.match(result.errors[0], /上限/);
});

test('a 429 response without headers waits at least a minute', async (t) => {
  const clock = Date.now();
  t.mock.method(Date, 'now', () => clock);
  const result = await resolveGitHub('octocat.keys', {
    fetcher: async () => new Response('{}', { status: 429 }),
  });
  assert.equal(result.retryAt, clock + 60000);
});

test('web lookups read only the same-origin Next.js key endpoint', async () => {
  const requests = [];
  const result = await resolveGitHub('ryoshin0830.gpg', {
    backend: true,
    fetcher: async (url, options) => {
      requests.push({ url, options });
      return new Response('[{"raw_key":"direct-public-key"}]');
    },
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/github-keys/ryoshin0830?type=pgp');
  assert.equal(requests[0].options.credentials, 'omit');
  assert.equal(requests[0].options.body, undefined);
  assert.deepEqual(result.pgp, ['direct-public-key']);
});

test('a complete server key list is not paginated through REST API URLs', async () => {
  let calls = 0;
  const result = await resolveGitHub('octocat.keys', {
    backend: true,
    fetcher: async (url) => {
      calls++;
      assert.equal(url, '/api/github-keys/octocat?type=ssh');
      return new Response(
        JSON.stringify(Array.from({ length: 100 }, (_, i) => ({ key: 'ssh-rsa ' + i }))),
      );
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.ssh.length, 100);
});

test('server JSON escaping overhead does not reject one MiB of public-key material', async () => {
  const key = 'a\n'.repeat(512 * 1024);
  const result = await resolveGitHub('octocat.gpg', {
    backend: true,
    fetcher: async () => new Response(JSON.stringify([{ raw_key: key }])),
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.pgp[0], key);
});

test('server transport overhead allowance never increases the public-key material limit', async () => {
  const key = 'a'.repeat(1024 * 1024 + 1);
  const result = await resolveGitHub('octocat.gpg', {
    backend: true,
    fetcher: async () => new Response(JSON.stringify([{ raw_key: key }])),
  });
  assert.deepEqual(result.pgp, []);
  assert.match(result.errors[0], /公開鍵.*1 MB/);
});
