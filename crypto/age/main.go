//go:build js && wasm

package main

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rsa"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"syscall/js"

	"filippo.io/age"
	"filippo.io/age/agessh"
	"filippo.io/age/armor"
	"github.com/hiddeco/sshsig"
	"golang.org/x/crypto/ssh"
)

const (
	maxPlain     = 50 * 1024 * 1024
	maxContainer = 52 * 1024 * 1024
	maxEncrypted = 72 * 1024 * 1024
	maxKey       = 1024 * 1024
)

func failure(message string) map[string]any { return map[string]any{"error": message} }

func inputBytes(value js.Value, limit int) ([]byte, error) {
	n := value.Get("byteLength").Int()
	if n > limit {
		return nil, errors.New("入力サイズが上限を超えています。")
	}
	b := make([]byte, n)
	js.CopyBytesToGo(b, value)
	return b, nil
}

func outputBytes(b []byte) js.Value {
	value := js.Global().Get("Uint8Array").New(len(b))
	js.CopyBytesToJS(value, b)
	return value
}

func recipient(publicKey string) (age.Recipient, ssh.PublicKey, error) {
	if len(publicKey) > maxKey {
		return nil, nil, errors.New("鍵は 1 MiB 以下にしてください。")
	}
	key, _, _, rest, err := ssh.ParseAuthorizedKey([]byte(publicKey))
	if err != nil || len(bytes.TrimSpace(rest)) != 0 {
		return nil, nil, errors.New("SSH 公開鍵の形式が正しくありません。")
	}
	var r age.Recipient
	switch key.Type() {
	case "ssh-ed25519":
		r, err = agessh.NewEd25519Recipient(key)
	case "ssh-rsa":
		r, err = agessh.NewRSARecipient(key)
	default:
		return nil, nil, errors.New("対応する SSH 公開鍵は Ed25519 と RSA です。")
	}
	if err != nil {
		return nil, nil, errors.New("SSH 公開鍵を利用できません。RSA は 2048 ビット以上が必要です。")
	}
	return r, key, nil
}

func inspect(_ js.Value, args []js.Value) any {
	_, key, err := recipient(args[0].String())
	if err != nil {
		return failure(err.Error())
	}
	return map[string]any{"type": key.Type(), "fingerprint": ssh.FingerprintSHA256(key)}
}

type boundedBuffer struct{ bytes.Buffer }

func (b *boundedBuffer) Write(p []byte) (int, error) {
	if len(p) > maxEncrypted-b.Len() {
		return 0, errors.New("暗号化結果は 72 MiB 以下にしてください。")
	}
	return b.Buffer.Write(p)
}

func encrypt(_ js.Value, args []js.Value) any {
	input := args[0]
	limit := plaintextLimit(input)
	data, err := inputBytes(input.Get("data"), limit)
	if err != nil {
		return failure(fmt.Sprintf("平文は %d MiB 以下にしてください。", limit/1024/1024))
	}
	defer clear(data)
	list := input.Get("recipients")
	if list.Length() == 0 {
		return failure("SSH 公開鍵を選択してください。")
	}
	recipients := make([]age.Recipient, 0, list.Length())
	total := 0
	for n := 0; n < list.Length(); n++ {
		value := list.Index(n).String()
		total += len(value)
		if total > maxKey {
			return failure("公開鍵の合計は 1 MiB 以下にしてください。")
		}
		r, _, err := recipient(value)
		if err != nil {
			return failure(err.Error())
		}
		recipients = append(recipients, r)
	}
	var buf boundedBuffer
	var destination io.Writer = &buf
	var armored io.WriteCloser
	if input.Get("armored").Bool() {
		armored = armor.NewWriter(&buf)
		destination = armored
	}
	w, err := age.Encrypt(destination, recipients...)
	if err == nil {
		_, err = w.Write(data)
	}
	if err == nil {
		err = w.Close()
	}
	if err == nil && armored != nil {
		err = armored.Close()
	}
	if err != nil {
		return failure("age の暗号化に失敗しました。入力と公開鍵を確認してください。")
	}
	return map[string]any{"bytes": outputBytes(buf.Bytes())}
}

func privateKey(privateKey, passphrase string) (any, error) {
	if len(privateKey) > maxKey || len(passphrase) > maxKey {
		return nil, errors.New("秘密鍵とパスフレーズは 1 MiB 以下にしてください。")
	}
	encoded := []byte(privateKey)
	defer clear(encoded)
	key, err := ssh.ParseRawPrivateKey(encoded)
	var missing *ssh.PassphraseMissingError
	if errors.As(err, &missing) {
		if passphrase == "" {
			return nil, errors.New("秘密鍵のパスフレーズを入力してください。")
		}
		password := []byte(passphrase)
		defer clear(password)
		key, err = ssh.ParseRawPrivateKeyWithPassphrase(encoded, password)
		if err != nil {
			return nil, errors.New("パスフレーズが正しくないか、秘密鍵が破損しています。")
		}
	}
	if err != nil {
		return nil, errors.New("SSH 秘密鍵を読み込めません。OpenSSH または PEM 形式を確認してください。")
	}
	return key, nil
}

func identity(encoded, passphrase string) (age.Identity, error) {
	key, err := privateKey(encoded, passphrase)
	if err != nil {
		return nil, err
	}
	switch k := key.(type) {
	case *rsa.PrivateKey:
		return agessh.NewRSAIdentity(k)
	case *ed25519.PrivateKey:
		return agessh.NewEd25519Identity(*k)
	case ed25519.PrivateKey:
		return agessh.NewEd25519Identity(k)
	default:
		return nil, errors.New("対応する SSH 秘密鍵は Ed25519 と RSA です。")
	}
}

