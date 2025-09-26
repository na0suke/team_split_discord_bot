# Discord Team Split Bot

Discord 上で **参加受付 → チーム分け → 勝敗登録 → ランキング → 管理** を一括管理するボットです。  
LoL などのチーム戦に最適。均衡分け（ポイント考慮）、ランダム分け、レーン指定分けに対応します。  

---

## ✨ 主な機能

### 参加受付
- `/start_signup` … 通常の参加受付を開始（✋で参加、✅で均衡分け、🎲でランダム分け）
- `/start_lane_signup` … レーン指定で参加受付（⚔️TOP 🌲JG 🪄MID 🏹ADC ❤️SUP + ✅で均衡分け）
- `/show_participants` … 現在の参加者一覧を表示
- `/reset_participants` … 参加者をリセット
- `/leave` … 自分の参加を取り消し（公開通知）
- `/kick_from_lol @user` … 指定ユーザーを参加リストから外す（誰でも可）

### チーム分け
- `/team` … 強さ（ポイント）を考慮し、合計差が最小になるように二分割
- `/team_simple` … 強さ無視でランダム二分割
- `/start_lane_signup` の ✅ → レーン指定でチーム分け（各レーンから1人ずつ、空席はダミーで埋める）

### 勝敗登録
- `/result winner:<A|B> [match_id:<number>]`  
- `/win <A|B> [match_id:<number>]`  
- `win a` / `win b` のショートカット  
- `/result_team winteam:<id> loseteam:<id>` … レーンチームの勝敗登録  

...

## ⚔️ 勝敗ポイントのルール

### 通常の試合（/team, /team_simple）
- 勝利: **+3**
- 敗北: **-2**
- 連勝ボーナス: 2連勝で+2、3連勝で+4 …（2点ずつ増加、上限あり）
- 連敗ペナルティ: 2連敗で-2、3連敗で-4 …（2点ずつ増加、上限あり）

### レーン指定試合（/start_lane_signup → /result_team）
- 勝利: **+6**
- 敗北: **-4**
- 連勝ボーナス: 2連勝で+2、3連勝で+4 …（2点ずつ増加）
- 連敗ペナルティ: 2連敗で-2、3連敗で-4 …（2点ずつ増加）


### ランキング
- `/rank` … ⭐ポイント / W-L / 勝率 / 連勝数 を表示  
- `/set_strength @user <points>` … 指定ユーザーのポイントを直接設定  
- `/set_points win:<int> loss:<int> streak_cap:<int>` … ポイント設定変更  
- `/show_points` … 現在の設定を表示  

### 管理者専用 & ユーザー補助コマンド

- `/record user:<@user> wins:<int> losses:<int>`  
  - **一般ユーザー**: 自分自身の戦績のみ編集可能  
  - **管理者 (Manage Guild 権限)**: 全ユーザーの戦績を編集可能  
  - 指定した wins / losses にそのまま上書き（points は変更しない、streak はリセット）  

- `/delete_user user:<@user>`  
  - **管理者専用**  
  - 指定ユーザーの記録を完全削除（ランキングや戦績からも消える）  

---

## 📦 セットアップ

### 1) 環境変数
`.env` またはホスティング環境の Variables に設定：

DISCORD_TOKEN=xxxxxxxxxxxxxxxxxxxx
CLIENT_ID=xxxxxxxxxxxxxxxxxxxx
GUILD_ID=xxxxxxxxxxxxxxxxxxxx # ギルド登録時のみ
DB_PATH=data/bot.db # Railway など永続化したい場合
マウントパス app/data

### 2) 依存関係
```bash
3) コマンド登録
ギルド登録（即時反映）:
node src/index.js guild-register

4) 起動
node src/index.js

Service: Node.js（Start: npm start）

Variables: DISCORD_TOKEN, DB_PATH=/data/bot.db

Volume: app/data を 1GB 以上でマウント
