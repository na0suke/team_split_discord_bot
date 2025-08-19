function signatureOfTeams(teamA, teamB) {
  const a = [...teamA].sort().join('-');
  const b = [...teamB].sort().join('-');
  return a < b ? `${a}__${b}` : `${b}__${a}`;
}

export function splitBalanced(players, lastSig = null) {
  const n = players.length;
  if (n < 2) {
    const sumA = players.reduce((s, p) => s + (p.points ?? 0), 0);
    return { teamA: players, teamB: [], diff: Math.abs(sumA - 0), sumA, sumB: 0 };
  }
  const sizeA = Math.floor(n / 2);
  const ids = players.map((_, i) => i);

  function* combos(arr, k, start = 0, acc = []) {
    if (acc.length === k) { yield acc; return; }
    for (let i = start; i < arr.length; i++) {
      acc.push(arr[i]);
      yield* combos(arr, k, i + 1, acc);
      acc.pop();
    }
  }

  let best = null;
  const total = players.reduce((s, p) => s + (p.points ?? 0), 0);
  for (const c of combos(ids, sizeA)) {
    const setA = new Set(c);
    const teamA = players.filter((_, i) => setA.has(i));
    const teamB = players.filter((_, i) => !setA.has(i));
    const sumA = teamA.reduce((s, p) => s + (p.points ?? 0), 0);
    const sumB = total - sumA;
    const diff = Math.abs(sumA - sumB);

    let penalty = 0;
    if (lastSig) {
      const sig = signatureOfTeams(teamA.map(p => p.user_id), teamB.map(p => p.user_id));
      if (sig === lastSig) penalty += 100000; // 完全一致は避ける
    }
    const score = diff + penalty;
    if (!best || score < best.score) best = { teamA, teamB, diff, sumA, sumB, score };
  }
  return best;
}

// ポイント無視でランダムに二分割（上限なし）
export function splitSimple(players) {
  const n = players.length;
  if (n < 2) {
    const sumA = players.reduce((s, p) => s + (p.points ?? 0), 0);
    return { teamA: players, teamB: [], sumA, sumB: 0, diff: Math.abs(sumA - 0) };
  }
  const shuffled = [...players];
  // Fisher–Yates
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const sizeA = Math.ceil(n / 2); // 片方に1人多くてもOK
  const teamA = shuffled.slice(0, sizeA);
  const teamB = shuffled.slice(sizeA);
  const sumA = teamA.reduce((s, p) => s + (p.points ?? 0), 0);
  const sumB = teamB.reduce((s, p) => s + (p.points ?? 0), 0);
  return { teamA, teamB, sumA, sumB, diff: Math.abs(sumA - sumB) };
}

export function formatTeamsEmbedFields(teamA, teamB) {
  const f = (team) => team.map(p => `${p.username} (⭐${p.points})`).join('\n') || '-';
  return [
    { name: `Team A (${teamA.length})`, value: f(teamA), inline: true },
    { name: `Team B (${teamB.length})`, value: f(teamB), inline: true }
  ];
}

export function signatureOfIds(a, b) {
  return signatureOfTeams(a, b);
}
