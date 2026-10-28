import { inspectPGPKeys, encryptPGP } from './pgp.js';
import { decryptPayload } from './decrypt.js';
import { inspectSSHKey, encryptAge, decryptAge } from './age.js';
import { decodeText, detectFormat, safeFilename } from './files.js';
import { MAX_BYTES, MAX_ENCRYPTED_BYTES, MAX_KEY_BYTES, byteLength } from './limits.js';
import { readSignedPackage, verifyRegisteredSignature } from './signatures.js';

async function inspect({ pgp = [], ssh = [] }) {
  if (
    pgp.length + ssh.length > 100 ||
    [...pgp, ...ssh].reduce((n, key) => n + byteLength(key), 0) > MAX_KEY_BYTES
  )
    throw new Error('公開鍵は合計1 MB・100件以下にしてください。');
  const result = { pgp: [], ssh: [], excluded: 0, messages: [] };
  for (const value of pgp) {
    try {
      const keys = await inspectPGPKeys(value);
      result.pgp.push(...keys);
      if (!keys.length) result.excluded++;
    } catch (error) {
      result.excluded++;
      result.messages.push(error.message);
    }
  }
  for (const value of ssh) {
    try {
      const info = await inspectSSHKey(value);
      if (!result.ssh.some((item) => item.fingerprint === info.fingerprint))
        result.ssh.push({
          ...info,
          key: value,
          label: info.type === 'ssh-ed25519' ? 'Ed25519' : 'RSA',
        });
    } catch (error) {
      result.excluded++;
      result.messages.push(error.message);
    }
  }
  return result;
}

self.onmessage = async ({ data: { id, action, payload } }) => {
  try {
    let result;
    if (action === 'inspect') result = await inspect(payload);
    else if (action === 'encrypt') {
      if (payload.signer) throw new Error('署名付きの暗号化には対応していません。');
      const { data, format, recipients, filename, armored } = payload;
      if (byteLength(data) > MAX_BYTES)
        throw new Error('暗号化する内容は50 MB以下にしてください。');
      const storedName = safeFilename(filename);
      result =
        format === 'pgp'
          ? await encryptPGP({ data, recipients, filename: storedName, armored })
          : await encryptAge({ data, recipients, armored });
      result.format = format;
      result.filename = storedName + (format === 'pgp' ? (armored ? '.asc' : '.gpg') : '.age');
    } else if (action === 'decrypt') {
      const { data, privateKey, passphrase, sourceName } = payload;
      if (byteLength(data) > MAX_ENCRYPTED_BYTES || byteLength(privateKey) > MAX_KEY_BYTES)
        throw new Error('暗号文は72 MB、秘密鍵は1 MB以下にしてください。');
      const format = detectFormat(data);
      if (!format)
        throw new Error('暗号文の形式を確認してください。OpenPGPまたはage形式に対応しています。');
      if (format === 'pgp')
        result = await decryptPayload({
          privateKey,
          ciphertext: data,
          passphrase,
          sourceName,
          container: true,
        });
      else {
        const bytes = await decryptAge({
          data,
          privateKey:
            typeof privateKey === 'string' ? privateKey : new TextDecoder().decode(privateKey),
          passphrase,
          container: true,
        });
        result = { bytes, text: decodeText(bytes), filename: safeFilename('', sourceName) };
      }
      const signed =
        result.encoding === 'native-pgp' ? null : await readSignedPackage(result.bytes);
      if (signed) result = { ...signed, text: decodeText(signed.bytes), signed: true };
      else if (result.bytes.length > MAX_BYTES)
        throw new Error('復号結果は50 MB以下にしてください。');
      result.format = format;
    } else if (action === 'verify-github') {
      result = { matched: await verifyRegisteredSignature(payload) };
    } else throw new Error('処理を開始できませんでした。');
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error.message || '処理に失敗しました。', code: error.code });
  }
};
