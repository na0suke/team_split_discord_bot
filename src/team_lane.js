// src/team_lane.js
import { saveLaneTeam, getNextLaneTeamIdForGuild } from './db.js';

export function assignLaneTeams(participants, guildId) {
  const groups = { TOP: [], JG: [], MID: [], ADC: [], SUP: [] };
  for (const p of participants) if (groups[p.role]) groups[p.role].push(p);

  const teamCount = Math.max(
    1,
    Math.min(groups.TOP.length, groups.JG.length, groups.MID.length, groups.ADC.length, groups.SUP.length)
  );
  const teams = Array.from({ length: teamCount }, () => ({
    teamId: getNextLaneTeamIdForGuild.get(guildId).next,
    players: [],
    totalStrength: 0,
  }));

  // 各ロール強い順で、合計が最小のチームへ割当
  const roles = ['TOP','JG','MID','ADC','SUP'];
  for (const role of roles) {
    const list = groups[role].slice().sort((a,b)=>b.strength-a.strength);
    // 足りない分は「揮発ダミー」を挿入（DB保存しない）
    while (list.length < teamCount) {
      list.push({ userId: `dummy:${role}:${list.length}`, username: '（空席）', role, strength: 300, __dummy: true });
    }
    for (const p of list.slice(0, teamCount)) {
      let idx = 0;
      for (let i=1;i<teams.length;i++) if (teams[i].totalStrength < teams[idx].totalStrength) idx = i;
      teams[idx].players.push(p);
      teams[idx].totalStrength += p.strength;
    }
  }

  // 実ユーザーのみ DB 保存（ダミーは保存しない）
  for (const t of teams) {
    for (const p of t.players) {
      if (p.__dummy) continue;
      saveLaneTeam.run({
        team_id: t.teamId,
        guild_id: guildId,
        user_id: p.userId,
        username: p.username,
        role: p.role,
        strength: p.strength,
      });
    }
  }
  return teams;
}

export function formatLaneTeamsEmbed(teams, EmbedBuilder) {
  const embed = new EmbedBuilder().setTitle('レーン指定チーム分け結果').setColor(0x00ae86);
  for (const t of teams) {
    embed.addFields({
      name: `チーム ${t.teamId}（合計⭐${t.totalStrength}）`,
      value: t.players.map(p => `${icon(p.role)} ${p.username} (⭐${p.strength})`).join('\n') || '（空）',
    });
  }
  return embed;
}

function icon(role) {
  switch (role) {
    case 'TOP': return '⚔️';
    case 'JG':  return '🌲';
    case 'MID': return '🪄';
    case 'ADC': return '🏹';
    case 'SUP': return '❤️';
    default:    return '•';
  }
}
