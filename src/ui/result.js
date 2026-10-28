import { $, size } from './dom.js';
export function renderResultView(result, mode) {
  $('result-panel').hidden = !result;
  $('result-text').textContent = '';
  $('copy-label').textContent = 'コピー';
  $('delivery-guide').hidden = !result || mode !== 'encrypt';
  $('terminal-tips').hidden = !result || mode !== 'encrypt';
  $('terminal-tips').open = false;
  $('terminal-command').textContent = '';
  $('terminal-key-hint').textContent = '';
  $('result-panel').dataset.operation = mode;
  if (!result) return;
  const text = result.text !== null;
  $('result-title').textContent = mode === 'encrypt' ? '暗号文' : '復号した内容';
  $('delivery-title').textContent = result.recipient
    ? result.recipient + ' の秘密鍵でのみ開けます。'
    : '指定した公開鍵に対応する秘密鍵で開けます。';
  $('delivery-note').textContent = text
    ? '暗号文をコピーして、メールやSNSで送ってください。'
    : '保存したファイルを、メールやSNSで送ってください。';
  $('result-file').hidden = text;
  $('result-filename').textContent = result.filename;
  $('result-size').textContent = size(result.bytes.length);
  $('result-text').hidden = !text;
  $('result-text').textContent = result.text?.slice(0, 100000) || '';
  $('preview-hint').hidden = !(result.text?.length > 100000);
  $('preview-hint').textContent = '先頭100,000文字を表示しています。全文はコピー・保存できます。';
  $('copy-button').hidden = !text;
  $('save-button').className = text ? 'secondary-button' : 'primary-button';
  if (mode === 'encrypt') {
    const filename = "'" + ('./' + result.filename).replace(/'/g, "'\\''") + "'";
    $('terminal-command').textContent =
      result.format === 'ssh'
        ? `age --decrypt --identity ~/.ssh/id_ed25519 --output restored ${filename}`
        : `gpg --output restored --decrypt ${filename}`;
    $('terminal-key-hint').textContent =
      result.format === 'ssh'
        ? '~/.ssh/id_ed25519 は、対応するSSH秘密鍵のパスに置き換えてください。'
        : '対応する秘密鍵を登録したGPGで実行してください。';
  }
}
