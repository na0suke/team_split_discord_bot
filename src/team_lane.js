const db = require('./db');

// DBのlane_signup形式 {message_id,user_id,username,role,strength} をそのまま使う
function groupByRole(participants) {
  const g = { TOP: [], JG: [], MID: [], ADC: [], SUP: [] };
  for (const p of participants) if (g[p.role]) g[p.role].push(p);
  return g;
}

function assignLaneTeams(participants) {
  const grouped = groupByRole(participants);
  // 各ロールの最小人数 = つくれるチーム数
  const teamCount = Math.min(
    grouped.TOP.length, grouped.JG.length, grouped.MID.length, grouped.ADC.length, grouped.SUP.length
  );
  if (teamCount <= 0) return [];

  // チームIDは通し番号で払い出し（試合IDは持たない）
  const teams = Array.from({ length: teamCount }, () => ({
    teamId: db.getNextTeamId(),
    players: [],
    totalStrength: 0,
  }));

  // 強い順に、合計値の低いチームへジグザグ投入（簡易バランス）
  const roles = ['TOP', 'JG', 'MID', 'ADC', 'SUP'];
  for (const role of roles) {
    const list = grouped[role].slice().sort((a, b) => b.strength - a.strength);
    for (let i = 0; i < list.length && i < teamCount; i++) {
      // i%teamCount でもOKだが、より均等化するなら「現在合計が最小のチーム」を選ぶ
      const targetIdx = teams.reduce((minIdx, t, idx, arr) =>
        t.totalStrength < arr[minIdx].totalStrength ? idx : minIdx, 0);
      const p = list[i];
      teams[targetIdx].players.push(p);
      teams[targetIdx].totalStrength += p.strength;
    }
  }

  // DBへ保存（team_id単位でメンバーを登録）
  for (const t of teams) {
    db.saveLaneTeam(t.teamId, t.players);
  }

  return teams;
}

function formatTeamsEmbed(teams, EmbedBuilder) {
  const embed = new EmbedBuilder().setTitle('レーン指定チーム分け結果').setColor(0x00ae86);
  for (const t of teams) {
    const lines = t.players.map(p => `${p.role}: ${p.username} (⭐${p.strength})`);
    embed.addFields({
      name: `チーム ${t.teamId}（合計⭐${t.totalStrength}）`,
      value: lines.join('\n') || '（空）',
    });
  }
  return embed;
}

module.exports = { assignLaneTeams, formatTeamsEmbed };
