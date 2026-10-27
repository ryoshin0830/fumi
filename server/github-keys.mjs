const MAX_BYTES = 1024 * 1024;
const USERNAME = /^(?!.*--)[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i;
const PGP_BLOCK =
  /-----BEGIN PGP PUBLIC KEY BLOCK-----\r?\n(?:[A-Za-z0-9-]+:[^\r\n]*\r?\n)*\r?\n(?:[A-Za-z0-9+/=]+\r?\n)+-----END PGP PUBLIC KEY BLOCK-----/g;
const SSH_KEY =
  /^(?:ssh-(?:rsa|dss|ed25519)|ecdsa-sha2-nistp(?:256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com) [A-Za-z0-9+/]+={0,2}(?:[ \t]+[^\r\n]*)?$/;

function json(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { ...headers, 'cache-control': 'no-store' } });
}

function error(status, message, headers) {
  return json({ message }, status, headers);
}

export async function githubKeysResponse(request, { username, fetcher = fetch }) {
  if (request.method !== 'GET')
    return error(405, '公開鍵の取得には GET を使用してください。', { allow: 'GET' });
  let query;
  try {
    query = new URL(request.url).searchParams;
  } catch {
    return error(400, '公開鍵の取得条件が正しくありません。');
  }
  if (
    typeof username !== 'string' ||
    !USERNAME.test(username) ||
    username.length > 39 ||
    query.size !== 1 ||
    !['pgp', 'ssh'].includes(query.get('type'))
  ) {
    return error(400, 'GitHub ユーザー名と公開鍵の種類を確認してください。');
  }
  if (request.signal.aborted) return error(499, '公開鍵の取得を中止しました。');

  const controller = new AbortController();
  let timedOut = false;
  let reader;
  let upstream;
  const cancel = () => controller.abort();
  request.signal.addEventListener('abort', cancel, { once: true });
  const deadline = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 15000);
  const aborted = new Promise((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });

  async function readText() {
    if (Number(upstream.headers.get('content-length')) > MAX_BYTES) throw new Error('oversized');
    if (!upstream.body) return '';
    reader = upstream.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const parts = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new Error('oversized');
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return parts.join('');
  }

  try {
    const result = (async () => {
      const type = query.get('type');
      upstream = await fetcher(
        `https://github.com/${username}.${type === 'pgp' ? 'gpg' : 'keys'}`,
        {
          method: 'GET',
          credentials: 'omit',
          redirect: 'error',
          cache: 'no-store',
          referrerPolicy: 'no-referrer',
          signal: controller.signal,
        },
      );
      if (controller.signal.aborted) {
        void upstream.body?.cancel().catch(() => {});
        throw new Error('aborted');
      }
      if (upstream.status === 404) return error(404, 'GitHub の公開鍵が見つかりません。');
      if (upstream.status === 403 || upstream.status === 429) {
        const text = upstream.status === 403 ? await readText() : '';
        const limited =
          upstream.status === 429 ||
          upstream.headers.get('x-ratelimit-remaining') === '0' ||
          /(?:rate[ -]limit(?: has been| was)? exceeded|(?:exceeded|hit|reached)[^\r\n]{0,100}\brate[ -]limit)/i.test(
            text,
          );
        if (!limited) return error(403, 'GitHub が公開鍵の取得を拒否しました (403)。');
        const headers = {};
        for (const name of ['retry-after', 'x-ratelimit-reset', 'x-ratelimit-remaining']) {
          const value = upstream.headers.get(name);
          if (value) headers[name] = value;
        }
        return error(429, 'GitHub 公開鍵取得の回数が上限に達しました (rate limit)。', headers);
      }
      if (upstream.status !== 200) return error(502, 'GitHub から公開鍵を取得できませんでした。');
      if (/text\/html/i.test(upstream.headers.get('content-type') || ''))
        throw new Error('invalid format');
      const text = (await readText()).trim();
      if (!text) return json([]);
      if (type === 'pgp') {
        const blocks = text.match(PGP_BLOCK);
        if (!blocks || text.replace(PGP_BLOCK, '').trim()) throw new Error('invalid format');
        return json([{ raw_key: text }]);
      }
      const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      if (!lines.every((line) => SSH_KEY.test(line))) throw new Error('invalid format');
      return json(lines.map((key) => ({ key })));
    })();
    return await Promise.race([result, aborted]);
  } catch {
    if (timedOut) return error(504, '公開鍵の取得が時間切れになりました。');
    if (request.signal.aborted) return error(499, '公開鍵の取得を中止しました。');
    return error(
      502,
      'GitHub の公開鍵を取得できませんでした。公開鍵の形式または通信状況を確認してください。',
    );
  } finally {
    clearTimeout(deadline);
    request.signal.removeEventListener('abort', cancel);
    if (reader) {
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    } else if (upstream?.body) {
      void upstream.body.cancel().catch(() => {});
    }
  }
}
