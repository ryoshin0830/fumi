import { readPrivateKey, readMessage, verify, config, enums, PacketList } from 'openpgp';
import {
  MAX_BYTES,
  MAX_CONTAINER_BYTES,
  MAX_ENCRYPTED_BYTES,
  MAX_KEY_BYTES,
  byteLength,
} from './limits.js';
import { recoverNativePGP } from './native-pgp.js';

export { MAX_BYTES };

export function safeFilename(filename, sourceName = '') {
  const candidate = filename || sourceName.replace(/\.(gpg|pgp|asc)$/i, '');
  let name = candidate
    .split(/[/\\]/)
    .pop()
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069<>:"|?*]/g, '')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 180);
  if (!name) name = 'decrypted.txt';
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name)) name = `_${name}`;
  return name;
}

function parseOptions(value, kind) {
  const text =
    typeof value === 'string'
      ? value.trim()
      : new TextDecoder().decode(value.subarray(0, 80)).trim();
  if (typeof value === 'string' || text.startsWith('-----BEGIN PGP ')) {
    const armored = typeof value === 'string' ? text : new TextDecoder().decode(value).trim();
    return kind === 'key' ? { armoredKey: armored } : { armoredMessage: armored };
  }
  return kind === 'key' ? { binaryKey: value } : { binaryMessage: value };
}

export async function unlockPGPKey(value, passphrase = '', signing = false) {
  if (!byteLength(value) || byteLength(value) > MAX_KEY_BYTES)
    throw new Error('秘密鍵は1 MB以下で入力してください。');
  let key;
  try {
    key = await readPrivateKey(parseOptions(value, 'key'));
  } catch {
    throw new Error('秘密鍵を読み込めません。OpenPGP秘密鍵の内容を確認してください。');
  }
  let packets;
  try {
    packets = signing
      ? [(await key.getSigningKey()).keyPacket]
      : key.getKeys().map((part) => part.keyPacket);
  } catch {
    throw new Error(
      'このOpenPGP秘密鍵では署名できません。署名用の鍵と有効期限を確認してください。',
    );
  }
  const locked = packets.filter((packet) => !packet.isDummy() && !packet.isDecrypted());
  if (locked.length && !passphrase) throw new Error('この秘密鍵にはパスフレーズが必要です。');
  try {
    for (const packet of locked) await packet.decrypt(passphrase);
    if (signing) await packets[0].validate();
    else if (locked.length) await key.validate();
  } catch {
    throw new Error('秘密鍵を解除できません。パスフレーズが正しいか確認してください。');
  }
  return key;
}

export async function decryptPayload({
  privateKey,
  ciphertext,
  passphrase = '',
  sourceName = '',
  container = false,
}) {
  for (const [label, value] of [
    ['秘密鍵', privateKey],
    ['暗号文', ciphertext],
  ]) {
    if (
      !(typeof value === 'string' || value instanceof Uint8Array) ||
      !value.length ||
      (typeof value === 'string' && !value.trim())
    ) {
      throw new Error(`${label}を入力するか、ファイルを選択してください。`);
    }
    const limit = label === '秘密鍵' ? MAX_KEY_BYTES : MAX_ENCRYPTED_BYTES;
    if (byteLength(value) > limit) {
      throw new Error(`${label}は${limit === MAX_KEY_BYTES ? '1' : '72'} MB以下にしてください。`);
    }
  }

  const key = await unlockPGPKey(privateKey, passphrase);

  let message;
  try {
    message = await readMessage(parseOptions(ciphertext, 'message'));
  } catch {
    throw new Error(
      '暗号文を読み込めません。OpenPGP形式の暗号文または暗号化ファイルを確認してください。',
    );
  }

  let result;
  let signaturePackets;
  try {
    const limit = container ? MAX_CONTAINER_BYTES : MAX_BYTES;
    const options = { ...config, maxDecompressedMessageSize: limit };
    const decrypted = await message.decrypt([key], undefined, undefined, undefined, options);
    const decryptedPacketLists = new Set([decrypted.packets, decrypted.unwrapCompressed().packets]);
    // Retain trailing packets and surface delayed parsing errors before verification consumes them.
    for (const packets of new Set([message.packets, ...decryptedPacketLists])) {
      if (!packets.stream) continue;
      const reader = packets.stream.getReader();
      try {
        for (let item; !(item = await reader.read()).done;) packets.push(item.value);
      } finally {
        reader.releaseLock?.();
      }
      packets.stream = null;
    }
    // Inspect every decrypted layer; verification omits outer, non-data and unparseable signatures.
    signaturePackets = new PacketList();
    for (const packets of decryptedPacketLists) {
      if (packets.some((packet) => packet.tag === enums.packet.signature))
        throw new Error('Unsupported signature packet');
      signaturePackets.push(...packets.filterByTag(enums.packet.signature));
    }
    result = await verify({
      message: decrypted,
      verificationKeys: [],
      format: 'binary',
      config: options,
    });
    result.filename = decrypted.getFilename();
    if (result.data.byteLength > limit) throw new Error('size');
  } catch {
    throw new Error(
      '復号できません。宛先に対応する秘密鍵か、データが破損していないか確認してください。復元後の上限は50 MBです。',
    );
  }

  const native = await recoverNativePGP(result, signaturePackets);
  let text = null;
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(result.data);
    if (!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(decoded)) text = decoded;
  } catch {
    /* Binary files are available as a download without a text preview. */
  }

  return {
    bytes: result.data,
    text,
    filename: safeFilename(result.filename, sourceName),
    fingerprint: key.getFingerprint(),
    signed: signaturePackets.some(
      (packet) =>
        packet.signatureType === enums.signature.binary ||
        packet.signatureType === enums.signature.text,
    ),
    ...native,
  };
}
