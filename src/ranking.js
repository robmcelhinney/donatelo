const INITIAL_RATING = 1000;
const DEFAULT_K_FACTOR = 52;
const DEFAULT_TEMPERATURE = 52;
const DEFAULT_ALLOCATION_STYLE = 50;
const DEFAULT_RECENT_WINDOW = 4;
const DEFAULT_RECENT_WINNER_WINDOW = 1;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function roundTo(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function lerp(min, max, t) {
  return min + (max - min) * t;
}

function normalizeAllocationStyle(allocationStyle = DEFAULT_ALLOCATION_STYLE) {
  const numeric = Number(allocationStyle);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_ALLOCATION_STYLE;
  }

  return clamp(numeric, 0, 100);
}

function pickWeighted(items, random = Math.random) {
  const total = items.reduce((sum, item) => sum + Math.max(item.weight, 0), 0);
  if (total <= 0) {
    return items[0] ?? null;
  }

  let cursor = random() * total;
  for (const item of items) {
    cursor -= Math.max(item.weight, 0);
    if (cursor <= 0) {
      return item;
    }
  }

  return items[0] ?? null;
}

function pairTouchesAnyId(leftId, rightId, ids) {
  return ids.has(leftId) || ids.has(rightId);
}

function countAppearances(comparisons) {
  const appearances = new Map();
  const pairCounts = new Map();
  const touchedIds = new Set();

  for (const comparison of comparisons) {
    appearances.set(comparison.leftId, (appearances.get(comparison.leftId) || 0) + 1);
    appearances.set(comparison.rightId, (appearances.get(comparison.rightId) || 0) + 1);
    touchedIds.add(comparison.leftId);
    touchedIds.add(comparison.rightId);

    const key = pairKey(comparison.leftId, comparison.rightId);
    pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
  }

  return { appearances, pairCounts, touchedIds };
}

export function createInitialRatings(causes, initial = INITIAL_RATING) {
  return Object.fromEntries(causes.map((cause) => [cause.id, initial]));
}

export function pairKey(leftId, rightId) {
  return leftId < rightId ? `${leftId}__${rightId}` : `${rightId}__${leftId}`;
}

export function expectedScore(aRating, bRating) {
  return 1 / (1 + 10 ** ((bRating - aRating) / 400));
}

export function updateRatings(ratings, leftId, rightId, choice, kFactor = DEFAULT_K_FACTOR) {
  if (choice === "skip") {
    return { ...ratings };
  }

  const leftRating = ratings[leftId] ?? INITIAL_RATING;
  const rightRating = ratings[rightId] ?? INITIAL_RATING;
  const expectedLeft = expectedScore(leftRating, rightRating);
  const expectedRight = 1 - expectedLeft;

  let leftScore = 0.5;
  let rightScore = 0.5;

  if (choice === "left") {
    leftScore = 1;
    rightScore = 0;
  } else if (choice === "right") {
    leftScore = 0;
    rightScore = 1;
  }

  return {
    ...ratings,
    [leftId]: leftRating + kFactor * (leftScore - expectedLeft),
    [rightId]: rightRating + kFactor * (rightScore - expectedRight),
  };
}

function scoreLeaderMatch({
  leaderId,
  opponentId,
  ratings,
  appearances,
  pairCounts,
  recentPairs,
  recentWinnerIds,
}) {
  const pair = pairKey(leaderId, opponentId);
  const leaderRating = ratings[leaderId] ?? INITIAL_RATING;
  const opponentRating = ratings[opponentId] ?? INITIAL_RATING;
  const opponentAppearances = appearances.get(opponentId) || 0;
  const pairCount = pairCounts.get(pair) || 0;
  const ratingGap = Math.abs(leaderRating - opponentRating);

  const underexposed = 1 / (1 + opponentAppearances / 2);
  const novelty = 1 / (1 + pairCount);
  const closeness = 1 / (1 + ratingGap / 180);
  const recencyPenalty = recentPairs.has(pair) ? 0.25 : 1;
  const leaderCooldown = recentWinnerIds.has(leaderId) ? 0.15 : 1;

  return {
    leftId: leaderId,
    rightId: opponentId,
    weight: (underexposed * 0.56 + novelty * 0.28 + closeness * 0.16) * recencyPenalty * leaderCooldown,
  };
}

