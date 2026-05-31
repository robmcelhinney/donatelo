import { causes } from "./data.js";
import {
  buildConfidence,
  chooseNextPair,
  createInitialRatings,
  pairKey,
  ratingsToAllocations,
  updateRatings,
} from "./ranking.js";

export const SESSION_VERSION = 3;
export const DEFAULT_ALLOCATION_STYLE = 50;

function clone(value) {
  return structuredClone(value);
}

function normalizeCauseIds(causeIds = []) {
  return [...new Set(causeIds)].filter((causeId) => causes.some((cause) => cause.id === causeId));
}

function normalizeAllocationStyle(allocationStyle = DEFAULT_ALLOCATION_STYLE) {
  const numeric = Number(allocationStyle);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_ALLOCATION_STYLE;
  }

  return Math.min(100, Math.max(0, numeric));
}

function getActiveCauses(session) {
  const excludedCauseIds = new Set(session.excludedCauseIds || []);
  return causes.filter((cause) => !excludedCauseIds.has(cause.id));
}

function computeComparisonTarget(activeCauseCount) {
  if (activeCauseCount < 2) {
    return 0;
  }

  const uniquePairCount = (activeCauseCount * (activeCauseCount - 1)) / 2;
  const heuristicTarget = Math.max(5, activeCauseCount * 2);
  return Math.min(uniquePairCount, heuristicTarget);
}

function makeBaseSession(excludedCauseIds = [], allocationStyle = DEFAULT_ALLOCATION_STYLE) {
  const normalizedExcludedCauseIds = normalizeCauseIds(excludedCauseIds);
  const activeCauseCount = causes.length - normalizedExcludedCauseIds.length;
  return {
    version: SESSION_VERSION,
    id: crypto.randomUUID(),
    phase: "intro",
    createdAt: new Date().toISOString(),
    completedAt: null,
    comparisonTarget: computeComparisonTarget(activeCauseCount),
    comparisonCount: 0,
    excludedCauseIds: normalizedExcludedCauseIds,
    allocationStyle: normalizeAllocationStyle(allocationStyle),
    ratings: createInitialRatings(causes),
    comparisons: [],
    currentPair: null,
    allocations: null,
    confidence: null,
  };
}

function makeReplayBase(session) {
  const excludedCauseIds = clone(session.excludedCauseIds || []);
  const activeCauseCount = causes.length - excludedCauseIds.length;
  return {
    ...makeBaseSession([], session.allocationStyle ?? DEFAULT_ALLOCATION_STYLE),
    id: session.id,
    createdAt: session.createdAt,
    comparisonTarget: computeComparisonTarget(activeCauseCount),
    excludedCauseIds,
    allocationStyle: normalizeAllocationStyle(session.allocationStyle ?? DEFAULT_ALLOCATION_STYLE),
  };
}

function applyComparisonStep(session, comparison) {
  const next = clone(session);
  next.comparisons = [...next.comparisons, clone(comparison)];

  if (comparison.choice !== "skip") {
    next.ratings = updateRatings(next.ratings, comparison.leftId, comparison.rightId, comparison.choice);
    next.comparisonCount += 1;
  }
  return next;
}

function rebuildSessionFromComparisons(session, comparisons) {
  let next = makeReplayBase(session);
  next.phase = "comparing";

  for (const comparison of comparisons) {
    next = applyComparisonStep(next, comparison);
  }

  next.allocations = null;
  next.confidence = null;
  next.completedAt = null;
  next.phase = "comparing";
  return next;
}

function getAllocationIds(session) {
  const activeCauseIds = new Set(getActiveCauses(session).map((cause) => cause.id));
  const touchedIds = new Set(
    session.comparisons
      .flatMap((comparison) => [comparison.leftId, comparison.rightId])
      .filter((causeId) => activeCauseIds.has(causeId)),
  );

  if (touchedIds.size > 0) {
    return touchedIds;
  }

  if (activeCauseIds.size <= 1) {
    return activeCauseIds;
  }

  return touchedIds;
}

function finalize(session, { preserveCompletedAt = false } = {}) {
  const next = clone(session);
  const activeIds = getAllocationIds(next);
  next.allocations = ratingsToAllocations(causes, next.ratings, undefined, activeIds, next.allocationStyle);
  next.confidence = buildConfidence(next.comparisonCount, next.allocations);
  next.phase = "results";
  next.completedAt = preserveCompletedAt && next.completedAt ? next.completedAt : new Date().toISOString();
  next.currentPair = null;
  return next;
}

function ensureComparisonPair(session) {
  const next = clone(session);
  if (next.phase === "comparing" && !next.currentPair) {
    next.currentPair = chooseNextPair(getActiveCauses(next), next.ratings, next.comparisons);
  }
  if (next.phase === "results" && !next.allocations) {
    return finalize(next);
  }
  return next;
}

export function createFreshSession({ start = false, excludedCauseIds = [], allocationStyle = DEFAULT_ALLOCATION_STYLE } = {}) {
  const session = makeBaseSession(excludedCauseIds, allocationStyle);
  return start ? startSession(session) : session;
}

