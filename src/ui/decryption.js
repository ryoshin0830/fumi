import { detectFormat } from '../files.js';

export function createDecryptionCommand({
  data,
  sourceName = '',
  identity = '~/.ssh/id_ed25519',
  shell = 'posix',
}) {
  if (shell !== 'posix' && shell !== 'powershell') {
    throw new Error('シェルは POSIX または PowerShell を選んでください。');
  }
  const format = detectFormat(data);
  if (!format) return null;
  const filename = sourceName || (format === 'pgp' ? 'message.txt.asc' : 'message.txt.age');
  if (filename.includes('\0')) throw new Error('ファイル名に NUL 文字は使えません。');
  if (format === 'ssh' && (!identity.trim() || /[\u0000-\u001f\u007f-\u009f]/.test(identity))) {
    throw new Error('秘密鍵のパスを、空欄や制御文字を含まない形で入力してください。');
  }
  const windowsPath = /^(?:[a-z]:|\\\\|\/\/)/i;
  if (
    shell === 'posix' &&
    (windowsPath.test(filename) || (format === 'ssh' && windowsPath.test(identity)))
  ) {
    throw new Error('Windows のパスを使う場合は PowerShell を選んでください。');
  }
  const quote =
    shell === 'posix'
      ? (value) => "'" + value.replace(/'/g, "'\\''") + "'"
      : (value) => "'" + value.replace(/['\u2018\u2019]/g, '$&$&') + "'";
  const absolute =
    shell === 'posix' ? filename.startsWith('/') : /^(?:[a-z]:|[/\\])/i.test(filename);
  const input = quote(absolute ? filename : './' + filename);
  if (format === 'pgp') {
    return { format, filename, command: `gpg --output restored --decrypt ${input}` };
  }
  const key = identity.startsWith('~/')
    ? shell === 'posix'
      ? '"$HOME"/' + quote(identity.slice(2))
      : `(Join-Path $HOME ${quote(identity.slice(2))})`
    : quote(identity);
  return {
    format,
    filename,
    command: `age --decrypt --identity ${key} --output restored ${input}`,
  };
}
