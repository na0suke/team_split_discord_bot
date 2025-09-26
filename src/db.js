// db.js
import Database from 'better-sqlite3';
import { mkdir } from 'fs/promises';
import { dirname } from 'path';

// Railway Volume対応: 永続化ディレクトリを使用
const DB_PATH = process.env.NODE_ENV === 'production' ? './data/bot.db' : './bot.db';

// データディレクトリが存在しない場合は作成
try {
  const dbDir = dirname(DB_PATH);
  await mkdir(dbDir, { recursive: true });
  console.log(`Database directory ensured: ${dbDir}`);
} catch (error) {
  if (error.code !== 'EEXIST') {
    console.error('Failed to create database directory:', error);
  }
}

const db = new Database(DB_PATH);
console.log(`Database initialized at: ${DB_PATH}`);

// --- テーブル存在ヘルパー ---
function tableExists(name) {
  const r = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
  return !!r;
}

// --- users の現状把握（ギルド列の有無） ---
function usersHasGuildId() {
  if (!tableExists('users')) return false;
  const cols = db.prepare(`PRAGMA table_info(users)`).all();
  return cols.some(c => c.name === 'guild_id');
}

// === マイグレーション ===
// 1) users が無ければ、ギルド対応の新スキーマを直接作成
// 2) users があるが guild_id が無ければ、users_new を作ってコピー → users を入替
db.exec('PRAGMA foreign_keys=OFF');
db.transaction(() => {
  if (!tableExists('users')) {
    // 新規作成（ギルド対応 + loss_streak 追加）
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        guild_id     TEXT NOT NULL,
        user_id      TEXT NOT NULL,
        username     TEXT,
        points       INTEGER DEFAULT 300,
        wins         INTEGER DEFAULT 0,
        losses       INTEGER DEFAULT 0,
        win_streak   INTEGER DEFAULT 0,
        loss_streak  INTEGER DEFAULT 0,
        PRIMARY KEY (guild_id, user_id)
      );
    `);
  } else if (!usersHasGuildId()) {
    // 旧 users → 新 users へ移行
    const oldRows = (() => {
      try { return db.prepare(`SELECT * FROM users`).all(); }
      catch { return []; }
    })();

    db.exec(`
      CREATE TABLE IF NOT EXISTS users_new (
        guild_id     TEXT NOT NULL,
        user_id      TEXT NOT NULL,
        username     TEXT,
        points       INTEGER DEFAULT 300,
        wins         INTEGER DEFAULT 0,
        losses       INTEGER DEFAULT 0,
        win_streak   INTEGER DEFAULT 0,
        loss_streak  INTEGER DEFAULT 0,
        PRIMARY KEY (guild_id, user_id)
      );
    `);

    const ins = db.prepare(`
      INSERT OR IGNORE INTO users_new (guild_id, user_id, username, points, wins, losses, win_streak, loss_streak)
      VALUES (@guild_id, @user_id, @username, COALESCE(@points,300), COALESCE(@wins,0), COALESCE(@losses,0), COALESCE(@win_streak,0), COALESCE(@loss_streak,0))
    `);

    for (const r of oldRows) {
      ins.run({
        guild_id: r.guild_id ?? 'global',
        user_id: r.user_id,
        username: r.username,
        points: r.points,
        wins: r.wins,
        losses: r.losses,
        win_streak: r.win_streak,
        loss_streak: r.loss_streak ?? 0,
      });
    }

    // 旧表を置き換え（users が存在する時だけ実行）
    db.exec(`
      ALTER TABLE users RENAME TO users_old;
      ALTER TABLE users_new RENAME TO users;
      DROP TABLE IF EXISTS users_old;
    `);
  }

  // 他テーブル（ギルド対応で作成）
  db.exec(`
    CREATE TABLE IF NOT EXISTS signup (
      guild_id   TEXT,
      message_id TEXT PRIMARY KEY,
      channel_id TEXT,
      author_id  TEXT,
      created_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS signup_participants (
      guild_id   TEXT,
      message_id TEXT,
      user_id    TEXT,
      username   TEXT,
      PRIMARY KEY (guild_id, message_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS matches (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id   TEXT,
      message_id TEXT,
      team_a     TEXT,
      team_b     TEXT,
      created_at INTEGER,
      winner     TEXT
    );

    CREATE TABLE IF NOT EXISTS last_team_signature (
      guild_id   TEXT PRIMARY KEY,
      signature  TEXT
    );

    CREATE TABLE IF NOT EXISTS config (
      key        TEXT PRIMARY KEY,
      value      TEXT
    );
  `);

  // 既存の旧スキーマに列が無ければ追加（あっても無視）
  try { db.exec(`ALTER TABLE signup ADD COLUMN guild_id TEXT`); } catch {}
  try { db.exec(`ALTER TABLE signup_participants ADD COLUMN guild_id TEXT`); } catch {}
  try { db.exec(`ALTER TABLE matches ADD COLUMN guild_id TEXT`); } catch {}
  try { db.exec(`ALTER TABLE last_team_signature ADD COLUMN guild_id TEXT`); } catch {}
  // streak 列の後方互換
  try { db.exec(`ALTER TABLE users ADD COLUMN win_streak INTEGER DEFAULT 0`); } catch {}
  try { db.exec(`ALTER TABLE users ADD COLUMN loss_streak INTEGER DEFAULT 0`); } catch {}
})();
db.exec('PRAGMA foreign_keys=ON');

// WALモードでパフォーマンス向上（Railway環境で推奨）
db.exec('PRAGMA journal_mode=WAL');
db.exec('PRAGMA synchronous=NORMAL');
db.exec('PRAGMA temp_store=memory');

// ===== users =====
export const upsertUser = db.prepare(`
INSERT INTO users (guild_id, user_id, username)
VALUES (@guild_id, @user_id, @username)
ON CONFLICT(guild_id, user_id) DO UPDATE SET username=excluded.username
`);

// --- ユーザー削除（戦績ごと完全削除） ---
export const deleteUserRecord = db.prepare(
  `DELETE FROM users WHERE guild_id=? AND user_id=?`
);

export const deleteFromSignupParticipants = db.prepare(
  `DELETE FROM signup_participants WHERE guild_id=? AND user_id=?`
);

export const deleteFromLaneSignup = db.prepare(
  `DELETE FROM lane_signup WHERE guild_id=? AND user_id=?`
);

export const getUser      = db.prepare(`SELECT * FROM users WHERE guild_id=? AND user_id=?`);
export const setStrength  = db.prepare(`
INSERT INTO users (guild_id, user_id, username, points)
VALUES (?, ?, ?, ?)
ON CONFLICT(guild_id, user_id) DO UPDATE
  SET username=excluded.username, points=excluded.points
`);
export const addWinLoss   = db.prepare(`
UPDATE users
SET wins = wins + ?, losses = losses + ?, points = points + ?
WHERE guild_id=? AND user_id=?
`);
export const getStreak       = db.prepare(`SELECT win_streak  FROM users WHERE guild_id=? AND user_id=?`);
export const incStreak       = db.prepare(`UPDATE users SET win_streak  = CASE WHEN win_streak  < ? THEN win_streak  + 1 ELSE win_streak  END WHERE guild_id=? AND user_id=?`);
export const resetStreak     = db.prepare(`UPDATE users SET win_streak  = 0 WHERE guild_id=? AND user_id=?`);
export const getLossStreak   = db.prepare(`SELECT loss_streak FROM users WHERE guild_id=? AND user_id=?`);
export const incLossStreak   = db.prepare(`UPDATE users SET loss_streak = CASE WHEN loss_streak < ? THEN loss_streak + 1 ELSE loss_streak END WHERE guild_id=? AND user_id=?`);
export const resetLossStreak = db.prepare(`UPDATE users SET loss_streak = 0 WHERE guild_id=? AND user_id=?`);

export const topRanks     = db.prepare(`
SELECT
  user_id, username, points, wins, losses, win_streak,
  CASE WHEN (wins + losses) = 0 THEN 0.0
       ELSE CAST(wins AS REAL) / (wins + losses) END AS winrate
FROM users
WHERE guild_id=?
ORDER BY points DESC, winrate DESC, wins DESC
LIMIT 50
`);

// --- 追加: 戦績（wins/losses）を直接上書きし、ストリークはリセット ---
export const setUserRecord = db.prepare(`
INSERT INTO users (guild_id, user_id, username, points, wins, losses, win_streak, loss_streak)
VALUES (?, ?, ?, 300, ?, ?, 0, 0)
ON CONFLICT(guild_id, user_id) DO UPDATE SET
  wins = excluded.wins,
  losses = excluded.losses,
  win_streak = 0,
  loss_streak = 0
`);

// === lane_signup（一時参加：メッセージ単位で管理） ===
db.exec(`
CREATE TABLE IF NOT EXISTS lane_signup (
  message_id TEXT,
  guild_id   TEXT,
  user_id    TEXT,
  username   TEXT,
  role       TEXT,
  strength   INTEGER,
  PRIMARY KEY (message_id, guild_id, user_id)
);
`);

// ===== signup =====
export const createSignup           = db.prepare(`INSERT INTO signup (guild_id, message_id, channel_id, author_id, created_at) VALUES (?, ?, ?, ?, ?)`);
export const latestSignupMessageId  = db.prepare(`SELECT message_id FROM signup WHERE guild_id=? ORDER BY created_at DESC LIMIT 1`);
export const getSignup              = db.prepare(`SELECT * FROM signup WHERE guild_id=? AND message_id=?`);
export const deleteSignup           = db.prepare(`DELETE FROM signup WHERE guild_id=? AND message_id=?`);

// ===== signup_participants =====
export const addParticipant         = db.prepare(`
INSERT INTO signup_participants (guild_id, message_id, user_id, username)
VALUES (?, ?, ?, ?)
ON CONFLICT(guild_id, message_id, user_id) DO NOTHING
`);
export const removeParticipant      = db.prepare(`DELETE FROM signup_participants WHERE guild_id=? AND message_id=? AND user_id=?`);
export const listParticipants       = db.prepare(`
SELECT user_id, username
FROM signup_participants
WHERE guild_id=? AND message_id=?
ORDER BY username COLLATE NOCASE ASC
`);
export const clearParticipantsByMessage = db.prepare(`DELETE FROM signup_participants WHERE guild_id=? AND message_id=?`);

// ===== matches =====
export const createMatch            = db.prepare(`INSERT INTO matches (guild_id, message_id, team_a, team_b, created_at) VALUES (?, ?, ?, ?, ?)`);
export const getLatestMatch         = db.prepare(`SELECT * FROM matches WHERE guild_id=? ORDER BY id DESC LIMIT 1`);
export const getMatchById           = db.prepare(`SELECT * FROM matches WHERE id=? AND guild_id=?`);
export const setMatchWinner         = db.prepare(`UPDATE matches SET winner=? WHERE id=? AND guild_id=?`);

// ===== signature =====
export const setLastSignature       = db.prepare(`
INSERT INTO last_team_signature (guild_id, signature)
VALUES (?, ?)
ON CONFLICT(guild_id) DO UPDATE SET signature=excluded.signature
`);
export const getLastSignature       = db.prepare(`SELECT signature FROM last_team_signature WHERE guild_id=?`);

// ===== config =====
export const setPointsConfig        = db.prepare(`
INSERT INTO config (key, value) VALUES (?, ?)
ON CONFLICT(key) DO UPDATE SET value=excluded.value
`);
export function updatePointsConfig({ win, loss, streak_cap, loss_streak_cap }) {
  if (win              !== undefined && win              !== null) setPointsConfig.run('win',              String(win));
  if (loss             !== undefined && loss             !== null) setPointsConfig.run('loss',             String(loss));
  if (streak_cap       !== undefined && streak_cap       !== null) setPointsConfig.run('streak_cap',       String(streak_cap));
  if (loss_streak_cap  !== undefined && loss_streak_cap  !== null) setPointsConfig.run('loss_streak_cap',  String(loss_streak_cap));
}
export function getPointsConfig() {
  const w  = db.prepare(`SELECT value FROM config WHERE key='win'`).get();
  const l  = db.prepare(`SELECT value FROM config WHERE key='loss'`).get();
  const s  = db.prepare(`SELECT value FROM config WHERE key='streak_cap'`).get();
  const ls = db.prepare(`SELECT value FROM config WHERE key='loss_streak_cap'`).get();
  return {
    win:             w  ? Number(w.value)  : 3,
    loss:            l  ? Number(l.value)  : -2,
    streak_cap:      s  ? Number(s.value)  : 3,
    loss_streak_cap: ls ? Number(ls.value) : (s ? Number(s.value) : 3),
  };
}

/* =========================
   ここから追加分（既存を壊さない）
   ========================= */



export const clearLaneSignup = db.prepare(
  `DELETE FROM lane_signup WHERE message_id=? AND guild_id=?`
);
export const upsertLaneParticipant = db.prepare(`
INSERT INTO lane_signup (message_id, guild_id, user_id, username, role, strength)
VALUES (@message_id, @guild_id, @user_id, @username, @role,
        COALESCE((SELECT points FROM users WHERE guild_id=@guild_id AND user_id=@user_id), 300))
ON CONFLICT(message_id, guild_id, user_id) DO UPDATE SET
  username=excluded.username,
  role=excluded.role
`);
export const removeLaneParticipant = db.prepare(
  `DELETE FROM lane_signup WHERE message_id=? AND guild_id=? AND user_id=?`
);
export const getLaneParticipantsByMessage = db.prepare(
  `SELECT user_id as userId, username, role,
          COALESCE((SELECT points FROM users WHERE guild_id=? AND user_id=userId), 300) as strength
   FROM lane_signup WHERE message_id=? AND guild_id=?`
);

// === lane_matches (レーン指定チーム用) ===
db.exec(`
CREATE TABLE IF NOT EXISTS lane_matches (
  team_id    INTEGER,
  guild_id   TEXT,
  user_id    TEXT,
  username   TEXT,
  role       TEXT,
  strength   INTEGER,
  PRIMARY KEY (team_id, guild_id, user_id)
);
`);

export const getNextLaneTeamId = db.prepare(`SELECT COALESCE(MAX(team_id), 0) + 1 AS next FROM lane_matches`);
export const saveLaneTeam = db.prepare(`
INSERT INTO lane_matches (team_id, guild_id, user_id, username, role, strength)
VALUES (@team_id, @guild_id, @user_id, @username, @role, @strength)
ON CONFLICT(team_id, guild_id, user_id) DO UPDATE
  SET username=excluded.username, role=excluded.role, strength=excluded.strength
`);
export const getLaneTeamMembers = db.prepare(`SELECT * FROM lane_matches WHERE team_id=? AND guild_id=?`);

// ギルドごとの連番払い出しが必要な場合の補助（新規追加・既存と別名）
export const getNextLaneTeamIdForGuild = db.prepare(
  `SELECT COALESCE(MAX(team_id), 0) + 1 AS next FROM lane_matches WHERE guild_id=?`
);

// グレースフルシャットダウン
process.on('SIGTERM', () => {
  console.log('Closing database connection...');
  db.close();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Closing database connection...');
  db.close();
  process.exit(0);
});

export default db;