func signingKey(encoded, passphrase string) (ssh.Signer, error) {
	key, err := privateKey(encoded, passphrase)
	if err != nil {
		return nil, err
	}
	switch key.(type) {
	case *rsa.PrivateKey, *ed25519.PrivateKey, ed25519.PrivateKey:
	default:
		return nil, errors.New("対応する SSH 秘密鍵は Ed25519 と RSA です。")
	}
	signer, err := ssh.NewSignerFromKey(key)
	if err != nil {
		return nil, errors.New("SSH 署名鍵を読み込めません。")
	}
	if _, _, err := recipient(string(ssh.MarshalAuthorizedKey(signer.PublicKey()))); err != nil {
		return nil, err
	}
	return signer, nil
}

func signingMetadata(key ssh.PublicKey) map[string]any {
	return map[string]any{"publicKey": string(bytes.TrimSpace(ssh.MarshalAuthorizedKey(key))), "fingerprint": ssh.FingerprintSHA256(key), "type": key.Type()}
}

func getSigningKey(_ js.Value, args []js.Value) any {
	input := args[0]
	signer, err := signingKey(input.Get("privateKey").String(), input.Get("passphrase").String())
	if err != nil {
		return failure(err.Error())
	}
	return signingMetadata(signer.PublicKey())
}

func sign(_ js.Value, args []js.Value) any {
	input := args[0]
	data, err := inputBytes(input.Get("data"), maxContainer)
	if err != nil {
		return failure("署名対象は 52 MiB 以下にしてください。")
	}
	defer clear(data)
	signer, err := signingKey(input.Get("privateKey").String(), input.Get("passphrase").String())
	if err != nil {
		return failure(err.Error())
	}
	sig, err := sshsig.Sign(bytes.NewReader(data), signer, sshsig.HashSHA512, "dgpg")
	if err != nil {
		return failure("SSH 署名を作成できません。秘密鍵を確認してください。")
	}
	result := signingMetadata(signer.PublicKey())
	result["signature"] = string(sshsig.Armor(sig))
	return result
}

func verify(_ js.Value, args []js.Value) any {
	input := args[0]
	data, err := inputBytes(input.Get("data"), maxContainer)
	if err != nil {
		return failure("署名対象は 52 MiB 以下にしてください。")
	}
	defer clear(data)
	_, key, err := recipient(input.Get("publicKey").String())
	if err != nil {
		return failure(err.Error())
	}
	encoded := input.Get("signature").String()
	if len(encoded) > maxKey {
		return failure("署名は 1 MiB 以下にしてください。")
	}
	block, rest := pem.Decode([]byte(encoded))
	if block == nil || block.Type != sshsig.PEMType || len(bytes.TrimSpace(rest)) != 0 {
		return failure("SSH 署名の形式が正しくありません。")
	}
	sig, err := sshsig.ParseSignature(block.Bytes)
	if err != nil || sig.HashAlgorithm != sshsig.HashSHA512 {
		return failure("SSH 署名の形式またはハッシュ方式が正しくありません。")
	}
	if err := sshsig.Verify(bytes.NewReader(data), sig, key, sshsig.HashSHA512, "dgpg"); err != nil {
		return failure("SSH 署名を検証できません。データ・公開鍵・署名が一致しません。")
	}
	return map[string]any{"fingerprint": ssh.FingerprintSHA256(key), "type": key.Type()}
}

func plaintextLimit(input js.Value) int {
	if input.Get("container").Truthy() {
		return maxContainer
	}
	return maxPlain
}

func decrypt(_ js.Value, args []js.Value) any {
	input := args[0]
	data, err := inputBytes(input.Get("data"), maxEncrypted)
	if err != nil {
		return failure("暗号化ファイルは 72 MiB 以下にしてください。")
	}
	i, err := identity(input.Get("privateKey").String(), input.Get("passphrase").String())
	if err != nil {
		return failure(err.Error())
	}
	var source io.Reader = bytes.NewReader(data)
	if bytes.HasPrefix(bytes.TrimSpace(data), []byte(armor.Header)) {
		source = armor.NewReader(source)
	}
	r, err := age.Decrypt(source, i)
	if err != nil {
		return failure("age を復号できません。秘密鍵が一致しないか、ファイルが破損しています。")
	}
	limit := plaintextLimit(input)
	plaintext, err := io.ReadAll(io.LimitReader(r, int64(limit)+1))
	defer clear(plaintext)
	if err != nil {
		return failure("age の復号に失敗しました。ファイルが破損・改変されている可能性があります。")
	}
	if len(plaintext) > limit {
		return failure(fmt.Sprintf("復号結果は %d MiB 以下にしてください。", limit/1024/1024))
	}
	return map[string]any{"bytes": outputBytes(plaintext)}
}

func guarded(fn func(js.Value, []js.Value) any) js.Func {
	return js.FuncOf(func(this js.Value, args []js.Value) (result any) {
		defer func() {
			if recover() != nil {
				result = failure("age の処理に失敗しました。入力形式を確認してください。")
			}
		}()
		return fn(this, args)
	})
}

func main() {
	js.Global().Set("__dgpgAgeBridge", map[string]any{
		"inspect": guarded(inspect), "encrypt": guarded(encrypt), "decrypt": guarded(decrypt),
		"signingKey": guarded(getSigningKey), "sign": guarded(sign), "verify": guarded(verify),
	})
	select {}
}
