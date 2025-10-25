import { PermissionsBitField } from 'discord.js';
import {
  getUser,
  setStrength,
  latestSignupMessageId,
  listParticipants,
  addParticipant,
  setUserRecord,
  deleteUserRecord
} from '../db.js';
import { ensureUserRow } from '../utils/helpers.js';

// ユーザー管理コマンド処理
export async function handleUserCommands(interaction) {
  const gid = interaction.guildId;
  const name = interaction.commandName;

  // --- /set_strength ---
  if (name === 'set_strength') {
    const needManage = interaction.member?.permissions?.has?.(PermissionsBitField.Flags.ManageGuild);
    // 必要なら権限制御を有効化:
    // if (!needManage) return interaction.reply('このコマンドは Manage Server 権限者のみ実行できます。');

    const user = interaction.options.getUser('user', true);
    const points = interaction.options.getInteger('points', true);

    ensureUserRow(gid, user);
    setStrength.run(gid, user.id, user.displayName || user.username, points);

    await interaction.reply(`<@${user.id}> の強さを ${points} に設定しました。`);
    return true;
  }

  // --- /join_name ---
  if (name === 'join_name') {
    const row = latestSignupMessageId.get(gid);
    if (!row) {
      await interaction.reply('現在受付中の募集はありません。');
      return true;
    }

    const nameArg = interaction.options.getString('name', true).trim();
    const pointsArg = interaction.options.getInteger('points'); // null 可

    // 衝突しない擬似IDを決定
    const existing = listParticipants.all(gid, row.message_id).map(p => p.user_id);
    const baseId = `name:${nameArg}`;
    let uid = baseId;
    let c = 2;
    while (existing.includes(uid)) {
      uid = `${baseId}:${c}`;
      c++;
    }

    const pts = pointsArg ?? 300;
    // addParticipant: (guild_id, message_id, user_id, username) - 4つのパラメータ
    addParticipant.run(gid, row.message_id, uid, nameArg);

    await interaction.reply(`${nameArg} (⭐${pts}) を参加者に追加しました。`);
    return true;
  }

  // --- /record ---
  if (name === 'record') {
    const needManage = interaction.member?.permissions?.has?.(PermissionsBitField.Flags.ManageGuild);
    // 必要なら権限制御を有効化:
    // if (!needManage) return interaction.reply('このコマンドは Manage Server 権限者のみ実行できます。');

    const user = interaction.options.getUser('user', true);
    const wins = interaction.options.getInteger('wins', true);
    const losses = interaction.options.getInteger('losses', true);

    ensureUserRow(gid, user);
    // setUserRecord: (guild_id, user_id, username, wins, losses) - 固定でpoints=300
    setUserRecord.run(gid, user.id, user.displayName || user.username, wins, losses);

    await interaction.reply(`<@${user.id}> の戦績を ${wins}勝${losses}敗 に設定しました。`);
    return true;
  }

  // --- /delete_user ---
  if (name === 'delete_user') {
    const needManage = interaction.member?.permissions?.has?.(PermissionsBitField.Flags.ManageGuild);
    // 必要なら権限制御を有効化:
    // if (!needManage) return interaction.reply('このコマンドは Manage Server 権限者のみ実行できます。');

    const user = interaction.options.getUser('user', true);

    deleteUserRecord.run(gid, user.id);

    await interaction.reply(`<@${user.id}> の戦績を完全削除しました。`);
    return true;
  }

  return false; // このハンドラーでは処理されなかった
}
