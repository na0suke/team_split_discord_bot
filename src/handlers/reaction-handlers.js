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
  console.log(`[DEBUG] Reaction event triggered: ${reaction.emoji.name} by ${user.displayName ?? user.username} on message ${reaction.message.id}`);

  if (user.bot) {
    console.log(`[DEBUG] Ignoring bot reaction`);
    return;
  }

  const msg = reaction.message;
  const gid = msg.guildId;
  const emoji = reaction.emoji.name;

  console.log(`[DEBUG] Processing reaction: emoji=${emoji}, guild=${gid}, message=${msg.id}`);

  try {
    // レーン指定チーム分けのリアクション処理
    const laneResult = await handleLaneReactionAdd(reaction, user, client);
    if (laneResult) {
      console.log(`[DEBUG] Handled by lane reaction handler`);
      return;
    }

    // 通常の参加受付リアクション処理
    const signup = getSignup.get(gid, msg.id);
    console.log(`[DEBUG] Signup found:`, signup);

    if (!signup) {
      console.log(`[DEBUG] No signup found for message ${msg.id}`);
      return;
    }

    // 参加リアクション
    if (emoji === JOIN_EMOJI) {
      ensureUserRow(gid, user);
      const participants = listParticipants.all(gid, msg.id);
      const existing = participants.find(p => p.user_id === user.id);
      if (!existing) {
        addParticipant.run(gid, msg.id, user.id, user.displayName ?? user.username);
        console.log(`[DEBUG] Added participant: ${user.displayName ?? user.username} (${user.id}) to message ${msg.id}`);
      } else {
        console.log(`[DEBUG] User ${user.displayName ?? user.username} already registered`);
      }
      return;
    }

    // チーム分け実行（バランス考慮）
    if (emoji === OK_EMOJI) {
      console.log(`[DEBUG] Starting balanced team split for message ${msg.id}`);
      let participants = listParticipants.all(gid, msg.id);
      console.log(`[DEBUG] Found ${participants.length} participants with points:`, participants.map(p => `${p.username}(${p.points})`));

      // 表示名を最新に補正
      try {
        console.log(`[DEBUG] Fetching latest member info...`);
        const ids = [...new Set(participants.map(p => p.user_id).filter(id => !id.startsWith('name:')))];
        console.log(`[DEBUG] Real user IDs to fetch: ${ids.length}`);

        if (ids.length > 0) {
          const fetched = await msg.guild.members.fetch({ user: ids, withPresences: false });
          participants = participants.map(p => {
            if (p.user_id.startsWith('name:')) return p;
            const m = fetched.get(p.user_id);
            return m ? { ...p, username: m.displayName ?? p.username } : p;
          });
          console.log(`[DEBUG] Updated participant names`);
        }
      } catch (error) {
        console.log(`[DEBUG] Member fetch failed, continuing with existing names:`, error.message);
        // 権限やIntentが無い場合はスキップ
      }

      if (participants.length < 2) {
        console.log(`[DEBUG] Not enough participants (${participants.length})`);
        await msg.channel.send('参加者が2人未満のため、チーム分けできません。');
        return;
      }

      // DBに参加者情報を更新
      console.log(`[DEBUG] Updating user records...`);
      for (const p of participants) {
        if (!p.user_id.startsWith('name:')) {
          try {
            const fetchedUser = await client.users.fetch(p.user_id);
            ensureUserRow(gid, fetchedUser);
          } catch (error) {
            console.log(`[DEBUG] Failed to fetch user ${p.user_id}:`, error.message);
            // ユーザー取得失敗時はスキップ
          }
        }
      }

      console.log(`[DEBUG] Calculating balanced teams...`);
      const lastSig = getLastSignature.get(gid)?.signature;
      const result = splitBalanced(participants, lastSig);

      if (!result) {
        console.log(`[DEBUG] Team split failed`);
        await msg.channel.send('チーム分けに失敗しました。');
        return;
      }

      console.log(`[DEBUG] Team split successful - A: ${result.sumA}, B: ${result.sumB}, diff: ${result.diff}`);
      const matchId = createMatch.run(gid, msg.id, JSON.stringify(result.teamA.map(p => p.user_id)), JSON.stringify(result.teamB.map(p => p.user_id)), Date.now()).lastInsertRowid;
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
      console.log(`[DEBUG] Balanced team result sent successfully`);
      return;
    }

    // ランダムチーム分け実行
    if (emoji === DICE_EMOJI) {
      console.log(`[DEBUG] Starting random team split for message ${msg.id}`);
      let participants = listParticipants.all(gid, msg.id);
      console.log(`[DEBUG] Found ${participants.length} participants for random split`);

      // 表示名を最新に補正
      try {
        console.log(`[DEBUG] Fetching latest member info for random split...`);
        const ids = [...new Set(participants.map(p => p.user_id).filter(id => !id.startsWith('name:')))];

        if (ids.length > 0) {
          const fetched = await msg.guild.members.fetch({ user: ids, withPresences: false });
          participants = participants.map(p => {
            if (p.user_id.startsWith('name:')) return p;
            const m = fetched.get(p.user_id);
            return m ? { ...p, username: m.displayName ?? p.username } : p;
          });
          console.log(`[DEBUG] Updated participant names for random split`);
        }
      } catch (error) {
        console.log(`[DEBUG] Member fetch failed for random split, continuing:`, error.message);
        // 権限やIntentが無い場合はスキップ
      }

      if (participants.length < 2) {
        console.log(`[DEBUG] Not enough participants for random split (${participants.length})`);
        await msg.channel.send('参加者が2人未満のため、チーム分けできません。');
        return;
      }

      console.log(`[DEBUG] Creating random teams...`);
      const result = splitRandom(participants);
      const matchId = createMatch.run(gid, msg.id, JSON.stringify(result.teamA.map(p => p.user_id)), JSON.stringify(result.teamB.map(p => p.user_id)), Date.now()).lastInsertRowid;

      const embed = new EmbedBuilder()
        .setTitle(`ランダムチーム分け結果 (Match ID: ${matchId})`)
        .setColor(0xff6b6b)
        .addFields(
          { name: 'Team A', value: formatTeamLines(result.teamA) },
          { name: 'Team B', value: formatTeamLines(result.teamB) }
        );

      await msg.channel.send({ embeds: [embed] });
      console.log(`[DEBUG] Random team result sent successfully`);
      return;
    }

  } catch (error) {
    console.error('[ERROR] Reaction handler failed:', error);
    try {
      await msg.channel.send('リアクション処理中にエラーが発生しました。しばらく待ってから再度お試しください。');
    } catch (replyError) {
      console.error('[ERROR] Failed to send error message:', replyError);
    }
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
