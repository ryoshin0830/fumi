import { zipSync } from 'fflate';
import { readKeys } from 'openpgp';
import { getPGPSigningKey, signPGP, verifyPGP } from './pgp.js';
import * as ssh from './age.js';
import { safeFilename, signingKeyType } from './files.js';
import { parseGitHub } from './recipients.js';
import { MAX_BYTES, MAX_CONTAINER_BYTES, MAX_KEY_BYTES, byteLength } from './limits.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const markers = [null, encoder.encode('dgpg-signed-v1'), encoder.encode('dgpg-signed-v2')];
const legacyLimits = {
  'manifest.json': 16 * 1024,
  data: MAX_BYTES,
  'signature.asc': 128 * 1024,
  'public.key': MAX_KEY_BYTES,
};
const invalid = () => new Error('署名付きデータの形式または内容が正しくありません。');
const hash = async (data) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), (n) =>
    n.toString(16).padStart(2, '0'),
  ).join('');

export { signingKeyType };

export function addPackageMarker(archive, version = 2) {
  const marker = markers[version];
  if (!marker) throw invalid();
  // Set the standard ZIP archive comment; fflate's comment option applies to files.
  const offset = archive.length - 22;
  if (
    offset < 0 ||
    new DataView(archive.buffer, archive.byteOffset).getUint32(offset, true) !== 0x06054b50
  )
    throw invalid();
  const bytes = new Uint8Array(archive.length + marker.length);
  bytes.set(archive);
  bytes.set(marker, archive.length);
  new DataView(bytes.buffer).setUint16(archive.length - 2, marker.length, true);
  return bytes;
}

export async function createSignedPackage({
  data,
  filename,
  github,
  privateKey,
  passphrase = '',
  registeredKeys,
}) {
  if (!(data instanceof Uint8Array) || data.length > MAX_BYTES)
    throw new Error('暗号化する内容は50 MB以下にしてください。');
  const account = parseGitHub(github).username.toLowerCase();
  const type = signingKeyType(privateKey);
  const options = {
    privateKey:
      typeof privateKey === 'string' || type === 'pgp' ? privateKey : decoder.decode(privateKey),
    passphrase,
  };
  const identity =
    type === 'pgp' ? await getPGPSigningKey(options) : await ssh.getSSHSigningKey(options);
  if (byteLength(identity.publicKey) > MAX_KEY_BYTES)
    throw new Error('署名の公開鍵は1 MB以下にしてください。');
  const name = safeFilename(filename);
  const readme = encoder.encode(
    packageReadme({ filename: name, account, type, fingerprint: identity.fingerprint }),
  );
  if (readme.length > 64 * 1024) throw invalid();
  const manifest = encoder.encode(
    JSON.stringify({
      version: 2,
      context: 'dgpg-signed',
      github: account,
      type,
      fingerprint: identity.fingerprint,
      filename: name,
      size: data.length,
      sha256: await hash(data),
      readmeSha256: await hash(readme),
    }),
  );
  const sign = (data) =>
    type === 'pgp'
      ? signPGP({ ...options, data })
      : ssh.signSSH({ ...options, data }).then((result) => result.signature);
  const signature = await sign(manifest);
  const contentSignature = await sign(data);
  if (
    manifest.length > 16 * 1024 ||
    byteLength(signature) > 128 * 1024 ||
    byteLength(contentSignature) > 128 * 1024
  )
    throw invalid();
  const verification = {
    github: account,
    type,
    fingerprint: identity.fingerprint,
    publicKey: identity.publicKey,
    manifest,
    signature,
    state: 'pending',
  };
  if (!(await verifyRegisteredSignature({ verification, registeredKeys })))
    throw new Error(
      `この秘密鍵は @${account} の現在のGitHub公開鍵と一致しません。署名用の鍵を確認してください。`,
    );
  const extension = type === 'pgp' ? 'asc' : 'sig';
  const bytes = addPackageMarker(
    zipSync(
      {
        'README.txt': readme,
        [`content/${name}`]: data,
        'signature/manifest.json': manifest,
        [`signature/manifest.${extension}`]: encoder.encode(signature),
        [`signature/content.${extension}`]: encoder.encode(contentSignature),
        [`signature/public.${type === 'pgp' ? 'asc' : 'pub'}`]: encoder.encode(identity.publicKey),
      },
      { level: 0 },
    ),
  );
  if (bytes.length > MAX_CONTAINER_BYTES)
    throw new Error('署名付きデータが上限サイズを超えています。');
  return { bytes, verification, encoding: 'signed-zip' };
}

