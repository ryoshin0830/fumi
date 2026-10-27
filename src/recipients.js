const invalid = () =>
  new Error('GitHubのユーザー名、または github.com/ユーザー名 のURLを入力してください。');
let keyCaches = new WeakMap();
const rateLimits = new WeakMap();
const cacheLifetime = 60000;
const keyBytes = 1024 * 1024;

export function clearGitHubKeyCache() {
  keyCaches = new WeakMap();
}
export const usesKeyServer = () =>
  typeof document !== 'undefined' &&
  document.querySelector('meta[name="dgpg-key-source"]')?.content === 'server';

function limited(until) {
  const time = new Date(until).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  const error = new Error(`GitHubの取得上限に達しました。再取得の目安は${time}です。`);
  error.retryAt = until;
  return error;
}

function retryTime(response) {
  const now = Date.now();
  const retry = response.headers.get('retry-after');
  const after = retry && /^\d+$/.test(retry) ? now + Number(retry) * 1000 : Date.parse(retry || '');
  const reset =
    response.headers.get('x-ratelimit-remaining') === '0'
      ? Number(response.headers.get('x-ratelimit-reset')) * 1000
      : NaN;
  const candidates = [after, reset].filter((value) => Number.isFinite(value) && value > now);
  return candidates.length ? Math.max(...candidates) : now + 60000;
}

export function parseGitHub(input) {
  let value = String(input).trim().replace(/^@/, '');
  if (/^(?:https?:\/\/)?github\.com\//i.test(value)) {
    let url;
    try {
      url = new URL(
        value.startsWith('https://') || value.startsWith('http://') ? value : `https://${value}`,
      );
    } catch {
      throw invalid();
    }
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'github.com' ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw invalid();
    value = url.pathname.replace(/^\//, '').replace(/\/$/, '');
  }
  const preferred = /\.gpg$/i.test(value) ? 'pgp' : /\.keys$/i.test(value) ? 'ssh' : null;
  value = value.replace(/\.(gpg|keys)$/i, '');
  if (!/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i.test(value) || value.includes('--'))
    throw invalid();
  return { username: value, preferred };
}

async function boundedJSON(response, limit = keyBytes) {
  if (Number(response.headers.get('content-length')) > limit)
    throw new Error('公開鍵の応答が大きすぎます。鍵ファイルを直接指定してください。');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit)
        throw new Error('公開鍵の応答が大きすぎます。鍵ファイルを直接指定してください。');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function resolveGitHub(
  input,
  { signal, fetcher = fetch, keyType, fresh = false, backend = usesKeyServer() } = {},
) {
  const { username, preferred } = parseGitHub(input);
  if (keyType && !['pgp', 'ssh'].includes(keyType)) throw invalid();
  if (keyType && preferred && keyType !== preferred)
    throw new Error('GitHub URLと指定した鍵の形式が異なります。');
  const selected = keyType || preferred;
  signal?.throwIfAborted();
  const timeout = AbortSignal.timeout(15000);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let cache = keyCaches.get(fetcher);
  if (!cache) {
    cache = new Map();
    keyCaches.set(fetcher, cache);
  }
  for (const [key, value] of cache) if (value.expiresAt <= Date.now()) cache.delete(key);
  let cached = false;
  async function list(endpoint, property) {
    const cacheKey = (backend ? 'server/' : 'api/') + username.toLowerCase() + '/' + endpoint;
    if (!fresh && cache.has(cacheKey)) {
      cached = true;
      return [...cache.get(cacheKey).keys];
    }
    const keys = [];
    for (let page = 1; page <= 3; page++) {
      requestSignal.throwIfAborted();
      if (rateLimits.get(fetcher) > Date.now()) throw limited(rateLimits.get(fetcher));
      const url = backend
        ? `/api/github-keys/${username}?type=${endpoint === 'gpg_keys' ? 'pgp' : 'ssh'}`
        : `https://api.github.com/users/${username}/${endpoint}?per_page=100&page=${page}`;
      const response = await fetcher(url, {
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        redirect: 'error',
        cache: 'no-store',
        signal: requestSignal,
        headers: { Accept: 'application/vnd.github+json' },
      });
      requestSignal.throwIfAborted();
      if (response.status === 404)
        throw new Error(
          backend
            ? 'GitHubの公開鍵が見つかりません。ユーザー名と鍵の公開状態を確認してください。'
            : 'GitHubアカウントが見つかりません。ユーザー名を確認してください。',
        );
      if (response.status === 403 || response.status === 429) {
        let message = '';
        try {
          message = String((await boundedJSON(response))?.message || '');
        } catch {
          requestSignal.throwIfAborted();
        }
        if (
          response.status === 429 ||
          response.headers.get('x-ratelimit-remaining') === '0' ||
          /rate limit/i.test(message)
        ) {
          const until = Math.max(rateLimits.get(fetcher) || 0, retryTime(response));
          rateLimits.set(fetcher, until);
          throw limited(until);
        }
        throw new Error(
          'GitHubから公開鍵の取得が拒否されました（403）。接続先の制限を確認するか、公開鍵を直接指定してください。',
        );
      }
      if (!response.ok)
        throw new Error(
          'GitHubから公開鍵を取得できませんでした。公開鍵を直接入力することもできます。',
        );
      // JSON may encode one control character as six bytes; key material remains capped below.
      const data = await boundedJSON(response, backend ? 6 * keyBytes + 65536 : keyBytes);
      if (!Array.isArray(data)) throw new Error('GitHubから正しい公開鍵を取得できませんでした。');
      keys.push(
        ...data
          .map((row) => row?.[property])
          .filter((value) => typeof value === 'string' && value.trim()),
      );
      if (keys.reduce((total, key) => total + new TextEncoder().encode(key).length, 0) > keyBytes)
        throw new Error('公開鍵は合計1 MB以下にしてください。');
      if (backend || data.length < 100) {
        requestSignal.throwIfAborted();
        if (cache.size >= 32 && !cache.has(cacheKey)) cache.delete(cache.keys().next().value);
        cache.set(cacheKey, { keys: [...keys], expiresAt: Date.now() + cacheLifetime });
        return keys;
      }
    }
    throw new Error('登録鍵が多いため、公開鍵ファイルを直接指定してください。');
  }
  const results = await Promise.allSettled([
    selected === 'ssh' ? Promise.resolve([]) : list('gpg_keys', 'raw_key'),
    selected === 'pgp' ? Promise.resolve([]) : list('keys', 'key'),
  ]);
  signal?.throwIfAborted();
  if (timeout.aborted)
    throw new Error(
      'GitHubへの接続がタイムアウトしました。もう一度取得するか、公開鍵を直接入力してください。',
    );
  const failures = results.flatMap((result, index) =>
    result.status === 'rejected'
      ? [{ label: index === 0 ? 'OpenPGP' : 'SSH', error: result.reason }]
      : [],
  );
  const retryAt = rateLimits.get(fetcher) > Date.now() ? rateLimits.get(fetcher) : null;
  const messages = failures.map(({ error }) => error.message || String(error));
  const errors =
    failures.length > 1 && failures.every(({ error }) => error.retryAt)
      ? [limited(retryAt).message]
      : new Set(messages).size === 1
        ? messages.slice(0, 1)
        : failures.map(({ label, error }) => `${label}: ${error.message || String(error)}`);
  return {
    username,
    preferred,
    pgp: results[0].status === 'fulfilled' ? results[0].value : [],
    ssh: results[1].status === 'fulfilled' ? results[1].value : [],
    errors,
    cached,
    retryAt,
  };
}
