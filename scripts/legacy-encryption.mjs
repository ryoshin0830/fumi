// Development-only producer for existing signed ciphertext compatibility tests.
import { encryptPGP } from '../src/pgp.js';
import { encryptAge } from '../src/age.js';
import { safeFilename, signingKeyType } from '../src/files.js';
import { MAX_BYTES, byteLength } from '../src/limits.js';
import { createSignedPackage } from '../src/signatures.js';
import { encryptNativePGP } from '../src/native-pgp.js';

export async function legacyEncrypt(payload) {
  let result;
  const { data, format, recipients, filename, armored, signer } = payload;
  if (byteLength(data) > MAX_BYTES) throw new Error('暗号化する内容は50 MB以下にしてください。');
  const native = signer && format === 'pgp' && signingKeyType(signer.privateKey) === 'pgp';
  const signed =
    signer && !native ? await createSignedPackage({ ...signer, data, filename }) : null;
  const encryptedData = signed ? signed.bytes : data;
  const storedName = signed ? safeFilename(filename) + '.signed.zip' : safeFilename(filename);
  if (native)
    result = await encryptNativePGP({
      ...signer,
      data,
      recipients,
      filename: storedName,
      armored,
    });
  else
    result =
      format === 'pgp'
        ? await encryptPGP({
            data: encryptedData,
            recipients,
            filename: storedName,
            armored,
            container: Boolean(signed),
          })
        : await encryptAge({
            data: encryptedData,
            recipients,
            armored,
            container: Boolean(signed),
          });
  result.format = format;
  result.originalFilename = safeFilename(filename);
  result.filename = storedName + (format === 'pgp' ? (armored ? '.asc' : '.gpg') : '.age');
  if (signed) {
    result.verification = signed.verification;
    result.encoding = 'signed-zip';
  }
  if (result.verification) result.verification.state = 'created';

  return result;
}
