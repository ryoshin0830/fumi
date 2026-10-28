import './vendor/wasm_exec.js';
import wasm from './vendor/age.wasm';

const MAX_PLAIN = 50 * 1024 ** 2;
const MAX_CONTAINER = 52 * 1024 ** 2;
const MAX_ENCRYPTED = 72 * 1024 ** 2;
const MAX_KEY = 1024 ** 2;
const encoder = new TextEncoder();
let runtime;

async function bridge() {
  if (!runtime)
    runtime = (async () => {
      const go = new globalThis.Go();
      const { instance } = await WebAssembly.instantiate(wasm, go.importObject);
      // The Go main function installs the bridge and then stays alive for this worker.
      const running = go.run(instance);
      running.catch(() => {
        runtime = undefined;
      });
      if (!globalThis.__dgpgAgeBridge) throw new Error('age エンジンを起動できません。');
      return globalThis.__dgpgAgeBridge;
    })().catch((error) => {
      runtime = undefined;
      throw error;
    });
  return runtime;
}

function keyText(value, label) {
  if (typeof value !== 'string') throw new Error(`${label}の形式を確認してください。`);
  if (encoder.encode(value).byteLength > MAX_KEY)
    throw new Error(`${label}は 1 MiB 以下にしてください。`);
  return value;
}

function inputBytes(value, max, label) {
  const bytes =
    typeof value === 'string'
      ? encoder.encode(value)
      : value instanceof Uint8Array
        ? value
        : value instanceof ArrayBuffer
          ? new Uint8Array(value)
          : null;
  if (!bytes) throw new Error(`${label}の形式を確認してください。`);
  if (bytes.byteLength > max)
    throw new Error(`${label}は ${max / 1024 ** 2} MiB 以下にしてください。`);
  return bytes;
}

async function invoke(operation, value) {
  const engine = await bridge();
  const result = engine[operation](value);
  if (result.error) throw Object.assign(new Error(result.error), { code: result.code });
  return result;
}

export async function inspectSSHKey(publicKey) {
  const { type, fingerprint } = await invoke('inspect', keyText(publicKey, '公開鍵'));
  return { type, fingerprint };
}

export async function getSSHSigningKey({ privateKey, passphrase = '' }) {
  const { publicKey, fingerprint, type } = await invoke('signingKey', {
    privateKey: keyText(privateKey, '秘密鍵'),
    passphrase: keyText(passphrase, 'パスフレーズ'),
  });
  return { publicKey, fingerprint, type };
}

export async function signSSH({ data, privateKey, passphrase = '' }) {
  const bytes = inputBytes(data, MAX_CONTAINER, '署名対象');
  const { signature, publicKey, fingerprint, type } = await invoke('sign', {
    data: bytes,
    privateKey: keyText(privateKey, '秘密鍵'),
    passphrase: keyText(passphrase, 'パスフレーズ'),
  });
  return { signature, publicKey, fingerprint, type };
}

export async function verifySSH({ data, signature, publicKey }) {
  const bytes = inputBytes(data, MAX_CONTAINER, '署名対象');
  const { fingerprint, type } = await invoke('verify', {
    data: bytes,
    signature: keyText(signature, '署名'),
    publicKey: keyText(publicKey, '公開鍵'),
  });
  return { fingerprint, type };
}

export async function encryptAge({ data, recipients, armored = false, container = false }) {
  const bytes = inputBytes(data, container ? MAX_CONTAINER : MAX_PLAIN, '平文');
  if (!Array.isArray(recipients) || !recipients.length)
    throw new Error('SSH 公開鍵を選択してください。');
  const keys = recipients.map((key) => keyText(key, '公開鍵'));
  if (keys.reduce((total, key) => total + encoder.encode(key).byteLength, 0) > MAX_KEY)
    throw new Error('公開鍵の合計は 1 MiB 以下にしてください。');
  const result = await invoke('encrypt', {
    data: bytes,
    recipients: keys,
    armored: Boolean(armored),
    container: Boolean(container),
  });
  return { bytes: result.bytes, text: armored ? new TextDecoder().decode(result.bytes) : null };
}

export async function decryptAge({ data, privateKey, passphrase = '', container = false }) {
  const bytes = inputBytes(data, MAX_ENCRYPTED, '暗号化ファイル');
  return (
    await invoke('decrypt', {
      data: bytes,
      privateKey: keyText(privateKey, '秘密鍵'),
      passphrase: keyText(passphrase, 'パスフレーズ'),
      container: Boolean(container),
    })
  ).bytes;
}
