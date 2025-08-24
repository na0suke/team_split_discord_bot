import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  PermissionsBitField,
  REST,
  Routes,
  Events,
  MessageFlags,
} from 'discord.js';
import {
  upsertUser,
  getUser,
  setStrength,
  addWinLoss,
  getStreak,
  incStreak,
  resetStreak,
  getLossStreak,
  incLossStreak,
  resetLossStreak,
  topRanks,
  createSignup,
  latestSignupMessageId,
  getSignup,
  addParticipant,
  removeParticipant,
  listParticipants,
  clearParticipantsByMessage,
  createMatch,
  getLatestMatch,
  getMatchById,
  setMatchWinner,
  setLastSignature,
  getLastSignature,
  updatePointsConfig,
  getPointsConfig,
} from './db.js';
import { splitBalanced, splitRandom } from './team.js';

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

// 複数ギルド登録用（GUILD_IDS が無ければ GUILD_ID を使う）
const GUILD_IDS = (process.env.GUILD_IDS ?? process.env.GUILD_ID ?? '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const JOIN_EMOJI = '✋';
const OK_EMOJI = '✅';
const DICE_EMOJI = '🎲';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// ====== Slash Commands ======
const commands = [
  { name: 'start_signup', description: '参加受付を開始（例: `/start_signup`）' },
  { name: 'show_participants', description: '現在の参加者を表示（例: `/show_participants`）' },
  { name: 'reset_participants', description: '参加者リセット（例: `/reset_participants`）' },
  { name: 'leave', description: '自分を参加リストから外す（例: `/leave`）' },
  {
    name: 'kick_from_lol',
    description: '他人を参加リストから外す（誰でも可）（例: `/kick_from_lol @user`）',
    options: [{ name: 'user', description: '対象ユーザー', type: 6, required: true }],
  },
  {
    name: 'set_strength',
    description: 'メンバーの強さを登録/再定義（例: `/set_strength @user 350`）',
    options: [
      { name: 'user', description: '対象ユーザー', type: 6, required: true },
      { name: 'points', description: 'ポイント値', type: 4, required: true },
    ],
  },
  { name: 'team', description: '強さを考慮してチーム分け（直前と似た構成を回避）（例: `/team`）' },
  { name: 'team_simple', description: '強さ無視でランダム2分割（例: `/team_simple`）' },
  {
    name: 'result',
    description: '勝敗を登録（例: `/result winner:A`、`/result winner:B`）',
    options: [
      {
        name: 'winner',
        description: '勝利チーム (A or B)',
        type: 3,
        required: true,
        choices: [{ name: 'A', value: 'A' }, { name: 'B', value: 'B' }],
      },
      { name: 'match_id', description: '対象マッチID（未指定なら最新）', type: 4, required: false },
    ],
  },
  {
    name: 'win',
    description: '簡易勝敗登録（例: `/win A`、`/win B`、`/win A match_id:42`）',
    options: [
      {
        name: 'team',
        description: '勝利チーム (A or B)',
        type: 3,
        required: true,
        choices: [{ name: 'A', value: 'A' }, { name: 'B', value: 'B' }],
      },
      { name: 'match_id', description: '対象マッチID（未指定なら最新）', type: 4, required: false },
    ],
  },
  {
    name: 'set_points',
    description: '勝敗ポイント/連勝上限/連敗上限を設定（例: `/set_points win:5 loss:-3 streak_cap:2 loss_streak_cap:2`）',
    options: [
      { name: 'win', description: '勝利ポイント（例: 3）', type: 4, required: false },
      { name: 'loss', description: '敗北ポイント（例: -2）', type: 4, required: false },
      { name: 'streak_cap', description: '連勝ボーナス上限（例: 3）', type: 4, required: false },
      { name: 'loss_streak_cap', description: '連敗ペナルティ上限（例: 3）', type: 4, required: false },
    ],
  },
  { name: 'show_points', description: '現在のポイント設定を表示（例: `/show_points`）' },
  { name: 'rank', description: 'ランキング表示（例: `/rank`）' },
  {
    name: 'join_name',
    description: 'ユーザー名だけで参加者に追加（例: `/join_name name:たろう points:320`）',
    options: [
      { name: 'name', description: '表示名', type: 3, required: true },
      { name: 'points', description: '初期ポイント（省略時300）', type: 4, required: false },
    ],
  },
  { name: 'help', description: 'コマンド一覧を表示' },
];

// ========= コマンド登録 =========
// 単一ギルド or グローバル（既存互換）
if (process.argv[2] === 'register' || process.argv[2] === 'register-global') {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  (async () => {
    let appId = CLIENT_ID;
    if (!appId) {
      const tmp = new Client({ intents: [] });
      await tmp.login(TOKEN);
      appId = tmp.user.id;
      await tmp.destroy();
    }
    if (process.argv[2] === 'register-global') {
      await rest.put(Routes.applicationCommands(appId), { body: commands });
      console.log('Global commands registered.');
    } else {
      if (!GUILD_ID) throw new Error('GUILD_ID is required for guild registration');
      await rest.put(Routes.applicationGuildCommands(appId, GUILD_ID), { body: commands });
      console.log('Guild commands registered.');
    }
    process.exit(0);
  })().catch((e) => { console.error(e); process.exit(1); });
}

// ★ グローバルコマンドを全消去
if (process.argv[2] === 'clear-global') {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  (async () => {
    let appId = CLIENT_ID;
    if (!appId) {
      const tmp = new Client({ intents: [] });
      await tmp.login(TOKEN);
      appId = tmp.user.id;
      await tmp.destroy();
    }
    await rest.put(Routes.applicationCommands(appId), { body: [] });
    console.log('Global commands cleared.');
    process.exit(0);
  })().catch((e) => { console.error(e); process.exit(1); });
}

// 複数ギルド一括登録
if (process.argv[2] === 'guild-register') {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  (async () => {
    let appId = CLIENT_ID;
    if (!appId) {
      const tmp = new Client({ intents: [] });
      await tmp.login(TOKEN);
      appId = tmp.user.id;
      await tmp.destroy();
    }
    if (!GUILD_IDS.length) throw new Error('GUILD_IDS または GUILD_ID を設定してください（カンマ区切り可）');
    for (const gid of GUILD_IDS) {
      await rest.put(Routes.applicationGuildCommands(appId, gid), { body: commands });
      console.log(`Guild commands registered for ${gid}`);
    }
    process.exit(0);
  })().catch((e) => { console.error(e); process.exit(1); });
}

client.once('clientReady', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// ===== helpers =====
// 重複参加チェック：同じDiscordユーザーが異なる方法で参加していないかチェック
function checkDuplicateParticipation(guildId, messageId, targetUserId) {
  const participants = listParticipants.all(guildId, messageId);
  
  // 直接的な重複チェック
  const directMatch = participants.some(p => p.user_id === targetUserId);
  
  // ユーザー名ベースの重複チェック
  let nameBasedDuplicates = [];
  
  if (!targetUserId.startsWith('name:')) {
    // 実ユーザーの場合、そのユーザーの可能な名前で疑似参加していないかチェック
    const member = client.guilds.cache.get(guildId)?.members?.cache.get(targetUserId);
    if (member) {
      const possibleNames = [
        member.displayName,
        member.user.username,
        member.user.globalName,
        normalizeDisplayName(member.displayName),
        normalizeDisplayName(member.user.username),
        `@${member.displayName}`,
        `@${member.user.username}`
      ].filter(Boolean).filter((name, index, arr) => arr.indexOf(name) === index); // 重複除去
      
      const possiblePseudoIds = [];
      possibleNames.forEach(name => {
        possiblePseudoIds.push(`name:${name}`);
        for (let i = 2; i <= 10; i++) {
          possiblePseudoIds.push(`name:${name}#${i}`);
        }
      });
      
      nameBasedDuplicates = participants.filter(p => possiblePseudoIds.includes(p.user_id));
    }
  }
  
  const isDuplicate = directMatch || nameBasedDuplicates.length > 0;
  
  console.log(`Duplicate check for ${targetUserId}:`);
  console.log(`- Direct match: ${directMatch}`);
  console.log(`- Name-based duplicates: ${nameBasedDuplicates.map(d => d.user_id).join(', ')}`);
  console.log(`- Is duplicate: ${isDuplicate}`);
  
  return {
    isDuplicate,
    realUserExists: directMatch,
    pseudoUserIds: nameBasedDuplicates.map(d => d.user_id),
    totalParticipations: (directMatch ? 1 : 0) + nameBasedDuplicates.length
  };
}

// 2. 既存ユーザーの重複を強制的に統合する関数
function forceConsolidateUser(guildId, userId) {
  try {
    // そのユーザーのすべてのレコードを取得
    const allRecords = db.prepare(`
      SELECT * FROM users WHERE guild_id = ? AND user_id = ?
    `).all(guildId, userId);
    
    if (allRecords.length <= 1) return false; // 重複なし
    
    console.log(`Consolidating ${allRecords.length} records for user ${userId}`);
    
    // 最新の表示名を取得
    const member = client.guilds.cache.get(guildId)?.members?.cache.get(userId);
    const latestDisplayName = normalizeDisplayName(
      member?.displayName || member?.user?.username || allRecords[0].username || userId
    );
    
    // 最良のデータを選択（試合数、ポイントなどを考慮）
    const bestRecord = allRecords.reduce((best, current) => {
      const bestGames = (best.wins || 0) + (best.losses || 0);
      const currentGames = (current.wins || 0) + (current.losses || 0);
      
      // より多くの試合をしている方を選択、同じなら高いポイントの方
      if (currentGames > bestGames) return current;
      if (currentGames === bestGames && (current.points || 0) > (best.points || 0)) return current;
      return best;
    });
    
    // すべてのレコードを削除
    db.prepare(`DELETE FROM users WHERE guild_id = ? AND user_id = ?`).run(guildId, userId);
    
    // 統合されたレコードを作成
    const insertStmt = db.prepare(`
      INSERT INTO users (guild_id, user_id, username, points, wins, losses, win_streak, loss_streak)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    insertStmt.run(
      guildId,
      userId,
      latestDisplayName,
      bestRecord.points || 300,
      bestRecord.wins || 0,
      bestRecord.losses || 0,
      bestRecord.win_streak || 0,
      bestRecord.loss_streak || 0
    );
    
    console.log(`Consolidated user ${userId} -> "${latestDisplayName}" with ${bestRecord.points || 300} points`);
    return true;
    
  } catch (error) {
    console.error(`Error consolidating user ${userId}:`, error);
    return false;
  }
}


// 1. 表示名を正規化する関数
function normalizeDisplayName(name) {
  if (!name) return name;
  // @記号を削除し、前後の空白を除去
  return name.replace(/^@+/, '').trim();
}

// ensureUserRow関数を修正して、常に最新の表示名で更新
// 2. ensureUserRow関数を修正して重複を防ぐ
function ensureUserRow(gid, user) {
  const member = client.guilds.cache.get(gid)?.members?.cache.get(user.id);
  let displayName = member?.displayName || user.displayName || user.username || `user_${user.id}`;
  
  // 表示名を正規化
  displayName = normalizeDisplayName(displayName);
  
  // 既存のレコードをチェックして統合
  const existing = getUser.get(gid, user.id);
  if (existing) {
    // 既存レコードがある場合は表示名のみ更新
    const stmt = db.prepare(`
      UPDATE users 
      SET username = ? 
      WHERE guild_id = ? AND user_id = ?
    `);
    stmt.run(displayName, gid, user.id);
  } else {
    // 新規作成
    upsertUser.run({
      guild_id: gid,
      user_id: user.id,
      username: displayName
    });
  }
  
  console.log(`ensureUserRow: ${user.id} -> "${displayName}"`);
}

// 勝敗登録時の表示も修正
// function formatResultLine(before, delta1, delta2, after, user_id, username) {
//   const d1 = delta1 >= 0 ? `+${delta1}` : `${delta1}`;
//   const d2 = delta2 ? (delta2 >= 0 ? ` +${delta2}` : ` ${delta2}`) : '';
//   const base = `${before} ${d1}${d2} => ${after}`;
  
//   let label;
//   if (user_id.startsWith('name:')) {
//     label = username || user_id.replace(/^name:/, '');
//   } else {
//     label = `<@${user_id}>`;
//   }
  
//   return `${label}: ${base}`;
// }

// === 応答安定化ヘルパー ===
// 期限内なら deferReply、期限切れ(10062)なら false を返す
async function tryDefer(interaction, opts) {
  if (interaction.deferred || interaction.replied) return true;
  try {
    await interaction.deferReply(opts);
    return true;
  } catch (e) {
    if (e?.code === 10062) return false;
    throw e;
  }
}

// 最終返信：defer 済みなら editReply、未deferなら reply、どちらも失敗ならチャンネル送信
async function sendFinal(interaction, payload, acked) {
  try {
    const already = acked ?? (interaction.deferred || interaction.replied);
    if (already) return await interaction.editReply(payload);
    return await interaction.reply(payload);
  } catch (e) {
    if (e?.code === 10062 || e?.code === 40060) {
      try {
        const channel = interaction.channel ?? (interaction.channelId ? await interaction.client.channels.fetch(interaction.channelId) : null);
        if (channel) {
          const text = typeof payload === 'string' ? payload : (payload?.content ?? '（応答に失敗しました）');
          return await channel.send(text);
        }
      } catch (_) {}
    }
    throw e;
  }
}

//08/24 19:34
// formatTeamLines 関数を index.js 内で定義
function formatTeamLines(team) {
  return team.map((user) => {
    const points = user.points ?? 300;
    let displayName;
    
    // 疑似ユーザー（name:で始まるID）の場合は、usernameをそのまま表示
    if (user.user_id.startsWith('name:')) {
      displayName = user.username || user.user_id.replace(/^name:/, '');
    } else {
      // 実際のDiscordユーザーの場合はメンション形式
      displayName = `<@${user.user_id}>`;
    }
    
    return `${displayName} (⭐${points})`;
  }).join('\n');
}

// formatResultLine 関数も修正
function formatResultLine(before, delta1, delta2, after, user_id, username) {
  const d1 = delta1 >= 0 ? `+${delta1}` : `${delta1}`;
  const d2 = delta2 ? (delta2 >= 0 ? ` +${delta2}` : ` ${delta2}`) : '';
  const base = `${before} ${d1}${d2} => ${after}`;
  
  let label;
  if (user_id.startsWith('name:')) {
    label = username || user_id.replace(/^name:/, '');
  } else {
    label = `<@${user_id}>`;
  }
  
  return `${label}: ${base}`;
}

// show_participants コマンドの修正版
function formatParticipantsList(list) {
  return list.map((p) => {
    // 疑似ユーザーの場合は username をそのまま表示
    if (p.user_id.startsWith('name:')) {
      return p.username || p.user_id.replace(/^name:/, '');
    } else {
      // 実際のDiscordユーザーの場合はメンション形式
      return `<@${p.user_id}>`;
    }
  }).join(', ');
}

// rank表示用の名前フォーマット関数
function formatRankDisplayName(user_id, username) {
  if (user_id.startsWith('name:')) {
    return username || user_id.replace(/^name:/, '');
  } else {
    return username || user_id;
  }
}

// ===== Slash command handling =====
client.on(Events.InteractionCreate, async (interaction) => {
  console.log('[start_signup]', { id: interaction.id, pid: process.pid, ts: Date.now() });
  if (!interaction.isCommand()) return;
  const gid = interaction.guildId;
  const name = interaction.commandName;

  try {
    // --- /start_signup ---
    if (name === 'start_signup') {
      const acked = await tryDefer(interaction);
      const embed = new EmbedBuilder()
        .setTitle('参加受付中')
        .setDescription('✋ 参加 / ✅ バランス分け / 🎲 ランダム分け（強さ無視）');

      let msg;
      if (acked) {
        // defer 済み → editReply → fetchReply（※editReplyにfetchReplyは渡さない）
        await interaction.editReply({ embeds: [embed] });
        msg = await interaction.fetchReply();
      } else {
        // 未ACK → 通常 reply（期限切れならチャンネル送信にフォールバック）
        try {
          await interaction.reply({ embeds: [embed] });
          msg = await interaction.fetchReply();
        } catch (e) {
          const channel = interaction.channel ?? (interaction.channelId ? await interaction.client.channels.fetch(interaction.channelId) : null);
          if (!channel) throw e;
          msg = await channel.send({ embeds: [embed] });
        }
      }

      try {
        await msg.react(JOIN_EMOJI);
        await msg.react(OK_EMOJI);
        await msg.react(DICE_EMOJI);
      } catch (e) {
        console.error('failed to add reactions', e);
      }
      createSignup.run(gid, msg.id, msg.channelId, interaction.user.id, Date.now());
      return;
    }

    // show_participants コマンドの表示も修正
    if (name === 'show_participants') {
      const row = latestSignupMessageId.get(gid);
      if (!row) return interaction.reply('現在受付中の募集はありません。');
      const list = listParticipants.all(gid, row.message_id);
      if (!list.length) return interaction.reply('現在の参加者はいません。');
      
      const names = list.map((p) => {
        // 疑似ユーザーの場合は username をそのまま表示
        if (p.user_id.startsWith('name:')) {
          return p.username || p.user_id.replace(/^name:/, '');
        } else {
          // 実際のDiscordユーザーの場合はメンション形式
          return `<@${p.user_id}>`;
        }
      }).join(', ');
      
      return interaction.reply(`参加者: ${names}`);
    }

    if (name === 'reset_participants') {
      const row = latestSignupMessageId.get(gid);
      if (!row) return interaction.reply('現在受付中の募集はありません。');
      clearParticipantsByMessage.run(gid, row.message_id);
      return interaction.reply('参加者をリセットしました。');
    }

    if (name === 'leave') {
      const row = latestSignupMessageId.get(gid);
      if (!row) return interaction.reply('現在受付中の募集はありません。');
      removeParticipant.run(gid, row.message_id, interaction.user.id);
      return interaction.reply('あなたを参加リストから外しました。');
    }

    if (name === 'kick_from_lol') {
      const user = interaction.options.getUser('user', true);
      const row = latestSignupMessageId.get(gid);
      if (!row) return interaction.reply('現在受付中の募集はありません。');
      removeParticipant.run(gid, row.message_id, user.id);
      return interaction.reply(`${user.username} を参加リストから外しました。`);
    }

    // --- 強さ設定 ---
    // set_strengthコマンドも修正して表示名を統一
    if (name === 'set_strength') {
      const user = interaction.options.getUser('user', true);
      const points = interaction.options.getInteger('points', true);
      
      // ユーザー情報を最新の表示名で登録
      ensureUserRow(gid, user);
      
      // 表示名取得
      const member = interaction.guild?.members?.cache.get(user.id);
      const displayName = member?.displayName || user.username;
      
      setStrength.run(gid, user.id, displayName, points);
      return interaction.reply(`${displayName} の強さを ${points} に設定しました。`);
    }

    // --- チーム分け（/team /team_simple） ---
    if (name === 'team' || name === 'team_simple') {
      const acked = await tryDefer(interaction);
      const row = latestSignupMessageId.get(gid);
      if (!row) return sendFinal(interaction, '現在受付中の募集はありません。', acked);
      const raw = listParticipants.all(gid, row.message_id);
      if (raw.length < 2) return sendFinal(interaction, '参加者が足りません。', acked);

      const enriched = raw.map((p) => {
        const u = getUser.get(gid, p.user_id);
        return {
          user_id: p.user_id,
          username: u?.username || p.username || p.user_id,
          points: u?.points ?? 300,
        };
      });

      let teamA, teamB, signature;
      if (name === 'team') {
        const prev = getLastSignature.get(gid)?.signature || null;
        const res = splitBalanced(enriched, prev);
        teamA = res.teamA; teamB = res.teamB; signature = res.signature;
        setLastSignature.run(gid, signature);
      } else {
        const rand = splitRandom(enriched);
        teamA = rand.teamA; teamB = rand.teamB;
        signature = null; // ランダムは署名は更新しない
      }

      const sumA = teamA.reduce((s, u) => s + (u.points ?? 300), 0);
      const sumB = teamB.reduce((s, u) => s + (u.points ?? 300), 0);
      const titleA = name === 'team' ? `Team A (${teamA.length})｜⭐合計 ${sumA}` : `Team A (${teamA.length})`;
      const titleB = name === 'team' ? `Team B (${teamB.length})｜⭐合計 ${sumB}` : `Team B (${teamB.length})`;

      const matchId = createMatch.run(
        gid,
        row.message_id,
        JSON.stringify(teamA.map((u) => u.user_id)),
        JSON.stringify(teamB.map((u) => u.user_id)),
        Date.now()
      ).lastInsertRowid;

      const embed = new EmbedBuilder()
        .setTitle(`マッチ ID: ${matchId}`)
        .addFields(
          { name: titleA, value: formatTeamLines(teamA), inline: true },
          { name: '\u200B', value: '\u200B', inline: true }, // 中央スペーサ
          { name: titleB, value: formatTeamLines(teamB), inline: true },
        );
      return sendFinal(interaction, { embeds: [embed] }, acked);
    }

    // --- 勝敗登録（/result /win） ---
    if (name === 'result' || name === 'win') {
      const acked = await tryDefer(interaction);

      const winner = name === 'result'
        ? interaction.options.getString('winner', true)
        : interaction.options.getString('team', true);
      const matchIdOpt = interaction.options.getInteger('match_id');
      const match = matchIdOpt ? getMatchById.get(matchIdOpt, gid) : getLatestMatch.get(gid);
      if (!match) {
        if (acked) await interaction.editReply('対象マッチが見つかりません。');
        else {
          try { await interaction.reply('対象マッチが見つかりません。'); }
          catch { const ch = interaction.channel ?? (interaction.channelId ? await interaction.client.channels.fetch(interaction.channelId) : null); if (ch) await ch.send('対象マッチが見つかりません。'); }
        }
        return;
      }

      const cfg = getPointsConfig();
      const teamA = JSON.parse(match.team_a);
      const teamB = JSON.parse(match.team_b);
      const winners = winner === 'A' ? teamA : teamB;
      const losers  = winner === 'A' ? teamB : teamA;

      const winnerLines = [];
      const loserLines = [];

      // 勝者：2連勝目から +1、連敗はリセット
      for (const uid of winners) {
        const beforeRow = getUser.get(gid, uid);
        const before = beforeRow?.points ?? 300;
        const streakBefore = (getStreak.get(gid, uid)?.win_streak) ?? 0;
        const bonus = Math.min(streakBefore, cfg.streak_cap);
        const delta = cfg.win + bonus;
        addWinLoss.run(1, 0, delta, gid, uid);
        incStreak.run(cfg.streak_cap, gid, uid);
        resetLossStreak.run(gid, uid);
        const after = before + delta;
        const username = beforeRow?.username || uid;
        winnerLines.push(formatResultLine(before, cfg.win, bonus, after, uid, username));
      }

      // 敗者：2連敗目から -1（上限あり）。勝利ストリークリセット
      for (const uid of losers) {
        const beforeRow = getUser.get(gid, uid);
        const before = beforeRow?.points ?? 300;
        const lsBefore = (getLossStreak.get(gid, uid)?.loss_streak) ?? 0;
        const lcap = cfg.loss_streak_cap ?? cfg.streak_cap;
        const penalty = Math.min(lsBefore, lcap);
        const delta = cfg.loss - penalty;
        addWinLoss.run(0, 1, delta, gid, uid);
        incLossStreak.run(lcap, gid, uid);
        resetStreak.run(gid, uid);
        const after = before + delta;
        const username = beforeRow?.username || uid;
        loserLines.push(formatResultLine(before, cfg.loss, -penalty, after, uid, username));
      }

      setMatchWinner.run(winner, match.id, gid);

      // ★ 表示を「勝利／敗北」に統一（Team表記を排除）
      const text = [
        `勝敗登録: Team ${winner} の勝利を記録しました。`,
        '',
        `# 勝利`,
        ...(winnerLines.length ? winnerLines : ['- 変更なし']),
        '',
        `# 敗北`,
        ...(loserLines.length ? loserLines : ['- 変更なし']),
      ].join('\n');

      // ここを「単一路線」に
      if (acked) {
        await interaction.editReply(text);
      } else {
        try { await interaction.reply(text); }
        catch {
          const ch = interaction.channel ?? (interaction.channelId ? await interaction.client.channels.fetch(interaction.channelId) : null);
          if (ch) await ch.send(text);
        }
      }
      return;
    }

    // --- ポイント設定/表示・ランク ---
    if (name === 'set_points') {
      const needManage = interaction.member?.permissions?.has?.(PermissionsBitField.Flags.ManageGuild);
      // 必要なら権限制御を有効化:
      // if (!needManage) return interaction.reply('このコマンドは Manage Server 権限者のみ実行できます。');

      const win  = interaction.options.getInteger('win');
      const loss = interaction.options.getInteger('loss');
      const cap  = interaction.options.getInteger('streak_cap');
      const lcap = interaction.options.getInteger('loss_streak_cap');

      updatePointsConfig({ win, loss, streak_cap: cap, loss_streak_cap: lcap });
      const cfg = getPointsConfig();
      return interaction.reply(
        `ポイント設定を更新しました: win=${cfg.win}, loss=${cfg.loss}, ` +
        `streak_cap=${cfg.streak_cap}, loss_streak_cap=${cfg.loss_streak_cap}`
      );
    }

    if (name === 'show_points') {
      const cfg = getPointsConfig();
      return interaction.reply(
        `現在のポイント設定: win=${cfg.win}, loss=${cfg.loss}, ` +
        `streak_cap=${cfg.streak_cap}, loss_streak_cap=${cfg.loss_streak_cap}`
      );
    }

    // rankコマンドの表示も修正（必要に応じて）
    if (name === 'rank') {
      const acked = await tryDefer(interaction);
      
      // まず重複ユーザーを自動統合
      const allUsers = db.prepare(`
        SELECT DISTINCT user_id FROM users WHERE guild_id = ? AND NOT user_id LIKE 'name:%'
      `).all(gid);
      
      let consolidatedCount = 0;
      for (const userRow of allUsers) {
        if (forceConsolidateUser(gid, userRow.user_id)) {
          consolidatedCount++;
        }
      }
      
      if (consolidatedCount > 0) {
        console.log(`Auto-consolidated ${consolidatedCount} duplicate users before showing rank`);
      }
      
      // 統合後のランキングを取得
      const rows = topRanks.all(gid);
      if (!rows.length) return sendFinal(interaction, 'ランキングはまだありません。', acked);
      
      const lines = rows.map((r, i) => {
        const rate = Math.round((r.winrate || 0) * 100);
        const displayName = formatRankDisplayName(r.user_id, r.username);
        return `${i + 1}. ${displayName} — ⭐${r.points} / ${r.wins}W-${r.losses}L / ${rate}% (WS:${r.win_streak})`;
      });
      
      const response = ['ランキング:', ...lines].join('\n');
      if (consolidatedCount > 0) {
        response += `\n\n（${consolidatedCount}人の重複データを自動統合しました）`;
      }
      
      return sendFinal(interaction, response, acked);
    }

    // --- /join_name ---
// // /join_name コマンドの処理部分を修正
    if (name === 'join_name') {
      const row = latestSignupMessageId.get(gid);
      if (!row) return interaction.reply('現在受付中の募集はありません。');

      const nameArg = interaction.options.getString('name', true).trim();
      const pointsArg = interaction.options.getInteger('points');
      const userArg = interaction.options.getUser('user');

      let uid, displayName;

      if (userArg) {
        // 既存のDiscordユーザーが指定された場合
        uid = userArg.id;
        displayName = normalizeDisplayName(nameArg);
        
        // ★ より厳格な重複チェック
        const participants = listParticipants.all(gid, row.message_id);
        
        // 1. 直接参加チェック
        const directParticipation = participants.some(p => p.user_id === uid);
        
        // 2. 名前ベース参加チェック
        const member = interaction.guild?.members?.cache.get(uid);
        let nameBasedParticipation = [];
        
        if (member) {
          const allPossibleNames = [
            member.displayName,
            member.user.username,
            member.user.globalName,
            normalizeDisplayName(member.displayName),
            normalizeDisplayName(member.user.username),
            normalizeDisplayName(member.user.globalName),
            `@${member.displayName}`,
            `@${member.user.username}`,
            nameArg,
            normalizeDisplayName(nameArg)
          ].filter(Boolean).filter((name, index, arr) => arr.indexOf(name) === index);
          
          nameBasedParticipation = participants.filter(p => {
            if (!p.user_id.startsWith('name:')) return false;
            const nameFromId = p.user_id.replace(/^name:/, '').replace(/#\d+$/, '');
            return allPossibleNames.includes(nameFromId);
          });
        }
        
        if (directParticipation || nameBasedParticipation.length > 0) {
          let message = `<@${uid}> は既に参加済みです。`;
          const details = [];
          
          if (directParticipation) {
            details.push('リアクション参加');
          }
          if (nameBasedParticipation.length > 0) {
            details.push(`name参加（${nameBasedParticipation.map(p => p.user_id).join(', ')}）`);
          }
          
          if (details.length > 0) {
            message += `（${details.join(' + ')}）`;
          }
          
          console.log(`join_name blocked duplicate: ${userArg.username} (${uid})`);
          return interaction.reply(message);
        }
        
        // 既存データを統合
        forceConsolidateUser(gid, uid);
        
        // ユーザー登録
        ensureUserRow(gid, userArg);
        
        // 表示名を正規化して更新
        const stmt = db.prepare(`
          UPDATE users 
          SET username = ? 
          WHERE guild_id = ? AND user_id = ?
        `);
        stmt.run(displayName, gid, uid);
        
      } else {
        // 疑似ユーザーの場合
        const normalizedName = normalizeDisplayName(nameArg);
        const existing = listParticipants.all(gid, row.message_id).map(p => p.user_id);
        const baseId = `name:${normalizedName}`;
        uid = baseId;
        let c = 2;
        while (existing.includes(uid)) {
          uid = `${baseId}#${c++}`;
        }
        displayName = normalizedName;
        
        upsertUser.run({ guild_id: gid, user_id: uid, username: displayName });
      }

      // ポイント設定
      if (pointsArg !== null && pointsArg !== undefined) {
        setStrength.run(gid, uid, displayName, pointsArg);
      }

      // 参加者表へ追加
      addParticipant.run(gid, row.message_id, uid, displayName);
      
      const userMention = userArg ? ` (<@${uid}>)` : '';
      return interaction.reply(`**${displayName}**${userMention} を参加者に追加しました${pointsArg!=null?`（⭐${pointsArg}）`:''}。`);
    }
  } catch (e) {
    console.error(e);
    await sendFinal(interaction, '内部エラーが発生しました。ログを確認してください。');
  }
});

// ===== Message shortcuts: "win a" / "win b" =====
client.on('messageCreate', async (msg) => {
  try {
    if (msg.author.bot) return;

    const m = msg.content.trim().toLowerCase();
    if (m !== 'win a' && m !== 'win b') return;

    // 直近のマッチ（ギルド毎）
    const match = getLatestMatch.get(msg.guildId);
    if (!match) return msg.reply('対象マッチが見つかりません。');
    if (match.winner) return; // 既に登録済み → 何もしない（重複防止）

    const winner = m.endsWith('a') ? 'A' : 'B';

    // /win と同じ集計ロジック
    const cfg = getPointsConfig();
    const teamA = JSON.parse(match.team_a);
    const teamB = JSON.parse(match.team_b);
    const winners = winner === 'A' ? teamA : teamB;
    const losers  = winner === 'A' ? teamB : teamA;

    const winnerLines = [];
    const loserLines = [];

    // 勝者：2連勝目から +1、連敗はリセット
    for (const uid of winners) {
      const beforeRow = getUser.get(msg.guildId, uid);
      const before = beforeRow?.points ?? 300;
      const streakBefore = (getStreak.get(msg.guildId, uid)?.win_streak) ?? 0;
      const bonus = Math.min(streakBefore, cfg.streak_cap); // 初勝利は +0
      const delta = cfg.win + bonus;

      addWinLoss.run(1, 0, delta, msg.guildId, uid);
      incStreak.run(cfg.streak_cap, msg.guildId, uid);
      resetLossStreak.run(msg.guildId, uid);

      const after = before + delta;
      const username = beforeRow?.username || uid;
      // formatResultLine を使って統一された表示
      winnerLines.push(formatResultLine(before, cfg.win, bonus, after, uid, username));
    }

    // 敗者：2連敗目から -1（上限あり）。勝利ストリークリセット
    for (const uid of losers) {
      const beforeRow = getUser.get(msg.guildId, uid);
      const before = beforeRow?.points ?? 300;

      const lsBefore = (getLossStreak.get(msg.guildId, uid)?.loss_streak) ?? 0;
      const lcap = cfg.loss_streak_cap ?? cfg.streak_cap;
      const penalty = Math.min(lsBefore, lcap); // 初敗北は 0
      const delta = cfg.loss - penalty;        // 例: -2 -1 = -3

      addWinLoss.run(0, 1, delta, msg.guildId, uid);
      incLossStreak.run(lcap, msg.guildId, uid);
      resetStreak.run(msg.guildId, uid);

      const after = before + delta;
      const username = beforeRow?.username || uid;
      // formatResultLine を使って統一された表示
      loserLines.push(formatResultLine(before, cfg.loss, -penalty, after, uid, username));
    }

    setMatchWinner.run(winner, match.id, msg.guildId);

    // ★ こちらも「勝利／敗北」表示に統一
    const text = [
      `**勝敗登録: Team ${winner} の勝利**`,
      '',
      `**勝利**`,
      ...winnerLines.map(line => `• ${line}`),
      '',
      `**敗北**`,
      ...loserLines.map(line => `• ${line}`),
    ].join('\n');

    return msg.reply(text);
  } catch (e) {
    console.error(e);
    try { await msg.reply('内部エラーが発生しました。ログを確認してください。'); } catch {}
  }
});

// ===== Reaction handling (✋ / ✅ / 🎲) =====
// リアクション処理部分も少し修正（重複チェック追加）
client.on('messageReactionAdd', async (reaction, user) => {
  try {
    if (user.bot) return;
    if (reaction.partial) await reaction.fetch();

    const message = reaction.message;
    const gid = message.guildId;
    const emoji = reaction.emoji.name;

    if (![JOIN_EMOJI, OK_EMOJI, DICE_EMOJI].includes(emoji)) return;

    const row = latestSignupMessageId.get(gid);
    if (!row || row.message_id !== message.id) return;

    if (emoji === JOIN_EMOJI) {
      // ★ 厳格な重複チェック
      const participants = listParticipants.all(gid, message.id);
      
      // 1. 直接的な重複チェック
      const alreadyJoined = participants.some(p => p.user_id === user.id);
      
      if (alreadyJoined) {
        console.log(`${user.username} already joined directly, removing reaction`);
        try {
          await reaction.users.remove(user.id);
        } catch (e) {
          console.log('Failed to remove duplicate reaction:', e.message);
        }
        return;
      }
      
      // 2. 名前ベースの重複チェック
      const member = message.guild?.members?.cache.get(user.id);
      if (member) {
        const userNames = [
          normalizeDisplayName(member.displayName),
          normalizeDisplayName(member.user.username),
          normalizeDisplayName(member.user.globalName),
          member.displayName,
          member.user.username,
          member.user.globalName,
          `@${member.displayName}`,
          `@${member.user.username}`
        ].filter(Boolean).filter((name, index, arr) => arr.indexOf(name) === index);
        
        const nameBasedDuplicates = participants.filter(p => {
          if (!p.user_id.startsWith('name:')) return false;
          const nameFromId = p.user_id.replace(/^name:/, '').replace(/#\d+$/, '');
          return userNames.includes(nameFromId);
        });
        
        if (nameBasedDuplicates.length > 0) {
          console.log(`${user.username} already joined via name (${nameBasedDuplicates.map(d => d.user_id).join(', ')}), removing reaction`);
          try {
            await reaction.users.remove(user.id);
          } catch (e) {
            console.log('Failed to remove duplicate reaction:', e.message);
          }
          return;
        }
      }
      
      // 重複なし → 参加処理
      // 既存データがあれば統合
      forceConsolidateUser(gid, user.id);
      
      ensureUserRow(gid, user);
      
      const member2 = message.guild?.members?.cache.get(user.id) ?? 
                     await message.guild.members.fetch(user.id).catch(() => null);
      const displayName = normalizeDisplayName(member2?.displayName || user.username);
      
      addParticipant.run(gid, message.id, user.id, displayName);
      console.log(`${displayName} joined via reaction (user_id: ${user.id})`);
      return;
    }

    // チーム分け処理は既存のまま...
    const raw = listParticipants.all(gid, message.id);
    if (raw.length < 2) {
      await message.channel.send('参加者が足りません。');
      return;
    }
    
    const enriched = raw.map((p) => {
      const u = getUser.get(gid, p.user_id);
      return {
        user_id: p.user_id,
        username: p.username || u?.username || p.user_id,
        points: u?.points ?? 300,
      };
    });

    let teamA, teamB;
    if (emoji === OK_EMOJI) {
      const prev = getLastSignature.get(gid)?.signature || null;
      const res = splitBalanced(enriched, prev);
      teamA = res.teamA; teamB = res.teamB;
      setLastSignature.run(gid, res.signature);
    } else if (emoji === DICE_EMOJI) {
      const rand = splitRandom(enriched);
      teamA = rand.teamA; teamB = rand.teamB;
    }

    const sumA = teamA.reduce((s, u) => s + (u.points ?? 300), 0);
    const sumB = teamB.reduce((s, u) => s + (u.points ?? 300), 0);
    const titleA = emoji === OK_EMOJI ? `Team A (${teamA.length})｜⭐合計 ${sumA}` : `Team A (${teamA.length})`;
    const titleB = emoji === OK_EMOJI ? `Team B (${teamB.length})｜⭐合計 ${sumB}` : `Team B (${teamB.length})`;

    const matchId = createMatch.run(
      gid,
      message.id,
      JSON.stringify(teamA.map((u) => u.user_id)),
      JSON.stringify(teamB.map((u) => u.user_id)),
      Date.now()
    ).lastInsertRowid;

    const embed = new EmbedBuilder()
      .setTitle(`マッチ ID: ${matchId}`)
      .addFields(
        { name: titleA, value: formatTeamLines(teamA), inline: true },
        { name: '\u200B', value: '\u200B', inline: true },
        { name: titleB, value: formatTeamLines(teamB), inline: true },
      );

    await message.channel.send({ embeds: [embed] });
  } catch (e) {
    console.error('messageReactionAdd error:', e);
  }
});

// 受付メッセージのリアクション解除 → 参加解除（✋だけ）
client.on(Events.MessageReactionRemove, async (reaction, user) => {
  try {
    if (user.bot) return;
    if (reaction.partial) await reaction.fetch();

    const message = reaction.message;
    const gid = message.guildId;
    const emoji = reaction.emoji.name;

    // 参加用リアクション以外は無視
    if (emoji !== JOIN_EMOJI) return;

    // このギルドの「直近の受付」かつ、そのメッセージに限定
    const row = latestSignupMessageId.get(gid);
    if (!row || row.message_id !== message.id) return;

    // ←← ここが重要：guild_id を含めて3引数で削除
    removeParticipant.run(gid, message.id, user.id);

    // （任意の通知）
    // const count = listParticipants.all(gid, message.id).length;
    // await message.channel.send(`**${user.username}** が参加を取り消しました。（現在 ${count} 人）`);
  } catch (e) {
    console.error('ReactionRemove error', e);
  }
});

//ヘルプ
client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isChatInputCommand()) {
    const { commandName } = interaction;
    if (commandName === 'help') {
      const embed = new EmbedBuilder()
        .setTitle('コマンド一覧')
        .setColor(0x00AE86)
        .setDescription(commands.map(c => `**/${c.name}** — ${c.description}`).join('\n'));
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
  }
});

client.login(TOKEN);
