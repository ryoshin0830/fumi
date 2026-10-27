export function safeFilename(filename, sourceName = '') {
  const candidate = filename || sourceName.replace(/\.(gpg|pgp|asc|age)$/i, '');
  let name = candidate
    .split(/[/\\]/)
    .pop()
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069<>:"|?*]/g, '')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 180)
    .replace(/[.\s]+$/g, '');
  if (!name) name = 'decrypted.txt';
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name)) name = `_${name}`;
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(new TextEncoder().encode(name));
}
export function decodeText(bytes) {
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text) ? null : text;
  } catch {
    return null;
  }
}
export function detectFormat(value) {
  const prefix = (
    typeof value === 'string'
      ? value.slice(0, 100)
      : new TextDecoder().decode(value?.subarray(0, 100))
  ).trim();
  if (
    prefix.startsWith('age-encryption.org/v1') ||
    prefix.startsWith('-----BEGIN AGE ENCRYPTED FILE-----')
  )
    return 'ssh';
  if (
    prefix.startsWith('-----BEGIN PGP MESSAGE-----') ||
    (value instanceof Uint8Array && value.length && value[0] >= 128)
  )
    return 'pgp';
  return null;
}

export function signingKeyType(value) {
  const prefix = (
    typeof value === 'string'
      ? value.slice(0, 100)
      : new TextDecoder().decode(value?.subarray(0, 100))
  ).trim();
  return prefix.startsWith('-----BEGIN PGP') || (value instanceof Uint8Array && value[0] >= 128)
    ? 'pgp'
    : 'ssh';
}
