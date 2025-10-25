import { EmbedBuilder } from 'discord.js';
import {
  getLaneParticipantsByMessage,
  getLaneTeamsByTeamId,
  getLaneTeamHistory,
  getLaneTeamMembers,
  addWinLoss,
  getUser,
  incStreak,
  resetStreak,
  incLossStreak,
  resetLossStreak,
  getStreak,
  getLossStreak,
  getPointsConfig,
  upsertLaneParticipant,
  clearLaneSignup
} from '../db.js';
import { assignLaneTeams, formatLaneTeamsEmbed } from '../team_lane.js';
import { formatResultLine } from '../utils/helpers.js';

// レーン指定チーム分けの募集メッセージを追跡
const laneSignupMessages = new Map();

// レーン指定チーム分けコマンド処理
export async function handleLaneCommands(interaction) {
  const name = interaction.commandName;

  // --- /start_lane_signup ---
  if (name === 'start_lane_signup') {
    const embed = new EmbedBuilder()
      .setTitle('レーン指定参加募集')
      .setDescription(
        '希望のレーンをリアクションで選んでください。\n\n' +
          '⚔️ TOP / 🌲 JG / 🪄 MID / 🏹 ADC / ❤️ SUP\n' +
          '✅ を押すと、レーン被りなし＆強さ考慮でチーム分けします。'
      );

    await interaction.reply({ embeds: [embed] });
    const msg = await interaction.fetchReply();

    // 既存の同メッセージIDの応募を初期化（再掲対策）
    try {
      clearLaneSignup.run(msg.id, interaction.guildId);
      console.log(`[DEBUG] Cleared existing data for message ${msg.id}`);
    } catch (clearError) {
      console.error('[DEBUG] Failed to clear existing data:', clearError);
    }

    // レーン + 実行ボタンのリアクションを付与
    const emojis = ['⚔️', '🌲', '🪄', '🏹', '❤️', '✅'];
    for (const e of emojis) await msg.react(e);

    // メッセージを追跡対象に登録
    laneSignupMessages.set(msg.id, {
      guildId: interaction.guildId,
      channelId: msg.channelId,
      messageId: msg.id
    });

    return true;
  }

  // --- /result_team ---
  if (name === 'result_team') {
    const gid = interaction.guildId;
    const winnerTeamId = interaction.options.getInteger('winteam', true);
    const loserTeamId = interaction.options.getInteger('loseteam', true);

    const winnerTeam = getLaneTeamsByTeamId.all(winnerTeamId, gid);
    const loserTeam = getLaneTeamsByTeamId.all(loserTeamId, gid);

    if (!winnerTeam.length) {
      await interaction.reply(`勝利チーム ID ${winnerTeamId} が見つかりません。`);
      return true;
    }
    if (!loserTeam.length) {
      await interaction.reply(`敗北チーム ID ${loserTeamId} が見つかりません。`);
      return true;
    }

    // レーン指定は通常より高いポイント
    const cfg = getPointsConfig();
    const winPoints = cfg.win + 3; // 通常+3
    const lossPoints = cfg.loss - 1; // 通常-1

    const winnerLines = [];
    const loserLines = [];

    // 勝者チーム処理
    for (const member of winnerTeam) {
      const beforeRow = getUser.get(gid, member.user_id);
      const before = beforeRow?.points ?? 300;
      const wsBefore = (getStreak.get(gid, member.user_id)?.win_streak) ?? 0;
      const bonus = Math.min(wsBefore, cfg.streak_cap);
      const delta = winPoints + bonus;
      addWinLoss.run(1, 0, delta, gid, member.user_id);
      incStreak.run(cfg.streak_cap, gid, member.user_id);
      resetLossStreak.run(gid, member.user_id);
      const after = before + delta;
      winnerLines.push(formatResultLine(before, winPoints, bonus, after, member.user_id, member.username));
    }

    // 敗者チーム処理
    for (const member of loserTeam) {
      const beforeRow = getUser.get(gid, member.user_id);
      const before = beforeRow?.points ?? 300;
      const lsBefore = (getLossStreak.get(gid, member.user_id)?.loss_streak) ?? 0;
      const lcap = cfg.loss_streak_cap ?? cfg.streak_cap;
      const penalty = Math.min(lsBefore, lcap);
      const delta = lossPoints - penalty;
      addWinLoss.run(0, 1, delta, gid, member.user_id);
      incLossStreak.run(lcap, gid, member.user_id);
      resetStreak.run(gid, member.user_id);
      const after = before + delta;
      loserLines.push(formatResultLine(before, lossPoints, -penalty, after, member.user_id, member.username));
    }

    const text = [
      `レーン指定勝敗登録: チーム${winnerTeamId} の勝利`,
      '',
      `# 勝利チーム ${winnerTeamId}`,
      ...winnerLines,
      '',
      `# 敗北チーム ${loserTeamId}`,
      ...loserLines,
    ].join('\n');

    await interaction.reply(text);
    return true;
  }

  // --- /show_lane_history ---
  if (name === 'show_lane_history') {
    const gid = interaction.guildId;
    const count = interaction.options.getInteger('count') || 5;

    try {
      // チームIDのリストを取得
      const teamIds = getLaneTeamHistory.all(gid, count);

      if (!teamIds.length) {
        const embed = new EmbedBuilder()
          .setTitle('レーン指定チーム履歴')
          .setDescription('チーム分けの履歴がありません。')
          .setColor(0xff0000);
        await interaction.reply({ embeds: [embed] });
        return true;
      }

      // 各チームのメンバー情報を取得
      const teams = [];
      for (const { team_id } of teamIds) {
        const members = getLaneTeamMembers.all(team_id, gid);

        // ロール順にソート
        members.sort((a, b) => {
          const roleOrder = { TOP: 1, JG: 2, MID: 3, ADC: 4, SUP: 5 };
          return (roleOrder[a.role] || 99) - (roleOrder[b.role] || 99);
        });

        // 各メンバーの現在のポイントと表示名を取得
        const enrichedMembers = await Promise.all(members.map(async m => {
          const currentUser = getUser.get(gid, m.user_id);

          // 現在のサーバー表示名を取得
          let currentDisplayName = m.username; // デフォルトは履歴の名前
          try {
            const member = await interaction.guild.members.fetch(m.user_id);
            currentDisplayName = member.displayName ?? member.user.displayName ?? m.username;
          } catch {
            // ユーザーが見つからない場合は履歴の名前を使用
          }

          return {
            ...m,
            currentDisplayName,
            currentStrength: currentUser?.points ?? m.strength,
            originalStrength: m.strength
          };
        }));

        const totalOriginal = enrichedMembers.reduce((sum, m) => sum + m.originalStrength, 0);
        const totalCurrent = enrichedMembers.reduce((sum, m) => sum + m.currentStrength, 0);

        teams.push({
          teamId: team_id,
          members: enrichedMembers,
          totalOriginal,
          totalCurrent
        });
      }

      // Embedを作成
      const embed = new EmbedBuilder()
        .setTitle(`レーン指定チーム履歴（最新${teams.length}件）`)
        .setDescription('表示形式: 当時のポイント → 現在のポイント')
        .setColor(0x00ae86);

      const roleEmoji = {
        'TOP': '⚔️',
        'JG': '🌲',
        'MID': '🪄',
        'ADC': '🏹',
        'SUP': '❤️'
      };

      for (const team of teams) {
        const lines = team.members.map(m => {
          const emoji = roleEmoji[m.role] || '•';
          // 現在のサーバー表示名を使用
          const displayName = m.currentDisplayName || m.username;

          // ポイントが変わった場合は矢印で表示、変わってない場合は1つだけ表示
          if (m.originalStrength === m.currentStrength) {
            return `${emoji} ${displayName} (⭐${m.originalStrength})`;
          } else {
            const diff = m.currentStrength - m.originalStrength;
            const arrow = diff > 0 ? '↗' : '↘';
            return `${emoji} ${displayName} (⭐${m.originalStrength} ${arrow} ${m.currentStrength})`;
          }
        });

        // チーム合計も同様に表示
        let teamTitle;
        if (team.totalOriginal === team.totalCurrent) {
          teamTitle = `チーム ${team.teamId}（合計⭐${team.totalOriginal}）`;
        } else {
          const diff = team.totalCurrent - team.totalOriginal;
          const arrow = diff > 0 ? '↗' : '↘';
          teamTitle = `チーム ${team.teamId}（合計⭐${team.totalOriginal} ${arrow} ${team.totalCurrent}）`;
        }

        embed.addFields({
          name: teamTitle,
          value: lines.join('\n') || '（メンバーなし）',
          inline: false
        });
      }

      await interaction.reply({ embeds: [embed] });
      return true;

    } catch (e) {
      console.error('[show_lane_history]', e);
      await interaction.reply('エラーが発生しました。');
      return true;
    }
  }

  return false; // このハンドラーでは処理されなかった
}

