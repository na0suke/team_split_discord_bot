// 定数定義
export const JOIN_EMOJI = '✋';
export const OK_EMOJI = '✅';
export const DICE_EMOJI = '🎲';

// 環境変数
export const TOKEN = process.env.DISCORD_TOKEN;
export const CLIENT_ID = process.env.CLIENT_ID;
export const GUILD_ID = process.env.GUILD_ID;

// 複数ギルド登録用（GUILD_IDS が無ければ GUILD_ID を使う）
export const GUILD_IDS = (process.env.GUILD_IDS ?? process.env.GUILD_ID ?? '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
