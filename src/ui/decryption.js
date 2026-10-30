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
      fumi_file=0
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
        *)
          fumi_path=$fumi_line
          case "$fumi_path" in
            \"*\"|\'*\') fumi_path=$(printf '%s' "$fumi_path" | sed 's/^.//; s/.$//') ;;
          esac
          case "$fumi_path" in '~/'*) fumi_path=$HOME/$(printf '%s' "$fumi_path" | cut -c 3-) ;; esac
          if [ -f "$fumi_path" ] && [ -r "$fumi_path" ]; then
            cat < "$fumi_path" > "$2" || exit $?
            fumi_file=1
          fi ;;
      esac
      if [ -n "$fumi_tty" ]; then stty "$fumi_tty"; fumi_tty=; fi
      grep -aEq "$3" "$2" && return 0
      if [ "$fumi_file" = 1 ]; then
        fumi_byte=$(od -An -tu1 -N1 "$2" | tr -d '[:space:]')
        case "$4:$fumi_byte" in
          cipher:132|cipher:133|cipher:134|cipher:135|cipher:140|cipher:141|cipher:142|cipher:143|cipher:193|cipher:195|pgp-key:148|pgp-key:149|pgp-key:150|pgp-key:151|pgp-key:156|pgp-key:157|pgp-key:158|pgp-key:159|pgp-key:197|pgp-key:199) return 0 ;;
        esac
      fi
      printf '%s\n' '内容やファイルを確認して、もう一度貼り付けてください。' >&2
    done
  }
  fumi_read '暗号文を貼り付けるか、ファイルパスを入力してください。' "$fumi_tmp/cipher" '^-----BEGIN (PGP MESSAGE|AGE ENCRYPTED FILE)-----|^age-encryption.org/v1' cipher
  fumi_cipher_file=$fumi_file
  if ! grep -aqE '^-----BEGIN AGE ENCRYPTED FILE-----|^age-encryption.org/v1' "$fumi_tmp/cipher"; then
    command -v gpg >/dev/null 2>&1 || { printf '%s\n' 'gpg が必要です。' >&2; exit 1; }
    fumi_read '秘密鍵を貼り付けるか、ファイルパスを入力してください。' "$fumi_tmp/key" '^-----BEGIN PGP PRIVATE KEY BLOCK-----' pgp-key
    if [ -t 0 ]; then GPG_TTY=$(tty); export GPG_TTY; fi
    gpg --no-options --homedir "$fumi_tmp" --quiet --batch --import "$fumi_tmp/key" || exit $?
    gpg --no-options --homedir "$fumi_tmp" --quiet --output "$fumi_tmp/plaintext" --decrypt "$fumi_tmp/cipher" || exit $?
  else
    command -v age >/dev/null 2>&1 || { printf '%s\n' 'age が必要です。' >&2; exit 1; }
    fumi_read '秘密鍵を貼り付けるか、ファイルパスを入力してください。' "$fumi_tmp/key" '^-----BEGIN (OPENSSH |RSA |EC |ENCRYPTED )?PRIVATE KEY-----|^AGE-SECRET-KEY-1' age-key
    : > "$fumi_tmp/plaintext" || exit 1
    age --decrypt --identity "$fumi_tmp/key" --output "$fumi_tmp/plaintext" "$fumi_tmp/cipher" || exit $?
  fi
  if [ "$fumi_cipher_file" = 0 ] && iconv -f UTF-8 -t UTF-8 "$fumi_tmp/plaintext" >/dev/null 2>&1 &&
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
  function Read-FumiBlock([string]$prompt, [string]$expected, [int[]]$packetTags = @()) {
    do {
      $first = Read-FumiLine $prompt
      $value = $first
      $fromFile = $false
      if ($first -match '^-----BEGIN .+-----$') {
        $end = $first.Replace('BEGIN ', 'END ')
        do {
          $line = Read-FumiLine ''
          $value += [Environment]::NewLine + $line
        } while ($line -ne $end)
      } else {
        $path = $first
        if ($path.Length -ge 2 -and (($path.StartsWith('"') -and $path.EndsWith('"')) -or ($path.StartsWith("'") -and $path.EndsWith("'")))) {
          $path = $path.Substring(1, $path.Length - 2)
        }
        if ($path.StartsWith('~/') -or $path.StartsWith('~\')) { $path = Join-Path $HOME $path.Substring(2) }
        if (Test-Path -LiteralPath $path -PathType Leaf -ErrorAction SilentlyContinue) {
          $bytes = [IO.File]::ReadAllBytes((Get-Item -LiteralPath $path).FullName)
          $value = [Text.Encoding]::ASCII.GetString($bytes)
          $fromFile = $true
        }
      }
      if (-not $fromFile) { $bytes = [Text.UTF8Encoding]::new($false).GetBytes($value) }
      if ($value -match $expected -or ($fromFile -and $bytes.Length -gt 0 -and $bytes[0] -in $packetTags)) {
        return [pscustomobject]@{ Bytes = $bytes; FromFile = $fromFile }
      }
      Write-Warning '内容やファイルを確認して、もう一度貼り付けてください。'
    } while ($true)
  }
  try {
    $fumiTemp = Join-Path ([IO.Path]::GetTempPath()) ('fumi-' + [guid]::NewGuid().ToString('N'))
    $null = New-Item -ItemType Directory -Path $fumiTemp
    $acl = Get-Acl -LiteralPath $fumiTemp
    $acl.SetAccessRuleProtection($true, $false)
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.WindowsIdentity]::GetCurrent().User, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
    Set-Acl -LiteralPath $fumiTemp -AclObject $acl
    $cipher = Read-FumiBlock '暗号文を貼り付けるか、ファイルパスを入力してください。' '^-----BEGIN (PGP MESSAGE|AGE ENCRYPTED FILE)-----|^age-encryption.org/v1' @(132,133,134,135,140,141,142,143,193,195)
    $prefix = [Text.Encoding]::ASCII.GetString($cipher.Bytes, 0, [Math]::Min(80, $cipher.Bytes.Length))
    $pgp = $prefix -notmatch '^-----BEGIN AGE ENCRYPTED FILE-----|^age-encryption.org/v1'
    $tool = if ($pgp) { 'gpg' } else { 'age' }
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool が必要です。" }
    $expected = if ($pgp) { '^-----BEGIN PGP PRIVATE KEY BLOCK-----' } else { '(?m)^-----BEGIN (OPENSSH |RSA |EC |ENCRYPTED )?PRIVATE KEY-----|^AGE-SECRET-KEY-1' }
    $tags = if ($pgp) { @(148,149,150,151,156,157,158,159,197,199) } else { @() }
    $key = Read-FumiBlock '秘密鍵を貼り付けるか、ファイルパスを入力してください。' $expected $tags
    $cipherPath = Join-Path $fumiTemp 'cipher'
    $keyPath = Join-Path $fumiTemp 'key'
    $plainPath = Join-Path $fumiTemp 'plaintext'
    [IO.File]::WriteAllBytes($cipherPath, $cipher.Bytes)
    [IO.File]::WriteAllBytes($keyPath, $key.Bytes)
    if ($pgp) {
      gpg --no-options --homedir $fumiTemp --quiet --batch --import $keyPath
      if ($LASTEXITCODE -ne 0) { throw '秘密鍵を読み込めませんでした。' }
      gpg --no-options --homedir $fumiTemp --quiet --output $plainPath --decrypt $cipherPath
    } else {
      [IO.File]::WriteAllBytes($plainPath, [byte[]]@())
      age --decrypt --identity $keyPath --output $plainPath $cipherPath
    }
    if ($LASTEXITCODE -ne 0) { throw '復号できませんでした。' }
    $bytes = [IO.File]::ReadAllBytes($plainPath)
    $text = $null
    try { $text = [Text.UTF8Encoding]::new($false, $true).GetString($bytes) }
    catch [Text.DecoderFallbackException] {}
    if (-not $cipher.FromFile -and $null -ne $text -and $text -notmatch '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]') {
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
