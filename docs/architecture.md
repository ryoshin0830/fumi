# アーキテクチャ

FumiはNext.jsのRoute Handlersで配信するHTMLアプリです。入力状態とDOM操作はブラウザが持ち、暗号処理は専用Worker、外部公開鍵取得はサーバーが担当します。

| 場所                                  | 責任                                           | 扱うデータ                 |
| ------------------------------------- | ---------------------------------------------- | -------------------------- |
| `src/app.js`                          | 入力状態、操作の開始・中止、イベント処理       | タブ内の入力と結果         |
| `src/ui/`                             | 結果・署名の表示、共通の表示ヘルパー           | 渡された結果、表示モード   |
| `src/recipients.js`                   | 公開鍵取得、短期キャッシュ、制限時の再試行待ち | GitHubユーザー名、公開鍵   |
| `src/worker-client.js`                | Workerの起動、ジョブ応答、終了                 | 端末内のメッセージ         |
| `src/crypto-worker.js`                | 暗号処理の入口                                 | 本文・ファイル・鍵         |
| `src/pgp.js`, `src/native-pgp.js`     | OpenPGP暗号化・復号・標準署名                  | Worker内のデータ           |
| `src/age.js`, `crypto/age/`           | ageとOpenSSH署名のGo/WASMブリッジ              | Worker内のデータ           |
| `src/signatures.js`, `src/decrypt.js` | 署名同封ZIP・整合性検証・元データ復元          | Worker内のデータ           |
| `app/route.js`                        | 生成HTMLとCSPの配信                            | 入力データを受け取らない   |
| `server/github-keys.mjs`              | GitHub公開ページの限定取得                     | GitHubユーザー名と鍵の種類 |

## 公開鍵API

`GET /api/github-keys/{username}?type=pgp|ssh` のみを受け付けます。ユーザー名・クエリを検証し、取得先は `https://github.com/{username}.gpg` または `.keys` に固定します。本文・任意URL・Cookie・認証ヘッダーを転送しません。リダイレクト禁止、15秒・1 MiB上限、no-storeで処理します。

送信先の選択ではタブ内で1分だけ公開鍵を再利用します。署名付き受信データのGitHub照合ではキャッシュを使わず、毎回現在の公開鍵を取得します。取得失敗で署名を無効化したり、古い鍵を現在の鍵として扱ったりしません。

## 公開プロフィールとアイコン

宛先の有効な入力から450ms後に、公開プロフィールと登録公開鍵を並行して取得します。`GET /api/github-profile/{username}` はプロフィール用です。サーバーは固定先 `https://api.github.com/users/{username}` だけを取得し、入力と一致するlogin・安全な数値ID・上限付きの名前とbioだけを返します。アイコンは `GET /api/github-avatar/{id}` が固定の `avatars.githubusercontent.com/u/{id}?s=96&v=4` から取得します。Cookie・認証ヘッダー・本文は転送しません。

両方とも8秒の期限とno-storeを使い、プロフィールは64 KiB、PNG/JPEG/WebP/GIF画像は256 KiBまでです。画像の任意URLやSVGは受け付けません。入力変更・手動公開鍵・モード変更・消去では保留中のプロフィール取得を中止し、遅い応答を表示しません。プロフィール取得失敗は暗号化を止めず、表示された人物情報を暗号鍵の確認として扱いません。

`src/profiles.js` が取得と応答検証、`src/ui/recipient.js` が入力変更と表示を扱います。`src/ui/motion.js` は固定例文だけで装飾演出を行い、本文や秘密鍵を受け取りません。結果の取得・表示は演出の終了を待ちません。

## ビルドと配信

`scripts/build.mjs` は同じソースから2種類を生成します。

1. **Web版**：`.generated/web.html` と `public/assets/crypto-worker-[hash].js`。画面は小さく、暗号処理の初回にWorkerを読み込みます。画面CSPは通信・Worker・アイコン画像を同一オリジンに限定し、WorkerのCSPは外部通信を禁止します。ハッシュ付きWorkerを長期キャッシュし、古いコードと新しいコードの混在を避けます。
2. **単一HTML版**：`index.html`。Worker・WASM・CSS・JavaScript・ライセンスを内包し、ファイルを直接開けます。公開鍵とプロフィールの自動取得にはGitHub REST APIを使用し、アイコンは頭文字で代替します。

いずれも画面のインラインCSS/JavaScriptにはSHA-256のCSPハッシュを設定します。Next.jsのファイルトレースは生成Web HTMLを明示的に含めます。生成物、使い捨て鍵、テスト結果、ローカル認証設定はリポジトリとVercelアップロードの両方から除外します。

## 互換性

プロダクト表示はFumiですが、署名済みメタデータの `identity@dgpg.local`、SSHSIG名前空間 `dgpg`、ZIPの `dgpg-signed-v1/v2` は互換性のため変更しません。暗号処理の整理では、既存の署名検証・エラー処理・バイト列・保存名を維持します。

アプリの暗号化は署名を作成しません。旧版の署名付きデータを生成する処理は、開発用の `scripts/legacy-encryption.mjs` と互換性テストからだけ使用します。製品Workerにはこのヘルパーを取り込みません。

## 条件付き入力

暗号文と秘密鍵の入力が600ms落ち着くと、ブラウザ内で復号を一度試します。GPGの既存の解除処理とGoのSSH秘密鍵パーサーで保護を検出し、`PASSPHRASE_REQUIRED` をWorkerクライアントまで維持してパスワード欄を開きます。エラーメッセージの文言からの推測や、すべての失敗をパスワード要求として扱う処理はありません。

入力の変更・中止・消去・モード切替は保留中の自動確認を止めます。取り消したファイル読込の遅い完了も、自動復号を再開しません。Editは再送信せず、パスワードの入力中にも自動試行しません。
