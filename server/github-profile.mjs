import { parseGitHubProfile } from './github-profile-html.mjs';

const USERNAME = /^(?!.*--)[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i;
const json = (body, status = 200) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
function validate(request, valid) {
  if (request.method !== 'GET')
    return new Response(null, { status: 405, headers: { allow: 'GET' } });
  if (!valid || new URL(request.url).searchParams.size)
    return json({ message: '取得条件を確認してください。' }, 400);
}

async function publicResponse(request, url, limit, fetcher, render) {
  if (request.signal.aborted) return json({ message: '取得を中止しました。' }, 499);
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.signal.addEventListener('abort', abort, { once: true });
  let timedOut = false;
  const deadline = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 8000);
  let reader;
  try {
    const upstream = await fetcher(url, {
      method: 'GET',
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
      headers: {
        Accept: url.includes('avatars.')
          ? 'image/png,image/jpeg,image/webp,image/gif'
          : 'text/html',
        'User-Agent': 'Fumi',
      },
    });
    controller.signal.throwIfAborted();
    if (!upstream.ok) {
      await upstream.body?.cancel();
      const status =
        upstream.status === 404 ? 404 : [403, 429].includes(upstream.status) ? 429 : 502;
      return json(
        {
          message:
            status === 404
              ? 'アカウントが見つかりません。'
              : '公開プロフィールを取得できませんでした。',
        },
        status,
      );
    }
    if (Number(upstream.headers.get('content-length')) > limit) {
      await upstream.body?.cancel();
      throw new Error('oversized');
    }
    reader = upstream.body.getReader();
    const chunks = [];
    let length = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) throw new Error('oversized');
      chunks.push(value);
    }
    controller.signal.throwIfAborted();
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return render(bytes, upstream.headers.get('content-type')?.split(';')[0].trim().toLowerCase());
  } catch {
    return json(
      {
        message: timedOut
          ? 'GitHubへの接続がタイムアウトしました。'
          : '公開プロフィールを取得できませんでした。',
      },
      request.signal.aborted ? 499 : timedOut ? 504 : 502,
    );
  } finally {
    clearTimeout(deadline);
    request.signal.removeEventListener('abort', abort);
    await reader?.cancel().catch(() => {});
  }
}

export async function githubProfileResponse(request, { username, fetcher = fetch }) {
  const invalid = validate(request, typeof username === 'string' && USERNAME.test(username));
  if (invalid) return invalid;
  return publicResponse(
    request,
    `https://github.com/${username}`,
    2 * 1024 * 1024,
    fetcher,
    (bytes, type) => {
      if (type !== 'text/html') throw new Error('Expected public profile HTML');
      const response = json(parseGitHubProfile(new TextDecoder().decode(bytes), username));
      response.headers.set('vercel-cdn-cache-control', 'public, max-age=300');
      return response;
    },
  );
}

export async function githubAvatarResponse(request, { id, fetcher = fetch }) {
  const invalid = validate(
    request,
    typeof id === 'string' && /^[1-9]\d{0,15}$/.test(id) && Number.isSafeInteger(Number(id)),
  );
  if (invalid) return invalid;
  return publicResponse(
    request,
    `https://avatars.githubusercontent.com/u/${id}?s=96&v=4`,
    262144,
    fetcher,
    (bytes, type) => {
      if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(type))
        throw new Error('unsupported image');
      return new Response(bytes, {
        headers: {
          'content-type': type,
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        },
      });
    },
  );
}
