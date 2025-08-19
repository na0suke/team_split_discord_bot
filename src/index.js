// src/index.js
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
  topRanks, getStreak, incStreak, resetStreak
} from './db.js';
import { splitBalanced, formatTeamsEmbedFields, signatureOfIds } from './team.js';

// ====== 環境変数 ======
const TOKEN = (process.env.DISCORD_TOKEN || '').trim();
const GUILD_ID = (process.env.GUILD_ID || '').trim();

if (!TOKEN) {
  console.error('[FATAL] DISCORD_TOKEN is missing or empty');
  process.exit(1);
}
if (!GUILD_ID) {
  console.error('[FATAL] GUILD_ID is missing or empty');
  process.exit(1);
}

// ====== Discord Client ======
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

// ====== 定数 ======
const JOIN_EMOJI = '✅';
const OK_EMOJI = '🆗';

// ====== 設定値（DB永続化） ======
// settings テーブルを用意（なければ作成）
db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`);

const getSettingStmt = db.prepare(`SELECT value FROM settings WHERE key=?`);
const setSettingStmt = db.prepare(`
  INSERT INTO settings (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value=excluded.value
`);

function getNumberSetting(key, fallback) {
  const row = getSettingStmt.get(key);
  const v = row?.value;
  const n = v != null ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}
function setNumberSetting(key, n) {
  setSettingStmt.run(key, String(n));
}

// 初期値（環境変数があればそれを優先 → DB に保存）
const DEFAULT_WIN   = Number.isFinite(Number(process.env.DEFAULT_WIN_POINTS)) ? Number(process.env.DEFAULT_WIN_POINTS) : 3;
const DEFAULT_LOSS  = Number.isFinite(Number(process.env.DEFAULT_LOSS_POINTS)) ? Number(process.env.DEFAULT_LOSS_POINTS) : -2;
const DEFAULT_STREAK_CAP = Number.isFinite(Number(process.env.DEFAULT_STREAK_CAP)) ? Number(process.env.DEFAULT_STREAK_CAP) : 3;

// DB未設定なら初期登録
if (getSettingStmt.get('win_points') == null)  setNumberSetting('win_points', DEFAULT_WIN);
if (getSettingStmt.get('loss_points') == null) setNumberSetting('loss_points', DEFAULT_LOSS);
if (getSettingStmt.get('streak_cap') == null)  setNumberSetting('streak_cap', DEFAULT_STREAK_CAP);

// 現在値を取得する関数
function currentPoints() {
  return {
    WIN: getNumberSetting('win_points', DEFAULT_WIN),
    LOSS: getNumberSetting('loss_points', DEFAULT_LOSS),
    STREAK_CAP: getNumberSetting('streak_cap', DEFAULT_STREAK_CAP)
  };
}

// ====== ユーティリティ ======
function calcWinBonus(streakBefore, cap) {
  return Math.min(streakBefore, cap);
}
function ensureUser(user) {
  upsertUser.run({ user_id: user.id, username: user.username || user.displayName });
}
function participantCap(arr) { return arr.length > 10 ? arr.slice(0,10) : arr; }

// matches 参照（id指定用）
const getMatchById = db.prepare(`SELECT * FROM matches WHERE id=?`);

// ====== Slash Commands 定義 ======
const commands = [
  { name: 'start_signup', description: '参加受付を開始する（例: `/start_signup`）' },
  { name: 'show_participants', description: '現在の参加者を表示（例: `/show_participants`）' },
  { name: 'reset_participants', description: '参加者リセット（例: `/reset_participants`）' },
  { name: 'leave', description: '自分を参加リストから外す（例: `/leave`）' },
  {
    name: 'kick_from_lol',
    description: '他人を参加リストから外す（誰でも可）（例: `/kick_from_lol @user`）',
    options: [
      { name: 'user', description: '対象ユーザー', type: 6, required: true }
    ]
  },
  {
    name: 'set_strength',
    description: 'メンバーの強さを登録/再定義（例: `/set_strength @user 350`）',
    options: [
      { name: 'user', description: '対象ユーザー', type: 6, required: true },
      { name: 'points', description: 'ポイント値', type: 4, required: true }
    ]
  },
  { name: 'team', description: 'チーム分け（最大10人）（例: `/team`）' },
  {
    name: 'result',
    description: '勝敗登録（例: `/result A`）',
    options: [
      {
        name: 'winner',
        description: '勝利チームを選択',
        type: 3,
        required: true,
        choices: [{ name: 'A', value: 'A' }, { name: 'B', value: 'B' }]
      }
    ]
  },
  {
    name: 'win',
    description: '簡易勝敗登録（例: `/win A`、`/win B`、`/win A match_id:42`）',
    options: [
      {
        name: 'team',
        description: '勝利チームを選択',
        type: 3,
        required: true,
        choices: [{ name: 'A', value: 'A' }, { name: 'B', value: 'B' }]
      },
      {
        name: 'match_id',
        description: '対象マッチID（未指定なら最新）',
        type: 4,
        required: false
      }
    ]
  },
  {
    name: 'set_points',
    description: '勝敗ポイント/連勝上限を設定（Manage Server 権限が必要）',
    options: [
      { name: 'win', description: '勝利ポイント（例: 3）', type: 4, required: false },
      { name: 'loss', description: '敗北ポイント（例: -2）', type: 4, required: false },
      { name: 'streak_cap', description: '連勝ボーナス上限（例: 3）', type: 4, required: false }
    ]
  },
  {
    name: 'show_points',
    description: '現在の勝敗ポイント設定を表示（例: `/show_points`）'
  },
  { name: 'rank', description: 'ランキング表示（例: `/rank`）' }
];

async function registerCommands() {
  const tmp = new Client({ intents: [] });
  await tmp.login(TOKEN);
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(tmp.user.id, GUILD_ID), { body: commands });
  console.log('Guild commands registered.');
  await tmp.destroy();
}

// ====== 起動ログ ======
client.once(Events.ClientReady, () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// ====== 勝敗処理 ======
function processResult(winner, match) {
  const { WIN, LOSS, STREAK_CAP } = currentPoints();

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
      const bonus = calcWinBonus(streakBefore, STREAK_CAP);
      const delta = WIN + bonus;
      addWinLoss.run(1, 0, delta, uid);
      incStreak.run(uid);
      const after = before + delta;
      linesA.push(`${getName(uid)}: ${before} + ${WIN}${bonus ? ` + ${bonus}（連勝ボーナス）` : ''} => ${after}`);
    }
    // 敗者B
    for (const uid of teamB) {
      const before = getBefore(uid);
      addWinLoss.run(0, 1, LOSS, uid);
      resetStreak.run(uid);
      const after = before + LOSS;
      linesB.push(`${getName(uid)}: ${before} ${LOSS >= 0 ? '+' : ''}${LOSS} => ${after}`);
    }
  } else {
    // 勝者B
    for (const uid of teamB) {
      const before = getBefore(uid);
      const streakBefore = (getStreak.get(uid)?.win_streak) ?? 0;
      const bonus = calcWinBonus(streakBefore, STREAK_CAP);
      const delta = WIN + bonus;
      addWinLoss.run(1, 0, delta, uid);
      incStreak.run(uid);
      const after = before + delta;
      linesB.push(`${getName(uid)}: ${before} + ${WIN}${bonus ? ` + ${bonus}（連勝ボーナス）` : ''} => ${after}`);
    }
    // 敗者A
    for (const uid of teamA) {
      const before = getBefore(uid);
      addWinLoss.run(0, 1, LOSS, uid);
      resetStreak.run(uid);
      const after = before + LOSS;
      linesA.push(`${getName(uid)}: ${before} ${LOSS >= 0 ? '+' : ''}${LOSS} => ${after}`);
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

// ====== Interaction ======
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  if (commandName === 'start_signup') {
    const embed = new EmbedBuilder()
      .setTitle('参加受付')
      .setDescription(`参加する人は ${JOIN_EMOJI} を、準備OKなら ${OK_EMOJI} を押してください。`)
      .setColor(0x00AE86);

    const msg = await interaction.reply({ embeds: [embed], fetchReply: true });
    await msg.react(JOIN_EMOJI);
    await msg.react(OK_EMOJI);
    createSignup.run(msg.id, msg.channelId, interaction.user.id, Date.now());
    return interaction.followUp({ content: '受付を開始しました！', ephemeral: true });
  }

  if (commandName === 'show_participants') {
    const mid = latestSignupMessageId.get()?.message_id;
    if (!mid) return interaction.reply({ content: '参加受付が見つかりません。', ephemeral: true });
    const rows = listParticipants.all(mid);
    const names = rows.map(r => r.username).join(', ') || '- なし -';
    return interaction.reply({ content: `現在の参加者 (${rows.length}): ${names}` });
  }

  if (commandName === 'reset_participants') {
    const mid = latestSignupMessageId.get()?.message_id;
    if (!mid) return interaction.reply({ content: '参加受付が見つかりません。', ephemeral: true });
    clearParticipantsByMessage.run(mid);
    return interaction.reply('参加者をリセットしました。');
  }

  if (commandName === 'leave') {
    const mid = latestSignupMessageId.get()?.message_id;
    if (!mid) return interaction.reply({ content: '参加受付が見つかりません。', ephemeral: true });
    removeParticipant.run(mid, interaction.user.id);
    return interaction.reply('参加表明を取り消しました。');
  }

  if (commandName === 'kick_from_lol') {
    const target = interaction.options.getUser('user', true);
    const mid = latestSignupMessageId.get()?.message_id;
    if (!mid) return interaction.reply({ content: '参加受付が見つかりません。', ephemeral: true });
    removeParticipant.run(mid, target.id); // 誰でも可
    return interaction.reply(`**${target.username}** を参加リストから外しました。`);
  }

  if (commandName === 'set_strength') {
    const user = interaction.options.getUser('user', true);
    const points = interaction.options.getInteger('points', true);
    setStrength.run(user.id, user.username, points);
    return interaction.reply(`**${user.username}** のポイントを **${points}** に設定しました。`);
  }

  if (commandName === 'team') {
    const mid = latestSignupMessageId.get()?.message_id;
    if (!mid) return interaction.reply({ content: '参加受付が見つかりません。', ephemeral: true });

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

    const embed = new EmbedBuilder()
      .setTitle('チーム分け結果')
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
    createMatch.run(mid, JSON.stringify(result.teamA.map(p => p.user_id)), JSON.stringify(result.teamB.map(p => p.user_id)), Date.now());
    return;
  }

  if (commandName === 'result' || commandName === 'win') {
    const winner = (commandName === 'result')
      ? interaction.options.getString('winner', true).toUpperCase()
      : interaction.options.getString('team', true).toUpperCase();

    // /win は match_id 指定可能
    let match = null;
    if (commandName === 'win') {
      const id = interaction.options.getInteger('match_id', false);
      match = id ? getMatchById.get(id) : getLatestMatch.get();
    } else {
      match = getLatestMatch.get();
    }

    if (!match) return interaction.reply({ content: '対戦データがありません。', ephemeral: true });
    if (match.winner) return interaction.reply('この対戦は既に結果登録済みです。');

    const msg = processResult(winner, match);
    return interaction.reply({ content: msg });
  }

  if (commandName === 'set_points') {
    // 権限チェック：Manage Server（= ManageGuild）
    if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) {
      return interaction.reply({ content: 'このコマンドを実行する権限がありません（Manage Server が必要）', ephemeral: true });
    }
    const win = interaction.options.getInteger('win', false);
    const loss = interaction.options.getInteger('loss', false);
    const cap = interaction.options.getInteger('streak_cap', false);

    if (win != null)  setNumberSetting('win_points', win);
    if (loss != null) setNumberSetting('loss_points', loss);
    if (cap != null)  setNumberSetting('streak_cap', cap);

    const cur = currentPoints();
    return interaction.reply(`ポイント設定を更新しました。\n- 勝利: ${cur.WIN}\n- 敗北: ${cur.LOSS}\n- 連勝上限: ${cur.STREAK_CAP}`);
  }

  if (commandName === 'show_points') {
    const cur = currentPoints();
    return interaction.reply(`現在のポイント設定\n- 勝利: ${cur.WIN}\n- 敗北: ${cur.LOSS}\n- 連勝上限: ${cur.STREAK_CAP}`);
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
});

// ====== Reaction ハンドラ（受付メッセージ） ======
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

    if (reaction.emoji.name === OK_EMOJI) {
      // 受付作成者 or ManageGuild 権限者のみ（制限を外したい場合はこの if を削除）
      if (user.id !== sign.author_id && !message.member?.permissions?.has(PermissionsBitField.Flags.ManageGuild)) {
        return; // 何もしない
      }
      let participants = listParticipants.all(message.id);
      if (participants.length < 2) return message.reply('参加者が足りません。');
      participants = participantCap(participants);

      const enriched = participants.map(p => {
        const u = getUser.get(p.user_id);
        return { user_id: p.user_id, username: p.username, points: u?.points ?? 300 };
      });

      const lastSigRow = getLastSignature.get();
      const lastSig = lastSigRow?.signature || null;
      const result = splitBalanced(enriched, lastSig);

      const embed = new EmbedBuilder()
        .setTitle('チーム分け結果')
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
      createMatch.run(message.id, JSON.stringify(result.teamA.map(p => p.user_id)), JSON.stringify(result.teamB.map(p => p.user_id)), Date.now());
    }
  } catch (e) { console.error('ReactionAdd error', e); }
});

// ====== ショートカット: "win a" / "win b" ======
client.on(Events.MessageCreate, async (msg) => {
  if (msg.author.bot) return;
  const m = msg.content.trim().toLowerCase();
  if (m !== 'win a' && m !== 'win b') return;

  const winner = m.endsWith('a') ? 'A' : 'B';
  const match = getLatestMatch.get();
  if (!match) return msg.reply('対戦データがありません。');
  if (match.winner) return msg.reply('既に結果登録済みです。');

  const text = processResult(winner, match);
  return msg.reply(text);
});

// ====== コマンド登録 or ログイン ======
if (process.argv[2] === 'register') {
  (async () => {
    await registerCommands();
    process.exit(0);
  })();
} else {
  client.login(TOKEN);
}