export function setAllocationStyle(session, allocationStyle) {
  const next = clone(session);
  next.allocationStyle = normalizeAllocationStyle(allocationStyle);

  if (next.phase === "results") {
    return finalize(next, { preserveCompletedAt: true });
  }

  return next;
}

export function undoLastChoice(session) {
  if (session.phase === "intro" || session.comparisons.length === 0) {
    return clone(session);
  }

  const lastComparison = session.comparisons.at(-1);
  const nextComparisons = session.comparisons.slice(0, -1);
  const nextSession = rebuildSessionFromComparisons(session, nextComparisons);
  nextSession.currentPair = lastComparison.currentPair
    ? clone(lastComparison.currentPair)
    : {
        leftId: lastComparison.leftId,
        rightId: lastComparison.rightId,
    };

  return nextSession;
}

export function normalizeSession(rawSession) {
  if (!rawSession || rawSession.version !== SESSION_VERSION) {
    return createFreshSession();
  }

  const session = {
    ...makeBaseSession(),
    ...clone(rawSession),
    version: SESSION_VERSION,
    id: rawSession.id || crypto.randomUUID(),
    ratings: rawSession.ratings || createInitialRatings(causes),
    comparisons: Array.isArray(rawSession.comparisons) ? rawSession.comparisons : [],
    currentPair: rawSession.currentPair || null,
    allocations: Array.isArray(rawSession.allocations) ? rawSession.allocations : null,
    confidence: rawSession.confidence || null,
    excludedCauseIds: normalizeCauseIds(rawSession.excludedCauseIds || []),
    allocationStyle: normalizeAllocationStyle(rawSession.allocationStyle ?? DEFAULT_ALLOCATION_STYLE),
  };

  session.comparisonTarget = computeComparisonTarget(causes.length - session.excludedCauseIds.length);

  const normalized = ensureComparisonPair(session);

  if (normalized.phase === "results") {
    const activeIds = new Set(normalized.comparisons.flatMap((comparison) => [comparison.leftId, comparison.rightId]));
    const finalized = finalize(normalized, { preserveCompletedAt: true });
    finalized.allocations = ratingsToAllocations(causes, finalized.ratings, undefined, activeIds, finalized.allocationStyle);
    finalized.confidence = buildConfidence(finalized.comparisonCount, finalized.allocations);
    finalized.completedAt = finalized.completedAt || new Date().toISOString();
    finalized.currentPair = null;
    return finalized;
  } else if (normalized.phase === "comparing") {
    normalized.allocations = null;
    normalized.confidence = null;
  }

  return normalized;
}

export function startSession(session) {
  const next = clone(session);
  next.phase = "comparing";
  const activeCauses = getActiveCauses(next);

  if (activeCauses.length < 2) {
    return finalize(next);
  }

  next.currentPair = chooseNextPair(activeCauses, next.ratings, next.comparisons);

  if (!next.currentPair) {
    return finalize(next);
  }

  return next;
}

export function continueComparing(session, extraComparisons = 5) {
  const next = clone(session);
  next.phase = "comparing";
  next.comparisonTarget = Math.max(next.comparisonTarget + extraComparisons, next.comparisonCount + extraComparisons);
  next.currentPair = chooseNextPair(getActiveCauses(next), next.ratings, next.comparisons);

  if (!next.currentPair) {
    return finalize(next);
  }

  return next;
}

export function finishSession(session) {
  return finalize(session);
}

export function applyChoice(session, choice) {
  if (session.phase !== "comparing" || !session.currentPair) {
    return clone(session);
  }

  const { leftId, rightId } = session.currentPair;
  const next = clone(session);
  next.comparisons = [
    ...next.comparisons,
    {
      id: crypto.randomUUID(),
      leftId,
      rightId,
      choice,
      pair: pairKey(leftId, rightId),
      currentPair: clone(session.currentPair),
      createdAt: new Date().toISOString(),
    },
  ];

  if (choice !== "skip") {
    next.ratings = updateRatings(next.ratings, leftId, rightId, choice);
    next.comparisonCount += 1;
  }

  if (next.comparisonCount >= next.comparisonTarget) {
    return finalize(next);
  }

  next.currentPair = chooseNextPair(getActiveCauses(next), next.ratings, next.comparisons);
  if (!next.currentPair) {
    return finalize(next);
  }

  return next;
}

export function applyAction(session, actionPayload = {}) {
  const action = actionPayload.action || "noop";

  if (action === "start") {
    return startSession(session);
  }

  if (action === "choice") {
    return applyChoice(session, actionPayload.choice);
  }

  if (action === "more") {
    return continueComparing(session, actionPayload.extraComparisons ?? 5);
  }

  if (action === "finish") {
    return finishSession(session);
  }

  if (action === "allocation-style") {
    return setAllocationStyle(session, actionPayload.allocationStyle);
  }

  if (action === "undo") {
    return undoLastChoice(session);
  }

  return clone(session);
}

export function buildSessionShareUrl(baseUrl, sessionId) {
  const url = new URL(baseUrl);
  url.searchParams.set("session", sessionId);
  return url.toString();
}
