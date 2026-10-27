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

## ビルドと配信

`scripts/build.mjs` は同じソースから2種類を生成します。

1. **Web版**：`.generated/web.html` と `public/assets/crypto-worker-[hash].js`。画面は小さく、暗号処理の初回にWorkerを読み込みます。画面CSPは通信・Workerを同一オリジンに限定し、WorkerのCSPは外部通信を禁止します。ハッシュ付きWorkerを長期キャッシュし、古いコードと新しいコードの混在を避けます。
2. **単一HTML版**：`index.html`。Worker・WASM・CSS・JavaScript・ライセンスを内包し、ファイルを直接開けます。公開鍵の自動取得だけはGitHub REST APIを使用します。

いずれも画面のインラインCSS/JavaScriptにはSHA-256のCSPハッシュを設定します。Next.jsのファイルトレースは生成Web HTMLを明示的に含めます。生成物、使い捨て鍵、テスト結果、ローカル認証設定はリポジトリとVercelアップロードの両方から除外します。

## 互換性

プロダクト表示はFumiですが、署名済みメタデータの `identity@dgpg.local`、SSHSIG名前空間 `dgpg`、ZIPの `dgpg-signed-v1/v2` は互換性のため変更しません。暗号処理の整理では、既存の署名検証・エラー処理・バイト列・保存名を維持します。

アプリの暗号化は署名を作成しません。旧版の署名付きデータを生成する処理は、開発用の `scripts/legacy-encryption.mjs` と互換性テストからだけ使用します。製品Workerにはこのヘルパーを取り込みません。
