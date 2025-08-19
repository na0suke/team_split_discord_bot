import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
} from 'discord.js';
import { REST, Routes } from '@discordjs/rest';
import {
  createSignup,
  getSignup,
  addParticipant,
  getParticipants,
  resetParticipants,
  ensureUser,
  setStrength,
  addWinLoss,
  setPointsConfig,
  getPointsConfig,
  getRankings,
  createMatch,
  getLatestMatch,
  getMatchById,
  getUserById,
} from './db.js';
import { teamBalance } from './team.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Message, Partials.Reaction, Partials.Channel],
});

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const JOIN_EMOJI = '✋';
const OK_EMOJI = '✅';
const DICE_EMOJI = '🎲';

// ================= コマンド定義 =================
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
      {
        name: 'user',
        description: '対象ユーザー',
        type: 6,
        required: true,
      },
    ],
  },
  {
    name: 'set_strength',
    description: '強さを登録/再定義（例: `/set_strength @user 300`）',
    options: [
      { name: 'user', description: '対象ユーザー', type: 6, required: true },
      { name: 'points', description: 'ポイント値', type: 4, required: true },
    ],
  },
  {
    name: 'team',
    description: '強さバランスでチーム分け（例: `/team`）',
  },
  {
    name: 'team_simple',
    description: '強さ無視で単純に2分割（例: `/team_simple`）',
  },
  {
    name: 'result',
    description: '勝敗登録（例: `/result winner:A`）',
    options: [
      {
        name: 'winner',
        description: '勝利チーム',
        type: 3,
        required: true,
        choices: [
          { name: 'A', value: 'A' },
          { name: 'B', value: 'B' },
        ],
      },
    ],
  },
  {
    name: 'win',
    description: '簡易勝敗登録（例: `/win A`、`/win B`、`/win A match_id:42`）',
    options: [
      {
        name: 'team',
        description: '勝利チーム',
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
    description: '勝敗ポイント/連勝上限を設定（Manage Server権限者のみ）（例: `/set_points win:5 loss:-3 streak_cap:2`）',
    options: [
      {
        name: 'win',
        description: '勝利ポイント（例: 3）',
        type: 4,
        required: false,
      },
      {
        name: 'loss',
        description: '敗北ポイント（例: -2）',
        type: 4,
        required: false,
      },
      {
        name: 'streak_cap',
        description: '連勝ボーナス上限（例: 3）',
        type: 4,
        required: false,
      },
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
];

// ================= コマンド登録 =================
if (process.argv[2] === 'register') {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  (async () => {
    try {
      console.log('Registering slash commands...');
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
        body: commands,
      });
      console.log('Guild commands registered.');
      process.exit(0);
    } catch (err) {
      console.error(err);
      process.exit(1);
    }
  })();
}

// ================== 起動処理 ==================
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// ================== スラッシュコマンド処理 ==================
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;

  const { commandName } = interaction;

  // 参加受付開始
  if (commandName === 'start_signup') {
    const msg = await interaction.reply({
      content: '参加受付を開始します！参加する人は ✋ を押してください。チーム分けは ✅、ランダム分けは 🎲',
      fetchReply: true,
    });
    await msg.react(JOIN_EMOJI);
    await msg.react(OK_EMOJI);
    await msg.react(DICE_EMOJI);
    await createSignup(msg.id);
  }

  // 参加者一覧表示
  else if (commandName === 'show_participants') {
    const participants = await getParticipants();
    if (!participants.length) {
      await interaction.reply('現在参加者はいません。');
    } else {
      const names = participants.map((p) => `<@${p.user_id}> (${p.strength})`);
      await interaction.reply(`現在の参加者:\n${names.join('\n')}`);
    }
  }

  // リセット
  else if (commandName === 'reset_participants') {
    await resetParticipants();
    await interaction.reply('参加者をリセットしました。');
  }

  // 自分を抜ける
  else if (commandName === 'leave') {
    const userId = interaction.user.id;
    const signup = await getSignup();
    if (!signup) return interaction.reply('現在募集はありません。');

    const participants = await getParticipants();
    const exists = participants.find((p) => p.user_id === userId);
    if (!exists) {
      await interaction.reply('あなたは参加していません。');
    } else {
      await resetParticipants();
      for (let p of participants) {
        if (p.user_id !== userId) {
          await addParticipant(signup.id, p.user_id);
        }
      }
      await interaction.reply('あなたをリストから外しました。');
    }
  }

  // 他人をキック
  else if (commandName === 'kick_from_lol') {
    const user = interaction.options.getUser('user');
    const signup = await getSignup();
    if (!signup) return interaction.reply('現在募集はありません。');
    const participants = await getParticipants();
    const remains = participants.filter((p) => p.user_id !== user.id);
    await resetParticipants();
    for (let p of remains) {
      await addParticipant(signup.id, p.user_id);
    }
    await interaction.reply(`${user.username} をリストから外しました。`);
  }

  // 強さ登録
  else if (commandName === 'set_strength') {
    const user = interaction.options.getUser('user');
    const points = interaction.options.getInteger('points');
    await setStrength(user.id, points);
    await interaction.reply(`${user.username} の強さを ${points} に設定しました。`);
  }

  // チーム分け（バランス）
  else if (commandName === 'team') {
    const participants = await getParticipants();
    if (participants.length < 2) return interaction.reply('参加者が不足しています。');

    const teams = teamBalance(participants);
    const msg = `チーム分け結果：\n\nAチーム:\n${teams.A.map((p) => `<@${p.user_id}> (${p.strength})`).join('\n')}\n\nBチーム:\n${teams.B.map((p) => `<@${p.user_id}> (${p.strength})`).join('\n')}`;
    await interaction.reply(msg);

    const matchId = await createMatch(
      teams.A.map((p) => p.user_id),
      teams.B.map((p) => p.user_id)
    );
    await interaction.followUp(`マッチID: ${matchId}`);
  }

  // チーム分け（単純ランダム）
  else if (commandName === 'team_simple') {
    const participants = await getParticipants();
    if (participants.length < 2) return interaction.reply('参加者が不足しています。');

    const shuffled = [...participants].sort(() => Math.random() - 0.5);
    const mid = Math.ceil(shuffled.length / 2);
    const teamA = shuffled.slice(0, mid);
    const teamB = shuffled.slice(mid);

    const msg = `ランダムチーム分け：\n\nAチーム:\n${teamA.map((p) => `<@${p.user_id}>`).join('\n')}\n\nBチーム:\n${teamB.map((p) => `<@${p.user_id}>`).join('\n')}`;
    await interaction.reply(msg);

    const matchId = await createMatch(
      teamA.map((p) => p.user_id),
      teamB.map((p) => p.user_id)
    );
    await interaction.followUp(`マッチID: ${matchId}`);
  }

  // 勝敗登録
  else if (commandName === 'result') {
    const winner = interaction.options.getString('winner');
    const match = await getLatestMatch();
    if (!match) return interaction.reply('まだマッチがありません。');

    await processResult(winner, match, interaction);
  }

  // 簡易勝敗登録
  else if (commandName === 'win') {
    const team = interaction.options.getString('team');
    const matchId = interaction.options.getInteger('match_id');
    const match = matchId ? await getMatchById(matchId) : await getLatestMatch();
    if (!match) return interaction.reply('対象マッチが見つかりません。');

    await processResult(team, match, interaction);
  }

  // ポイント設定変更
  else if (commandName === 'set_points') {
    const win = interaction.options.getInteger('win');
    const loss = interaction.options.getInteger('loss');
    const streakCap = interaction.options.getInteger('streak_cap');
    await setPointsConfig(win, loss, streakCap);
    await interaction.reply(`ポイント設定を更新しました: 勝利=${win ?? '既存'} 敗北=${loss ?? '既存'} 連勝上限=${streakCap ?? '既存'}`);
  }

  // ポイント設定表示
  else if (commandName === 'show_points') {
    const config = await getPointsConfig();
    await interaction.reply(`現在のポイント設定: 勝利=${config.win}, 敗北=${config.loss}, 連勝上限=${config.streak_cap}`);
  }

  // ランキング表示
  else if (commandName === 'rank') {
    const rankings = await getRankings();
    if (!rankings.length) return interaction.reply('ランキングはまだありません。');
    const lines = rankings.map((r, i) => `${i + 1}. <@${r.user_id}> - ${r.strength}pt`);
    await interaction.reply(`ランキング:\n${lines.join('\n')}`);
  }
});