// レーン指定チーム分けのリアクションイベント処理
export async function handleLaneReactionAdd(reaction, user, client) {
  if (user.bot) return false;
  if (!laneSignupMessages.has(reaction.message.id)) return false;

  const msg = reaction.message;
  const gid = msg.guildId;

  try {
    // 各レーンのリアクション処理
    const roleMap = {
      '⚔️': 'TOP',
      '🌲': 'JG',
      '🪄': 'MID',
      '🏹': 'ADC',
      '❤️': 'SUP'
    };

    if (roleMap[reaction.emoji.name]) {
      // レーン選択処理 - DBに登録
      const selectedRole = roleMap[reaction.emoji.name];

      try {
        // ユーザー情報をDBに登録
        upsertLaneParticipant.run({
          message_id: msg.id,
          guild_id: gid,
          user_id: user.id,
          username: user.displayName || user.username,
          role: selectedRole
        });

        console.log(`[DEBUG] Successfully registered: ${user.displayName || user.username} selected ${selectedRole} for message ${msg.id}`);
      } catch (dbError) {
        console.error(`[ERROR] Failed to register participant:`, dbError);
        console.error(`[ERROR] Parameters:`, {
          message_id: msg.id,
          guild_id: gid,
          user_id: user.id,
          username: user.displayName || user.username,
          role: selectedRole
        });
      }

      return true;
    }

    // チーム分け実行
    if (reaction.emoji.name === '✅') {
      try {
        // この募集に登録された参加者だけ取得 → チーム分け
        let participants = getLaneParticipantsByMessage.all(msg.id, gid);

        // デバッグ: 参加者数を確認
        console.log(`[DEBUG] Found ${participants.length} participants for message ${msg.id}`);
        console.log(`[DEBUG] Participants:`, participants);

        // 表示名を最新に補正（サーバーでの表示名を取得）
        try {
          const ids = [...new Set(participants.map(p => p.userId))];
          const fetched = await msg.guild.members.fetch({ user: ids, withPresences: false });
          participants = participants.map(p => {
            const m = fetched.get(p.userId);
            return m ? {
              ...p,
              username: m.displayName ?? m.user.displayName ?? p.username
            } : p;
          });
        } catch (fetchError) {
          console.log('[DEBUG] Member fetch failed, using original usernames:', fetchError.message);
          // 権限やIntentが無い場合はスキップ
        }

        if (!participants.length) {
          msg.channel.send('この募集に登録された参加者がいません。');
          return true;
        }

        const teams = assignLaneTeams(participants, gid);
        if (!teams.length) {
          msg.channel.send('チームを作成できませんでした。');
          return true;
        }

        const embed = formatLaneTeamsEmbed(teams, EmbedBuilder);
        await msg.channel.send({ embeds: [embed] });

        // 多重実行を防ぐため、この募集は終了扱い
        laneSignupMessages.delete(msg.id);

        console.log(`[DEBUG] Successfully created ${teams.length} teams for message ${msg.id}`);
        return true;
      } catch (teamBuildError) {
        console.error('[ERROR] Team building failed:', teamBuildError);
        msg.channel.send('チーム分けでエラーが発生しました。');
        return true;
      }
    }
  } catch (e) {
    console.error('[laneReactionAdd]', e);
  }

  return false;
}

export { laneSignupMessages };
