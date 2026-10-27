import { $ } from './dom.js';
import { parseGitHub, usesKeyServer } from '../recipients.js';
import { loadGitHubProfile } from '../profiles.js';

export function createRecipientPreview() {
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
    $('recipient-status').textContent = 'GitHubプロフィールを確認中…';
    timer = setTimeout(async () => {
      const request = new AbortController();
      controller = request;
      try {
        const profile = await loadGitHubProfile(next, { signal: request.signal });
        if (request.signal.aborted || username !== next) return;
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
        $('recipient-status').textContent =
          '公開プロフィールです。暗号化に使う鍵は実行時に確認します。';
      } catch (error) {
        if (request.signal.aborted || username !== next) return;
        $('recipient-status').textContent = /見つかりません|制限|取得できません/.test(error.message)
          ? error.message
          : 'プロフィールを表示できません。暗号化はそのまま試せます。';
      }
    }, 450);
  }
  return { update, reset };
}