function scoreFallbackPair({ leftId, rightId, ratings, appearances, pairCounts, recentPairs, recentWinnerIds }) {
  const pair = pairKey(leftId, rightId);
  const leftAppearances = appearances.get(leftId) || 0;
  const rightAppearances = appearances.get(rightId) || 0;
  const pairCount = pairCounts.get(pair) || 0;
  const ratingGap = Math.abs((ratings[leftId] ?? INITIAL_RATING) - (ratings[rightId] ?? INITIAL_RATING));

  const underexposed = 1 / (1 + (leftAppearances + rightAppearances) / 4);
  const novelty = 1 / (1 + pairCount);
  const closeness = 1 / (1 + ratingGap / 220);
  const recencyPenalty = recentPairs.has(pair) ? 0.3 : 1;
  const winnerCooldown = recentWinnerIds.has(leftId) || recentWinnerIds.has(rightId) ? 0.45 : 1;

  return {
    leftId,
    rightId,
    weight: (underexposed * 0.45 + novelty * 0.3 + closeness * 0.25) * recencyPenalty * winnerCooldown,
  };
}

function orientPair(pair, random = Math.random) {
  if (random() < 0.5) {
    return pair;
  }

  return {
    leftId: pair.rightId,
    rightId: pair.leftId,
    weight: pair.weight,
  };
}

export function chooseNextPair(causes, ratings, comparisons, random = Math.random) {
  if (causes.length < 2) {
    return null;
  }

  const { appearances, pairCounts } = countAppearances(comparisons);
  const recentCauseIds = new Set(
    comparisons.length
      ? [comparisons.at(-1).leftId, comparisons.at(-1).rightId]
      : [],
  );
  const recentPairs = new Set(comparisons.slice(-DEFAULT_RECENT_WINDOW).map((comparison) => pairKey(comparison.leftId, comparison.rightId)));
  const recentWinnerIds = new Set(
    comparisons
      .slice(-DEFAULT_RECENT_WINNER_WINDOW)
      .map((comparison) =>
        comparison.choice === "left"
          ? comparison.leftId
          : comparison.choice === "right"
            ? comparison.rightId
            : null,
      )
      .filter(Boolean),
  );
  const preferredPool = recentWinnerIds.size
    ? causes.filter((cause) => !recentWinnerIds.has(cause.id))
    : causes;

  function collectPreferredCandidates(avoidCauseIds) {
    const preferredCandidates = [];
    for (let leftIndex = 0; leftIndex < preferredPool.length - 1; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < preferredPool.length; rightIndex += 1) {
        const leftId = preferredPool[leftIndex].id;
        const rightId = preferredPool[rightIndex].id;
        const pair = pairKey(leftId, rightId);
        if (pairCounts.has(pair) || pairTouchesAnyId(leftId, rightId, avoidCauseIds)) {
          continue;
        }
        preferredCandidates.push(
          scoreFallbackPair({
            leftId,
            rightId,
            ratings,
            appearances,
            pairCounts,
            recentPairs,
            recentWinnerIds,
          }),
        );
      }
    }
    return preferredCandidates;
  }

  if (preferredPool.length >= 2) {
    const strictPreferredCandidates = collectPreferredCandidates(recentCauseIds);
    const weightedPreferred = pickWeighted(strictPreferredCandidates.sort((a, b) => b.weight - a.weight).slice(0, 8), random);
    if (weightedPreferred) {
      return orientPair(weightedPreferred, random);
    }
  }

  const leader = causes.reduce((best, candidate) => {
    const bestRating = ratings[best.id] ?? INITIAL_RATING;
    const candidateRating = ratings[candidate.id] ?? INITIAL_RATING;
    return candidateRating > bestRating ? candidate : best;
  }, causes[0]);

  const leaderCandidates = causes
    .filter((cause) => cause.id !== leader.id)
    .map((cause) =>
      scoreLeaderMatch({
        leaderId: leader.id,
        opponentId: cause.id,
        ratings,
        appearances,
        pairCounts,
        recentPairs,
        recentWinnerIds,
      }),
    )
    .filter((candidate) => {
      const pair = pairKey(candidate.leftId, candidate.rightId);
      return !pairCounts.has(pair) && !pairTouchesAnyId(candidate.leftId, candidate.rightId, recentCauseIds);
    })
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5);

  const weightedLeader = pickWeighted(leaderCandidates, random);
  if (weightedLeader && weightedLeader.weight > 0) {
    return orientPair(weightedLeader, random);
  }

  function collectFallbackCandidates(avoidCauseIds) {
    const fallbackCandidates = [];
    for (let leftIndex = 0; leftIndex < causes.length - 1; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < causes.length; rightIndex += 1) {
        const leftId = causes[leftIndex].id;
        const rightId = causes[rightIndex].id;
        const pair = pairKey(leftId, rightId);
        if (pairCounts.has(pair) || pairTouchesAnyId(leftId, rightId, avoidCauseIds)) {
          continue;
        }
        fallbackCandidates.push(
          scoreFallbackPair({
            leftId,
            rightId,
            ratings,
            appearances,
            pairCounts,
            recentPairs,
            recentWinnerIds,
          }),
        );
      }
    }
    return fallbackCandidates;
  }

  const strictFallbackCandidates = collectFallbackCandidates(recentCauseIds);
  const relaxedFallbackCandidates = strictFallbackCandidates.length > 0 ? strictFallbackCandidates : collectFallbackCandidates(new Set());
  const weightedFallback = pickWeighted(relaxedFallbackCandidates.sort((a, b) => b.weight - a.weight).slice(0, 8), random);
  if (!weightedFallback) {
    return null;
  }

  return orientPair(weightedFallback, random);
}