export async function verifyRegisteredSignature({ verification, registeredKeys = [] }) {
  if (
    !Array.isArray(registeredKeys) ||
    registeredKeys.length > 100 ||
    registeredKeys.reduce((n, key) => n + byteLength(key), 0) > MAX_KEY_BYTES
  )
    throw new Error('検証用の公開鍵は合計1 MB・100件以下にしてください。');
  for (const raw of registeredKeys) {
    try {
      if (verification.type === 'pgp') {
        const keys = await readKeys({ armoredKeys: raw });
        for (const key of keys) {
          if (key.isPrivate() || key.getFingerprint() !== verification.fingerprint) continue;
          const result = await verifyPGP({
            data: verification.manifest,
            signature: verification.signature,
            publicKey: key.armor(),
            current: true,
          });
          if (result.fingerprint === verification.fingerprint) return true;
        }
      } else {
        const result = await ssh.verifySSH({
          data: verification.manifest,
          signature: verification.signature,
          publicKey: raw,
        });
        if (result.fingerprint === verification.fingerprint) return true;
      }
    } catch {
      /* Other or invalid registered keys cannot verify this signature. */
    }
  }
  return false;
}

const shellQuote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";

function packageReadme({ filename, account, type, fingerprint }) {
  const content = shellQuote('./content/' + filename);
  const manifest = "'./signature/manifest.json'";
  const commands =
    type === 'pgp'
      ? `gpg --import './signature/public.asc'
gpg --verify './signature/content.asc' ${content}
gpg --verify './signature/manifest.asc' ${manifest}`
      : `awk ${shellQuote('{print "' + account + ' " $0}')} './signature/public.pub' > './signature/allowed_signers'
ssh-keygen -Y verify -f './signature/allowed_signers' -I ${shellQuote(account)} -n dgpg -s './signature/content.sig' < ${content}
ssh-keygen -Y verify -f './signature/allowed_signers' -I ${shellQuote(account)} -n dgpg -s './signature/manifest.sig' < ${manifest}`;
  return `Fumi signed archive v2 / 日本語・English

日本語:
元のファイルは content/ にあります。age による復号だけでは署名は自動検証されません。
この ZIP を展開し、展開先のディレクトリで下記のコマンドを実行してください。
最初に元のファイルの署名を、次に manifest.json の署名を検証します。
SHA-256 の結果を、署名検証済み manifest.json の sha256（元のファイル）と
readmeSha256（README.txt）にそれぞれ比較してください。
同梱の公開鍵による検証は改変検知です。GitHub 本人確認には、信頼できる経路で
GitHub の現在の登録公開鍵とフィンガープリントを独立に照合してください。

English:
The exact original file is in content/. Decrypting with age does not automatically verify signatures.
Extract this ZIP, then run these commands from the extracted directory.
Verify the direct file signature and the separate signed manifest:

${commands}

Compare these SHA-256 values with sha256 (original file) and readmeSha256 (README.txt)
in the verified signature/manifest.json:

shasum -a 256 ${content}
shasum -a 256 './README.txt'

GitHub: https://github.com/${account}
Fingerprint: ${fingerprint}
Verification with the included key establishes integrity. Independently compare the key and
fingerprint with the GitHub account's current registered signing key over a trusted channel
to establish identity. The manifest binds the account, filename, size, content and this README.
`;
}

