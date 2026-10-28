import { parseGitHub, usesKeyServer } from './recipients.js';

export function normalizeProfile(data, username) {
  if (
    !Number.isSafeInteger(data?.id) ||
    data.id <= 0 ||
    typeof data.login !== 'string' ||
    parseGitHub(data.login).username.toLowerCase() !== username.toLowerCase() ||
    data.login.toLowerCase() !== username.toLowerCase()
  )
    throw new Error('プロフィールを確認できませんでした。');
  return {
    id: data.id,
    login: data.login,
    name:
      typeof data.name === 'string' && data.name.trim()
        ? data.name.trim().slice(0, 80)
        : data.login,
    bio: typeof data.bio === 'string' ? data.bio.trim().slice(0, 160) : '',
  };
}

export async function loadGitHubProfile(
  input,
  { signal, fetcher = fetch, backend = usesKeyServer() } = {},
) {
  const { username } = parseGitHub(input);
  signal?.throwIfAborted();
  const response = await fetcher(
    backend ? `/api/github-profile/${username}` : `https://api.github.com/users/${username}`,
    {
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(8000)])
        : AbortSignal.timeout(8000),
      headers: { Accept: 'application/vnd.github+json' },
    },
  );
  signal?.throwIfAborted();
  if (response.status === 404)
    throw new Error('アカウントが見つかりません。ユーザー名を確認してください。');
  if ([403, 429].includes(response.status))
    throw new Error('プロフィールの取得が制限されています。暗号化はそのまま試せます。');
  if (!response.ok) throw new Error('プロフィールを取得できません。暗号化はそのまま試せます。');
  if (Number(response.headers.get('content-length')) > 65536)
    throw new Error('プロフィールの応答が大きすぎます。');
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 65536) throw new Error('プロフィールの応答が大きすぎます。');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  signal?.throwIfAborted();
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return normalizeProfile(JSON.parse(new TextDecoder().decode(bytes)), username);
}
