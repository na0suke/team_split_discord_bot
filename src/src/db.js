import Database from 'better-sqlite3';

const db = new Database(process.env.DB_PATH || './bot.db');

db.exec(`
CREATE TABLE IF NOT EXISTS signup (
  message_id TEXT PRIMARY KEY,
  channel_id TEXT,
  author_id TEXT,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS signup_participants (
  message_id TEXT,
  user_id TEXT,
  username TEXT,
  PRIMARY KEY (message_id, user_id)
);

CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT,
  team_a TEXT,
  team_b TEXT,
  created_at INTEGER,
  winner TEXT
);

/* （旧）全体共通 users は残すが未使用にする想定
CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  username TEXT,
  points INTEGER DEFAULT 300,
  wins INTEGER DEFAULT 0,
  losses INTEGER DEFAULT 0,
  win_streak INTEGER DEFAULT 0
);
*/

/* ★ 新：ギルド別のユーザー成績 */
CREATE TABLE IF NOT EXISTS guild_users (
  guild_id TEXT,
  user_id  TEXT,
  username TEXT,
  points INTEGER DEFAULT 300,
  wins   INTEGER DEFAULT 0,
  losses INTEGER DEFAULT 0,
  win_streak INTEGER DEFAULT 0,
  PRIMARY KEY (guild_id, user_id)
);

/* ★ 新：ギルド別設定（勝敗ポイントなど） */
CREATE TABLE IF NOT EXISTS guild_settings (
  guild_id TEXT,
  key TEXT,
  value TEXT,
  PRIMARY KEY (guild_id, key)
);

/* 直前のチーム署名（全体共通のまま。必要なら per-channel/per-guild に拡張可） */
CREATE TABLE IF NOT EXISTS last_team_signature (
  id INTEGER PRIMARY KEY CHECK(id=1),
  signature TEXT
);
`);

// --- guild_users API（ギルド別ポイント/戦績） ---
export const upsertUser = db.prepare(`
INSERT INTO guild_users (guild_id, user_id, username, points, wins, losses, win_streak)
VALUES (@guild_id, @user_id, @username, COALESCE(@points,300), COALESCE(@wins,0), COALESCE(@losses,0), COALESCE(@win_streak,0))
ON CONFLICT(guild_id, user_id) DO UPDATE SET username=excluded.username;
`);
export const getUser = db.prepare(`SELECT * FROM guild_users WHERE guild_id=? AND user_id=?`);
export const setStrength = db.prepare(`
INSERT INTO guild_users (guild_id, user_id, username, points) VALUES (?, ?, ?, ?)
ON CONFLICT(guild_id, user_id) DO UPDATE SET username=excluded.username, points=excluded.points;
`);
export const addWinLoss = db.prepare(`
UPDATE guild_users
SET wins = wins + ?, losses = losses + ?, points = points + ?
WHERE guild_id=? AND user_id=?;
`);
export const setStreak  = db.prepare(`UPDATE guild_users SET win_streak=? WHERE guild_id=? AND user_id=?`);
export const getStreak  = db.prepare(`SELECT win_streak FROM guild_users WHERE guild_id=? AND user_id=?`);
export const incStreak  = db.prepare(`UPDATE guild_users SET win_streak = win_streak + 1 WHERE guild_id=? AND user_id=?`);
export const resetStreak= db.prepare(`UPDATE guild_users SET win_streak = 0 WHERE guild_id=? AND user_id=?`);
export const topRanks = db.prepare(`
SELECT user_id, username, points, wins, losses, win_streak,
  CASE WHEN wins+losses=0 THEN 0.0 ELSE CAST(wins AS REAL)/(wins+losses) END AS winrate
FROM guild_users
WHERE guild_id=?
ORDER BY points DESC, winrate DESC
LIMIT 20;
`);

// --- settings（ギルド別） ---
export const getSetting = db.prepare(`SELECT value FROM guild_settings WHERE guild_id=? AND key=?`);
export const setSetting = db.prepare(`
INSERT INTO guild_settings (guild_id, key, value) VALUES (?, ?, ?)
ON CONFLICT(guild_id, key) DO UPDATE SET value=excluded.value;
`);

// --- signup ---
export const createSignup = db.prepare(`INSERT INTO signup (message_id, channel_id, author_id, created_at) VALUES (?, ?, ?, ?);`);
export const getSignup = db.prepare(`SELECT * FROM signup WHERE message_id=?`);
export const latestSignupMessageId = db.prepare(`SELECT message_id FROM signup ORDER BY created_at DESC LIMIT 1`);
export const deleteSignup = db.prepare(`DELETE FROM signup WHERE message_id=?`);

// --- participants ---
export const addParticipant = db.prepare(`
INSERT INTO signup_participants (message_id, user_id, username) VALUES (?, ?, ?)
ON CONFLICT(message_id,user_id) DO NOTHING;
`);
export const removeParticipant = db.prepare(`DELETE FROM signup_participants WHERE message_id=? AND user_id=?`);
export const listParticipants = db.prepare(`SELECT user_id, username FROM signup_participants WHERE message_id=?`);
export const clearParticipantsByMessage = db.prepare(`DELETE FROM signup_participants WHERE message_id=?`);

// --- matches ---
export const createMatch = db.prepare(`INSERT INTO matches (message_id, team_a, team_b, created_at) VALUES (?, ?, ?, ?);`);
export const getLatestMatch = db.prepare(`SELECT * FROM matches ORDER BY id DESC LIMIT 1`);
export const getMatchById = db.prepare(`SELECT * FROM matches WHERE id=?`);
export const setMatchWinner = db.prepare(`UPDATE matches SET winner=? WHERE id=?`);

// --- signature ---
export const setLastSignature = db.prepare(`
INSERT INTO last_team_signature (id, signature) VALUES (1, ?)
ON CONFLICT(id) DO UPDATE SET signature=excluded.signature;
`);
export const getLastSignature = db.prepare(`SELECT signature FROM last_team_signature WHERE id=1`);

export default db;
