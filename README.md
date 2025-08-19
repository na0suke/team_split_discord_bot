# Discord Team Split Bot

Discord 上で **参加受付 → チーム分け → 勝敗登録 → ランキング** を一括管理するボットです。  
LoL などのチーム戦に最適。均衡分け（ポイント考慮）とランダム分けの両方に対応します。

- 参加受付メッセージに ✅/🆗/🎲 リアクション
- チーム分け時に **Match ID** を自動採番 → 勝敗登録の対象に使える
- **連勝ボーナス**／**ポイント設定の変更**／**ギルド（サーバー）ごとのランキング**

---

## ✨ 主な機能

### 参加受付
- `/start_signup` … 参加受付を開始（✅で参加、🆗で均衡分け、🎲でランダム分け）
- `/show_participants` … 現在の参加者一覧を表示
- `/reset_participants` … 参加者をリセット
- `/leave` … 自分の参加を取り消し（公開で通知）
- `/join_name` … 名前を指定して参加させる
- `/kick_from_lol @user` … 指定ユーザーを参加リストから外す（誰でも実行可）

### チーム分け
- `/team` … 強さ（ポイント）を考慮し、合計差が最小になるように二分割（最大10人）
- `/team_simple` … 強さ無視でランダム二分割（人数上限なし）
- 🆗 リアクション = `/team`、🎲 リアクション = `/team_simple`
- チーム分け時に **Match ID** を発行し、Embed タイトルに表示

### 勝敗登録
- `/result winner:<A|B> [match_id:<number>]`
  - 例: `/result winner:A`（match_id省略時は最新マッチ）
- `/win <A|B> [match_id:<number>]`
  - 例: `/win B 42`
- テキストショートカット：`win a` / `win b`（最新マッチのみ）
- 連勝ボーナスあり（上限は設定可）

### ランキング・ポイント管理
- `/rank` … 現在のランキング（⭐ポイント / W-L / 勝率 / 連勝）
- `/set_strength @user <points>` … 個別ユーザーのポイントを直接設定
- `/set_points [win:<int>] [loss:<int>] [streak_cap:<int>]` … 勝敗ポイント・連勝上限を変更（Manage Server 権限者のみ）
- `/show_points` … 現在の設定値を表示

> 🔐 **ポイント・戦績はギルド（サーバー）ごとに独立**して保存されます。

---

## 🖼 Embed 表示例（テキスト）

### ✅ 均衡分け（`/team` 実行時）
**チーム分け結果（ポイント均衡） — Match #1024**

**Team A (5)**
Alice (⭐301)
Bob (⭐297)
Charlie (⭐305)
David (⭐300)
Eve (⭐302)

**Team B (5)**
Frank (⭐299)
Grace (⭐304)
Heidi (⭐298)
Ivan (⭐302)
Judy (⭐301)


- Team A 合計: **1505**  
- Team B 合計: **1504**  
- 合計差: **1**

---

### 🎲 ランダム分け（`/team_simple` 実行時）
**チーム分け結果（ランダム／ポイント無視） — Match #1025**

**Team A (4)**
Alice (⭐301)
David (⭐300)
Grace (⭐304)
Ivan (⭐302)

**Team B (4)**
Bob (⭐297)
Charlie (⭐305)
Eve (⭐302)
Heidi (⭐298)


---

## ⚙️ 仕様（デフォルト）

- 初期ポイント：**300**
- 勝利：**+3** ＋ 連勝ボーナス（直前連勝数に応じて、**最大+3**）
- 敗北：**-2**
- これらは `/set_points` で変更可能  
  - 例：`/set_points win:5 loss:-3 streak_cap:2`

---

## 🧭 コマンド一覧（詳説）

### 受付系
- `/start_signup`  
  新しい受付を開始（必要に応じて直前の参加者をリセット）。  
  - 受付メッセージに ✅/🆗/🎲 が付与されます。  
  - ✅：参加、🆗：均衡分け、🎲：ランダム分け

- `/show_participants`  
  現在の参加者を表示。

- `/reset_participants`  
  現在の参加者リストをリセット。

- `/leave`  
  自分の参加を取り消し（チャンネルに公開メッセージで通知）。

- `/kick_from_lol @user`  
  指定ユーザーを参加リストから外す（誰でも実行可／公開通知）。

### チーム分け
- `/team`  
  強さを考慮し、合計ポイント差が最小になるように2チームに分ける（最大10人）。  
  実行時に **Match ID** を発行して Embed に表示。

- `/team_simple`  
  強さを無視してランダムに二分割（人数上限なし）。  
  実行時に **Match ID** を発行して Embed に表示。

### 勝敗登録
- `/result winner:<A|B> [match_id:<number>]`  
  指定の試合（省略時は最新）に勝敗を登録。  
  例：`/result winner:A`、`/result winner:B match_id:42`

- `/win <A|B> [match_id:<number>]`  
  簡易勝敗登録。  
  例：`/win A`、`/win B 42`

- **ショートカット**：`win a` / `win b`  
  ※最新マッチのみ対象。

### ランキング・ポイント
- `/rank`  
  ランキング（⭐ポイント / W-L / 勝率 / WS）を表示。

- `/set_strength @user <points>`  
  指定ユーザーのポイントを直接設定。例：`/set_strength @Alice 320`

- `/set_points [win:<int>] [loss:<int>] [streak_cap:<int>]`  
  ポイント変動と連勝上限を設定（**Manage Server 権限者のみ**）。  
  例：`/set_points win:4 loss:-1 streak_cap:3`

- `/show_points`  
  現在の設定（win / loss / streak_cap）を表示。

---

## 📦 セットアップ

### 1) 環境変数
`.env`（ローカル）／ホスティングの Variables に設定：

DISCORD_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxx

グローバルコマンド登録なら GUILD_ID は不要
永続化したい場合（Railway など）は DB_PATH を指定
DB_PATH=/data/bot.db

### 2) 依存関係
```bash

npm ci

3) スラッシュコマンド登録
npm run register

グローバルコマンドにすると、招待した全サーバーで使えます（反映に数分〜最大1時間）。
すぐ反映が必要な場合はギルドコマンドで一時確認→後でグローバル化がおすすめ。

4) 起動
npm start
```

デプロイ（例：Railway）

Service: Node.js（Start: npm start）

Variables:

DISCORD_TOKEN

DB_PATH=/data/bot.db（永続化したい場合）

Volumes: /data に 1GB+ をマウント

初回のみ Slash コマンド登録：一時的に Start を npm run register にしてデプロイ → 完了したら npm start に戻す

🧩 実装メモ

DB: SQLite（better-sqlite3）。DB_PATH で保存先を切替可能。

ポイント・戦績は ギルド単位で独立（guild_users テーブル）。

均衡分けは 全探索で合計ポイント差の最小化＋直前の組合せ回避（署名比較）。

ランダム分けは Fisher–Yates でシャッフル → ちょうど半分で分割。

🛠 よくあるトラブル

Bot がオフライン

DISCORD_TOKEN が正しいか／Intents（MESSAGE CONTENT / SERVER MEMBERS）が ON か

コマンドが出ない

npm run register 済みか／グローバルは反映待ちか／Guild ID が正しいか

データが消える

永続ディスク未設定（Railway なら Volume /data ＋ DB_PATH=/data/bot.db）

起動時に Cannot find module '/app/index.js'

ルート／Start コマンドのパスを確認（例：node src/index.js）
