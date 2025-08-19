import 'dotenv/config';
import {
  Client, EmbedBuilder, Events, GatewayIntentBits, Partials, REST, Routes,
  PermissionsBitField
} from 'discord.js';
import db, {
  upsertUser, getUser, setStrength, addWinLoss,
  createSignup, latestSignupMessageId, getSignup,
  addParticipant, removeParticipant, listParticipants, clearParticipantsByMessage,
  createMatch, getLatestMatch, setMatchWinner,
  setLastSignature, getLastSignature,
  topRanks, getStreak, incStreak, resetStreak,
  getSetting, setSetting
} from './db.js';
import { splitBalanced, splitSimple, formatTeamsEmbedFields, signatureOfIds } from './team.js';

const TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

const JOIN_EMOJI = '✅';
const OK_EMOJI = '🆗';
const SIMPLE_EMOJI = '🎲'; // ランダム二分割

// ===== 勝敗ポイントの可変設定（DB未設定時のデフォルト）=====
const DEFAULT_STREAK_BONUS_CAP = 3; // 連勝ボーナス上限
const DEFAULT_WIN_POINTS = 3;       // 勝利の基本ポイント
const DEFAULT_LOSS_POINTS = -2;     // 敗北の基本ポイント

function getConfigInt(key, fallback) {
  const row = getSetting.get(key);
  if (!row) return fallback;
  const v = parseInt(row.value, 10);
  return Number.isFinite(v) ? v : fallback;
}
function getPointsConfig() {
  return {
    win: getConfigInt('win_points', DEFAULT_WIN_POINTS),
    loss: getConfigInt('loss_points', DEFAULT_LOSS_POINTS),
    streakCap: getConfigInt('streak_cap', DEFAULT_STREAK_BONUS_CAP),
  };
}
function calcWinBonus(streakBefore, cap) { return Math.min(streakBefore, cap); }

// ===== ユーティリティ =====
function ensureUser(user) {
  upsertUser.run({ user_id: user.id, username: user.username || user.displayName });
}
function participantCap(arr) { return arr.length > 10 ? arr.slice(0, 10) : arr; }
function getLastInsertRowId() {
  return db.prepare('SELECT last_insert_rowid() AS id').get().id;
}
function getMatchByIdLocal(id) {
  return db.prepare('SELECT * FROM matches WHERE id=?').get(id);
}

// ===== スラッシュコマンド定義 =====
const commands = [
  { name: 'start_signup', description: '参加受付を開始（例: `/start_signup`）' },
  { name: 'show_participants', description: '現在の参加者を表示（例: `/show_participants`）' },
  { name: 'reset_participants', description: '参加者リセット（例: `/reset_participants`）' },
  { name: 'leave', description: '自分を参加リストから外す（例: `/leave`）' },
  {
    name: 'kick_from_lol',
    description: '他人を参加リストから外す（誰でも可）（例: `/kick_from_lol @user`）',
    options: [{ name: 'user', description: '対象ユーザー', type: 6, required: true }]
  },
  {
    name: 'set_strength',
    description: 'メンバーの強さを登録/再定義（例: `/set_strength @user 320`）',
    options: [
      { name: 'user', type: 6, required: true, description: '対象ユーザー' },
      { name: 'points', type: 4, required: true, description: 'ポイント値' }
    ]
  },
  { name: 'team', description: '強さを考慮したチーム分け（最大10人）（例: `/team`）' },
  { name: 'team_simple', description: '強さ無視で単純に2分割（上限なし）（例: `/team_simple`）' },
  {
    name: 'result',
    description: '勝敗登録（例: `/result A`、`/result B`、`/result A match_id:42`）',
    options: [
      { name: 'winner', type: 3, required: true, choices: [{ name: 'A', value: 'A' }, { name: 'B', value: 'B' }] },
      { name: 'match_id', type: 4, required: false, description: '対象マッチID（未指定なら最新）' }
    ]
  },
  {
    name: 'win',
    description: '簡易勝敗登録（例: `/win A`、`/win B`、`/win A match_id:42`）',
    options: [
      { name: 'team', type: 3, required: true, choices: [{ name: 'A', value: 'A' }, { name: 'B', value: 'B' }] },
      { name: 'match_id', type: 4, required: false, description: '対象マッチID（未指定なら最新）' }
    ]
  },
  { name: 'rank', description: 'ランキング表示（例: `/rank`）' },
  {
    name: 'set_points',
    description: '勝敗ポイント/連勝上限を設定（Manage Server権限者のみ）（例: `/set_points win:5 loss:-3 streak_cap:2`）',
    options: [
      { name: 'win', type: 4, required: false, description: '勝利ポイント（例: 3）' },
      { name: 'loss', type: 4, required: false, description: '敗北ポイント（例: -2）' },
      { name: 'streak_cap', type: 4, required: false, description: '連勝ボーナス上限（例: 3）' }
    ]
  },
  { name: 'show_points', description: '現在の勝敗ポイント設定を表示（例: `/show_points`）' }
];