function memberLimit(name, version) {
  if (version === 1) return Object.hasOwn(legacyLimits, name) ? legacyLimits[name] : null;
  if (name === 'README.txt') return 64 * 1024;
  if (name === 'signature/manifest.json') return 16 * 1024;
  if (/^signature\/(?:manifest|content)\.(?:asc|sig)$/.test(name)) return 128 * 1024;
  if (/^signature\/public\.(?:asc|pub)$/.test(name)) return MAX_KEY_BYTES;
  if (name.startsWith('content/') && name.slice(8) === safeFilename(name.slice(8)))
    return MAX_BYTES;
  return null;
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
  return value;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}

function readStoreArchive(bytes, view, end, version) {
  const count = version === 1 ? 4 : 6;
  const start = view.getUint32(end + 16, true);
  const size = view.getUint32(end + 12, true);
  if (view.getUint16(end + 8, true) !== count || start + size !== end) throw invalid();
  const entries = [];
  const names = new Set();
  let cursor = start;
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50) throw invalid();
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (
      next > end ||
      extraLength ||
      commentLength ||
      view.getUint16(cursor + 34, true) ||
      view.getUint32(cursor + 38, true)
    )
      throw invalid();
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    const compressed = view.getUint32(cursor + 20, true);
    const length = view.getUint32(cursor + 24, true);
    const flags = view.getUint16(cursor + 8, true);
    const limit = memberLimit(name, version);
    if (
      limit === null ||
      names.has(name) ||
      flags & ~0x800 ||
      (!(flags & 0x800) && /[^\x00-\x7f]/.test(name)) ||
      view.getUint16(cursor + 10, true) ||
      compressed !== length ||
      length > limit
    )
      throw invalid();
    names.add(name);
    entries.push({
      name,
      length,
      flags,
      version: view.getUint16(cursor + 6, true),
      modified: view.getUint32(cursor + 12, true),
      crc: view.getUint32(cursor + 16, true),
      offset: view.getUint32(cursor + 42, true),
    });
    cursor = next;
  }
  if (cursor !== end) throw invalid();
  entries.sort((a, b) => a.offset - b.offset);
  cursor = 0;
  const files = {};
  for (const entry of entries) {
    if (
      entry.offset !== cursor ||
      cursor + 30 > start ||
      view.getUint32(cursor, true) !== 0x04034b50
    )
      throw invalid();
    const nameLength = view.getUint16(cursor + 26, true);
    const extraLength = view.getUint16(cursor + 28, true);
    const dataStart = cursor + 30 + nameLength + extraLength;
    const next = dataStart + entry.length;
    if (
      next > start ||
      extraLength ||
      view.getUint16(cursor + 4, true) !== entry.version ||
      view.getUint32(cursor + 10, true) !== entry.modified ||
      view.getUint16(cursor + 6, true) !== entry.flags ||
      view.getUint16(cursor + 8, true) ||
      view.getUint32(cursor + 14, true) !== entry.crc ||
      view.getUint32(cursor + 18, true) !== entry.length ||
      view.getUint32(cursor + 22, true) !== entry.length ||
      decoder.decode(bytes.subarray(cursor + 30, dataStart)) !== entry.name
    )
      throw invalid();
    files[entry.name] = bytes.subarray(dataStart, next);
    if (crc32(files[entry.name]) !== entry.crc) throw invalid();
    cursor = next;
  }
  if (cursor !== start) throw invalid();
  return files;
}

