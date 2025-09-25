const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('start_lane_signup')
    .setDescription('LoLのポジション指定で参加受付を開始します'),
  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setTitle('ポジション参加募集')
      .setDescription(
        '希望のレーンをリアクションで選んでください。\n\n' +
          '🗡️ TOP / 🪓 JG / 🧙 MID / 🏹 ADC / 🛡️ SUP\n' +
          '✅ を押すと、レーン被りなし＆強さ考慮でチーム分けします。'
      );

    // 返信メッセージを取得して、そのメッセージIDで lane_signup を紐付け
    await interaction.reply({ embeds: [embed] });
    const msg = await interaction.fetchReply();

    // 既存の同メッセージIDの応募を初期化（再掲対策）
    db.clearLaneSignup(msg.id);

    // レーン + 実行ボタンのリアクションを付与
    const emojis = ['🗡️', '🪓', '🧙', '🏹', '🛡️', '✅'];
    for (const e of emojis) await msg.react(e);
  },
};
