const posix = String.raw`(
  umask 077
  fumi_tmp=$(mktemp -d /tmp/fumi-XXXXXXXX) || exit 1
  fumi_tty=
  fumi_cleanup() {
    fumi_status=$?
    trap - 0 HUP INT TERM
    if [ -n "$fumi_tty" ]; then stty "$fumi_tty" 2>/dev/null || :; fi
    if command -v gpgconf >/dev/null 2>&1; then gpgconf --homedir "$fumi_tmp" --kill gpg-agent >/dev/null 2>&1 || :; fi
    rm -rf -- "$fumi_tmp"
    exit "$fumi_status"
  }
  trap fumi_cleanup 0
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM
  fumi_read() {
    while :; do
      if [ -t 0 ]; then fumi_tty=$(stty -g) || exit 1; stty -echo || exit 1; fi
      printf '%s\n' "$1" >&2
      fumi_line=
      IFS= read -r fumi_line || exit 1
      printf '%s\n' "$fumi_line" > "$2"
      case "$fumi_line" in
        '-----BEGIN '*'-----')
          fumi_end=$(printf '%s' "$fumi_line" | sed 's/BEGIN /END /')
          while IFS= read -r fumi_line; do
            printf '%s\n' "$fumi_line" >> "$2"
            [ "$fumi_line" != "$fumi_end" ] || break
          done
          [ "$fumi_line" = "$fumi_end" ] || exit 1 ;;
      esac
      if [ -n "$fumi_tty" ]; then stty "$fumi_tty"; fumi_tty=; fi
      grep -aEq "$3" "$2" && return 0
      printf '%s\n' '内容を確認して、もう一度貼り付けてください。' >&2
    done
  }
  fumi_read '暗号文を貼り付けてください。' "$fumi_tmp/cipher" '^-----BEGIN (PGP MESSAGE|AGE ENCRYPTED FILE)-----'
  if grep -aq '^-----BEGIN PGP MESSAGE-----' "$fumi_tmp/cipher"; then
    command -v gpg >/dev/null 2>&1 || { printf '%s\n' 'gpg が必要です。' >&2; exit 1; }
    fumi_read '秘密鍵を貼り付けてください。' "$fumi_tmp/key" '^-----BEGIN PGP PRIVATE KEY BLOCK-----'
    if [ -t 0 ]; then GPG_TTY=$(tty); export GPG_TTY; fi
    gpg --no-options --homedir "$fumi_tmp" --quiet --batch --import "$fumi_tmp/key" || exit $?
    gpg --no-options --homedir "$fumi_tmp" --quiet --output "$fumi_tmp/plaintext" --decrypt "$fumi_tmp/cipher" || exit $?
  else
    command -v age >/dev/null 2>&1 || { printf '%s\n' 'age が必要です。' >&2; exit 1; }
    fumi_read '秘密鍵を貼り付けてください。' "$fumi_tmp/key" '^-----BEGIN (OPENSSH |RSA |EC |ENCRYPTED )?PRIVATE KEY-----|^AGE-SECRET-KEY-1'
    age --decrypt --identity "$fumi_tmp/key" --output "$fumi_tmp/plaintext" "$fumi_tmp/cipher" || exit $?
  fi
  if iconv -f UTF-8 -t UTF-8 "$fumi_tmp/plaintext" >/dev/null 2>&1 &&
     ! LC_ALL=C tr -d '\11\12\15' < "$fumi_tmp/plaintext" | LC_ALL=C grep -aEq "[[:cntrl:]]|$(printf '\302[\200-\237]')"; then
    printf '\n復号した内容:\n' >&2
    cat "$fumi_tmp/plaintext" || exit $?
    printf '\n' >&2
  else
    fumi_output=$(mktemp ./restored-XXXXXXXX) || exit 1
    cat "$fumi_tmp/plaintext" > "$fumi_output" || { rm -f -- "$fumi_output"; exit 1; }
    printf 'ファイルに保存しました: %s\n' "$fumi_output"
  fi
)`;

