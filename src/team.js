import {
  addTeamHistory,
  getRecentTeamHistory,
  cleanOldTeamHistory
} from './db.js';

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

// 複数回前のチーム構成との類似度を計算
function calculateMultipleHistorySimilarity(currentAIds, currentBIds, historySignatures) {
  if (!historySignatures || historySignatures.length === 0) return 0;

  let totalPenalty = 0;

  historySignatures.forEach((signature, index) => {
    const similarity = jaccardSimilarity(currentAIds, currentBIds, signature);
    // 新しい履歴ほど重いペナルティ（直前=1.0倍、2回前=0.8倍、3回前=0.6倍...）
    const weight = Math.max(0.2, 1.0 - (index * 0.2));
    totalPenalty += similarity * weight;
  });

  return totalPenalty;
}

export function splitBalanced(players, lastSignature = null, guildId = null) {
  // players: [{ user_id, username, points }]
  const n = players.length;
  if (n < 2) return { teamA: players, teamB: [], diff: 0, sumA: 0, sumB: 0, signature: null };

  // ポイントが未定義の場合は300に設定
  const normalizedPlayers = players.map(p => ({
    ...p,
    points: p.points ?? p.strength ?? 300
  }));

  const sizeA = Math.floor(n / 2);
  const idx = normalizedPlayers.map((_, i) => i);

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

  // 過去5回分のチーム履歴を取得（guildIdが提供された場合）
  let historySignatures = [];
  if (guildId) {
    try {
      // データベースから過去のチーム履歴を取得
      historySignatures = getRecentTeamHistory.all(guildId, 5).map(row => row.signature);
      console.log(`[DEBUG] Loaded ${historySignatures.length} team history signatures`);
    } catch (error) {
      console.log('[DEBUG] Failed to fetch team history:', error.message);
      historySignatures = [];
    }
  }

  const total = normalizedPlayers.reduce((s, p) => s + (p.points ?? 300), 0);
  let best = null;

  for (const c of combos(idx, sizeA)) {
    const setA = new Set(c);
    const candidateA = normalizedPlayers.filter((_, i) => setA.has(i));
    const candidateB = normalizedPlayers.filter((_, i) => !setA.has(i));
    const sumA = candidateA.reduce((s, p) => s + (p.points ?? 300), 0);
    const sumB = candidateB.reduce((s, p) => s + (p.points ?? 300), 0);
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

    // ★ 改善: ポイント差を最優先にするスコア計算
    let penalty = 0;

    // 完全一致の場合は巨大ペナルティ（これは維持）
    if (lastSignature && sigNow === lastSignature) penalty += 100000;

    // ポイント差が大きい場合は履歴ペナルティを軽減
    const diffThreshold = 50; // 50ポイント差以内なら履歴を考慮

    if (diff <= diffThreshold) {
      // ポイント差が小さい場合のみ履歴を強く考慮
      // 直前のチーム構成との類似度ペナルティ
      if (lastSignature) {
        const directSim = jaccardSimilarity(idsA, idsB, lastSignature);
        penalty += Math.floor(directSim * 150); // 200→150に軽減
      }

      // 複数回前のチーム構成との類似度ペナルティ
      const historySim = calculateMultipleHistorySimilarity(idsA, idsB, historySignatures);
      penalty += Math.floor(historySim * 75); // 100→75に軽減
    } else {
      // ポイント差が大きい場合は履歴ペナルティを大幅軽減
      if (lastSignature) {
        const directSim = jaccardSimilarity(idsA, idsB, lastSignature);
        penalty += Math.floor(directSim * 30); // 大幅軽減
      }

      const historySim = calculateMultipleHistorySimilarity(idsA, idsB, historySignatures);
      penalty += Math.floor(historySim * 15); // 大幅軽減
    }

    // ★ 改善: ポイント差に重みを付けてより重要視
    const weightedDiff = diff * 3; // ポイント差を3倍重視
    const score = weightedDiff + penalty;

    if (!best || score < best.score) {
      best = { 
        teamA, 
        teamB, 
        diff, 
        sumA: teamA.reduce((s, p) => s + (p.points ?? 300), 0),
        sumB: teamB.reduce((s, p) => s + (p.points ?? 300), 0),
        score,
        signature: sigNow 
      };
    }
  }

  return best;
}

// チーム構成を履歴に保存する関数
export function saveTeamHistory(guildId, signature) {
  if (!guildId || !signature) return;

  try {
    // 新しい履歴を追加
    addTeamHistory.run(guildId, signature, Date.now());

    // 古い履歴を削除（最新10件のみ保持）
    cleanOldTeamHistory.run(guildId, guildId, 10);

    console.log(`[DEBUG] Saved team history for guild ${guildId}`);
  } catch (error) {
    console.error('[ERROR] Failed to save team history:', error);
  }
}

// ランダム2分割（強さ無視）
export function splitRandom(players) {
  // フィッシャー・イェーツシャッフルアルゴリズムで真のランダム化
  const shuffled = [...players];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const half = Math.ceil(shuffled.length / 2);
  const firstHalf = shuffled.slice(0, half);
  const secondHalf = shuffled.slice(half);
  
  // チームA/Bの決定もランダム化（偏り解消）
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
