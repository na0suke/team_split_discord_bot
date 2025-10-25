import {
  latestSignupMessageId,
  getSignup,
  addParticipant,
  removeParticipant,
  listParticipants,
  createMatch,
  setLastSignature,
  getLastSignature
} from '../db.js';
import { splitBalanced, splitRandom, formatTeamLines } from '../team.js';
import { JOIN_EMOJI, OK_EMOJI, DICE_EMOJI } from '../constants.js';
import { ensureUserRow } from '../utils/helpers.js';
import { handleLaneReactionAdd } from './lane-commands.js';
import { EmbedBuilder } from 'discord.js';

// リアクションイベント処理
export async function handleReactionAdd(reaction, user, client) {
  if (user.bot) return;

  const msg = reaction.message;
  const gid = msg.guildId;
  const emoji = reaction.emoji.name;

  // レーン指定チーム分けのリアクション処理
  if (handleLaneReactionAdd(reaction, user, client)) {
    return;
  }

  // 通常の参加受付リアクション処理
  const signup = getSignup.get(gid, msg.id);
  if (!signup) return;

  try {
    // 参加リアクション
    if (emoji === JOIN_EMOJI) {
      ensureUserRow(gid, user);
      const participants = listParticipants.all(gid, msg.id);
      const existing = participants.find(p => p.user_id === user.id);
      if (!existing) {
        addParticipant.run(gid, msg.id, user.id, user.displayName ?? user.username);
      }
      return;
    }

    // チーム分け実行（バランス考慮）
    if (emoji === OK_EMOJI) {
      let participants = listParticipants.all(gid, msg.id);

      // 表示名を最新に補正
      try {
        const ids = [...new Set(participants.map(p => p.user_id))];
        const fetched = await msg.guild.members.fetch({ user: ids, withPresences: false });
        participants = participants.map(p => {
          const m = fetched.get(p.user_id);
          return m ? { ...p, username: m.displayName ?? p.username } : p;
        });
      } catch {
        // 権限やIntentが無い場合はスキップ
      }

      if (participants.length < 2) {
        await msg.channel.send('参加者が2人未満のため、チーム分けできません。');
        return;
      }

      // DBに参加者情報を更新
      for (const p of participants) {
        if (!p.user_id.startsWith('name:')) {
          try {
            const fetchedUser = await client.users.fetch(p.user_id);
            ensureUserRow(gid, fetchedUser);
          } catch {
            // ユーザー取得失敗時はスキップ
          }
        }
      }

      const lastSig = getLastSignature.get(gid)?.signature;
      const result = splitBalanced(participants, lastSig);

      if (!result) {
        await msg.channel.send('チーム分けに失敗しました。');
        return;
      }

      const matchId = createMatch.run(gid, Date.now()).lastInsertRowid;
      setLastSignature.run(gid, result.signature);

      const embed = new EmbedBuilder()
        .setTitle(`チーム分け結果 (Match ID: ${matchId})`)
        .setColor(0x00ae86)
        .addFields(
          { name: `Team A (⭐${result.sumA})`, value: formatTeamLines(result.teamA) },
          { name: `Team B (⭐${result.sumB})`, value: formatTeamLines(result.teamB) }
        )
        .setFooter({ text: `ポイント差: ${result.diff}` });

      await msg.channel.send({ embeds: [embed] });
      return;
    }

    // ランダムチーム分け実行
    if (emoji === DICE_EMOJI) {
      let participants = listParticipants.all(gid, msg.id);

      // 表示名を最新に補正
      try {
        const ids = [...new Set(participants.map(p => p.user_id))];
        const fetched = await msg.guild.members.fetch({ user: ids, withPresences: false });
        participants = participants.map(p => {
          const m = fetched.get(p.user_id);
          return m ? { ...p, username: m.displayName ?? p.username } : p;
        });
      } catch {
        // 権限やIntentが無い場合はスキップ
      }

      if (participants.length < 2) {
        await msg.channel.send('参加者が2人未満のため、チーム分けできません。');
        return;
      }

      const result = splitRandom(participants);
      const matchId = createMatch.run(gid, Date.now()).lastInsertRowid;

      const embed = new EmbedBuilder()
        .setTitle(`ランダムチーム分け結果 (Match ID: ${matchId})`)
        .setColor(0xff6b6b)
        .addFields(
          { name: 'Team A', value: formatTeamLines(result.teamA) },
          { name: 'Team B', value: formatTeamLines(result.teamB) }
        );

      await msg.channel.send({ embeds: [embed] });
      return;
    }

  } catch (e) {
    console.error('[reactionAdd]', e);
  }
}

// リアクション削除イベント処理
export async function handleReactionRemove(reaction, user) {
  if (user.bot) return;

  const msg = reaction.message;
  const gid = msg.guildId;
  const emoji = reaction.emoji.name;

  // 参加取り消し
  if (emoji === JOIN_EMOJI) {
    const signup = getSignup.get(gid, msg.id);
    if (signup) {
      removeParticipant.run(gid, msg.id, user.id);
    }
  }
}
