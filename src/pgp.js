import { readKeys, readKey, createMessage, encrypt, sign, verify, readSignature } from 'openpgp';
import { MAX_BYTES, MAX_CONTAINER_BYTES, MAX_KEY_BYTES, byteLength } from './limits.js';
import { unlockPGPKey } from './decrypt.js';

export async function inspectPGPKeys(value) {
  if (!byteLength(value) || byteLength(value) > MAX_KEY_BYTES)
    throw new Error('公開鍵は1 MB以下で入力してください。');
  let keys;
  try {
    const isText =
      typeof value === 'string' ||
      new TextDecoder().decode(value.subarray(0, 80)).trim().startsWith('-----BEGIN');
    keys = await readKeys(
      isText
        ? {
            armoredKeys:
              typeof value === 'string' ? value.trim() : new TextDecoder().decode(value).trim(),
          }
        : { binaryKeys: value },
    );
  } catch {
    throw new Error('OpenPGP公開鍵を読み込めません。公開鍵の内容を確認してください。');
  }
  if (keys.some((key) => key.isPrivate()))
    throw new Error('暗号化には公開鍵を使います。秘密鍵は入力しないでください。');
  const usable = [];
  for (const key of keys) {
    try {
      await key.getEncryptionKey();
      const fingerprint = key.getFingerprint();
      if (!usable.some((item) => item.fingerprint === fingerprint))
        usable.push({
          key: key.armor(),
          fingerprint,
          label: key.getUserIDs()[0] || 'OpenPGP公開鍵',
        });
    } catch {
      /* Signing-only, expired and revoked keys cannot receive encrypted data. */
    }
  }
  return usable;
}

export async function encryptPGP({
  data,
  recipients,
  filename = 'message.txt',
  armored = false,
  container = false,
}) {
  if (
    !(data instanceof Uint8Array) ||
    data.byteLength > (container ? MAX_CONTAINER_BYTES : MAX_BYTES)
  )
    throw new Error('暗号化する内容は50 MB以下にしてください。');
  if (byteLength(filename) > 255)
    throw new Error('OpenPGPのファイル名はUTF-8で255バイト以下にしてください。');
  if (!recipients?.length || recipients.length > 100)
    throw new Error('暗号化に使う公開鍵を選んでください（最大100件）。');
  const encryptionKeys = await Promise.all(recipients.map((armoredKey) => readKey({ armoredKey })));
  const output = await encrypt({
    encryptionKeys,
    message: await createMessage({ binary: data, filename }),
    format: armored ? 'armored' : 'binary',
  });
  return {
    bytes: armored ? new TextEncoder().encode(output) : output,
    text: armored ? output : null,
  };
}

export async function getPGPSigningKey({ privateKey, passphrase = '' }) {
  const key = await unlockPGPKey(privateKey, passphrase, true);
  return { publicKey: key.toPublic().armor(), fingerprint: key.getFingerprint(), type: 'pgp' };
}

export async function signPGP({ data, privateKey, passphrase = '' }) {
  const key = await unlockPGPKey(privateKey, passphrase, true);
  return sign({
    message: await createMessage({ binary: data }),
    signingKeys: key,
    detached: true,
    format: 'armored',
  });
}

export async function verifyPGP({ data, signature, publicKey, current = false }) {
  if (
    byteLength(publicKey) > MAX_KEY_BYTES ||
    byteLength(signature) > 128 * 1024 ||
    byteLength(data) > MAX_BYTES
  )
    throw new Error('署名データが大きすぎます。');
  const key = await readKey({ armoredKey: publicKey });
  if (key.isPrivate()) throw new Error('署名検証には公開鍵を指定してください。');
  const result = await verify({
    message: await createMessage({ binary: data }),
    signature: await readSignature({ armoredSignature: signature }),
    verificationKeys: key,
    format: 'binary',
  });
  if (result.signatures.length !== 1) throw new Error('署名は1件である必要があります。');
  await result.signatures[0].verified;
  if (current) await key.getSigningKey(result.signatures[0].keyID);
  return { fingerprint: key.getFingerprint(), type: 'pgp' };
}
