import { $, size, formatLabel } from './dom.js';

export function renderResultView(result, mode) {
  $('result-panel').hidden = !result;
  $('result-text').textContent = '';
  $('copy-label').textContent = 'コピー';
  if (!result) return;
  const encrypt = mode === 'encrypt';
  $('copy-label').textContent = encrypt ? '暗号文をコピー' : '内容をコピー';
  $('result-handoff').hidden = !encrypt;
  const bundled = result.encoding === 'signed-zip';
  const native = result.encoding === 'native-pgp';
  $('result-preview-disclosure').hidden = result.text === null;
  $('result-preview-disclosure').open = !encrypt;
  $('result-preview-label').textContent = encrypt ? '暗号文を表示' : '元のテキスト';
  $('result-title').textContent = encrypt ? '渡す準備ができました' : '元の内容を開けました';
  $('result-description').textContent = encrypt
    ? result.text === null
      ? 'ファイルを保存して、相手に渡せます。'
      : 'ファイルを保存するか、暗号文をコピーして渡せます。'
    : result.text === null
      ? 'ファイルを保存して内容を確認できます。'
      : 'テキストを表示しています。';
  $('delivery-instruction').textContent =
    result.text === null
      ? '保存したファイルを、メールやチャットで送ってください。'
      : '保存したファイルやコピーした文章を、メールやチャットで送ってください。';
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
      ? '相手はこのアプリで開けます。GPG・ageを使う場合は、復号したあとZIPを展開すると元のファイルと署名の説明書があります。'
      : native
        ? 'GPGでは元データを直接取り出せます。署名の検証には、署名者の公開鍵の登録が必要です。'
        : result.format === 'ssh'
          ? 'age形式です。受け取る側は、このアプリの「受け取って開く」またはageで開けます。'
          : '受け取る側は、このアプリの「受け取って開く」またはGPGで開けます。'
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
}
