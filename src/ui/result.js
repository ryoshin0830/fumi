import { $, size, formatLabel } from './dom.js';
export function renderResultView(result, mode) {
  $('result-panel').hidden = !result;
  $('result-text').textContent = '';
  $('copy-label').textContent = 'コピー';
  if (!result) return;
  const text = result.text !== null;
  $('result-title').textContent = mode === 'encrypt' ? '暗号文' : '復号結果';
  $('result-target').textContent = result.recipient || '';
  $('result-target').hidden = !result.recipient;
  $('result-file').hidden = text;
  $('result-filename').textContent = result.filename;
  $('result-size').textContent = size(result.bytes.length);
  $('result-text').hidden = !text;
  $('result-text').textContent = result.text?.slice(0, 100000) || '';
  $('preview-hint').hidden = !(result.text?.length > 100000);
  $('preview-hint').textContent = '先頭100,000文字を表示しています。全文はコピー・保存できます。';
  $('copy-button').hidden = !text;
  $('save-button').className = text ? 'secondary-button' : 'primary-button';
  $('result-details').open = false;
  $('result-format').textContent = formatLabel(result.format) + ' / ' + result.filename;
  $('cli-help').hidden = mode !== 'encrypt';
  const quote = (text) => "'" + text.replace(/'/g, "'\\''") + "'";
  $('cli-command').textContent =
    result.format === 'ssh'
      ? `age -d -i ~/.ssh/id_ed25519 -o restored ${quote('./' + result.filename)}`
      : `gpg --output restored --decrypt ${quote('./' + result.filename)}`;
}