export async function readSignedPackage(bytes) {
  const version = markers.findIndex(
    (marker) =>
      marker &&
      bytes.length >= 22 + marker.length &&
      marker.every((value, index) => bytes[bytes.length - marker.length + index] === value),
  );
  if (version < 1) return null;
  const marker = markers[version];
  if (bytes.length > MAX_CONTAINER_BYTES) throw invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  if (view.getUint32(0, true) !== 0x04034b50) return null;
  const end = bytes.length - 22 - marker.length;
  if (
    view.getUint32(end, true) !== 0x06054b50 ||
    view.getUint16(end + 20, true) !== marker.length ||
    view.getUint16(end + 10, true) !== (version === 1 ? 4 : 6) ||
    view.getUint16(end + 4, true) ||
    view.getUint16(end + 6, true)
  )
    throw invalid();
  let files;
  try {
    files = readStoreArchive(bytes, view, end, version);
  } catch {
    throw invalid();
  }
  const manifestName = version === 1 ? 'manifest.json' : 'signature/manifest.json';
  let manifest;
  try {
    manifest = JSON.parse(decoder.decode(files[manifestName]));
  } catch {
    throw invalid();
  }
  const names = [
    'version',
    'context',
    'github',
    'type',
    'fingerprint',
    'filename',
    'size',
    'sha256',
    ...(version === 2 ? ['readmeSha256'] : []),
  ];
  if (
    !manifest ||
    Object.keys(manifest).length !== names.length ||
    !names.every((key) => Object.hasOwn(manifest, key)) ||
    manifest.version !== version ||
    manifest.context !== 'dgpg-signed' ||
    !['pgp', 'ssh'].includes(manifest.type) ||
    typeof manifest.github !== 'string' ||
    !/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/.test(manifest.github) ||
    manifest.github.includes('--') ||
    typeof manifest.filename !== 'string' ||
    manifest.filename !== safeFilename(manifest.filename) ||
    typeof manifest.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(manifest.sha256) ||
    typeof manifest.fingerprint !== 'string' ||
    manifest.fingerprint.length > 100 ||
    (version === 2 &&
      (typeof manifest.readmeSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(manifest.readmeSha256)))
  )
    throw invalid();
  const dataName = version === 1 ? 'data' : `content/${manifest.filename}`;
  const extension = manifest.type === 'pgp' ? 'asc' : 'sig';
  const signatureName = version === 1 ? 'signature.asc' : `signature/manifest.${extension}`;
  const contentSignatureName = `signature/content.${extension}`;
  const publicName =
    version === 1 ? 'public.key' : `signature/public.${manifest.type === 'pgp' ? 'asc' : 'pub'}`;
  const expectedNames =
    version === 1
      ? Object.keys(legacyLimits)
      : ['README.txt', dataName, manifestName, signatureName, contentSignatureName, publicName];
  if (
    !expectedNames.every((name) => Object.hasOwn(files, name)) ||
    manifest.size !== files[dataName].length
  )
    throw invalid();
  let verification;
  try {
    verification = {
      github: manifest.github,
      type: manifest.type,
      fingerprint: manifest.fingerprint,
      manifest: files[manifestName],
      signature: decoder.decode(files[signatureName]),
      publicKey: decoder.decode(files[publicName]),
      state: 'pending',
    };
    const verify = (data) => (manifest.type === 'pgp' ? verifyPGP(data) : ssh.verifySSH(data));
    const checked = await verify({
      data: verification.manifest,
      signature: verification.signature,
      publicKey: verification.publicKey,
    });
    if (
      checked.fingerprint !== manifest.fingerprint ||
      (await hash(files[dataName])) !== manifest.sha256
    )
      throw invalid();
    if (version === 2) {
      decoder.decode(files['README.txt']);
      if ((await hash(files['README.txt'])) !== manifest.readmeSha256) throw invalid();
      const contentChecked = await verify({
        data: files[dataName],
        signature: decoder.decode(files[contentSignatureName]),
        publicKey: verification.publicKey,
      });
      if (contentChecked.fingerprint !== manifest.fingerprint) throw invalid();
    }
  } catch {
    throw new Error('署名を検証できません。署名や内容が変更されている可能性があります。');
  }
  return {
    bytes: files[dataName],
    filename: manifest.filename,
    verification,
    encoding: 'signed-zip',
  };
}
