import {
  getLatestMatch,
  getMatchById,
  setMatchWinner,
  getUser,
  addWinLoss,
  getStreak,
  incStreak,
  resetStreak,
  getLossStreak,
  incLossStreak,
  resetLossStreak,
  getPointsConfig,
  updatePointsConfig,
  topRanks,
  getServerStats,
  getMaxWinStreakUser,
  getMaxLossStreakUser,
  getMaxPointsUser,
  getTopPlayersbyMatches,
  getTopPlayersByRecentWinrate,
  getTeamWinStats,
  getRecentMatchResults
} from '../db.js';
import { formatResultLine, tryDefer } from '../utils/helpers.js';

// 勝敗登録・設定・情報表示コマンド処理
export async function handleResultAndConfigCommands(interaction) {
  const gid = interaction.guildId;
  const name = interaction.commandName;

  // --- /result, /win ---
  if (name === 'result' || name === 'win') {
    const acked = await tryDefer(interaction);

    const winner = name === 'result'
      ? interaction.options.getString('winner', true)
      : interaction.options.getString('team', true);
    const matchIdArg = interaction.options.getInteger('match_id');

    const match = matchIdArg ? getMatchById.get(gid, matchIdArg) : getLatestMatch.get(gid);
    if (!match) {
      const msg = matchIdArg ? `マッチ ID ${matchIdArg} が見つかりません。` : '登録可能なマッチがありません。';
      await (acked ? interaction.editReply(msg) : interaction.reply(msg));
      return true;
    }

    if (!['A', 'B'].includes(winner)) {
      await (acked ? interaction.editReply('winner は A または B を指定してください。') : interaction.reply('winner は A または B を指定してください。'));
      return true;
    }

    const cfg = getPointsConfig();
    const teamA = JSON.parse(match.team_a || '[]');
    const teamB = JSON.parse(match.team_b || '[]');
    const winners = winner === 'A' ? teamA : teamB;
    const losers = winner === 'A' ? teamB : teamA;

    const linesA = [], linesB = [];

    // 勝者処理
    for (const uid of winners) {
      if (uid.startsWith('name:')) continue;
      const beforeRow = getUser.get(gid, uid);
      const before = beforeRow?.points ?? 300;
      const wsBefore = (getStreak.get(gid, uid)?.win_streak) ?? 0;
      const bonus = Math.min(wsBefore, cfg.streak_cap);
      const delta = cfg.win + bonus;
      addWinLoss.run(1, 0, delta, gid, uid);
      incStreak.run(cfg.streak_cap, gid, uid);
      resetLossStreak.run(gid, uid);
      const after = before + delta;

      // サーバー表示名を取得（ニックネーム優先）
      let label;
      try {
        const member = await interaction.guild.members.fetch(uid);
        label = member.displayName;
      } catch {
        label = beforeRow?.username || `<@${uid}>`;
      }

      linesA.push(formatResultLine(before, cfg.win, bonus, after, label));
    }

    // 敗者処理
    for (const uid of losers) {
      if (uid.startsWith('name:')) continue;
      const beforeRow = getUser.get(gid, uid);
      const before = beforeRow?.points ?? 300;
      const lsBefore = (getLossStreak.get(gid, uid)?.loss_streak) ?? 0;
      const lcap = cfg.loss_streak_cap ?? cfg.streak_cap;
      const penalty = Math.min(lsBefore, lcap);
      const delta = cfg.loss - penalty;
      addWinLoss.run(0, 1, delta, gid, uid);
      incLossStreak.run(lcap, gid, uid);
      resetStreak.run(gid, uid);
      const after = before + delta;

      // サーバー表示名を取得（ニックネーム優先）
      let label;
      try {
        const member = await interaction.guild.members.fetch(uid);
        label = member.displayName;
      } catch {
        label = beforeRow?.username || `<@${uid}>`;
      }

      linesB.push(formatResultLine(before, cfg.loss, -penalty, after, label));
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

    if (acked) {
      await interaction.editReply(text);
    } else {
      try {
        await interaction.reply(text);
      } catch {
        const ch = interaction.channel ?? (interaction.channelId ? await interaction.client.channels.fetch(interaction.channelId) : null);
        if (ch) await ch.send(text);
      }
    }
    return true;
  }

  // --- /set_points ---
  if (name === 'set_points') {
    const win = interaction.options.getInteger('win');
    const loss = interaction.options.getInteger('loss');
    const cap = interaction.options.getInteger('streak_cap');
    const lcap = interaction.options.getInteger('loss_streak_cap');

    updatePointsConfig({ win, loss, streak_cap: cap, loss_streak_cap: lcap });
    const cfg = getPointsConfig();
    await interaction.reply(
      `ポイント設定を更新しました: win=${cfg.win}, loss=${cfg.loss}, ` +
      `streak_cap=${cfg.streak_cap}, loss_streak_cap=${cfg.loss_streak_cap}`
    );
    return true;
  }

  // --- /show_points ---
  if (name === 'show_points') {
    const cfg = getPointsConfig();
    await interaction.reply(
      `現在のポイント設定: win=${cfg.win}, loss=${cfg.loss}, ` +
      `streak_cap=${cfg.streak_cap}, loss_streak_cap=${cfg.loss_streak_cap}`
    );
    return true;
  }

  // --- /rank ---
  if (name === 'rank') {
    const rows = topRanks.all(gid);
    if (!rows.length) {
      await interaction.reply('ランキングはまだありません。');
      return true;
    }
    const lines = rows.map((r, i) => {
      const rate = Math.round((r.winrate || 0) * 100);
      return `${i + 1}. ${r.username || r.user_id} — ⭐${r.points} / ${r.wins}W-${r.losses}L / ${rate}% (WS:${r.win_streak})`;
    });
    await interaction.reply(['ランキング:', ...lines].join('\n'));
    return true;
  }

  // --- /stats ---
  if (name === 'stats') {
    const stats = getServerStats.get(gid);

    if (!stats || stats.total_users === 0) {
      await interaction.reply('統計情報がまだありません。');
      return true;
    }

    const maxWinStreakUser = getMaxWinStreakUser.get(gid);
    const maxLossStreakUser = getMaxLossStreakUser.get(gid);
    const topPlayersByWinrate = getTopPlayersByRecentWinrate.all(gid, 5); // 最低5試合以上

    const lines = [
      '📊 **サーバー統計情報**',
      '',
      '【全体】',
      `総試合数: ${Math.floor(stats.total_matches / 2)}試合`,
      `平均ポイント: ${Math.round(stats.avg_points || 0)}⭐`,
      '',
      '【記録】',
    ];

    // 最多連勝記録
    if (maxWinStreakUser && maxWinStreakUser.win_streak > 0) {
      lines.push(`🏆 最多連勝: ${maxWinStreakUser.username || maxWinStreakUser.user_id} (${maxWinStreakUser.win_streak}連勝)`);
    }

    // 最多連敗記録
    if (maxLossStreakUser && maxLossStreakUser.loss_streak > 0) {
      lines.push(`💔 最多連敗: ${maxLossStreakUser.username || maxLossStreakUser.user_id} (${maxLossStreakUser.loss_streak}連敗)`);
    }

    // 最新戦績での勝率TOP3（最低5試合参加）
    if (topPlayersByWinrate.length > 0) {
      lines.push('');
      lines.push('【最新戦績での勝率 TOP3】');
      lines.push('（最低試合参加数: 5試合）');
      topPlayersByWinrate.slice(0, 3).forEach((p, i) => {
        const winrate = Math.round((p.winrate || 0) * 100);
        lines.push(`${i + 1}. ${p.username || p.user_id} — ${winrate}% (${p.wins}W-${p.losses}L)`);
      });
    } else {
      lines.push('');
      lines.push('【最新戦績での勝率 TOP3】');
      lines.push('（データ不足: 最低5試合必要）');
    }

    await interaction.reply(lines.join('\n'));
    return true;
  }

  return false; // このハンドラーでは処理されなかった
}
