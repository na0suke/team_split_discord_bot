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
  {
    name: 'start_signup',
    description: '参加受付を開始（例: `/start_signup`）',
  },
  {
    name: 'show_participants',
    description: '現在の参加者を表示（例: `/show_participants`）',
  },
  {
    name: 'reset_participants',
    description: '参加者リセット（例: `/reset_participants`）',
  },
  {
    name: 'leave',
    description: '自分を参加リストから外す（例: `/leave`）',
  },
  {
    name: 'kick_from_lol',
    description: '他人を参加リストから外す（誰でも可）（例: `/kick_from_lol @user`）',
    options: [
      { name: 'user', description: '対象ユーザー', type: 6, required: true },
    ],
  },
  {
    name: 'set_strength',
    description: 'メンバーの強さを登録/再定義（例: `/set_strength @user 350`）',
    options: [
      { name: 'user', description: '対象ユーザー', type: 6, required: true },
      { name: 'points', description: 'ポイント値', type: 4, required: true },
    ],
  },
  {
    name: 'team',
    description: '強さを考慮してチーム分け（直前と似た構成を回避）（例: `/team`）',
  },
  {
    name: 'team_simple',
    description: '強さ無視でランダム2分割（例: `/team_simple`）',
  },
  {
    name: 'result',
    description: '勝敗を登録（例: `/result winner:A`、`/result winner:B`）',
    options: [
      {
        name: 'winner',
        description: '勝利チーム (A or B)',
        type: 3,
        required: true,
        choices: [
          { name: 'A', value: 'A' },
          { name: 'B', value: 'B' },
        ],
      },
      {
        name: 'match_id',
        description: '対象マッチID（未指定なら最新）',
        type: 4,
        required: false,
      },
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
        choices: [
          { name: 'A', value: 'A' },
          { name: 'B', value: 'B' },
        ],
      },
      {
        name: 'match_id',
        description: '対象マッチID（未指定なら最新）',
        type: 4,
        required: false,
      },
    ],
  },
  {
    name: 'set_points',
    description: '勝敗ポイント/連勝上限を設定（例: `/set_points win:5 loss:-3 streak_cap:2`）',
    options: [
      { name: 'win', description: '勝利ポイント（例: 3）', type: 4, required: false },
      { name: 'loss', description: '敗北ポイント（例: -2）', type: 4, required: false },
      { name: 'streak_cap', description: '連勝ボーナス上限（例: 3）', type: 4, required: false },
    ],
  },
  {
    name: 'show_points',
    description: '現在の勝敗ポイント設定を表示（例: `/show_points`）',
  },
  {
    name: 'rank',
    description: 'ランキング表示（例: `/rank`）',
  },
  {
    name: 'join_name',
    description: 'ユーザー名だけで参加者に追加（例: `/join_name name:たろう points:320`）',
    options: [
      { name: 'name', description: '表示名', type: 3, required: true },
      { name: 'points', description: '初期ポイント（省略時300）', type: 4, required: false },
    ],
  },
];

