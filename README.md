# team_split_discord_bot
discord bot team splitter

# Discord LoL 5v5 Team Split Bot – Render デプロイ手順付き

このボットは Node.js + **discord.js v14** + **better-sqlite3** で動きます。Render に公開するまでの流れを最初からまとめます。

---

## 1) Discord Bot の準備

1. [Discord Developer Portal](https://discord.com/developers/applications) にアクセス
2. **New Application** → 名前をつける
3. 左メニュー **Bot** → **Add Bot**
4. **TOKEN** をコピー（あとで `.env` に入れる）
5. **Privileged Gateway Intents** → 「MESSAGE CONTENT INTENT」「SERVER MEMBERS INTENT」を ON
6. **OAuth2 → URL Generator**
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `Read Messages`, `Send Messages`, `Add Reactions`, `Read Message History`
   - 出てきた URL でサーバーに招待

---

## 2) プロジェクト作成

```bash
mkdir lol-team-bot && cd lol-team-bot
npm init -y
npm i discord.js better-sqlite3 dotenv
npm i -D nodemon
mkdir src
```

`package.json` に以下を追加:
```json
"scripts": {
  "start": "node src/bot.js",
  "dev": "nodemon src/bot.js"
}
```

`.env` ファイルを作成:
```
DISCORD_TOKEN=あなたのBotトークン
CLIENT_ID=あなたのアプリケーションID
GUILD_ID=開発中のサーバーID（必須ではない）
DEFAULT_BALANCE_DIFF=50
DEFAULT_WIN_DELTA=10
```

---

## 3) ソースコード配置

`src/bot.js` にキャンバスのコードをコピー。

---

## 4) ローカルで動作確認

```bash
npm run dev
```

ターミナルに `Logged in as <botname>` と出たら成功。Discord サーバーに `/lobby` を打ってみて、リアクションできればOK。

---

## 5) GitHub にアップロード

```bash
git init
git add .
git commit -m "first commit"
git branch -M main
git remote add origin https://github.com/あなたの名前/lol-team-bot.git
git push -u origin main
```

`.env` は **必ず .gitignore に追加** してください。

---

## 5.5) .gitignore の設定

リポジトリ作成時に GitHub で `.gitignore` テンプレートを選べます。ここでは **Node** を選んでください。これで `node_modules/` などが無視されます。

さらに以下を自分で追加するのが必須です:
```
.env
/data/
data.db
```

これで秘密情報やデータベースファイルが誤って公開されることを防げます。

---

## 6) Render でデプロイ

1. [Render](https://dashboard.render.com/) にログイン
2. **New → Background Worker** を選択
3. GitHub リポジトリを選ぶ
4. 設定:
   - **Build Command**: `npm ci`
   - **Start Command**: `npm start`
5. **Environment Variables** に以下を追加
   - `DISCORD_TOKEN`
   - `CLIENT_ID`
   - `GUILD_ID`（開発サーバーなら推奨）
   - `DEFAULT_BALANCE_DIFF`
   - `DEFAULT_WIN_DELTA`
6. **Add Disk**（SQLite を消さないため）
   - Name: `data`
   - Size: 1GB
   - Mount Path: `/opt/render/project/src`
7. **Create Worker** を押す

デプロイ後、ログに `Logged in as ...` が出れば起動成功。

---

## 7) 使い方

1. `/lobby` → ✅ 参加者を集める
2. 10人揃ったら 🆗 を押すと自動でチーム分け
3. `/teams` → 手動で開始することも可能
4. `/result winner:A delta:10` → 勝敗登録

---

## 8) 注意点

- Render の無料プランはスリープする場合があります。常時稼働なら有料プランを推奨。
- `.env` の管理は Render の **Environment Variables** に入れる。
- DB (`data.db`) は Render の **Disk** をマウントして永続化すること。

---

これで Render で公開 → Discord サーバーで使えるようになります。