async function registerCommands() {
  const appId = client.application?.id || (await (async () => {
    const tmp = new Client({ intents: [] }); await tmp.login(TOKEN);
    const id = tmp.user.id; await tmp.destroy(); return id;
  })());
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(appId, GUILD_ID), { body: commands });
}

client.once(Events.ClientReady, () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// ===== 勝敗処理（ユーザー毎の内訳メッセージを返す）=====
function processResult(winner, match) {
  const { win: WIN_P, loss: LOSS_P, streakCap: CAP } = getPointsConfig();

  const teamA = JSON.parse(match.team_a);
  const teamB = JSON.parse(match.team_b);
  const linesA = [];
  const linesB = [];
  const getBefore = (uid) => (getUser.get(uid)?.points ?? 300);
  const getName   = (uid) => (getUser.get(uid)?.username ?? uid);

  if (winner === 'A') {
    // 勝者A
    for (const uid of teamA) {
      const before = getBefore(uid);
      const streakBefore = (getStreak.get(uid)?.win_streak) ?? 0;
      const bonus = calcWinBonus(streakBefore, CAP);
      const delta = WIN_P + bonus;
      addWinLoss.run(1, 0, delta, uid);
      incStreak.run(uid);
      const after = before + delta;
      linesA.push(`${getName(uid)}: ${before} + ${WIN_P}${bonus ? ` + ${bonus}（連勝ボーナス）` : ''} => ${after}`);
    }
    // 敗者B
    for (const uid of teamB) {
      const before = getBefore(uid);
      addWinLoss.run(0, 1, LOSS_P, uid);
      resetStreak.run(uid);
      const after = before + LOSS_P;
      linesB.push(`${getName(uid)}: ${before} ${LOSS_P >= 0 ? '+' : ''}${LOSS_P} => ${after}`);
    }
  } else {
    // 勝者B
    for (const uid of teamB) {
      const before = getBefore(uid);
      const streakBefore = (getStreak.get(uid)?.win_streak) ?? 0;
      const bonus = calcWinBonus(streakBefore, CAP);
      const delta = WIN_P + bonus;
      addWinLoss.run(1, 0, delta, uid);
      incStreak.run(uid);
      const after = before + delta;
      linesB.push(`${getName(uid)}: ${before} + ${WIN_P}${bonus ? ` + ${bonus}（連勝ボーナス）` : ''} => ${after}`);
    }
    // 敗者A
    for (const uid of teamA) {
      const before = getBefore(uid);
      addWinLoss.run(0, 1, LOSS_P, uid);
      resetStreak.run(uid);
      const after = before + LOSS_P;
      linesA.push(`${getName(uid)}: ${before} ${LOSS_P >= 0 ? '+' : ''}${LOSS_P} => ${after}`);
    }
  }

  setMatchWinner.run(winner, match.id);

  const msg = [
    `勝者: Team ${winner} を登録しました。（連勝ボーナス適用）`,
    '',
    `# Team A`,
    ...(linesA.length ? linesA : ['- 変更なし']),
    '',
    `# Team B`,
    ...(linesB.length ? linesB : ['- 変更なし'])
  ].join('\n');

  return msg;
}

// ===== Interaction =====
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName } = interaction;

  if (commandName === 'start_signup') {
    // 1) 直前の受付参加者をリセット
    const prev = latestSignupMessageId.get()?.message_id;
    if (prev) {
      clearParticipantsByMessage.run(prev);
    }

    // 2) 新しい受付メッセージ
    const embed = new EmbedBuilder()
      .setTitle('参加受付')
      .setDescription(
        `参加する人は ${JOIN_EMOJI} を押してください。\n` +
        `${OK_EMOJI}: 強さを考慮して均衡にチーム分け（最大10人）\n` +
        `${SIMPLE_EMOJI}: 強さ無視・ランダムで二分割（上限なし）`
      )
      .setColor(0x00AE86);
    const msg = await interaction.reply({ embeds: [embed], fetchReply: true });
    await msg.react(JOIN_EMOJI);
    await msg.react(OK_EMOJI);
    await msg.react(SIMPLE_EMOJI);
    createSignup.run(msg.id, msg.channelId, interaction.user.id, Date.now());

    // 3) 公開アナウンス
    if (prev) {
      await interaction.followUp(`新しい受付を開始しました。前回の参加者リストをリセットしています。`);
    } else {
      await interaction.followUp(`受付を開始しました！`);
    }
    return;
  }

  if (commandName === 'show_participants') {
    const mid = latestSignupMessageId.get()?.message_id;
    if (!mid) return interaction.reply({ content: '参加受付が見つかりません。' });
    const rows = listParticipants.all(mid);
    const names = rows.map(r => r.username).join(', ') || '- なし -';
    return interaction.reply({ content: `現在の参加者 (${rows.length}): ${names}` });
  }

  if (commandName === 'reset_participants') {
    const mid = latestSignupMessageId.get()?.message_id;
    if (!mid) return interaction.reply({ content: '参加受付が見つかりません。' });
    clearParticipantsByMessage.run(mid);
    return interaction.reply('参加者をリセットしました。');
  }

  if (commandName === 'leave') {
    const mid = latestSignupMessageId.get()?.message_id;
    if (!mid) return interaction.reply({ content: '参加受付が見つかりません。' });
    removeParticipant.run(mid, interaction.user.id);
    const rows = listParticipants.all(mid);
    return interaction.reply(`**${interaction.user.username}** が参加を取り消しました。（現在 ${rows.length} 人）`);
  }

  if (commandName === 'kick_from_lol') {
    const target = interaction.options.getUser('user', true);
    const mid = latestSignupMessageId.get()?.message_id;
    if (!mid) return interaction.reply({ content: '参加受付が見つかりません。' });
    removeParticipant.run(mid, target.id); // 誰でも可
    const rows = listParticipants.all(mid);
    return interaction.reply(`**${interaction.user.username}** が **${target.username}** を参加リストから外しました。（現在 ${rows.length} 人）`);
  }

  if (commandName === 'set_strength') {
    const user = interaction.options.getUser('user', true);
    const points = interaction.options.getInteger('points', true);
    setStrength.run(user.id, user.username, points);
    return interaction.reply(`**${user.username}** のポイントを **${points}** に設定しました。`);
  }

  if (commandName === 'team') {
    const mid = latestSignupMessageId.get()?.message_id;
    if (!mid) return interaction.reply({ content: '参加受付が見つかりません。' });
    let participants = listParticipants.all(mid);
    if (participants.length < 2) return interaction.reply('参加者が足りません。');
    participants = participantCap(participants); // 11人以上→先頭10人

    const enriched = participants.map(p => {
      const u = getUser.get(p.user_id);
      return { user_id: p.user_id, username: p.username, points: u?.points ?? 300 };
    });

    const lastSigRow = getLastSignature.get();
    const lastSig = lastSigRow?.signature || null;
    const result = splitBalanced(enriched, lastSig);

    // 先に作成して matchId を取得
    createMatch.run(mid, JSON.stringify(result.teamA.map(p => p.user_id)), JSON.stringify(result.teamB.map(p => p.user_id)), Date.now());
    const matchId = getLastInsertRowId();

    const embed = new EmbedBuilder()
      .setTitle(`チーム分け結果（ポイント均衡） — Match #${matchId}`)
      .addFields(formatTeamsEmbedFields(result.teamA, result.teamB))
      .setFooter({ text: `合計差: ${result.diff}` })
      .setColor(0x5865F2)
      .setDescription(
        `Team A 合計: ${result.sumA}\nTeam B 合計: ${result.sumB}` +
        (participants.length === 10 ? '\n（参加者が10人を超えていたため、先頭10人でチーム分けを実施）' : '')
      );

    await interaction.reply({ embeds: [embed] });

    const sig = signatureOfIds(result.teamA.map(p => p.user_id), result.teamB.map(p => p.user_id));
    setLastSignature.run(sig);
    return;
  }

  if (commandName === 'team_simple') {
    const mid = latestSignupMessageId.get()?.message_id;
    if (!mid) return interaction.reply({ content: '参加受付が見つかりません。' });
    let participants = listParticipants.all(mid);
    if (participants.length < 2) return interaction.reply('参加者が足りません。');

    const enriched = participants.map(p => {
      const u = getUser.get(p.user_id);
      return { user_id: p.user_id, username: p.username, points: u?.points ?? 300 };
    });

    const result = splitSimple(enriched); // ポイント無視

    // 先に作成して matchId を取得
    createMatch.run(mid, JSON.stringify(result.teamA.map(p => p.user_id)), JSON.stringify(result.teamB.map(p => p.user_id)), Date.now());
    const matchId = getLastInsertRowId();

    const embed = new EmbedBuilder()
      .setTitle(`チーム分け結果（ポイント無視／ランダム） — Match #${matchId}`)
      .addFields(formatTeamsEmbedFields(result.teamA, result.teamB))
      .setColor(0x2ECC71)
      .setDescription(
        `Team A 人数: ${result.teamA.length}\nTeam B 人数: ${result.teamB.length}\n※ 強さポイントは考慮せずランダムで二分割しています。`
      );

    await interaction.reply({ embeds: [embed] });

    const sig = signatureOfIds(result.teamA.map(p => p.user_id), result.teamB.map(p => p.user_id));
    setLastSignature.run(sig);
    return;
  }

  if (commandName === 'result' || commandName === 'win') {
    const winner = (commandName === 'result')
      ? interaction.options.getString('winner', true).toUpperCase()
      : interaction.options.getString('team', true).toUpperCase();

    // /result と /win の両方で任意 match_id をサポート（未指定は最新）
    let match;
    const optMatchId = interaction.options.getInteger('match_id', false);
    if (optMatchId != null) {
      match = getMatchByIdLocal(optMatchId);
      if (!match) {
        return interaction.reply({ content: `マッチ #${optMatchId} が見つかりません。` });
      }
    } else {
      match = getLatestMatch.get();
      if (!match) return interaction.reply({ content: '対戦データがありません。' });
    }

    if (match.winner) return interaction.reply('この対戦は既に結果登録済みです。');

    const msg = processResult(winner, match);
    return interaction.reply({ content: `# Match #${match.id}\n${msg}` });
  }

  if (commandName === 'rank') {
    const rows = topRanks.all();
    const lines = rows.map((r, i) => {
      const total = r.wins + r.losses;
      const wr = total ? (r.wins / total * 100).toFixed(1) : '0.0';
      return `#${i + 1} ${r.username} — ⭐${r.points} / ${r.wins}W-${r.losses}L / ${wr}% (WS:${r.win_streak ?? 0})`;
    });
    return interaction.reply({ content: lines.join('\n') || 'データなし' });
  }

  if (commandName === 'show_points') {
    const { win, loss, streakCap } = getPointsConfig();
    return interaction.reply(
      `現在の設定: 勝利 **${win}**, 敗北 **${loss}**, 連勝ボーナス上限 **${streakCap}**`
    );
  }

  if (commandName === 'set_points') {
    const member = await interaction.guild.members.fetch(interaction.user.id);
    if (!member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
      return interaction.reply({ content: '権限がありません（Manage Server が必要）' });
    }
    const win = interaction.options.getInteger('win', false);
    const loss = interaction.options.getInteger('loss', false);
    const cap = interaction.options.getInteger('streak_cap', false);

    if (win !== null)  setSetting.run('win_points', String(win));
    if (loss !== null) setSetting.run('loss_points', String(loss));
    if (cap !== null)  setSetting.run('streak_cap', String(cap));

    const after = getPointsConfig();
    return interaction.reply(
      `設定を更新しました。\n勝利 **${after.win}**, 敗北 **${after.loss}**, 連勝ボーナス上限 **${after.streakCap}**`
    );
  }
});

