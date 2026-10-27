import { $ } from './dom.js';
import { parseGitHub, usesKeyServer, resolveGitHub } from '../recipients.js';
import { loadGitHubProfile } from '../profiles.js';

export function createRecipientPreview({ onKeyFallback } = {}) {
  let username = '';
  let timer;
  let controller;
  const avatar = $('recipient-avatar');
  avatar.addEventListener('error', () => {
    avatar.hidden = true;
  });
  function reset() {
    username = '';
    clearTimeout(timer);
    controller?.abort();
    controller = null;
    $('recipient-preview').hidden = true;
    $('recipient-card').hidden = true;
    $('recipient-status').textContent = '';
    for (const id of ['recipient-name', 'recipient-login', 'recipient-bio', 'recipient-initial'])
      $(id).textContent = '';
    $('recipient-link').removeAttribute('href');
    avatar.hidden = true;
    avatar.removeAttribute('src');
  }
  function update(input, enabled) {
    let next;
    try {
      if (enabled) next = parseGitHub(input).username.toLowerCase();
    } catch {
      /* Wait for a complete username. */
    }
    if (!next) {
      if (username) reset();
      return;
    }
    if (next === username) return;
    reset();
    username = next;
    $('recipient-preview').hidden = false;
    $('recipient-status').textContent = '宛先と公開鍵を確認中…';
    timer = setTimeout(async () => {
      const request = new AbortController();
      controller = request;
      const [person, keys] = await Promise.allSettled([
        loadGitHubProfile(next, { signal: request.signal }),
        resolveGitHub(input, { signal: request.signal }),
      ]);
      if (request.signal.aborted || username !== next) return;
      if (person.status === 'fulfilled') {
        const profile = person.value;
        $('recipient-name').textContent = profile.name;
        $('recipient-login').textContent = '@' + profile.login;
        $('recipient-bio').textContent = profile.bio;
        $('recipient-bio').hidden = !profile.bio;
        $('recipient-initial').textContent = profile.login[0].toUpperCase();
        $('recipient-link').href = 'https://github.com/' + profile.login;
        if (usesKeyServer()) {
          avatar.hidden = false;
          avatar.src = '/api/github-avatar/' + profile.id;
        }
        $('recipient-card').hidden = false;
      }
      if (keys.status === 'rejected' || keys.value.errors.length) {
        const reason =
          'GitHubから公開鍵を取得できませんでした。相手から受け取った公開鍵を入力することもできます。';
        $('recipient-status').textContent = reason;
        onKeyFallback?.(reason);
      } else if (!keys.value.pgp.length && !keys.value.ssh.length) {
        const reason =
          'GitHubに公開鍵が登録されていません。相手から受け取った公開鍵を入力してください。';
        $('recipient-status').textContent = '';
        onKeyFallback?.(reason);
      } else {
        $('recipient-status').textContent =
          person.status === 'fulfilled'
            ? 'GitHubに登録された公開鍵を使います。'
            : 'プロフィールは表示できませんが、GitHubの公開鍵を使えます。';
      }
    }, 450);
  }
  return { update, reset };
}
