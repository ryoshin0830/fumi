# UI・アニメーションスキル調査

確認日: 2026-10-28。GitHub REST API の `stargazers_count` を直接取得し、[skills.sh](https://skills.sh/) の導入数と原本の説明を確認した。

以下は今回の用途に関連する候補をリポジトリの star 順に並べた比較。全スキルの網羅的ランキングではない。star はリポジトリ全体、導入数は個別スキルの数なので、同じ指標として扱わない。どちらも品質の保証ではない。

| 元リポジトリ                                                                                    | GitHub stars | 確認したスキルと導入数                                                                                                                           | 判断                                                                                   |
| ----------------------------------------------------------------------------------------------- | -----------: | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| [anthropics/skills](https://github.com/anthropics/skills)                                       |      184,196 | [frontend-design](https://skills.sh/anthropics/skills/frontend-design): 約100万                                                                  | 導入。Fumiの「相手だけに届ける」という題材を中心に、画面の構図・文字・余白を設計する。 |
| [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) |      141,474 | [ui-ux-pro-max](https://skills.sh/nextlevelbuilder/ui-ux-pro-max-skill/ui-ux-pro-max): 約41.8万                                                  | 既存導入を利用。フォーム、操作領域、コントラスト、動きを減らす設定を確認する。         |
| [pbakaus/impeccable](https://github.com/pbakaus/impeccable)                                     |       90,245 | [animate](https://skills.sh/pbakaus/impeccable/animate): 約8.2万                                                                                 | 比較候補。今回はEmilのanimateと役割が重なるため追加しない。                            |
| [emilkowalski/skills](https://github.com/emilkowalski/skills)                                   |       50,602 | [apple-design](https://skills.sh/emilkowalski/skills/apple-design): 約24.9万、[animate](https://skills.sh/emilkowalski/skills/animate): 約17.6万 | 両方導入。直接的な操作反応、意味のある状態変化、短く中断可能な動きに使う。             |
| [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills)                         |       33,103 | [web-design-guidelines](https://skills.sh/vercel-labs/agent-skills/web-design-guidelines): 約79.1万                                              | 導入。実装後のキーボード、フォーム、表示、動きの確認に使う。                           |

導入数はskills.sh表示値の概数で、GitHub APIの取得時刻とは異なる。CLI検索の上位には動画制作向けスキルもあったが、今回はWebの暗号化ツールであるため、順位だけで動画ツールを追加しない。

## 導入先

ユーザー単位の `~/.codex/skills/` に公式 skill-installer の `install-skill-from-github.py` で次を追加した。アプリのnpm依存やリポジトリへのスキル本体の追加はない。次のターンから通常のスキル検出で利用可能。

- `frontend-design/SKILL.md`
- `animate/SKILL.md`（Emil版。`RECIPES.md`を含む）
- `apple-design/SKILL.md`
- `web-design-guidelines/SKILL.md`

調査時の原本main: anthropics `dbd4588f9e1033efb41dad4bef2f7947c8993d44`、Emil `2d228630ba1446365f614a108cb8252f1feda202`、Vercel `6ec269328bc400712ee225a173a14b6b29128df7`。

## Fumiへの適用方針

- 暗号化の動きの目的は、押下への反応と処理状態の説明。結果を待たせる人工的なタイマーや進捗率は設けない。
- CSS transition、CSS animation、Web Animations APIのうち最小の仕組みを選ぶ。動きのためだけのライブラリは不要。
- 基本のUI変化は160〜250ms、`transform`と`opacity`を中心にする。暗号化を説明する装飾は操作時だけ開始し、終了・中止で止める。
- `prefers-reduced-motion`では変形や文字シャッフルを抑え、読める処理状態を保つ。装飾文字は読み上げ対象外にする。
- システムフォント、既存の暗号処理、1回の送信、完全な結果のコピー・保存を維持する。
- UI UX Pro Maxの最初の「premium」検索はファッション向けの書体・金色が強く、Fumiには不適合だった。`utility minimal light`に絞ってMinimalism & Swiss Styleを確認した上で、既存の青とシステムフォントを継承する。

具体的な仕様は[デザイン案](superpowers/specs/2026-10-28-motion-ui-design.md)、実装への適用と確認結果は[検証記録](review/motion-ui-verification.md)にまとめた。
