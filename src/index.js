// src/index.js
import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  PermissionsBitField,
  REST,
  Routes,
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
import { splitBalanced, splitRandom, formatTeamLines } from './team.js';

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

// 複数ギルド一括登録（追加機能）
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

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// ===== helpers =====
function ensureUserRow(gid, user) {
  upsertUser.run({
    guild_id: gid,
    user_id: user.id,
    username: user.username || user.displayName || `user_${user.id}`
  });
}

function formatResultLine(before, delta1, delta2, after, label = '') {
  const d1 = delta1 >= 0 ? `+${delta1}` : `${delta1}`;
  const d2 = delta2 ? (delta2 >= 0 ? ` +${delta2}` : ` ${delta2}`) : '';
  const base = `${before} ${d1}${d2} => ${after}`;
  return label ? `${label}: ${base}` : base;
}

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

// ===== Slash command handling =====
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;
  const gid = interaction.guildId;
  const name = interaction.commandName;

  try {
    // --- /start_signup ---
    if (name === 'start_signup') {
      const acked = await tryDefer(interaction); // 先にACK
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
          msg = await interaction.reply({ embeds: [embed], fetchReply: true });
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
      const names = list.map((p) => `<@${p.user_id}>`).join(', ');
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
      setStrength.run(gid, user.id, user.username, points);
      return interaction.reply(`${user.username} の強さを ${points} に設定しました。`);
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

      const linesA = [];
      const linesB = [];

      // 勝者：2連勝目から +1、連敗はリセット
      for (const uid of winners) {
        const beforeRow = getUser.get(gid, uid);
        const before = beforeRow?.points ?? 300;
        const streakBefore = (getStreak.get(gid, uid)?.win_streak) ?? 0;
        const bonus = Math.min(streakBefore, cfg.streak_cap); // 初勝利は +0
        const delta = cfg.win + bonus;
        addWinLoss.run(1, 0, delta, gid, uid);
        incStreak.run(cfg.streak_cap, gid, uid);
        resetLossStreak.run(gid, uid);
        const after = before + delta;
        const label = beforeRow?.username || `<@${uid}>`;
        linesA.push(formatResultLine(before, cfg.win, bonus, after, label));
      }

      // 敗者：2連敗目から -1（上限あり）。勝利ストリークリセット
      for (const uid of losers) {
        const beforeRow = getUser.get(gid, uid);
        const before = beforeRow?.points ?? 300;
        const lsBefore = (getLossStreak.get(gid, uid)?.loss_streak) ?? 0;
        const lcap = cfg.loss_streak_cap ?? cfg.streak_cap;
        const penalty = Math.min(lsBefore, lcap); // 初敗北は 0
        const delta = cfg.loss - penalty;        // 例: -2 -1 = -3
        addWinLoss.run(0, 1, delta, gid, uid);
        incLossStreak.run(lcap, gid, uid);
        resetStreak.run(gid, uid);
        const after = before + delta;
        const label = beforeRow?.username || `<@${uid}>`;
        linesB.push(formatResultLine(before, cfg.loss, -penalty, after, label));
      }

      setMatchWinner.run(winner, match.id, gid);

      const text = [
        `勝者: Team ${winner} を登録しました。`,
        '',
        '# Team A',
        ...(linesA.length ? linesA : ['- 変更なし']),
        '',
        '# Team B',
        ...(linesB.length ? linesB : ['- 変更なし']),
      ].join('\n');

      // ←← ここを“単一路線”に
      if (acked) {
        await interaction.editReply(text);
      } else {
        try {
          await interaction.reply(text);
        } catch {
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

    if (name === 'rank') {
      const rows = topRanks.all(gid);
      if (!rows.length) return interaction.reply('ランキングはまだありません。');
      const lines = rows.map((r, i) => {
        const rate = Math.round((r.winrate || 0) * 100);
        return `${i + 1}. ${r.username || r.user_id} — ⭐${r.points} / ${r.wins}W-${r.losses}L / ${rate}% (WS:${r.win_streak})`;
      });
      return interaction.reply(['ランキング:', ...lines].join('\n'));
    }

    // --- /join_name ---
    if (name === 'join_name') {
      const row = latestSignupMessageId.get(gid);
      if (!row) return interaction.reply('現在受付中の募集はありません。');

      const nameArg = interaction.options.getString('name', true).trim();
      const pointsArg = interaction.options.getInteger('points'); // null 可

      // 衝突しない擬似IDを決定
      const existing = listParticipants.all(gid, row.message_id).map(p => p.user_id);
      const baseId = `name:${nameArg}`;
      let uid = baseId;
      let c = 2;
      while (existing.includes(uid)) {
        uid = `${baseId}#${c++}`;
      }

      // users にも登録（points 指定があれば上書き）
      upsertUser.run({ guild_id: gid, user_id: uid, username: nameArg });
      if (pointsArg !== null && pointsArg !== undefined) {
        setStrength.run(gid, uid, nameArg, pointsArg);
      }

      // 参加者表へ追加（返信はIDを見せない）
      addParticipant.run(gid, row.message_id, uid, nameArg);
      return interaction.reply(`**${nameArg}** を参加者に追加しました${pointsArg!=null?`（⭐${pointsArg}）`:''}。`);
    }
  } catch (e) {
    console.error(e);
    await sendFinal(interaction, '内部エラーが発生しました。ログを確認してください。');
  }
});

// ===== Message shortcuts: "win a" / "win b"（/win と重複しないようガード） =====
client.on('messageCreate', async (msg) => {
  try {
    if (msg.author.bot) return;

    const m = msg.content.trim().toLowerCase();
    if (m !== 'win a' && m !== 'win b') return;

    // 直近のマッチ（ギルドごと）
    const match = getLatestMatch.get(msg.guildId);
    if (!match) return msg.reply('対象マッチが見つかりません。');
    if (match.winner) return; // ★ 既に登録済み → 何もしない（重複防止）

    const winner = m.endsWith('a') ? 'A' : 'B';

    // /win と同じ集計ロジック
    const cfg = getPointsConfig();
    const teamA = JSON.parse(match.team_a);
    const teamB = JSON.parse(match.team_b);
    const winners = winner === 'A' ? teamA : teamB;
    const losers  = winner === 'A' ? teamB : teamA;

    const linesA = [];
    const linesB = [];

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
      const label = beforeRow?.username || `<@${uid}>`;
      linesA.push(`${label}: ${before} +${cfg.win}${bonus?` +${bonus}`:''} => ${after}`);
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
      const label = beforeRow?.username || `<@${uid}>`;
      linesB.push(`${label}: ${before} ${cfg.loss} ${penalty?`-${penalty}`:''} => ${after}`);
    }

    setMatchWinner.run(winner, match.id, msg.guildId);

    const text = [
      `勝者: Team ${winner} を登録しました。`,
      '',
      '# Team A',
      ...(linesA.length ? linesA : ['- 変更なし']),
      '',
      '# Team B',
      ...(linesB.length ? linesB : ['- 変更なし']),
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
      ensureUserRow(gid, user);
      addParticipant.run(gid, message.id, user.id, user.username);
      return;
    }

    // 共通：参加者読み込み → ユーザー情報付与
    const raw = listParticipants.all(gid, message.id);
    if (raw.length < 2) {
      await message.channel.send('参加者が足りません。');
      return;
    }
    const enriched = raw.map((p) => {
      const u = getUser.get(gid, p.user_id);
      return {
        user_id: p.user_id,
        username: u?.username || p.username || p.user_id,
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
      // ランダムは署名は更新しない
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
    console.error(e);
  }
});

client.login(TOKEN);
