import { EmbedBuilder } from 'discord.js';
import {
  latestSignupMessageId,
  listParticipants,
  createMatch,
  setLastSignature,
  getLastSignature
} from '../db.js';
import { splitBalanced, splitRandom, formatTeamLines, saveTeamHistory } from '../team.js';
import { ensureUserRow } from '../utils/helpers.js';

// チーム分けコマンド処理
export async function handleTeamCommands(interaction) {
  const gid = interaction.guildId;
  const name = interaction.commandName;

  // --- /team ---
  if (name === 'team') {
    try {
      // 即座にインタラクションを延期して3秒タイムアウトを回避
      await interaction.deferReply();
      console.log(`[DEBUG] /team command started for guild ${gid}`);

      const row = latestSignupMessageId.get(gid);
      if (!row) {
        await interaction.editReply('現在受付中の募集はありません。');
        return true;
      }

      let participants = listParticipants.all(gid, row.message_id);
      console.log(`[DEBUG] Found ${participants.length} participants`);

      // 表示名を最新に補正
      try {
        console.log(`[DEBUG] Fetching member info...`);
        const ids = [...new Set(participants.map(p => p.user_id).filter(id => !id.startsWith('name:')))];
        console.log(`[DEBUG] Real user IDs to fetch: ${ids.length}`);

        if (ids.length > 0) {
          const fetched = await interaction.guild.members.fetch({ user: ids, withPresences: false });
          participants = participants.map(p => {
            if (p.user_id.startsWith('name:')) return p;
            const m = fetched.get(p.user_id);
            return m ? { ...p, username: m.displayName ?? p.username } : p;
          });
          console.log(`[DEBUG] Member info fetched successfully`);
        }
      } catch (error) {
        console.log(`[DEBUG] Member fetch failed, continuing with existing names:`, error.message);
        // 権限やIntentが無い場合はスキップ
      }

      if (participants.length < 2) {
        await interaction.editReply('参加者が2人未満のため、チーム分けできません。');
        return true;
      }

      // DBに参加者情報を更新（簡略化）
      console.log(`[DEBUG] Updating user records...`);
      for (const p of participants) {
        if (!p.user_id.startsWith('name:')) {
          try {
            const user = await interaction.client.users.fetch(p.user_id);
            ensureUserRow(gid, user);
          } catch (error) {
            console.log(`[DEBUG] Failed to fetch user ${p.user_id}:`, error.message);
            // ユーザー取得失敗時はスキップ
          }
        }
      }
      console.log(`[DEBUG] User records updated`);

      const lastSig = getLastSignature.get(gid)?.signature;
      const result = splitBalanced(participants, lastSig, gid); // guildIdを渡して履歴機能を有効化

      if (!result) {
        await interaction.editReply('チーム分けに失敗しました。');
        return true;
      }

      console.log(`[DEBUG] Creating match record...`);
      const matchId = createMatch.run(gid, null, JSON.stringify(result.teamA.map(p => p.user_id)), JSON.stringify(result.teamB.map(p => p.user_id)), Date.now()).lastInsertRowid;
      setLastSignature.run(gid, result.signature);

      // 新しい履歴保存機能を追加
      saveTeamHistory(gid, result.signature);

      const embed = new EmbedBuilder()
        .setTitle(`チーム分け結果 (Match ID: ${matchId})`)
        .setColor(0x00ae86)
        .addFields(
          { name: `Team A (⭐${result.sumA})`, value: formatTeamLines(result.teamA) },
          { name: `Team B (⭐${result.sumB})`, value: formatTeamLines(result.teamB) }
        )
        .setFooter({ text: `ポイント差: ${result.diff}` });

      console.log(`[DEBUG] Sending team result...`);
      await interaction.editReply({ embeds: [embed] });
      console.log(`[DEBUG] /team command completed successfully`);
      return true;

    } catch (error) {
      console.error(`[ERROR] /team command failed:`, error);
      try {
        await interaction.editReply('チーム分け処理中にエラーが発生しました。しばらく待ってから再度お試しください。');
      } catch (replyError) {
        console.error(`[ERROR] Failed to send error reply:`, replyError);
      }
      return true;
    }
  }

  // --- /team_simple ---
  if (name === 'team_simple') {
    try {
      // 即座にインタラクションを延期して3秒タイムアウトを回避
      await interaction.deferReply();
      console.log(`[DEBUG] /team_simple command started for guild ${gid}`);

      const row = latestSignupMessageId.get(gid);
      if (!row) {
        await interaction.editReply('現在受付中の募集はありません。');
        return true;
      }

      let participants = listParticipants.all(gid, row.message_id);
      console.log(`[DEBUG] Found ${participants.length} participants for simple team`);

      // 表示名を最新に補正（簡略化）
      try {
        console.log(`[DEBUG] Fetching member info for simple team...`);
        const ids = [...new Set(participants.map(p => p.user_id).filter(id => !id.startsWith('name:')))];

        if (ids.length > 0) {
          const fetched = await interaction.guild.members.fetch({ user: ids, withPresences: false });
          participants = participants.map(p => {
            if (p.user_id.startsWith('name:')) return p;
            const m = fetched.get(p.user_id);
            return m ? { ...p, username: m.displayName ?? p.username } : p;
          });
          console.log(`[DEBUG] Member info fetched for simple team`);
        }
      } catch (error) {
        console.log(`[DEBUG] Member fetch failed for simple team, continuing:`, error.message);
        // 権限やIntentが無い場合はスキップ
      }

      if (participants.length < 2) {
        await interaction.editReply('参加者が2人未満のため、チーム分けできません。');
        return true;
      }

      console.log(`[DEBUG] Creating random teams...`);
      const result = splitRandom(participants);
      const matchId = createMatch.run(gid, null, JSON.stringify(result.teamA.map(p => p.user_id)), JSON.stringify(result.teamB.map(p => p.user_id)), Date.now()).lastInsertRowid;

      const embed = new EmbedBuilder()
        .setTitle(`ランダムチーム分け結果 (Match ID: ${matchId})`)
        .setColor(0xff6b6b)
        .addFields(
          { name: 'Team A', value: formatTeamLines(result.teamA) },
          { name: 'Team B', value: formatTeamLines(result.teamB) }
        );

      console.log(`[DEBUG] Sending simple team result...`);
      await interaction.editReply({ embeds: [embed] });
      console.log(`[DEBUG] /team_simple command completed successfully`);
      return true;

    } catch (error) {
      console.error(`[ERROR] /team_simple command failed:`, error);
      try {
        await interaction.editReply('チーム分け処理中にエラーが発生しました。しばらく待ってから再度お試しください。');
      } catch (replyError) {
        console.error(`[ERROR] Failed to send error reply:`, replyError);
      }
      return true;
    }
  }

  return false; // このハンドラーでは処理されなかった
}
