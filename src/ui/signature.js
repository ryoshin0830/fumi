import { clearText, setText, setError, getLocale, t } from '../i18n.js';
import { $ } from './dom.js';

export function renderSignatureView(result, mode) {
  $('signature-status').hidden = !result || (!result.verification && !result.signed);
  if (!result) {
    for (const id of [
      'signature-status-title',
      'signature-status-message',
      'signature-account',
      'signature-fingerprint',
      'signature-algorithm',
      'signature-checked-at',
    ])
      clearText($(id));
    $('signature-account').removeAttribute('href');
    $('copy-button').disabled = true;
    $('save-button').disabled = true;
    return;
  }
  const verification = result.verification;
  const state = verification?.state || (result.signed ? 'external' : 'none');
  const states = {
    none: ['署名なし', '送信者の署名は含まれていません。', 'info'],
    external: [
      'OpenPGP署名あり・GitHub未照合',
      'GitHubユーザー情報が含まれていないため、自動照合していません。',
      'info',
    ],
    pending: [
      'GitHubと照合しています',
      '署名と内容の整合性は確認済みです。現在の登録公開鍵を取得しています。',
      'info',
    ],
    verified: [
      'GitHubの公開鍵で検証できました',
      '署名が正しく、現在このGitHubアカウントに登録されている公開鍵と一致しました。',
      'check',
    ],
    mismatch: [
      '現在のGitHub登録鍵では確認できません',
      '署名自体は正しいものの、現在の登録公開鍵では検証できません。鍵の削除・更新や有効期限の変更も考えられます。',
      'close',
    ],
    unavailable: [
      'GitHub未照合',
      '署名と内容の整合性は確認済みですが、GitHubの登録公開鍵との照合は完了していません。',
      'info',
    ],
  };
  const [title, message, glyph] = states[state] || states.unavailable;
  $('signature-status').className = `signature-status ${state}`;
  setText($('signature-status-title'), title);
  setError($('signature-status-message'), verification?.message || message);
  $('signature-status-glyph').setAttribute('href', '#' + glyph);
  $('signature-account-line').hidden = !verification;
  $('signature-details').hidden = !verification;
  $('retry-verification').hidden =
    mode !== 'decrypt' || !verification || !['unavailable', 'mismatch'].includes(state);
  if (verification) {
    setText($('signature-account-label'), state === 'verified' ? '署名者' : '署名者（申告）');
    $('signature-account').textContent = '@' + verification.github;
    $('signature-account').href = `https://github.com/${verification.github}`;
    setText(
      $('signature-algorithm'),
      verification.type === 'pgp' ? 'OpenPGP署名' : 'OpenSSH署名（SSHSIG）',
    );
    $('signature-fingerprint').textContent = verification.fingerprint;
    setText($('signature-checked-at'), () =>
      verification.checkedAt
        ? new Date(verification.checkedAt).toLocaleString(getLocale())
        : t('未照合'),
    );
  }
  $('copy-button').disabled = state === 'pending' || result.text === null;
  $('save-button').disabled = state === 'pending';
  return title;
}
