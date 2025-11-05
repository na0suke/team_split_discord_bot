import { upsertUser } from '../db.js';

// ===== ヘルパー関数 =====

// ユーザー情報をDBに登録/更新
export function ensureUserRow(gid, user) {
  upsertUser.run({
    guild_id: gid,
    user_id: user.id,
    username: user.username || user.displayName || `user_${user.id}`
  });
}

// 結果表示用のフォーマット
export function formatResultLine(before, delta1, delta2, after, displayName) {
  const d1 = delta1 >= 0 ? `+${delta1}` : `${delta1}`;
  const d2 = delta2 ? (delta2 >= 0 ? ` +${delta2}` : ` ${delta2}`) : '';
  return `${displayName}: ${before} ${d1}${d2} => ${after}`;
}

// rank表示用の名前フォーマット関数
export function formatRankDisplayName(user_id, username) {
  if (user_id.startsWith('name:')) {
    return username || user_id.replace(/^name:/, '');
  } else {
    return username || user_id;
  }
}

// === 応答安定化ヘルパー ===

// 期限内なら deferReply、期限切れ(10062)なら false を返す
export async function tryDefer(interaction, opts) {
  if (interaction.deferred || interaction.replied) return true;
  try {
    await interaction.deferReply(opts);
    return true;
  } catch (e) {
    if (e?.code === 10062) return false;
    throw e;
  }
}

// 最終返信：defer 済みなら editReply、未deferなら reply、どちらも失敗ならチャンネル送信
export async function sendFinal(interaction, payload, acked) {
  try {
    const already = acked ?? (interaction.deferred || interaction.replied);
    if (already) return await interaction.editReply(payload);
    return await interaction.reply(payload);
  } catch (e) {
    if (e?.code === 10062 || e?.code === 40060) {
      try {
        const channel = interaction.channel ?? (interaction.channelId ? await interaction.client.channels.fetch(interaction.channelId) : null);
        if (channel) {
          const text = typeof payload === 'string' ? payload : (payload?.content ?? '（応答に失敗しました）');
          return await channel.send(text);
        }
      } catch (_) {}
    }
    throw e;
  }
}