export function ratingsToAllocations(
  causes,
  ratings,
  temperature = DEFAULT_TEMPERATURE,
  activeIds = null,
  allocationStyle = DEFAULT_ALLOCATION_STYLE,
) {
  const normalizedStyle = normalizeAllocationStyle(allocationStyle);
  const decisiveness = normalizedStyle / 100;
  const effectiveTemperature = lerp((temperature ?? DEFAULT_TEMPERATURE) * 1.15, (temperature ?? DEFAULT_TEMPERATURE) * 0.55, decisiveness);
  const balanceWeight = lerp(0.12, 0.82, decisiveness);

  const scored = causes.map((cause) => ({
    id: cause.id,
    name: cause.name,
    description: cause.description,
    rating: ratings[cause.id] ?? INITIAL_RATING,
    active: activeIds ? activeIds.has(cause.id) : true,
    weight: Math.exp(((ratings[cause.id] ?? INITIAL_RATING) - INITIAL_RATING) / effectiveTemperature),
  }));

  const activeScored = scored.filter((item) => item.active);
  if (activeScored.length === 0) {
    return scored
      .map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description,
        rating: roundTo(item.rating, 2),
        share: 0,
      }))
      .sort((a, b) => b.share - a.share);
  }

  const totalWeight = activeScored.reduce((sum, item) => sum + item.weight, 0);
  const activeCount = activeScored.length || 1;
  const uniformShare = 100 / activeCount;

  const allocations = scored
    .map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description,
      rating: roundTo(item.rating, 2),
      share: item.active
        ? roundTo(
            ((item.weight / totalWeight) * 100) * balanceWeight + uniformShare * (1 - balanceWeight),
            1,
          )
        : 0,
    }))
    .sort((a, b) => b.share - a.share);

  const roundedTotal = allocations.reduce((sum, item) => sum + item.share, 0);
  const adjustment = roundTo(100 - roundedTotal, 1);
  if (allocations.length > 0 && adjustment !== 0) {
    allocations[0].share = roundTo(clamp(allocations[0].share + adjustment, 0, 100), 1);
  }

  return allocations;
}

export function buildConfidence(comparisonCount, allocations) {
  const topShare = allocations[0]?.share ?? 0;
  const secondShare = allocations[1]?.share ?? 0;
  const countScore = clamp(comparisonCount / 14, 0, 1);
  const gapScore = clamp((topShare - secondShare) / 16, 0, 1);
  const confidenceScore = roundTo((countScore * 0.55 + gapScore * 0.45) * 100, 1);

  let label = "Low";
  if (confidenceScore >= 70) {
    label = "High";
  } else if (confidenceScore >= 35) {
    label = "Medium";
  }

  const description =
    label === "High"
      ? "The ranking looks stable across the comparisons you made."
      : label === "Medium"
        ? "The result is useful, but a few more comparisons would sharpen it."
        : "This result is provisional and should improve with more comparisons.";

  return {
    score: confidenceScore,
    label,
    description,
  };
}

export function buildShareText({ allocations, comparisonCount }) {
  const lines = ["Donatelo donation allocation", `Based on ${comparisonCount} comparisons.`];
  for (const item of allocations) {
    lines.push(`${item.name}: ${item.share.toFixed(1)}%`);
  }
  return lines.join("\n");
}
