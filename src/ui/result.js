import { $, size, formatLabel } from './dom.js';

export function renderResultView(result, mode) {
  $('result-panel').hidden = !result;
  $('result-text').textContent = '';
  $('copy-label').textContent = 'コピー';
  if (!result) return;
  const encrypt = mode === 'encrypt';
  const bundled = result.encoding === 'signed-zip';
  const native = result.encoding === 'native-pgp';
  $('result-title').textContent = encrypt ? '暗号化できました' : '元のデータに戻せました';
  $('result-description').textContent = encrypt
    ? bundled
      ? '相手は復号したあと、ZIPを展開して開きます。'
      : native
        ? 'GPGでそのまま開ける、署名付きの暗号文です。'
        : '保存・コピーして、相手に渡せます。'
    : result.text === null
      ? 'ファイルを保存して内容を確認できます。'
      : 'テキストを表示しています。';
  $('result-format').textContent = formatLabel(result.format);
  $('result-filename').textContent = result.filename;
  $('result-size').textContent =
    `${size(result.bytes.length)} · ${encrypt ? '暗号化されたデータ' : '復元されたデータ'}`;
  $('result-text').hidden = result.text === null;
  $('result-text').textContent = result.text?.slice(0, 100000) || '';
  $('preview-hint').hidden = !(result.text?.length > 100000);
  $('preview-hint').textContent =
    '先頭100,000文字を表示しています。コピー・保存では全文を取得できます。';
  $('copy-button').hidden = result.text === null;
  $('result-note').textContent = encrypt
    ? bundled
      ? 'ZIPのcontentフォルダに元ファイル、README.txtに署名の確認手順が入ります。このアプリでは自動で取り出します。'
      : native
        ? 'GPGでは元データを直接取り出せます。署名の検証には、署名者の公開鍵の登録が必要です。'
        : result.format === 'ssh'
          ? 'age形式です。受け取る側は、このアプリの「復号」またはageで開けます。'
          : '受け取る側は、このアプリの「復号」またはGPGで開けます。'
    : result.verification
      ? '復号したデータと、署名者の照合結果をそれぞれ確認できます。'
      : '元のデータを変更せず取り出しました。';
  $('cli-help').hidden = !encrypt;
  const quote = (text) => "'" + text.replace(/'/g, "'\\''") + "'";
  const output = bundled ? 'signed.zip' : result.originalFilename || 'restored';
  $('cli-description').textContent = bundled
    ? '復号後にZIPを展開し、contentフォルダの元ファイルとREADME.txtを開いてください。署名はREADMEの手順で確認できます。'
    : native
      ? '対応する秘密鍵で開けます。署名者の公開鍵もGPGに登録すると、復号と同時に署名を検証できます。'
      : result.format === 'ssh'
        ? '秘密鍵のパスと、入力・出力ファイル名を置き換えてください。'
        : '対応する秘密鍵をインポート済みのGPGで開けます。';
  const command =
    result.format === 'ssh'
      ? `age -d -i ~/.ssh/id_ed25519 -o ${quote('./' + output)} ${quote('./' + result.filename)}`
      : `gpg --output ${quote('./' + output)} --decrypt ${quote('./' + result.filename)}`;
  $('cli-command').textContent = command + (bundled ? `\nunzip -n ${quote('./' + output)}` : '');
  $('try-decrypt-button').hidden = !encrypt || !result.demoKey;
}
