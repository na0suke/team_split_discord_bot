import { EmbedBuilder } from 'discord.js';
import {
  latestSignupMessageId,
  createSignup,
  listParticipants,
  clearParticipantsByMessage,
  removeParticipant
} from '../db.js';
import { JOIN_EMOJI, OK_EMOJI, DICE_EMOJI } from '../constants.js';
import { tryDefer } from '../utils/helpers.js';

// 参加受付関連のコマンド処理
export async function handleSignupCommands(interaction) {
  const gid = interaction.guildId;
  const name = interaction.commandName;

  // --- /start_signup ---
  if (name === 'start_signup') {
    const acked = await tryDefer(interaction);
    const embed = new EmbedBuilder()
      .setTitle('参加受付中')
      .setDescription('✋ 参加 / ✅ バランス分け / 🎲 ランダム分け（強さ無視）');

    let msg;
    if (acked) {
      await interaction.editReply({ embeds: [embed] });
      msg = await interaction.fetchReply();
    } else {
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
    return true;
  }

  // --- /show_participants ---
  if (name === 'show_participants') {
    const row = latestSignupMessageId.get(gid);
    if (!row) {
      await interaction.reply('現在受付中の募集はありません。');
      return true;
    }
    const list = listParticipants.all(gid, row.message_id);
    if (!list.length) {
      await interaction.reply('現在の参加者はいません。');
      return true;
    }
    const names = list.map((p) => `<@${p.user_id}>`).join(', ');
    await interaction.reply(`参加者: ${names}`);
    return true;
  }

  // --- /reset_participants ---
  if (name === 'reset_participants') {
    const row = latestSignupMessageId.get(gid);
    if (!row) {
      await interaction.reply('現在受付中の募集はありません。');
      return true;
    }
    clearParticipantsByMessage.run(gid, row.message_id);
    await interaction.reply('参加者をリセットしました。');
    return true;
  }

  // --- /leave ---
  if (name === 'leave') {
    const row = latestSignupMessageId.get(gid);
    if (!row) {
      await interaction.reply('現在受付中の募集はありません。');
      return true;
    }
    removeParticipant.run(gid, row.message_id, interaction.user.id);
    await interaction.reply('あなたを参加リストから外しました。');
    return true;
  }

  // --- /kick_from_lol ---
  if (name === 'kick_from_lol') {
    const user = interaction.options.getUser('user', true);
    const row = latestSignupMessageId.get(gid);
    if (!row) {
      await interaction.reply('現在受付中の募集はありません。');
      return true;
    }
    removeParticipant.run(gid, row.message_id, user.id);
    await interaction.reply(`<@${user.id}> を参加リストから外しました。`);
    return true;
  }

  return false; // このハンドラーでは処理されなかった
}
