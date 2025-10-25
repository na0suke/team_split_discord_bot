import { EmbedBuilder } from 'discord.js';
import {
  latestSignupMessageId,
  listParticipants,
  createMatch,
  setLastSignature,
  getLastSignature
} from '../db.js';
import { splitBalanced, splitRandom, formatTeamLines } from '../team.js';
import { ensureUserRow } from '../utils/helpers.js';

// チーム分けコマンド処理
export async function handleTeamCommands(interaction) {
  const gid = interaction.guildId;
  const name = interaction.commandName;

  // --- /team ---
  if (name === 'team') {
    const row = latestSignupMessageId.get(gid);
    if (!row) {
      await interaction.reply('現在受付中の募集はありません。');
      return true;
    }

    let participants = listParticipants.all(gid, row.message_id);

    // 表示名を最新に補正
    try {
      const ids = [...new Set(participants.map(p => p.user_id))];
      const fetched = await interaction.guild.members.fetch({ user: ids, withPresences: false });
      participants = participants.map(p => {
        const m = fetched.get(p.user_id);
        return m ? { ...p, username: m.displayName ?? p.username } : p;
      });
    } catch {
      // 権限やIntentが無い場合はスキップ
    }

    if (participants.length < 2) {
      await interaction.reply('参加者が2人未満のため、チーム分けできません。');
      return true;
    }

    // DBに参加者情報を更新
    for (const p of participants) {
      if (!p.user_id.startsWith('name:')) {
        try {
          const user = await interaction.client.users.fetch(p.user_id);
          ensureUserRow(gid, user);
        } catch {
          // ユーザー取得失敗時はスキップ
        }
      }
    }

    const lastSig = getLastSignature.get(gid)?.signature;
    const result = splitBalanced(participants, lastSig);

    if (!result) {
      await interaction.reply('チーム分けに失敗しました。');
      return true;
    }

    const matchId = createMatch.run(gid, null, JSON.stringify(result.teamA.map(p => p.user_id)), JSON.stringify(result.teamB.map(p => p.user_id)), Date.now()).lastInsertRowid;
    setLastSignature.run(gid, result.signature);

    const embed = new EmbedBuilder()
      .setTitle(`チーム分け結果 (Match ID: ${matchId})`)
      .setColor(0x00ae86)
      .addFields(
        { name: `Team A (⭐${result.sumA})`, value: formatTeamLines(result.teamA) },
        { name: `Team B (⭐${result.sumB})`, value: formatTeamLines(result.teamB) }
      )
      .setFooter({ text: `ポイント差: ${result.diff}` });

    await interaction.reply({ embeds: [embed] });
    return true;
  }

  // --- /team_simple ---
  if (name === 'team_simple') {
    const row = latestSignupMessageId.get(gid);
    if (!row) {
      await interaction.reply('現在受付中の募集はありません。');
      return true;
    }

    let participants = listParticipants.all(gid, row.message_id);

    // 表示名を最新に補正
    try {
      const ids = [...new Set(participants.map(p => p.user_id))];
      const fetched = await interaction.guild.members.fetch({ user: ids, withPresences: false });
      participants = participants.map(p => {
        const m = fetched.get(p.user_id);
        return m ? { ...p, username: m.displayName ?? p.username } : p;
      });
    } catch {
      // 権限やIntentが無い場合はスキップ
    }

    if (participants.length < 2) {
      await interaction.reply('参加者が2人未満のため、チーム分けできません。');
      return true;
    }

    const result = splitRandom(participants);
    const matchId = createMatch.run(gid, null, JSON.stringify(result.teamA.map(p => p.user_id)), JSON.stringify(result.teamB.map(p => p.user_id)), Date.now()).lastInsertRowid;

    const embed = new EmbedBuilder()
      .setTitle(`ランダムチーム分け結果 (Match ID: ${matchId})`)
      .setColor(0xff6b6b)
      .addFields(
        { name: 'Team A', value: formatTeamLines(result.teamA) },
        { name: 'Team B', value: formatTeamLines(result.teamB) }
      );

    await interaction.reply({ embeds: [embed] });
    return true;
  }

  return false; // このハンドラーでは処理されなかった
}