if (process.argv[2] === 'register' || process.argv[2] === 'register-global') {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  (async () => {
    await rest.put(
      GUILD_ID
        ? Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID)
        : Routes.applicationCommands(CLIENT_ID),
      { body: commands }
    );
    console.log('Slash commands registered.');
    // CLIENT_ID が未設定でも動くよう、必要なら一時ログインで取得
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
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
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
// ===== Slash command handling =====
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;
  const gid = interaction.guildId;
  const name = interaction.commandName;

  try {
    if (name === 'start_signup') {
      const embed = new EmbedBuilder()
        .setTitle('参加受付中')
        .setDescription('✋ 参加 / ✅ バランス分け / 🎲 ランダム分け（強さ無視）');
      const msg = await interaction.reply({ embeds: [embed], fetchReply: true });
      await msg.react(JOIN_EMOJI);
      await msg.react(OK_EMOJI);
      await msg.react(DICE_EMOJI);
      createSignup.run(interaction.guildId, msg.id, msg.channelId, interaction.user.id, Date.now());
      return;
    }

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

    if (name === 'set_strength') {
      const user = interaction.options.getUser('user', true);
      const points = interaction.options.getInteger('points', true);
      ensureUserRow(gid, user);
      setStrength.run(gid, user.id, user.username, points);
      return interaction.reply(`${user.username} の強さを ${points} に設定しました。`);
    }

    if (name === 'team' || name === 'team_simple') {
      const row = latestSignupMessageId.get(gid);
      if (!row) return interaction.reply('現在受付中の募集はありません。');
      const raw = listParticipants.all(gid, row.message_id);
      if (raw.length < 2) return interaction.reply('参加者が足りません。');

      // users テーブルの points/username を付与
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
          { name: `Team A (${teamA.length})`, value: formatTeamLines(teamA), inline: true },
          { name: `Team B (${teamB.length})`, value: formatTeamLines(teamB), inline: true },
        );
      return interaction.reply({ embeds: [embed] });
    }

    if (name === 'result' || name === 'win') {
      const winner = name === 'result'
        ? interaction.options.getString('winner', true)
        : interaction.options.getString('team', true);
      const matchIdOpt = interaction.options.getInteger('match_id');
      const match = matchIdOpt
        ? getMatchById.get(matchIdOpt, gid)
        : getLatestMatch.get(gid);
      if (!match) return interaction.reply('対象マッチが見つかりません。');

      const cfg = getPointsConfig();
      const teamA = JSON.parse(match.team_a);
      const teamB = JSON.parse(match.team_b);

      const winners = winner === 'A' ? teamA : teamB;
      const losers  = winner === 'A' ? teamB : teamA;

      const linesA = [];
      const linesB = [];

      // 勝者
      for (const uid of winners) {
        const beforeRow = getUser.get(gid, uid);
        const before = beforeRow?.points ?? 300;
        const streakBefore = (getStreak.get(gid, uid)?.win_streak) ?? 0;
        const bonus = Math.min(streakBefore + 1, cfg.streak_cap);
        const delta = cfg.win + bonus;

        addWinLoss.run(1, 0, delta, gid, uid);
        incStreak.run(cfg.streak_cap, gid, uid);

        const after = before + delta;
        const label = beforeRow?.username || `<@${uid}>`;
        linesA.push(formatResultLine(before, cfg.win, bonus, after, label));
      }

      // 敗者
      for (const uid of losers) {
        const beforeRow = getUser.get(gid, uid);
        const before = beforeRow?.points ?? 300;
        addWinLoss.run(0, 1, cfg.loss, gid, uid);
        resetStreak.run(gid, uid);
        const after = before + cfg.loss;
        const label = beforeRow?.username || `<@${uid}>`;
        linesB.push(formatResultLine(before, cfg.loss, 0, after, label));
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

      return interaction.reply(text);
    }

    if (name === 'set_points') {
      const needManage = interaction.member?.permissions?.has?.(PermissionsBitField.Flags.ManageGuild);
      // 必要に応じて権限チェックを有効化
      // if (!needManage) return interaction.reply('このコマンドは Manage Server 権限者のみ実行できます。');

      const win = interaction.options.getInteger('win');
      const loss = interaction.options.getInteger('loss');
      const cap  = interaction.options.getInteger('streak_cap');

      updatePointsConfig({ win, loss, streak_cap: cap });
      const cfg = getPointsConfig();
      return interaction.reply(`ポイント設定を更新しました: win=${cfg.win}, loss=${cfg.loss}, streak_cap=${cfg.streak_cap}`);
    }

    if (name === 'show_points') {
      const cfg = getPointsConfig();
      return interaction.reply(`現在のポイント設定: win=${cfg.win}, loss=${cfg.loss}, streak_cap=${cfg.streak_cap}`);
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
  } catch (e) {
    console.error(e);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply('内部エラーが発生しました。ログを確認してください。');
    }
  }

  if (name === 'join_name') {
    const row = latestSignupMessageId.get(gid);
    if (!row) return interaction.reply('現在受付中の募集はありません。');

    const nameArg = interaction.options.getString('name', true).trim();
    const pointsArg = interaction.options.getInteger('points'); // null 可

    // 既存参加者の user_id を見て衝突回避つきの擬似IDを決定
    const existing = listParticipants.all(gid, row.message_id).map(p => p.user_id);
    const baseId = `name:${nameArg}`;
    let uid = baseId;
    let c = 2;
    while (existing.includes(uid)) {
      uid = `${baseId}#${c}`;
    }

    // users にも登録（points 指定があれば上書き）
    upsertUser.run({ guild_id: gid, user_id: uid, username: nameArg });
    if (pointsArg !== null && pointsArg !== undefined) {
      setStrength.run(gid, uid, nameArg, pointsArg);
    }

    // 参加者表へ追加
    addParticipant.run(gid, row.message_id, uid, nameArg);
    return interaction.reply(`**${nameArg}** を参加者に追加しました（ID: \`${uid}\`${pointsArg!=null?`, ⭐${pointsArg}`:''}）。`);
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
      // ランダムは last_signature を更新しない（必要ならここでしてもOK）
    }

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
        { name: `Team A (${teamA.length})`, value: formatTeamLines(teamA), inline: true },
        { name: `Team B (${teamB.length})`, value: formatTeamLines(teamB), inline: true },
      );

    await message.channel.send({ embeds: [embed] });
  } catch (e) {
    console.error(e);
  }
});

client.login(TOKEN);
