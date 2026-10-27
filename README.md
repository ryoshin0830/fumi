# Fumi

**安全に渡す。手元で開く。**

[アプリを開く](https://fumi-delta.vercel.app/)

GitHubの公開鍵でテキストやファイルを暗号化し、秘密鍵で復号するツールです。OpenPGP・SSH/ageに対応し、GitHubの現在の登録公開鍵による署名者の照合もできます。

**秘密鍵・パスフレーズ・本文・ファイルをサーバーへ送信しません。** 暗号処理はブラウザのWeb Worker内で実行します。Next.jsサーバーは、GitHubユーザー名と鍵の種類を受け取り、公開されている `.gpg` / `.keys` を取得します。

## 起動

Node.js 24を使用します。通常ビルドにはGoやGPGは不要です。

```sh
npm ci
npm run build
npm start
```

<http://127.0.0.1:3000/> を開きます。開発用は `npm run dev`。HTML/CSS/JavaScriptを変更した場合は `npm run build:client` で画面を再生成します。

## 使い方

- **暗号化して渡す**：内容を選ぶ → 相手のGitHubユーザー名・公開鍵を指定 → 内容を確認して作成 → コピー・保存して相手に渡す。
- **受け取って開く**：暗号文またはファイル → 自分の秘密鍵・必要なパスワード → 元の内容を表示・保存。
- **送り主の証明（署名）**：確認ステップで必要な場合だけオンにし、自分のGitHubユーザー名と署名用秘密鍵を指定します。暗号化時と復号時に、現在そのアカウントに公開されている鍵と照合します。

| 相手の公開鍵               | 暗号化形式 | 相手が使うもの                           |
| -------------------------- | ---------- | ---------------------------------------- |
| `github.com/username.gpg`  | OpenPGP    | このアプリ、またはGPGと対応する秘密鍵    |
| `github.com/username.keys` | age        | このアプリ、またはageと対応するSSH秘密鍵 |

ユーザー名、`@username`、プロフィールURL、`.gpg` / `.keys` URL、公開鍵の直接入力・ファイル選択に対応します。SSHはEd25519とRSAに対応。**ageはGPGとは別形式です。** OpenPGP鍵同士の署名はGPG標準形式。それ以外の署名同封は、復号後にZIPを展開して元ファイルと署名を取り出します。

暗号化と復号には対等な入口があり、一度に1つの手順を表示します。戻る・操作の切り替えでも入力は保持されます。鍵の詳細や形式選択は必要なときだけ展開できます。結果では暗号文・技術情報を初期状態で閉じ、復元したテキストはすぐ表示します。「この入力をクリア」は現在の画面、「すべて消去」は両画面の入力・鍵・結果を消去します。「サンプル」では使い捨て鍵で試せます。

## プライバシーと制限

- 暗号処理・署名の整合性検証はブラウザ内です。サーバーへの操作時リクエストは、公開鍵取得用のGETだけです。
- GitHub REST APIを使わず、サーバーが `.gpg` / `.keys` を直接取得します。GitHubの公開ページ自体に制限がある場合は、公開鍵の手動取込を案内します。
- 鍵や履歴を永続保存しません。外部フォント・解析・CDNライブラリは使用しません。Workerも同じホストから配信します。
- GitHubとの一致は、そのアカウントの現在の登録鍵との対応を示します。実在人物の身元を保証するものではありません。
- 元データは50 MiB、暗号文は72 MiB、鍵は合計1 MiBまで。対応鍵・署名・外部ツールでの開き方の詳細は[暗号処理の仕様](docs/cryptography.md)を参照してください。

## 開発・検証

```sh
npm run format:check
npm run build
npm test
npm run test:cli
```

テストにはOpenSSHの `ssh-keygen` とGo 1.27.3以降、CLI互換性検証にはGnuPGも必要です。Go実行ファイルは `GO` 環境変数で指定できます。テストは使い捨て鍵を生成し、個人の鍵リングを使用しません。`test-results/` はGit・Vercelの両方から除外します。

ブラウザ回帰確認にはego-browserを使用します。ローカルサーバーの起動後に：

```sh
npm run fixtures:signatures
npm run test:browser
# 別の配信先を確認する場合
FUMI_URL=https://your-app.vercel.app npm run test:browser
```

ブラウザスイートは暗号処理に実際の使い捨て鍵を使い、GitHub照合の応答は成功・鍵変更・通信失敗・取得制限の各ケースを再現します。実際のGitHub取得は別途APIで確認します。

コードの整形は `npm run format`。GitHub Actionsでは整形・本番ビルド・テスト・CLI互換性を確認します。Go/WASMの再ビルドが必要な場合のみ `npm run build:age` を使用し、対応するGoランタイムと依存ライセンスも更新します。

## Vercel

このリポジトリをNext.jsプロジェクトとしてインポートします。Node.js 24、Build Commandは `npm run build`。環境変数やAPIトークンはアプリの動作に不要です。`main` をProduction Branchにすると、以降のpushが本番デプロイになります。

画面は約140 KiB、暗号エンジンは必要時に同一オリジンのハッシュ付き静的Workerとして取得します。生成HTMLはNext.jsのファイルトレースに含めます。初回の暗号処理にはエンジンのダウンロードが必要です。

サーバーなしで使う場合は、`npm run build:client` で生成される `index.html` を開けます。単一HTMLは約9.6 MiBで、暗号エンジンを内包します。**このファイル版の自動公開鍵取得はGitHub REST APIを使用します。** 公開鍵の直接入力で暗号処理をオフラインでも利用できます。

## 構成

- [アーキテクチャ](docs/architecture.md) — 画面・Worker・サーバーの境界。
- [暗号処理の仕様](docs/cryptography.md) — 対応鍵、署名形式、互換性、データの扱い。
- [デザインシステム](docs/design-system.md) — UI UX Pro Maxに基づく白・グレー・青のシンプルなUI。

OpenPGP.js、age、Goランタイム、fflateのライセンスは、生成HTMLの「Fumiについて」に含まれます。旧版の暗号文を復号・検証できるよう、`dgpg` のSSHSIG名前空間・署名済みNotation・ZIPマーカーは維持しています。
