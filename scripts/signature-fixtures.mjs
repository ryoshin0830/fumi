import * as pgp from 'openpgp';
import { mkdir, writeFile, readFile, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { zipSync, unzipSync } from 'fflate';
import { encryptPGP } from '../src/pgp.js';
import { encryptNativePGP } from '../src/native-pgp.js';
const destination = new URL('../test-results/signatures/', import.meta.url);
await mkdir(destination, { recursive: true });
const recipient = await pgp.generateKey({
  type: 'ecc',
  curve: 'curve25519Legacy',
  userIDs: [{ name: 'disposable recipient' }],
  passphrase: 'test-recipient-pass',
});
const signer = await pgp.generateKey({
  type: 'ecc',
  curve: 'curve25519Legacy',
  userIDs: [{ name: 'disposable signer' }],
  subkeys: [],
  passphrase: 'test-sign-pass',
});
const other = await pgp.generateKey({
  type: 'ecc',
  curve: 'curve25519Legacy',
  userIDs: [{ name: 'disposable signer' }],
  subkeys: [],
});
const temporary = await mkdtemp(join(tmpdir(), 'dgpg-signature-fixtures-'));
try {
  const sshPath = join(temporary, 'signer-ssh');
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', 'test-sign-pass', '-f', sshPath]);
  const sshPrivate = await readFile(sshPath, 'utf8'),
    sshPublic = await readFile(sshPath + '.pub', 'utf8');
  for (const [name, content] of Object.entries({
    'recipient-public.asc': recipient.publicKey,
    'recipient-secret.asc': recipient.privateKey,
    'signer-public.asc': signer.publicKey,
    'signer-secret.asc': signer.privateKey,
    'signer-ssh.pub': sshPublic,
    'signer-ssh': sshPrivate,
    'other-public.asc': other.publicKey,
  }))
    await writeFile(new URL(name, destination), content, { mode: 0o600 });
  await writeFile(
    new URL('public-responses.json', destination),
    JSON.stringify({ pgp: signer.publicKey, ssh: sshPublic, other: other.publicKey }),
  );
  await build({
    entryPoints: ['src/signatures.js'],
    outfile: join(temporary, 'api.mjs'),
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: 'es2022',
    loader: { '.wasm': 'binary' },
    logLevel: 'silent',
  });
  const api = await import('file://' + join(temporary, 'api.mjs'));
  const packaged = await api.createSignedPackage({
    data: new TextEncoder().encode('Tampered content must stay hidden'),
    filename: 'tamper.txt',
    github: 'alice-pgp',
    privateKey: signer.privateKey,
    passphrase: 'test-sign-pass',
    registeredKeys: [signer.publicKey],
  });
  const files = unzipSync(packaged.bytes);
  const legacy = await encryptPGP({
    data: packaged.bytes,
    recipients: [recipient.publicKey],
    filename: 'legacy.signed.zip',
    armored: true,
    container: true,
  });
  await writeFile(new URL('legacy-signed.asc', destination), legacy.text);
  const native = await encryptNativePGP({
    data: new TextEncoder().encode('Existing signed message'),
    recipients: [recipient.publicKey],
    filename: 'legacy.txt',
    armored: true,
    github: 'alice-pgp',
    privateKey: signer.privateKey,
    passphrase: 'test-sign-pass',
    registeredKeys: [signer.publicKey],
  });
  await writeFile(new URL('legacy-native.asc', destination), native.text);
  files['content/tamper.txt'][0] ^= 1;
  const changed = api.addPackageMarker(zipSync(files, { level: 0 }));
  const cipher = await encryptPGP({
    data: changed,
    recipients: [recipient.publicKey],
    filename: 'tampered.signed.zip',
    armored: true,
    container: true,
  });
  await writeFile(new URL('tampered.asc', destination), cipher.text);
  const data = new TextEncoder().encode('Malformed native signature must stay hidden');
  const signingKey = await pgp.decryptKey({
    privateKey: await pgp.readPrivateKey({ armoredKey: signer.privateKey }),
    passphrase: 'test-sign-pass',
  });
  const identity = new TextEncoder().encode(
    JSON.stringify({
      version: 1,
      github: 'alice-pgp',
      filename: 'message.txt',
      publicKey: signer.publicKey,
    }),
  );
  const signature = await pgp.sign({
    message: await pgp.createMessage({ binary: data }),
    signingKeys: signingKey,
    detached: true,
    format: 'object',
    signatureNotations: [
      { name: 'identity@dgpg.local', value: identity, humanReadable: true, critical: false },
    ],
  });
  signature.packets[0].signatureData[0] = 5;
  const malformed = await pgp.encrypt({
    message: await pgp.createMessage({ binary: data, filename: 'message.txt' }),
    encryptionKeys: await pgp.readKey({ armoredKey: recipient.publicKey }),
    signature,
    format: 'armored',
  });
  await writeFile(new URL('unsupported-native.asc', destination), malformed);
  const externalData = new TextEncoder().encode('External OpenPGP signed message');
  const externalMessage = (
    await pgp.createMessage({ binary: externalData, filename: 'external.txt' })
  ).compress(pgp.enums.compression.zlib);
  const externalSignature = await pgp.sign({
    message: await pgp.createMessage({ binary: externalData }),
    signingKeys: signingKey,
    detached: true,
    format: 'object',
  });
  externalMessage.packets.unshift(externalSignature.packets[0]);
  const externalCipher = await pgp.encrypt({
    message: externalMessage,
    encryptionKeys: await pgp.readKey({ armoredKey: recipient.publicKey }),
    format: 'armored',
  });
  await writeFile(new URL('external-signed.asc', destination), externalCipher);
  console.log(
    'Disposable signature browser fixtures ready in test-results/signatures. No personal keys used.',
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