// ===== 受付メッセージのリアクション =====
client.on(Events.MessageReactionAdd, async (reaction, user) => {
  try {
    if (user.bot) return;
    await reaction.fetch();
    const { message } = reaction;
    const sign = getSignup.get(message.id);
    if (!sign) return;

    if (reaction.emoji.name === JOIN_EMOJI) {
      ensureUser(user);
      addParticipant.run(message.id, user.id, user.username);
    }

    if (reaction.emoji.name === OK_EMOJI || reaction.emoji.name === SIMPLE_EMOJI) {
      let participants = listParticipants.all(message.id);
      if (participants.length < 2) return message.reply('参加者が足りません。');

      // 均衡は最大10人、ランダムは上限なし
      const isBalanced = reaction.emoji.name === OK_EMOJI;
      if (isBalanced) participants = participantCap(participants);

      const enriched = participants.map(p => {
        const u = getUser.get(p.user_id);
        return { user_id: p.user_id, username: p.username, points: u?.points ?? 300 };
      });

      let result, embed;
      if (isBalanced) {
        const lastSigRow = getLastSignature.get();
        const lastSig = lastSigRow?.signature || null;
        result = splitBalanced(enriched, lastSig);

        // 先に試合を作成してID取得
        createMatch.run(message.id, JSON.stringify(result.teamA.map(p => p.user_id)), JSON.stringify(result.teamB.map(p => p.user_id)), Date.now());
        const matchId = getLastInsertRowId();

        embed = new EmbedBuilder()
          .setTitle(`チーム分け結果（ポイント均衡） — Match #${matchId}`)
          .addFields(formatTeamsEmbedFields(result.teamA, result.teamB))
          .setFooter({ text: `合計差: ${result.diff}` })
          .setColor(0x5865F2)
          .setDescription(
            `Team A 合計: ${result.sumA}\nTeam B 合計: ${result.sumB}` +
            (participants.length === 10 ? '\n（参加者が10人を超えていたため、先頭10人でチーム分けを実施）' : '')
          );

        await message.reply({ embeds: [embed] });

        const sig = signatureOfIds(result.teamA.map(p => p.user_id), result.teamB.map(p => p.user_id));
        setLastSignature.run(sig);
      } else {
        result = splitSimple(enriched);

        // 先に試合を作成してID取得
        createMatch.run(message.id, JSON.stringify(result.teamA.map(p => p.user_id)), JSON.stringify(result.teamB.map(p => p.user_id)), Date.now());
        const matchId = getLastInsertRowId();

        embed = new EmbedBuilder()
          .setTitle(`チーム分け結果（ランダム／ポイント無視） — Match #${matchId}`)
          .addFields(formatTeamsEmbedFields(result.teamA, result.teamB))
          .setColor(0x2ECC71)
          .setDescription(
            `Team A 人数: ${result.teamA.length}\nTeam B 人数: ${result.teamB.length}\n※ 強さポイントは考慮せずランダムで二分割しています。`
          );

        await message.reply({ embeds: [embed] });

        const sig = signatureOfIds(result.teamA.map(p => p.user_id), result.teamB.map(p => p.user_id));
        setLastSignature.run(sig);
      }
    }
  } catch (e) { console.error('ReactionAdd error', e); }
});

// ===== ショートカット: "win a" / "win b" （最新マッチのみ対象）=====
client.on(Events.MessageCreate, async (msg) => {
  if (msg.author.bot) return;
  const m = msg.content.trim().toLowerCase();
  if (m !== 'win a' && m !== 'win b') return;

  const winner = m.endsWith('a') ? 'A' : 'B';
  const match = getLatestMatch.get();
  if (!match) return msg.reply('対戦データがありません。');
  if (match.winner) return msg.reply('既に結果登録済みです。');

  const text = processResult(winner, match);
  return msg.reply(`# Match #${match.id}\n${text}`);
});

// ===== コマンド登録 & ログイン =====
if (process.argv[2] === 'register') {
  (async () => {
    const tmp = new Client({ intents: [] });
    await tmp.login(TOKEN);
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    await rest.put(Routes.applicationGuildCommands(tmp.user.id, GUILD_ID), { body: commands });
    console.log('Guild commands registered.');
    await tmp.destroy();
    process.exit(0);
  })();
} else {
  client.login(TOKEN);
}
