const { SlashCommandBuilder } = require('discord.js');
const db = require('../db');

// ポイント設定
const WIN_BASE = 6;   // 勝ち基本
const LOSE_BASE = -4; // 負け基本
// 連勝/連敗ボーナス: 2連勝で+2, 3連勝で+4 ... / 2連敗で-2, 3連敗で-4 ...

module.exports = {
  data: new SlashCommandBuilder()
    .setName('result_team')
    .setDescription('チームID指定で勝敗を登録（レーン分けチーム）')
    .addIntegerOption(o =>
      o.setName('winteam')
        .setDescription('勝ったチームID')
        .setRequired(true),
    )
    .addIntegerOption(o =>
      o.setName('loseteam')
        .setDescription('負けたチームID')
        .setRequired(true),
    ),
  async execute(interaction) {
    const winTeamId = interaction.options.getInteger('winteam');
    const loseTeamId = interaction.options.getInteger('loseteam');

    if (winTeamId === loseTeamId) {
      return interaction.reply({ content: '勝ちチームと負けチームが同じです。別のIDを指定してください。', ephemeral: true });
    }

    const winners = db.getLaneTeamMembers(winTeamId);
    const losers  = db.getLaneTeamMembers(loseTeamId);

    if (!winners.length || !losers.length) {
      return interaction.reply({ content: '指定したチームIDのメンバーが見つかりません。', ephemeral: true });
    }

    const logs = [];

    // 勝者処理
    for (const p of winners) {
      const u = db.getUser(p.user_id);
      let streak = u?.streak ?? 0;
      // 直前も勝ちなら+1、直前が負け/0なら1から
      streak = (streak >= 0) ? streak + 1 : 1;
      const bonus = (streak - 1) * 2;           // 2連勝=+2, 3連勝=+4...
      const delta = WIN_BASE + bonus;           // +6 にボーナス加算
      db.updateUserStrength(p.user_id, delta, streak);
      logs.push(`🏆 ${p.username} +${delta}（連勝:${streak}）`);
    }

    // 敗者処理
    for (const p of losers) {
      const u = db.getUser(p.user_id);
      let streak = u?.streak ?? 0;
      // 直前も負けなら-1、直前が勝ち/0なら-1から
      streak = (streak <= 0) ? streak - 1 : -1;
      const penalty = (Math.abs(streak) - 1) * 2; // 2連敗=-2, 3連敗=-4...
      const delta = LOSE_BASE - penalty;          // -4 にペナルティをさらに減算
      db.updateUserStrength(p.user_id, delta, streak);
      logs.push(`🛠 ${p.username} ${delta}（連敗:${Math.abs(streak)}）`);
    }

    await interaction.reply(
      `結果を登録しました：チーム${winTeamId} 勝利 / チーム${loseTeamId} 敗北\n\n` +
      logs.join('\n')
    );
  },
};
