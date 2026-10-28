import { detectFormat } from '../files.js';

const control = /[\u0000-\u001f\u007f-\u009f]/;
const windowsPath = /^(?:[a-z]:|\\\\|\/\/)/i;
const clipboardCommands = {
  pbpaste: 'pbpaste',
  'wl-paste': 'wl-paste --no-newline',
  xclip: 'xclip -selection clipboard -out',
};
const keyPrompt = '秘密鍵をコピーして Enter を押してください。';
const cipherPrompt = '暗号文をコピーして Enter を押してください。';

export function createDecryptionCommand({
  data,
  sourceName = '',
  inputSource = 'file',
  inputPath = '',
  keySource = '',
  identity = '',
  shell = 'posix',
  clipboardTool = '',
}) {
  if (!['posix', 'powershell'].includes(shell)) {
    throw new Error('シェルは POSIX または PowerShell を選んでください。');
  }
  const format = detectFormat(data);
  if (!format || keySource === '') return null;
  if (!['file', 'clipboard'].includes(inputSource)) {
    throw new Error('暗号文の入力元を選んでください。');
  }
  if (
    !['keyring', 'file', 'clipboard'].includes(keySource) ||
    (format === 'ssh' && keySource === 'keyring')
  ) {
    throw new Error('秘密鍵の入力元を選んでください。');
  }
  const clipboard = inputSource === 'clipboard' || keySource === 'clipboard';
  if (clipboard && shell === 'posix' && !Object.hasOwn(clipboardCommands, clipboardTool)) {
    throw new Error('クリップボードのコマンドを選んでください。');
  }
  if (
    keySource === 'file' &&
    typeof identity === 'string' &&
    /-----BEGIN (?:[A-Z0-9]+ )*(?:PRIVATE|PUBLIC) KEY(?: BLOCK)?-----|AGE-SECRET-KEY-1|^\s*(?:ssh-(?:rsa|ed25519)|ecdsa-sha2-\S+|sk-\S+@openssh\.com)\s+[A-Za-z0-9+/]{16,}={0,3}(?:\s|$)/i.test(
      identity,
    )
  ) {
    throw new Error(
      '鍵の本文はパスとして使えません。秘密鍵ファイルのパスを入力するか、クリップボードを選んでください。',
    );
  }
  const filename = sourceName || (format === 'pgp' ? 'message.txt.asc' : 'message.txt.age');
  if (typeof filename !== 'string' || control.test(filename)) {
    throw new Error('ファイル名に制御文字は使えません。');
  }
  const quote =
    shell === 'posix'
      ? (value) => "'" + value.replace(/'/g, "'\\''") + "'"
      : (value) => "'" + value.replace(/['\u2018\u2019]/g, '$&$&') + "'";
  function path(value, label, home = false) {
    if (typeof value !== 'string' || !value.trim() || control.test(value)) {
      throw new Error(`${label}のパスを、空欄や制御文字を含まない形で入力してください。`);
    }
    if (shell === 'posix' && windowsPath.test(value)) {
      throw new Error('Windows のパスを使う場合は PowerShell を選んでください。');
    }
    if (home && value.startsWith('~/')) {
      return shell === 'posix'
        ? '"$HOME"/' + quote(value.slice(2))
        : `(Join-Path $HOME ${quote(value.slice(2))})`;
    }
    const absolute = shell === 'posix' ? value.startsWith('/') : /^(?:[a-z]:|[/\\])/i.test(value);
    return quote(absolute || /^\.\.?[/\\]/.test(value) ? value : './' + value);
  }
  // The source filename is kept verbatim; the editable execution path may differ.
  const input =
    inputSource === 'file' ? path(inputPath || filename, '暗号文', Boolean(inputPath)) : '';
  const key = keySource === 'file' ? path(identity, '秘密鍵', true) : '';
  if (shell === 'posix' && windowsPath.test(filename)) {
    throw new Error('Windows のパスを使う場合は PowerShell を選んでください。');
  }
  const temporaryKey = keySource === 'clipboard';
  const isolatedGpg = format === 'pgp' && keySource !== 'keyring';
  const temporary =
    isolatedGpg || temporaryKey || (shell === 'posix' && inputSource === 'clipboard');
  const decrypt =
    format === 'pgp'
      ? `gpg${isolatedGpg ? (shell === 'posix' ? ' --no-options --homedir "$fumi_tmp"' : ' --no-options --homedir $fumiTemp') : ''} --output restored --decrypt`
      : `age --decrypt --identity ${temporaryKey ? (shell === 'posix' ? '"$fumi_tmp/identity"' : '$fumiIdentity') : key} --output restored`;
  if (!temporary && !clipboard) return { format, filename, command: `${decrypt} ${input}` };

  if (shell === 'posix') {
    const lines = ['('];
    if (temporary) {
      lines.push(
        '  umask 077',
        '  fumi_tmp=$(mktemp -d /tmp/fumi-XXXXXXXX) || exit 1',
        '  fumi_cleanup() {',
        '    fumi_status=$?',
        '    trap - 0 HUP INT TERM',
        ...(isolatedGpg
          ? ['    gpgconf --homedir "$fumi_tmp" --kill gpg-agent >/dev/null 2>&1 || :']
          : []),
        '    rm -rf -- "$fumi_tmp"',
        '    exit "$fumi_status"',
        '  }',
        '  trap fumi_cleanup 0',
        "  trap 'exit 129' HUP",
        "  trap 'exit 130' INT",
        "  trap 'exit 143' TERM",
      );
    }
    const readClipboard = (prompt, target) =>
      lines.push(
        `  printf '%s\\n' ${quote(prompt)} >&2`,
        '  IFS= read -r fumi_enter || exit 1',
        `  ${clipboardCommands[clipboardTool]} > "${target}" || exit 1`,
      );
    if (temporaryKey) readClipboard(keyPrompt, '$fumi_tmp/identity');
    if (isolatedGpg) {
      lines.push(
        `  gpg --no-options --homedir "$fumi_tmp" --batch --import ${temporaryKey ? '"$fumi_tmp/identity"' : key} || exit $?`,
      );
    }
    if (inputSource === 'clipboard') {
      // Staging preserves bytes and catches clipboard failure before native decryption.
      readClipboard(cipherPrompt, '$fumi_tmp/ciphertext');
      lines.push(`  ${decrypt} < "$fumi_tmp/ciphertext"`);
    } else {
      lines.push(`  ${decrypt} ${input}`);
    }
    lines.push(')');
    return { format, filename, command: lines.join('\n') };
  }

  const lines = ['& {', "  $ErrorActionPreference = 'Stop'", '  $fumiTemp = $null', '  try {'];
  if (temporary) {
    lines.push(
      "    $fumiTemp = Join-Path ([System.IO.Path]::GetTempPath()) ('fumi-' + [guid]::NewGuid().ToString('N'))",
      '    $null = New-Item -ItemType Directory -Path $fumiTemp',
      '    $fumiAcl = Get-Acl -LiteralPath $fumiTemp',
      '    $fumiAcl.SetAccessRuleProtection($true, $false)',
      "    $fumiAcl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new([System.Security.Principal.WindowsIdentity]::GetCurrent().User, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))",
      '    Set-Acl -LiteralPath $fumiTemp -AclObject $fumiAcl',
    );
  }
  if (temporaryKey) {
    lines.push(
      `    $null = Read-Host ${quote(keyPrompt)}`,
      '    $fumiKey = Get-Clipboard -Raw -ErrorAction Stop',
      "    $fumiIdentity = Join-Path $fumiTemp 'identity'",
      '    [System.IO.File]::WriteAllText($fumiIdentity, $fumiKey, [System.Text.UTF8Encoding]::new($false))',
    );
  }
  if (isolatedGpg) {
    lines.push(
      `    gpg --no-options --homedir $fumiTemp --batch --import ${temporaryKey ? '$fumiIdentity' : key}`,
      "    if ($LASTEXITCODE -ne 0) { throw '秘密鍵の読み込みに失敗しました。' }",
    );
  }
  if (inputSource === 'clipboard') {
    lines.push(
      `    $null = Read-Host ${quote(cipherPrompt)}`,
      '    $fumiCipher = Get-Clipboard -Raw -ErrorAction Stop',
      `    $fumiCipher | ${decrypt}`,
    );
  } else {
    lines.push(`    ${decrypt} ${input}`);
  }
  lines.push(
    "    if ($LASTEXITCODE -ne 0) { throw '復号に失敗しました。' }",
    '  } finally {',
    '    if ($null -ne $fumiTemp) {',
    ...(isolatedGpg
      ? [
          '      try {',
          '        gpgconf --homedir $fumiTemp --kill gpg-agent 2>$null',
          '      } finally {',
          '        Remove-Item -LiteralPath $fumiTemp -Recurse -Force',
          '      }',
        ]
      : ['      Remove-Item -LiteralPath $fumiTemp -Recurse -Force']),
    '    }',
    '  }',
    '}',
  );
  return { format, filename, command: lines.join('\n') };
}
