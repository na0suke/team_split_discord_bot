// src/db.js
import Database from 'better-sqlite3';

const db = new Database('./bot.db');

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
    // 新規作成（ギルド対応）
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        guild_id   TEXT NOT NULL,
        user_id    TEXT NOT NULL,
        username   TEXT,
        points     INTEGER DEFAULT 300,
        wins       INTEGER DEFAULT 0,
        losses     INTEGER DEFAULT 0,
        win_streak INTEGER DEFAULT 0,
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
        guild_id   TEXT NOT NULL,
        user_id    TEXT NOT NULL,
        username   TEXT,
        points     INTEGER DEFAULT 300,
        wins       INTEGER DEFAULT 0,
        losses     INTEGER DEFAULT 0,
        win_streak INTEGER DEFAULT 0,
        PRIMARY KEY (guild_id, user_id)
      );
    `);

    const ins = db.prepare(`
      INSERT OR IGNORE INTO users_new (guild_id, user_id, username, points, wins, losses, win_streak)
      VALUES (@guild_id, @user_id, @username, COALESCE(@points,300), COALESCE(@wins,0), COALESCE(@losses,0), COALESCE(@win_streak,0))
    `);

    for (const r of oldRows) {
      ins.run({
        guild_id: r.guild_id ?? 'global',
        user_id: r.user_id,
        username: r.username,
        points: r.points,
        wins: r.wins,
        losses: r.losses,
        win_streak: r.win_streak
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
})();
db.exec('PRAGMA foreign_keys=ON');

// ===== users =====
export const upsertUser = db.prepare(`
INSERT INTO users (guild_id, user_id, username)
VALUES (@guild_id, @user_id, @username)
ON CONFLICT(guild_id, user_id) DO UPDATE SET username=excluded.username
`);

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
export const getStreak    = db.prepare(`SELECT win_streak FROM users WHERE guild_id=? AND user_id=?`);
export const incStreak    = db.prepare(`UPDATE users SET win_streak = CASE WHEN win_streak < ? THEN win_streak + 1 ELSE win_streak END WHERE guild_id=? AND user_id=?`);
export const resetStreak  = db.prepare(`UPDATE users SET win_streak = 0 WHERE guild_id=? AND user_id=?`);
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
export function updatePointsConfig({ win, loss, streak_cap }) {
  if (win         !== undefined && win         !== null) setPointsConfig.run('win',         String(win));
  if (loss        !== undefined && loss        !== null) setPointsConfig.run('loss',        String(loss));
  if (streak_cap  !== undefined && streak_cap  !== null) setPointsConfig.run('streak_cap',  String(streak_cap));
}
export function getPointsConfig() {
  const w = db.prepare(`SELECT value FROM config WHERE key='win'`).get();
  const l = db.prepare(`SELECT value FROM config WHERE key='loss'`).get();
  const s = db.prepare(`SELECT value FROM config WHERE key='streak_cap'`).get();
  return {
    win:        w ? Number(w.value) : 3,
    loss:       l ? Number(l.value) : -2,
    streak_cap: s ? Number(s.value) : 3,
  };
}

export default db;
