function signatureOfTeams(teamA, teamB) {
  const a = [...teamA].sort().join('-');
  const b = [...teamB].sort().join('-');
  return a < b ? `${a}__${b}` : `${b}__${a}`;
}

export function splitBalanced(players, lastSig = null) {
  const n = players.length;
  if (n < 2) return { teamA: players, teamB: [], diff: 0, sumA: players.reduce((s,p)=>s+p.points,0), sumB: 0 };
  const sizeA = Math.floor(n / 2);
  const ids = players.map((_, i) => i);

  function *combos(arr, k, start=0, acc=[]) {
    if (acc.length === k) { yield acc; return; }
    for (let i=start; i<arr.length; i++) {
      acc.push(arr[i]);
      yield* combos(arr, k, i+1, acc);
      acc.pop();
    }
  }

  let best = null;
  const total = players.reduce((s,p)=>s+p.points,0);
  for (const c of combos(ids, sizeA)) {
    const setA = new Set(c);
    const teamA = players.filter((_,i)=>setA.has(i));
    const teamB = players.filter((_,i)=>!setA.has(i));
    const sumA = teamA.reduce((s,p)=>s+p.points,0);
    const sumB = total - sumA;
    const diff = Math.abs(sumA - sumB);

    let penalty = 0;
    if (lastSig) {
      const sig = signatureOfTeams(teamA.map(p=>p.user_id), teamB.map(p=>p.user_id));
      if (sig === lastSig) penalty += 100000; // 完全一致は避ける
    }
    const score = diff + penalty;
    if (!best || score < best.score) best = { teamA, teamB, diff, sumA, sumB, score };
  }
  return best;
}

// ★ 強さ無視ランダム二分割
export function splitSimple(players) {
  const arr = [...players];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  const half = Math.floor(arr.length / 2);
  const teamA = arr.slice(0, half);
  const teamB = arr.slice(half);
  return { teamA, teamB, diff: 0, sumA: 0, sumB: 0 };
}

export function formatTeamsEmbedFields(teamA, teamB) {
  const f = (team) => team.map(p => `${p.username} (⭐${p.points})`).join('\n') || '-';
  return [
    { name: `Team A (${teamA.length})`, value: f(teamA), inline: true },
    { name: `Team B (${teamB.length})`, value: f(teamB), inline: true }
  ];
}

export function signatureOfIds(a,b){
  return signatureOfTeams(a,b);
}
