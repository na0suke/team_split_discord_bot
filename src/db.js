import Database from 'better-sqlite3';

const db = new Database('./bot.db');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  username TEXT,
  points INTEGER DEFAULT 300,
  wins INTEGER DEFAULT 0,
  losses INTEGER DEFAULT 0,
  win_streak INTEGER DEFAULT 0
);

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

CREATE TABLE IF NOT EXISTS last_team_signature (
  id INTEGER PRIMARY KEY CHECK(id=1),
  signature TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

// 既存DBへのマイグレーション（足りない列だけ追加）
try { db.exec('ALTER TABLE users ADD COLUMN win_streak INTEGER DEFAULT 0'); } catch (e) {}
try { db.exec('ALTER TABLE users ADD COLUMN points INTEGER DEFAULT 300'); } catch (e) {}

// users
export const upsertUser = db.prepare(`
INSERT INTO users (user_id, username, points, wins, losses, win_streak)
VALUES (@user_id, @username, COALESCE(@points,300), COALESCE(@wins,0), COALESCE(@losses,0), COALESCE(@win_streak,0))
ON CONFLICT(user_id) DO UPDATE SET username=excluded.username;
`);
export const getUser = db.prepare(`SELECT * FROM users WHERE user_id=?`);
export const setStrength = db.prepare(`
INSERT INTO users (user_id, username, points) VALUES (?, ?, ?)
ON CONFLICT(user_id) DO UPDATE SET username=excluded.username, points=excluded.points;
`);
export const addWinLoss = db.prepare(`
UPDATE users SET wins = wins + ?, losses = losses + ?, points = points + ? WHERE user_id=?;
`);
export const setStreak = db.prepare(`UPDATE users SET win_streak=? WHERE user_id=?`);
export const getStreak = db.prepare(`SELECT win_streak FROM users WHERE user_id=?`);
export const incStreak = db.prepare(`UPDATE users SET win_streak = win_streak + 1 WHERE user_id=?`);
export const resetStreak = db.prepare(`UPDATE users SET win_streak = 0 WHERE user_id=?`);
export const topRanks = db.prepare(`
SELECT user_id, username, points, wins, losses, win_streak,
  CASE WHEN wins+losses=0 THEN 0.0 ELSE CAST(wins AS REAL)/(wins+losses) END AS winrate
FROM users
ORDER BY points DESC, winrate DESC
LIMIT 20;
`);

// signup
export const createSignup = db.prepare(`INSERT INTO signup (message_id, channel_id, author_id, created_at) VALUES (?, ?, ?, ?);`);
export const getSignup = db.prepare(`SELECT * FROM signup WHERE message_id=?`);
export const latestSignupMessageId = db.prepare(`SELECT message_id FROM signup ORDER BY created_at DESC LIMIT 1`);
export const deleteSignup = db.prepare(`DELETE FROM signup WHERE message_id=?`);

// participants
export const addParticipant = db.prepare(`
INSERT INTO signup_participants (message_id, user_id, username) VALUES (?, ?, ?)
ON CONFLICT(message_id,user_id) DO NOTHING;
`);
export const removeParticipant = db.prepare(`DELETE FROM signup_participants WHERE message_id=? AND user_id=?`);
export const listParticipants = db.prepare(`SELECT user_id, username FROM signup_participants WHERE message_id=?`);
export const clearParticipantsByMessage = db.prepare(`DELETE FROM signup_participants WHERE message_id=?`);

// matches
export const createMatch = db.prepare(`INSERT INTO matches (message_id, team_a, team_b, created_at) VALUES (?, ?, ?, ?);`);
export const getLatestMatch = db.prepare(`SELECT * FROM matches ORDER BY id DESC LIMIT 1`);
export const setMatchWinner = db.prepare(`UPDATE matches SET winner=? WHERE id=?`);

// signature
export const setLastSignature = db.prepare(`
INSERT INTO last_team_signature (id, signature) VALUES (1, ?)
ON CONFLICT(id) DO UPDATE SET signature=excluded.signature;
`);
export const getLastSignature = db.prepare(`SELECT signature FROM last_team_signature WHERE id=1`);

// settings
export const getSetting = db.prepare(`SELECT value FROM settings WHERE key=?`);
export const setSetting = db.prepare(`
INSERT INTO settings (key, value) VALUES (?, ?)
ON CONFLICT(key) DO UPDATE SET value=excluded.value;
`);

export default db;
