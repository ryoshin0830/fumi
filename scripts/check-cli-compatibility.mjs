// Exercise the recipient's native tools, without dgpg's automatic ZIP handling.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { build } from 'esbuild';
import * as pgp from 'openpgp';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
// GPG agent sockets exceed macOS's pathname limit inside its long per-user temp path.
const directory = await mkdtemp('/tmp/dgpg-cli-');
const destination = join(root, 'test-results/cli-compatibility');
const gnupg = join(directory, 'gnupg');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const run = (cmd, args, options = {}) =>
  execFileSync(cmd, args, { cwd: directory, maxBuffer: 4 * 1024 ** 2, ...options });
let worker;
try {
  await mkdir(destination, { recursive: true });
  await mkdir(gnupg, { mode: 0o700 });
  const go = process.env.GO || 'go';
  await writeFile(
    join(directory, 'go.mod'),
    'module dgpg.local/native-compatibility\n\ngo 1.27.3\n\nrequire filippo.io/age v1.3.2\n',
  );
  const age = join(directory, 'age');
  run(go, ['build', '-mod=mod', '-o', age, 'filippo.io/age/cmd/age']);
  const receiver = await pgp.generateKey({
    type: 'ecc',
    curve: 'curve25519Legacy',
    userIDs: [{ name: 'Disposable recipient' }],
  });
  const signer = await pgp.generateKey({
    type: 'ecc',
    curve: 'curve25519Legacy',
    userIDs: [{ name: 'Disposable signer' }],
    subkeys: [],
  });
  const sshKey = join(directory, 'ssh-key');
  run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'disposable-test-only', '-f', sshKey]);
  const sshPrivate = await readFile(sshKey, 'utf8');
  const sshPublic = await readFile(sshKey + '.pub', 'utf8');
  const sshReceiver = join(directory, 'ssh-receiver');
  run('ssh-keygen', [
    '-q',
    '-t',
    'ed25519',
    '-N',
    '',
    '-C',
    'disposable-recipient-only',
    '-f',
    sshReceiver,
  ]);
  const sshReceiverPublic = await readFile(sshReceiver + '.pub', 'utf8');
  const keyFile = join(directory, 'pgp-keys.asc');
  await writeFile(keyFile, receiver.privateKey + '\n' + signer.publicKey, { mode: 0o600 });
  run('gpg', ['--no-options', '--homedir', gnupg, '--batch', '--import', keyFile], {
    stdio: 'pipe',
  });
  await build({
    entryPoints: [join(root, 'src/crypto-worker.js')],
    outfile: join(directory, 'worker-bundle.mjs'),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    loader: { '.wasm': 'binary' },
    logLevel: 'silent',
  });
  await writeFile(
    join(directory, 'worker.mjs'),
    `import {parentPort} from 'node:worker_threads';globalThis.self=globalThis;globalThis.postMessage=data=>parentPort.postMessage(data);await import('./worker-bundle.mjs');parentPort.on('message',data=>self.onmessage({data}));`,
  );
  worker = new Worker(join(directory, 'worker.mjs'));
  let sequence = 0;
  const pending = new Map();
  worker.on('message', ({ id, result, error }) => {
    const task = pending.get(id);
    pending.delete(id);
    error ? task.reject(new Error(error)) : task.resolve(result);
  });
  worker.on('error', (error) => {
    for (const task of pending.values()) task.reject(error);
    pending.clear();
  });
  const rpc = (action, payload) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, action, payload });
    });
  const inputs = [
    {
      name: 'message.txt',
      armored: true,
      bytes: Buffer.from('受信者の手元で、そのまま読めるかを確認します。\n'),
    },
    {
      name: 'example.png',
      armored: false,
      bytes: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1kAAAAASUVORK5CYII=',
        'base64',
      ),
    },
  ];
  const cases = [];
  for (const format of ['pgp', 'ssh'])
    for (const input of inputs)
      for (const signing of ['none', 'pgp', 'ssh']) {
        const id = `${format === 'ssh' ? 'age' : 'pgp'}-${input.name}-${signing}`;
        const caseDirectory = join(directory, id);
        await mkdir(caseDirectory);
        const keys = signing === 'pgp' ? [signer.publicKey] : [sshPublic];
        const encrypted = await rpc('encrypt', {
          data: new Uint8Array(input.bytes),
          format,
          recipients: [format === 'pgp' ? receiver.publicKey : sshReceiverPublic],
          filename: input.name,
          armored: input.armored,
          signer:
            signing === 'none'
              ? undefined
              : {
                  github: 'disposable-signer',
                  privateKey: signing === 'pgp' ? signer.privateKey : sshPrivate,
                  registeredKeys: keys,
                },
        });
        const ciphertext = join(caseDirectory, encrypted.filename);
        const plaintext = join(caseDirectory, 'decrypted');
        await writeFile(ciphertext, encrypted.bytes);
        let stderr = '';
        if (format === 'ssh')
          run(age, ['--decrypt', '-i', sshReceiver, '-o', plaintext, ciphertext]);
        else {
          const result = spawnSync(
            'gpg',
            [
              '--no-options',
              '--homedir',
              gnupg,
              '--batch',
              '--yes',
              '--status-fd',
              '2',
              '--output',
              plaintext,
              '--decrypt',
              ciphertext,
            ],
            { encoding: 'utf8' },
          );
          assert.equal(result.status, 0, result.stderr);
          stderr = result.stderr;
        }
        const decrypted = await readFile(plaintext);
        const row = {
          id,
          encryptedFilename: encrypted.filename,
          nativeDecryption: true,
          nativeAutomaticSignatureVerification: /\[GNUPG:\] VALIDSIG /.test(stderr),
          directlyOriginalData: decrypted.equals(input.bytes),
          decryptedMagicHex: decrypted.subarray(0, 8).toString('hex'),
        };
        const native = format === 'pgp' && signing === 'pgp';
        if (signing === 'none' || native) {
          assert.equal(row.directlyOriginalData, true);
          assert.equal(row.nativeAutomaticSignatureVerification, native);
          assert.equal(
            encrypted.filename,
            input.name + (format === 'pgp' ? (input.armored ? '.asc' : '.gpg') : '.age'),
          );
        } else {
          assert.equal(row.directlyOriginalData, false);
          assert.equal(row.nativeAutomaticSignatureVerification, false);
          run('unzip', ['-t', plaintext]);
          const names = run('unzip', ['-Z1', plaintext], { encoding: 'utf8' }).trim().split('\n');
          const extension = signing === 'pgp' ? 'asc' : 'sig';
          assert.deepEqual(
            new Set(names),
            new Set([
              'README.txt',
              `content/${input.name}`,
              'signature/manifest.json',
              `signature/manifest.${extension}`,
              `signature/content.${extension}`,
              signing === 'pgp' ? 'signature/public.asc' : 'signature/public.pub',
            ]),
          );
          run('unzip', ['-q', plaintext, '-d', join(caseDirectory, 'extracted')]);
          const extracted = join(caseDirectory, 'extracted');
          const manifestPath = join(extracted, 'signature/manifest.json');
          const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
          const dataPath = join(extracted, 'content', input.name);
          const data = await readFile(dataPath);
          const readme = await readFile(join(extracted, 'README.txt'));
          assert.equal(manifest.version, 2);
          assert.deepEqual(data, input.bytes);
          assert.equal(sha256(data), manifest.sha256);
          assert.equal(sha256(readme), manifest.readmeSha256);
          assert.equal(manifest.filename, input.name);
          let verification, directVerification;
          if (signing === 'pgp') {
            const args = ['--no-options', '--homedir', gnupg, '--batch', '--verify'];
            verification = spawnSync('gpg', [
              ...args,
              join(extracted, 'signature/manifest.asc'),
              manifestPath,
            ]);
            directVerification = spawnSync('gpg', [
              ...args,
              join(extracted, 'signature/content.asc'),
              dataPath,
            ]);
          } else {
            const allowed = join(caseDirectory, 'allowed_signers');
            await writeFile(allowed, `${manifest.github} ${sshPublic}`);
            const args = ['-Y', 'verify', '-f', allowed, '-I', manifest.github, '-n', 'dgpg', '-s'];
            verification = spawnSync(
              'ssh-keygen',
              [...args, join(extracted, 'signature/manifest.sig')],
              { input: await readFile(manifestPath) },
            );
            directVerification = spawnSync(
              'ssh-keygen',
              [...args, join(extracted, 'signature/content.sig')],
              { input: data },
            );
          }
          assert.equal(verification.status, 0, String(verification.stderr));
          assert.equal(directVerification.status, 0, String(directVerification.stderr));
          Object.assign(row, {
            archiveEntries: names,
            originalFilenamePreserved: input.name,
            extractedContentIdentical: true,
            sha256MatchesSignedManifest: true,
            readmeMatchesSignedManifest: true,
            nativeManifestSignatureValid: true,
            signatureDirectlyOverOriginalData: true,
          });
          if (id === 'age-example.png-ssh') {
            await writeFile(join(destination, 'example.decrypted.zip'), decrypted);
            await writeFile(
              join(destination, 'archive-listing.txt'),
              run('unzip', ['-l', plaintext]),
            );
          }
        }
        cases.push(row);
      }
  // Baseline: standard OpenPGP signing and encryption produces the original data and automatic GPG verification.
  const native = await pgp.encrypt({
    message: await pgp.createMessage({
      binary: new Uint8Array(inputs[0].bytes),
      filename: inputs[0].name,
    }),
    encryptionKeys: await pgp.readKey({ armoredKey: receiver.publicKey }),
    signingKeys: await pgp.readPrivateKey({ armoredKey: signer.privateKey }),
    format: 'armored',
  });
  const nativePath = join(directory, 'native-signed.asc');
  await writeFile(nativePath, native);
  const nativeResult = spawnSync('gpg', [
    '--no-options',
    '--homedir',
    gnupg,
    '--batch',
    '--status-fd',
    '2',
    '--decrypt',
    nativePath,
  ]);
  assert.equal(nativeResult.status, 0);
  assert.deepEqual(nativeResult.stdout, inputs[0].bytes);
  assert.match(String(nativeResult.stderr), /\[GNUPG:\] VALIDSIG /);
  const report = {
    checkedAt: new Date().toISOString(),
    versions: {
      gpg: run('gpg', ['--version'], { encoding: 'utf8' }).split('\n')[0],
      ageSource: 'filippo.io/age v1.3.2 (official native CLI)',
      unzip: 'macOS /usr/bin/unzip 6.00',
      ssh: String(spawnSync('ssh', ['-V']).stderr).trim(),
    },
    cases,
    standardOpenPGPBaseline: {
      originalDataDirectlyReadable: true,
      nativeAutomaticSignatureVerification: true,
    },
    limitations: [
      'CLI tools only; no external GUI clients tested.',
      'GitHub network identity matching is outside this compatibility check.',
    ],
  };
  await writeFile(join(destination, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(
    JSON.stringify(
      {
        cases: cases.length,
        signedArchives: cases.filter((row) => row.archiveEntries).length,
        directOriginalOutputs: cases.filter((row) => row.directlyOriginalData).length,
        automaticGPGSignatures: cases.filter((row) => row.nativeAutomaticSignatureVerification)
          .length,
        manifestSignaturesVerifiedByNativeTools: cases.filter(
          (row) => row.nativeManifestSignatureValid,
        ).length,
        directFileSignaturesVerifiedByNativeTools: cases.filter(
          (row) => row.signatureDirectlyOverOriginalData,
        ).length,
        standardOpenPGPBaseline: report.standardOpenPGPBaseline,
        report: join(destination, 'report.json'),
      },
      null,
      2,
    ),
  );
} finally {
  await worker?.terminate();
  spawnSync('gpgconf', ['--homedir', gnupg, '--kill', 'gpg-agent']);
  await rm(directory, { recursive: true, force: true });
}
