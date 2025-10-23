// 強さ（points）の合計が近くなるように分割しつつ、直前と似過ぎない組合せを優先

function signatureOfTeams(teamAIds, teamBIds) {
  const a = [...teamAIds].sort().join('-');
  const b = [...teamBIds].sort().join('-');
  // A/Bの並び替えで同じ署名になるように正規化
  return a < b ? `${a}__${b}` : `${b}__${a}`;
}

function jaccardSimilarity(currentAIds, currentBIds, prevSignature) {
  if (!prevSignature) return 0;
  const [pa, pb] = prevSignature.split('__');
  const prevA = new Set(pa.split('-').filter(Boolean));
  const prevB = new Set(pb.split('-').filter(Boolean));
  const curA = new Set(currentAIds);
  const curB = new Set(currentBIds);

  const jac = (s1, s2) => {
    const inter = [...s1].filter((x) => s2.has(x)).length;
    const uni = new Set([...s1, ...s2]).size;
    return uni ? inter / uni : 0;
  };

  // A↔A / A↔B / B↔A / B↔B の最大類似を採用（似すぎる構成を避ける）
  const simAA = jac(curA, prevA);
  const simAB = jac(curA, prevB);
  const simBA = jac(curB, prevA);
  const simBB = jac(curB, prevB);
  return Math.max(simAA, simAB, simBA, simBB);
}

export function splitBalanced(players, lastSignature = null) {
  // players: [{ user_id, username, points }]
  const n = players.length;
  if (n < 2) return { teamA: players, teamB: [], diff: 0, sumA: 0, sumB: 0, signature: null };

  const sizeA = Math.floor(n / 2);
  const idx = players.map((_, i) => i);

  function* combos(arr, k, start = 0, acc = []) {
    if (acc.length === k) {
      yield acc;
      return;
    }
    for (let i = start; i < arr.length; i++) {
      acc.push(arr[i]);
      yield* combos(arr, k, i + 1, acc);
      acc.pop();
    }
  }

  const total = players.reduce((s, p) => s + p.points, 0);
  let best = null;

  for (const c of combos(idx, sizeA)) {
    const setA = new Set(c);
    const candidateA = players.filter((_, i) => setA.has(i));
    const candidateB = players.filter((_, i) => !setA.has(i));
    const sumA = candidateA.reduce((s, p) => s + p.points, 0);
    const sumB = total - sumA;
    const diff = Math.abs(sumA - sumB);

    // ★ 修正点: チームA/Bの決定をランダム化（偏り解消）
    let teamA, teamB;
    if (Math.random() < 0.5) {
      teamA = candidateA;
      teamB = candidateB;
    } else {
      teamA = candidateB;
      teamB = candidateA;
    }

    const idsA = teamA.map((p) => p.user_id);
    const idsB = teamB.map((p) => p.user_id);
    const sigNow = signatureOfTeams(idsA, idsB);

    // 直前チームとの完全一致は巨大ペナルティ、類似度(Jaccard)は係数を掛けて加点
    let penalty = 0;
    if (lastSignature && sigNow === lastSignature) penalty += 100000;
    const sim = jaccardSimilarity(idsA, idsB, lastSignature);
    penalty += Math.floor(sim * 200); // 類似度 0.0〜1.0 に対して 0〜200 程度の重み

    const score = diff + penalty;

    if (!best || score < best.score) {
      best = { 
        teamA, 
        teamB, 
        diff, 
        sumA: teamA.reduce((s, p) => s + p.points, 0), 
        sumB: teamB.reduce((s, p) => s + p.points, 0), 
        score, 
        signature: sigNow 
      };
    }
  }

  return best;
}

// ランダム2分割（強さ無視）
export function splitRandom(players) {
  const shuffled = [...players].sort(() => Math.random() - 0.5);
  const half = Math.ceil(shuffled.length / 2);
  
  // ★ 修正点: チームA/Bの決定もランダム化（偏り解消）
  const firstHalf = shuffled.slice(0, half);
  const secondHalf = shuffled.slice(half);
  
  if (Math.random() < 0.5) {
    return { teamA: firstHalf, teamB: secondHalf };
  } else {
    return { teamA: secondHalf, teamB: firstHalf };
  }
}

// チームメンバーを表示用にフォーマット
export function formatTeamLines(team) {
  return team.map((user) => {
    const points = user.points ?? 300;
    let displayName;

    // 疑似ユーザー（name:で始まるID）の場合は、usernameをそのまま表示
    if (user.user_id.startsWith('name:')) {
      displayName = user.username || user.user_id.replace(/^name:/, '');
    } else {
      // 実際のDiscordユーザーの場合はメンション形式
      displayName = `<@${user.user_id}>`;
    }

    return `${displayName} (⭐${points})`;
  }).join('\n');
}