// ================== リアクション処理 ==================
client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;
  if (reaction.partial) await reaction.fetch();

  const signup = await getSignup();
  if (!signup) return;
  if (reaction.message.id !== signup.message_id) return;

  // 参加表明
  if (reaction.emoji.name === JOIN_EMOJI) {
    await ensureUser(user.id);
    await addParticipant(signup.id, user.id);
    console.log(`${user.username} が参加しました`);
  }

  // ✅ チーム分け
  if (reaction.emoji.name === OK_EMOJI) {
    const participants = await getParticipants();
    if (participants.length < 2) return;

    const teams = teamBalance(participants);
    const msg = `チーム分け結果：\n\nAチーム:\n${teams.A.map((p) => `<@${p.user_id}> (${p.strength})`).join('\n')}\n\nBチーム:\n${teams.B.map((p) => `<@${p.user_id}> (${p.strength})`).join('\n')}`;
    await reaction.message.channel.send(msg);

    const matchId = await createMatch(
      teams.A.map((p) => p.user_id),
      teams.B.map((p) => p.user_id)
    );
    await reaction.message.channel.send(`マッチID: ${matchId}`);
  }

  // 🎲 ランダム分け
  if (reaction.emoji.name === DICE_EMOJI) {
    const participants = await getParticipants();
    if (participants.length < 2) return;

    const shuffled = [...participants].sort(() => Math.random() - 0.5);
    const mid = Math.ceil(shuffled.length / 2);
    const teamA = shuffled.slice(0, mid);
    const teamB = shuffled.slice(mid);

    const msg = `ランダムチーム分け：\n\nAチーム:\n${teamA.map((p) => `<@${p.user_id}>`).join('\n')}\n\nBチーム:\n${teamB.map((p) => `<@${p.user_id}>`).join('\n')}`;
    await reaction.message.channel.send(msg);

    const matchId = await createMatch(
      teamA.map((p) => p.user_id),
      teamB.map((p) => p.user_id)
    );
    await reaction.message.channel.send(`マッチID: ${matchId}`);
  }
});

// ================== 勝敗処理関数 ==================
async function processResult(winner, match, interaction) {
  const config = await getPointsConfig();
  const winPts = config.win;
  const lossPts = config.loss;
  const streakCap = config.streak_cap;

  const teamA = JSON.parse(match.team_a);
  const teamB = JSON.parse(match.team_b);

  const winners = winner === 'A' ? teamA : teamB;
  const losers = winner === 'A' ? teamB : teamA;

  let detailLines = [];

  for (let uid of winners) {
    const u = await getUserById(uid);
    const streakBonus = Math.min(u.streak + 1, streakCap);
    const delta = winPts + streakBonus;
    await addWinLoss(uid, delta, true, streakCap);
    detailLines.push(`<@${uid}>: ${u.strength} +${winPts} +${streakBonus} => ${u.strength + delta}`);
  }
  for (let uid of losers) {
    const u = await getUserById(uid);
    const delta = lossPts;
    await addWinLoss(uid, delta, false, streakCap);
    detailLines.push(`<@${uid}>: ${u.strength} ${lossPts} => ${u.strength + delta}`);
  }

  await interaction.reply(`結果を登録しました。勝者: チーム${winner}\n${detailLines.join('\n')}`);
}

// ================== ログイン ==================
client.login(TOKEN);
