import { readKey, readKeys, createMessage, encrypt, sign, enums, Signature } from 'openpgp';
import { unlockPGPKey } from './decrypt.js';
import { verifyPGP } from './pgp.js';
import { safeFilename } from './files.js';
import { parseGitHub } from './recipients.js';
import { MAX_BYTES, MAX_KEY_BYTES, byteLength } from './limits.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const identityName = 'identity@dgpg.local';
const MAX_IDENTITY_BYTES = 60 * 1024;
const invalid = () => new Error('OpenPGP署名の識別情報または内容が正しくありません。');

export async function encryptNativePGP({
  data,
  recipients,
  filename = 'message.txt',
  armored = false,
  github,
  privateKey,
  passphrase = '',
  registeredKeys = [],
}) {
  if (!(data instanceof Uint8Array) || data.byteLength > MAX_BYTES)
    throw new Error('暗号化する内容は50 MB以下にしてください。');
  if (!recipients?.length || recipients.length > 100)
    throw new Error('暗号化に使う公開鍵を選んでください（最大100件）。');
  if (
    !Array.isArray(registeredKeys) ||
    registeredKeys.length > 100 ||
    registeredKeys.reduce((n, key) => n + byteLength(key), 0) > MAX_KEY_BYTES
  )
    throw new Error('検証用の公開鍵は合計1 MB・100件以下にしてください。');
  const account = parseGitHub(github).username.toLowerCase();
  const key = await unlockPGPKey(privateKey, passphrase, true);
  const publicKey = key.toPublic().armor();
  const safeName = safeFilename(filename);
  if (byteLength(safeName) > 255)
    throw new Error('OpenPGPのファイル名はUTF-8で255バイト以下にしてください。');
  const value = encoder.encode(
    JSON.stringify({ version: 1, github: account, filename: safeName, publicKey }),
  );
  if (value.length > MAX_IDENTITY_BYTES)
    throw new Error(
      'OpenPGP署名の識別情報が60 KiBを超えています。より小さい署名用公開鍵を指定してください。',
    );
  const signature = await sign({
    message: await createMessage({ binary: data }),
    signingKeys: key,
    detached: true,
    format: 'object',
    signatureNotations: [{ name: identityName, value, humanReadable: true, critical: false }],
  });
  const verification = {
    kind: 'native-pgp',
    github: account,
    type: 'pgp',
    fingerprint: key.getFingerprint(),
    publicKey,
    manifest: data,
    signature: signature.armor(),
    state: 'pending',
  };
  let registered = false;
  for (const raw of registeredKeys) {
    try {
      for (const candidate of await readKeys({ armoredKeys: raw })) {
        if (candidate.isPrivate() || candidate.getFingerprint() !== verification.fingerprint)
          continue;
        await verifyPGP({
          data,
          signature: verification.signature,
          publicKey: candidate.armor(),
          current: true,
        });
        registered = true;
        break;
      }
    } catch {
      /* Only a current registered signing key can establish identity. */
    }
    if (registered) break;
  }
  if (!registered)
    throw new Error(
      `この秘密鍵は @${account} の現在のGitHub公開鍵と一致しません。署名用の鍵を確認してください。`,
    );
  const encryptionKeys = await Promise.all(recipients.map((armoredKey) => readKey({ armoredKey })));
  const output = await encrypt({
    encryptionKeys,
    message: await createMessage({ binary: data, filename: safeName }),
    signature,
    format: armored ? 'armored' : 'binary',
  });
  return {
    bytes: armored ? encoder.encode(output) : output,
    text: armored ? output : null,
    verification,
    encoding: 'native-pgp',
  };
}

export async function recoverNativePGP(result, signaturePackets) {
  let identity;
  let detached;
  for (const packet of signaturePackets) {
    // OpenPGP.js ignores unhashed notations in rawNotations but retains their wire bodies.
    for (const { type, body } of packet.unhashedSubpackets) {
      if (type !== 20 || body.length < 8) continue;
      const length = new DataView(body.buffer, body.byteOffset, body.byteLength).getUint16(4);
      if (new TextDecoder().decode(body.subarray(8, 8 + length)) === identityName) throw invalid();
    }
    for (const notation of packet.rawNotations) {
      if (notation.name !== identityName) continue;
      if (
        identity ||
        signaturePackets.length !== 1 ||
        packet.signatureType !== enums.signature.binary ||
        notation.critical ||
        !notation.humanReadable ||
        notation.value.length > MAX_IDENTITY_BYTES
      )
        throw invalid();
      try {
        identity = JSON.parse(decoder.decode(notation.value));
      } catch {
        throw invalid();
      }
      const fields = ['version', 'github', 'filename', 'publicKey'];
      if (
        !identity ||
        Object.keys(identity).length !== fields.length ||
        !fields.every((field) => Object.hasOwn(identity, field)) ||
        identity.version !== 1 ||
        typeof identity.github !== 'string' ||
        !/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/.test(identity.github) ||
        identity.github.includes('--') ||
        typeof identity.filename !== 'string' ||
        safeFilename(identity.filename) !== identity.filename ||
        typeof identity.publicKey !== 'string' ||
        !identity.publicKey.length ||
        byteLength(identity.publicKey) > MAX_KEY_BYTES
      )
        throw invalid();
      detached = new Signature(signaturePackets).armor();
    }
  }
  if (!identity) return null;
  let checked;
  try {
    checked = await verifyPGP({
      data: result.data,
      signature: detached,
      publicKey: identity.publicKey,
    });
  } catch {
    throw new Error('署名を検証できません。署名や内容が変更されている可能性があります。');
  }
  return {
    filename: identity.filename,
    encoding: 'native-pgp',
    verification: {
      kind: 'native-pgp',
      github: identity.github,
      type: 'pgp',
      fingerprint: checked.fingerprint,
      publicKey: identity.publicKey,
      manifest: result.data,
      signature: detached,
      state: 'pending',
    },
  };
}
