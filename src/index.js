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
  setUserRecord,
  deleteUserRecord,
  deleteFromSignupParticipants,
  deleteFromLaneSignup, 
  clearLaneSignup,
  upsertLaneParticipant,
  removeLaneParticipant,
  getLaneParticipantsByMessage,
  getLaneTeamMembers
} from './db.js';
import { splitBalanced, splitRandom } from './team.js';
import { assignLaneTeams, formatLaneTeamsEmbed } from './team_lane.js';

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
// レーン募集メッセージ（/start_lane_signupで作ったもの）だけを対象化するためのセット
const laneSignupMessages = new Set();

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
    name: 'record',
    description: '指定ユーザーの戦績（wins/losses）を上書きします（管理者用）',
    dm_permission: false,
    options: [
      { name: 'user',   description: '対象ユーザー', type: 6, required: true },
      { name: 'wins',   description: '勝利数',       type: 4, required: true, min_value: 0 },
      { name: 'losses', description: '敗北数',       type: 4, required: true, min_value: 0 }
    ]
  },
  {
    name: 'delete_user',
    description: '指定ユーザーの戦績を完全削除（管理者用）',
    default_member_permissions: "32",
    dm_permission: false,
    options: [
      { name: 'user', description: '削除する対象ユーザー', type: 6, required: true }
    ]
  },
  {
    name: 'join_name',
    description: 'ユーザー名だけで参加者に追加（例: `/join_name name:たろう points:320`）',
    options: [
      { name: 'name', description: '表示名', type: 3, required: true },
      { name: 'points', description: '初期ポイント（省略時300）', type: 4, required: false },
      { name: 'user', description: '既存Discordユーザー（省略時は疑似ユーザー）', type: 6, required: false },
    ],
  },
  { name: 'start_lane_signup', description: 'ポジション指定で参加受付（例: `/start_lane_signup`）' },
  {
    name: 'result_team',
    description: 'レーン指定チームの勝敗登録（例: `/result_team winteam:1 loseteam:2`）',
    options: [
      { name: 'winteam', description: '勝ったチームID', type: 4, required: true },
      { name: 'loseteam', description: '負けたチームID', type: 4, required: true },
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
// 表示名を正規化する関数
function normalizeDisplayName(name) {
  if (!name) return name;
  // @記号を削除し、前後の空白を除去
  return name.replace(/^@+/, '').trim();
}

// ensureUserRow関数を修正して、常に最新の表示名で更新
function ensureUserRow(gid, user) {
  const member = client.guilds.cache.get(gid)?.members?.cache.get(user.id);
  let displayName = member?.displayName || user.displayName || user.username || `user_${user.id}`;
  
  // 表示名を正規化（@記号除去）
  displayName = normalizeDisplayName(displayName);
  
  console.log(`ensureUserRow: ${user.id} "${member?.displayName || user.displayName || user.username}" -> "${displayName}"`);
  
  upsertUser.run({
    guild_id: gid,
    user_id: user.id,
    username: displayName
  });
}

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

// formatResultLine 関数
function formatResultLine(before, delta1, delta2, after, user_id, username) {
  const d1 = delta1 >= 0 ? `+${delta1}` : `${delta1}`;
  const d2 = delta2 ? (delta2 >= 0 ? ` +${delta2}` : ` ${delta2}`) : '';
  const base = `${before} ${d1}${d2} => ${after}`;
  
  let label;
  if (user_id && user_id.startsWith('name:')) {
    label = username || user_id.replace(/^name:/, '');
  } else if (user_id) {
    label = `<@${user_id}>`;
  } else {
    // 後方互換性のため
    label = username || before;
  }
  
  return `${label}: ${base}`;
}

// rank表示用の名前フォーマット関数
function formatRankDisplayName(user_id, username) {
  if (user_id.startsWith('name:')) {
    return username || user_id.replace(/^name:/, '');
  } else {
    return username || user_id;
  }
}

// === 応答安定化ヘルパー ===
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

// ===== Slash command handling =====
client.on(Events.InteractionCreate, async (interaction) => {
  console.log('[interaction]', { id: interaction.id, pid: process.pid, ts: Date.now() });
  if (!interaction.isCommand()) return;
  const gid = interaction.guildId;
  const name = interaction.commandName;

  try {
    // --- ユーザー削除 ---
    if (name === 'delete_user') {
      const userOpt = interaction.options.getUser('user', true);

      // 実行権限チェック（任意、管理者のみ）
      if (!interaction.memberPermissions?.has('ManageGuild')) {
        return interaction.reply({ content: '権限がありません。', ephemeral: true });
      }

      deleteUserRecord.run(gid, userOpt.id);
      deleteFromSignupParticipants.run(gid, userOpt.id);
      deleteFromLaneSignup.run(gid, userOpt.id);

      return interaction.reply(`🗑️ <@${userOpt.id}> の戦績を削除しました。`);
    }

    // --- 戦績を直接編集（wins/losses 上書き、ストリーク0） ---
    if (name === 'record') {
      const userOpt = interaction.options.getUser('user', true);
      const wins    = interaction.options.getInteger('wins', true);
      const losses  = interaction.options.getInteger('losses', true);

      if (wins < 0 || losses < 0) {
        return interaction.reply({ content: 'wins と losses は 0 以上で指定してください。', ephemeral: true });
      }

      // 管理者判定
      const isAdmin = interaction.memberPermissions?.has('ManageGuild');
      if (!isAdmin && interaction.user.id !== userOpt.id) {
        return interaction.reply({ content: '他人の戦績は編集できません。', ephemeral: true });
      }

      // 既存の表示名を尊重（DBにあればそれ、無ければ現在のDiscord名）
      const current  = getUser.get(gid, userOpt.id);
      const username = current?.username ?? userOpt.username;

      setUserRecord.run(gid, userOpt.id, username, wins, losses);
      const after = getUser.get(gid, userOpt.id);

      return interaction.reply(
        `✅ <@${userOpt.id}> の戦績を更新しました。\n` +
        `Wins: **${after.wins}** / Losses: **${after.losses}** / Points: **${after.points}**\n` +
        `（win_streak / loss_streak は 0 にリセット、ポイントは変更していません）`
      );
    }

    // --- /start_signup ---
    if (name === 'start_signup') {
      const acked = await tryDefer(interaction);
      const embed = new EmbedBuilder()
        .setTitle('参加受付中')
        .setDescription('✋ 参加 / ✅ バランス分け / 🎲 ランダム分け（強さ無視）');

      let msg;
      if (acked) {
        await interaction.editReply({ embeds: [embed] });
        msg = await interaction.fetchReply();
      } else {
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

    // --- 参加者表示/操作 ---
    if (name === 'show_participants') {
      const row = latestSignupMessageId.get(gid);
      if (!row) return interaction.reply('現在受付中の募集はありません。');
      const list = listParticipants.all(gid, row.message_id);
      if (!list.length) return interaction.reply('現在の参加者はいません。');
      
      const names = list.map((p) => {
        if (p.user_id.startsWith('name:')) {
          return p.username || p.user_id.replace(/^name:/, '');
        } else {
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
    if (name === 'set_strength') {
      const user = interaction.options.getUser('user', true);
      const points = interaction.options.getInteger('points', true);
      
      ensureUserRow(gid, user);
      const member = interaction.guild?.members?.cache.get(user.id);
      const displayName = normalizeDisplayName(member?.displayName || user.username);
      
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
        signature = null;
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
          { name: '\u200B', value: '\u200B', inline: true },
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
        return sendFinal(interaction, '対象マッチが見つかりません。', acked);
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

      const text = [
        `勝敗登録: Team ${winner} の勝利を記録しました。`,
        '',
        `# 勝利`,
        ...(winnerLines.length ? winnerLines : ['- 変更なし']),
        '',
        `# 敗北`,
        ...(loserLines.length ? loserLines : ['- 変更なし']),
      ].join('\n');

      return sendFinal(interaction, text, acked);
    }

    // --- ポイント設定/表示・ランク ---
    if (name === 'set_points') {
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

    if (name === 'rank') {
      const rows = topRanks.all(gid);
      if (!rows.length) return interaction.reply('ランキングはまだありません。');
      
      const lines = rows.map((r, i) => {
        const rate = Math.round((r.winrate || 0) * 100);
        const displayName = formatRankDisplayName(r.user_id, r.username);
        return `${i + 1}. ${displayName} — ⭐${r.points} / ${r.wins}W-${r.losses}L / ${rate}% (WS:${r.win_streak})`;
      });
      
      return interaction.reply(['ランキング:', ...lines].join('\n'));
    }

    // --- /join_name ---
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
        
        // ★ シンプルで確実な重複チェック
        const participants = listParticipants.all(gid, row.message_id);
        const alreadyJoined = participants.some(p => p.user_id === uid);
        
        if (alreadyJoined) {
          console.log(`BLOCKED: ${userArg.username} (${uid}) already joined`);
          return interaction.reply(`<@${uid}> は既に参加済みです。`);
        }
        
        console.log(`ALLOWING: ${userArg.username} (${uid}) to join as "${displayName}"`);
        
        // ユーザー登録
        ensureUserRow(gid, userArg);
        
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

    // --- レーン募集開始 ---
    if (name === 'start_lane_signup') {
      const embed = new EmbedBuilder()
        .setTitle('ポジション募集')
      //   .setDescription('⚔️ TOP / 🌲 JG / 🪄 MID / 🏹 ADC / ❤️ SUP\n✅でチーム分けを実行');
      // await interaction.reply({ embeds: [embed] });
      // const msg = await interaction.fetchReply();
      // for (const e of ['⚔️','🌲','🪄','🏹','❤️','✅']) {
      //   await msg.react(e);
      // }
      .setDescription('⚔️ TOP / 🌲 JG / 🪄 MID / 🏹 ADC / ❤️ SUP\n✅でチーム分けを実行');
      await interaction.reply({ embeds: [embed] });
      const msg = await interaction.fetchReply();
      laneSignupMessages.add(msg.id);                   // この募集のみ対象化
      clearLaneSignup.run(msg.id, interaction.guildId); // 同メッセージの旧登録をクリア
      for (const e of ['⚔️','🌲','🪄','🏹','❤️','✅']) await msg.react(e);
      return;
    }

    // --- レーン結果登録 ---
    if (name === 'result_team') {
      const winId  = interaction.options.getInteger('winteam');
      const loseId = interaction.options.getInteger('loseteam');
      const winners = getLaneTeamMembers.all(winId, gid);
      const losers  = getLaneTeamMembers.all(loseId, gid);
      if (!winners.length || !losers.length) {
        return interaction.reply('指定したチームが見つかりません。');
      }

      const logs = [];
      for (const p of winners) {
        const before = getUser.get(gid, p.user_id)?.points ?? 300;
        const wsBefore = getStreak.get(gid, p.user_id)?.win_streak ?? 0;
        const bonus = (wsBefore >= 1) ? (wsBefore * 2) : 0;
        const delta = 6 + bonus;
        addWinLoss.run(1, 0, delta, gid, p.user_id);
        incStreak.run(99, gid, p.user_id);
        resetLossStreak.run(gid, p.user_id);
        const after = before + delta;
        logs.push(`<@${p.user_id}> +${delta} (${before} → ${after})`);
      }
      for (const p of losers) {
        const before = getUser.get(gid, p.user_id)?.points ?? 300;
        const lsBefore = getLossStreak.get(gid, p.user_id)?.loss_streak ?? 0;
        const penalty = (lsBefore >= 1) ? (lsBefore * 2) : 0;
        const delta = -4 - penalty;
        addWinLoss.run(0, 1, delta, gid, p.user_id);
        incLossStreak.run(99, gid, p.user_id);
        resetStreak.run(gid, p.user_id);
        const after = before + delta;
        logs.push(`<@${p.user_id}> ${delta} (${before} → ${after})`);
      }
      return interaction.reply(['試合結果を登録しました。', ...logs].join('\n'));
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

    const match = getLatestMatch.get(msg.guildId);
    if (!match) return msg.reply('対象マッチが見つかりません。');
    if (match.winner) return;

    const winner = m.endsWith('a') ? 'A' : 'B';

    const cfg = getPointsConfig();
    const teamA = JSON.parse(match.team_a);
    const teamB = JSON.parse(match.team_b);
    const winners = winner === 'A' ? teamA : teamB;
    const losers  = winner === 'A' ? teamB : teamA;

    const winnerLines = [];
    const loserLines = [];

    // 勝者処理
    for (const uid of winners) {
      const beforeRow = getUser.get(msg.guildId, uid);
      const before = beforeRow?.points ?? 300;
      const streakBefore = (getStreak.get(msg.guildId, uid)?.win_streak) ?? 0;
      const bonus = Math.min(streakBefore, cfg.streak_cap);
      const delta = cfg.win + bonus;

      addWinLoss.run(1, 0, delta, msg.guildId, uid);
      incStreak.run(cfg.streak_cap, msg.guildId, uid);
      resetLossStreak.run(msg.guildId, uid);

      const after = before + delta;
      const username = beforeRow?.username || uid;
      winnerLines.push(formatResultLine(before, cfg.win, bonus, after, uid, username));
    }

    // 敗者処理
    for (const uid of losers) {
      const beforeRow = getUser.get(msg.guildId, uid);
      const before = beforeRow?.points ?? 300;

      const lsBefore = (getLossStreak.get(msg.guildId, uid)?.loss_streak) ?? 0;
      const lcap = cfg.loss_streak_cap ?? cfg.streak_cap;
      const penalty = Math.min(lsBefore, lcap);
      const delta = cfg.loss - penalty;

      addWinLoss.run(0, 1, delta, msg.guildId, uid);
      incLossStreak.run(lcap, msg.guildId, uid);
      resetStreak.run(msg.guildId, uid);

      const after = before + delta;
      const username = beforeRow?.username || uid;
      loserLines.push(formatResultLine(before, cfg.loss, -penalty, after, uid, username));
    }

    setMatchWinner.run(winner, match.id, msg.guildId);

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
      // シンプルで確実な重複チェック
      const participants = listParticipants.all(gid, message.id);
      const alreadyJoined = participants.some(p => p.user_id === user.id);
      
      if (alreadyJoined) {
        console.log(`BLOCKED: ${user.username} (${user.id}) already joined`);
        try {
          await reaction.users.remove(user.id);
        } catch (e) {
          console.log('Failed to remove reaction:', e.message);
        }
        return;
      }
      
      // ★ 表示名を最初に正規化して統一
      const member = message.guild?.members?.cache.get(user.id) ?? 
                     await message.guild.members.fetch(user.id).catch(() => null);
      let displayName = member?.displayName || user.username;
      displayName = normalizeDisplayName(displayName); // @記号除去
      
      console.log(`ALLOWING: ${user.username} (${user.id}) to join via reaction as "${displayName}"`);
      console.log(`Raw name: "${member?.displayName || user.username}" -> Normalized: "${displayName}"`);
      
      // 正規化された名前でユーザー登録
      upsertUser.run({
        guild_id: gid,
        user_id: user.id,
        username: displayName
      });
      
      // 同じ正規化された名前で参加者登録
      addParticipant.run(gid, message.id, user.id, displayName);
      console.log(`${displayName} joined via reaction (user_id: ${user.id})`);
      return;
    }

    // チーム分け処理
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

    if (emoji !== JOIN_EMOJI) return;

    const row = latestSignupMessageId.get(gid);
    if (!row || row.message_id !== message.id) return;

    removeParticipant.run(gid, message.id, user.id);
  } catch (e) {
    console.error('ReactionRemove error', e);
  }
});

// レーン募集のリアクション解除 → そのレーン参加を取り消し
client.on(Events.MessageReactionRemove, async (reaction, user) => {
  try {
    if (user.bot) return;
    if (reaction.partial) await reaction.fetch();
    const msg = reaction.message;
    if (!laneSignupMessages.has(msg.id)) return;
    const role = laneRoleMap[reaction.emoji.name];
    if (!role) return;
    removeLaneParticipant.run(msg.id, msg.guildId, user.id);
  } catch (e) {
    console.error('[laneReactionRemove]', e);
  }
});

// ===== レーン募集用リアクション処理 =====
const laneRoleMap = {
  '⚔️': 'TOP',
  '🌲': 'JG',
  '🪄': 'MID',
  '🏹': 'ADC',
  '❤️': 'SUP',
};

client.on('messageReactionAdd', async (reaction, user) => {
  try {
    if (user.bot) return;
    if (reaction.partial) await reaction.fetch();

    const msg  = reaction.message;
    const gid  = msg.guildId;
    const emoji = reaction.emoji.name;

    // /start_lane_signup で作られた募集メッセージ以外は無視（他の✅と干渉しない）
    if (!laneSignupMessages.has(msg.id)) return;

    // レーン参加（role を登録/更新）
    if (laneRoleMap[emoji]) {
      
    // サーバー表示名（ニックネーム優先）を取得
      let displayName = user.username;
      try {
        const member = await msg.guild.members.fetch(user.id);
        displayName = member?.displayName ?? user.globalName ?? user.username;
      } catch { /* 取得失敗時は従来どおり username を使用 */ }

      upsertLaneParticipant.run({
        message_id: msg.id,
        guild_id: gid,
        user_id: user.id,
        username: displayName,
        role: laneRoleMap[emoji],
      });
      console.log(`${displayName} joined as ${laneRoleMap[emoji]}`);
      return;
    }

    // ✅ が押されたらチーム分け
    if (emoji === '✅') {
      // Bot が自動で付けた ✅ は無視
      if (user.id === reaction.client.user.id) return;
      console.log('Lane team split triggered');

      // この募集に登録された参加者だけ取得 → チーム分け
      let participants = getLaneParticipantsByMessage.all(gid, msg.id, gid);
      // 表示名を最新に補正（取得失敗時はDBの名前のまま）
      try {
        const ids = [...new Set(participants.map(p => p.userId))];
        const fetched = await msg.guild.members.fetch({ user: ids, withPresences: false });
        participants = participants.map(p => {
          const m = fetched.get(p.userId);
          return m ? { ...p, username: m.displayName ?? p.username } : p;
        });
      } catch { /* 権限やIntentが無い場合はスキップ */ }
      if (!participants.length) {
        await msg.channel.send('この募集に登録された参加者がいません。');
        return;
      }
      const teams = assignLaneTeams(participants, gid);
      if (!teams.length) {
        await msg.channel.send('各レーンが揃っていないため、チームを作成できません。');
        return;
      }
      const embed = formatLaneTeamsEmbed(teams, EmbedBuilder);
      await msg.channel.send({ embeds: [embed] });
      // 多重実行を防ぐため、この募集は終了扱い
      laneSignupMessages.delete(msg.id);
    }
  } catch (e) {
    console.error('[laneReactionAdd]', e);
  }
});

// ヘルプ
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