const powershell = String.raw`& {
  $ErrorActionPreference = 'Stop'
  $fumiTemp = $null
  function Read-FumiLine([string]$prompt) {
    $value = Read-Host $prompt -AsSecureString
    try { return [pscredential]::new('fumi', $value).GetNetworkCredential().Password }
    finally { $value.Dispose() }
  }
  function Read-FumiBlock([string]$prompt, [string]$expected) {
    do {
      $first = Read-FumiLine $prompt
      $value = $first
      if ($first -match '^-----BEGIN .+-----$') {
        $end = $first.Replace('BEGIN ', 'END ')
        do {
          $line = Read-FumiLine ''
          $value += [Environment]::NewLine + $line
        } while ($line -ne $end)
      }
      if ($value -match $expected) { return $value }
      Write-Warning '内容を確認して、もう一度貼り付けてください。'
    } while ($true)
  }
  try {
    $fumiTemp = Join-Path ([IO.Path]::GetTempPath()) ('fumi-' + [guid]::NewGuid().ToString('N'))
    $null = New-Item -ItemType Directory -Path $fumiTemp
    $acl = Get-Acl -LiteralPath $fumiTemp
    $acl.SetAccessRuleProtection($true, $false)
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.WindowsIdentity]::GetCurrent().User, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
    Set-Acl -LiteralPath $fumiTemp -AclObject $acl
    $cipher = Read-FumiBlock '暗号文を貼り付けてください。' '^-----BEGIN (PGP MESSAGE|AGE ENCRYPTED FILE)-----'
    $pgp = $cipher.StartsWith('-----BEGIN PGP MESSAGE-----')
    $tool = if ($pgp) { 'gpg' } else { 'age' }
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool が必要です。" }
    $expected = if ($pgp) { '^-----BEGIN PGP PRIVATE KEY BLOCK-----' } else { '^-----BEGIN (OPENSSH |RSA |EC |ENCRYPTED )?PRIVATE KEY-----|^AGE-SECRET-KEY-1' }
    $key = Read-FumiBlock '秘密鍵を貼り付けてください。' $expected
    $cipherPath = Join-Path $fumiTemp 'cipher'
    $keyPath = Join-Path $fumiTemp 'key'
    $plainPath = Join-Path $fumiTemp 'plaintext'
    [IO.File]::WriteAllText($cipherPath, $cipher, [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText($keyPath, $key, [Text.UTF8Encoding]::new($false))
    if ($pgp) {
      gpg --no-options --homedir $fumiTemp --quiet --batch --import $keyPath
      if ($LASTEXITCODE -ne 0) { throw '秘密鍵を読み込めませんでした。' }
      gpg --no-options --homedir $fumiTemp --quiet --output $plainPath --decrypt $cipherPath
    } else {
      age --decrypt --identity $keyPath --output $plainPath $cipherPath
    }
    if ($LASTEXITCODE -ne 0) { throw '復号できませんでした。' }
    $bytes = [IO.File]::ReadAllBytes($plainPath)
    $text = $null
    try { $text = [Text.UTF8Encoding]::new($false, $true).GetString($bytes) }
    catch [Text.DecoderFallbackException] {}
    if ($null -ne $text -and $text -notmatch '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]') {
      [Console]::Error.WriteLine('復号した内容:')
      [Console]::Out.Write($text)
      [Console]::Error.WriteLine()
    } else {
      $destination = Join-Path (Get-Location).Path ('restored-' + [guid]::NewGuid().ToString('N'))
      $file = [IO.File]::Open($destination, 'CreateNew', 'Write')
      try { $file.Write($bytes, 0, $bytes.Length) } finally { $file.Dispose() }
      Write-Host "ファイルに保存しました: $destination"
    }
  } finally {
    if ($null -ne $fumiTemp) {
      try { if (Get-Command gpgconf -ErrorAction SilentlyContinue) { gpgconf --homedir $fumiTemp --kill gpg-agent 2>$null } }
      finally { Remove-Item -LiteralPath $fumiTemp -Recurse -Force }
    }
  }
}`;

export function createDecryptionCommand(shell = 'posix') {
  if (shell === 'posix') return posix;
  if (shell === 'powershell') return powershell;
  throw new Error('実行する環境は POSIX または PowerShell です。');
}
