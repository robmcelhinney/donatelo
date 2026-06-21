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

function normalizeCustomCauses(customCauses = []) {
  const seenIds = new Set(causes.map((cause) => cause.id));

  return (Array.isArray(customCauses) ? customCauses : []).slice(0, 5).flatMap((cause, index) => {
    const name = typeof cause?.name === "string" ? cause.name.trim().slice(0, 80) : "";
    if (!name) {
      return [];
    }

    const description = typeof cause?.description === "string" ? cause.description.trim().slice(0, 240) : "";
    const baseId = name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || `area-${index + 1}`;
    let id = typeof cause?.id === "string" && cause.id.startsWith("custom-") ? cause.id.slice(0, 100) : `custom-${baseId}`;
    let suffix = 2;
    while (seenIds.has(id)) {
      id = `custom-${baseId}-${suffix}`;
      suffix += 1;
    }
    seenIds.add(id);

    return [{ id, name, description: description || "A cause area added by you.", category: "custom" }];
  });
}

function getSessionCauses(session) {
  return [...causes, ...normalizeCustomCauses(session.customCauses)];
}

function normalizeCauseIds(causeIds = [], availableCauses = causes) {
  return [...new Set(causeIds)].filter((causeId) => availableCauses.some((cause) => cause.id === causeId));
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
  return getSessionCauses(session).filter((cause) => !excludedCauseIds.has(cause.id));
}

function computeComparisonTarget(activeCauseCount) {
  if (activeCauseCount < 2) {
    return 0;
  }

  const uniquePairCount = (activeCauseCount * (activeCauseCount - 1)) / 2;
  const heuristicTarget = Math.max(5, activeCauseCount * 2);
  return Math.min(uniquePairCount, heuristicTarget);
}

function makeBaseSession(excludedCauseIds = [], allocationStyle = DEFAULT_ALLOCATION_STYLE, customCauses = []) {
  const normalizedCustomCauses = normalizeCustomCauses(customCauses);
  const sessionCauses = [...causes, ...normalizedCustomCauses];
  const normalizedExcludedCauseIds = normalizeCauseIds(excludedCauseIds, sessionCauses);
  const activeCauseCount = sessionCauses.length - normalizedExcludedCauseIds.length;
  return {
    version: SESSION_VERSION,
    id: crypto.randomUUID(),
    phase: "intro",
    createdAt: new Date().toISOString(),
    completedAt: null,
    comparisonTarget: computeComparisonTarget(activeCauseCount),
    comparisonCount: 0,
    excludedCauseIds: normalizedExcludedCauseIds,
    customCauses: normalizedCustomCauses,
    allocationStyle: normalizeAllocationStyle(allocationStyle),
    ratings: createInitialRatings(sessionCauses),
    comparisons: [],
    currentPair: null,
    allocations: null,
    confidence: null,
    editingReturnPhase: null,
    editingReturnCompletedAt: null,
  };
}

function makeReplayBase(session) {
  const excludedCauseIds = clone(session.excludedCauseIds || []);
  const sessionCauses = getSessionCauses(session);
  const activeCauseCount = sessionCauses.length - excludedCauseIds.length;
  return {
    ...makeBaseSession([], session.allocationStyle ?? DEFAULT_ALLOCATION_STYLE, session.customCauses),
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

function restoreSessionAfterReplay(session) {
  const next = clone(session);
  const activeCauses = getActiveCauses(next);

  if (activeCauses.length < 2 || next.comparisonCount >= next.comparisonTarget) {
    return finalize(next);
  }

  next.phase = "comparing";
  next.allocations = null;
  next.confidence = null;
  next.completedAt = null;
  next.currentPair = chooseNextPair(activeCauses, next.ratings, next.comparisons);

  if (!next.currentPair) {
    return finalize(next);
  }

  return next;
}

function replayComparisons(session, comparisons) {
  return restoreSessionAfterReplay(rebuildSessionFromComparisons(session, comparisons));
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
  next.allocations = ratingsToAllocations(getSessionCauses(next), next.ratings, undefined, activeIds, next.allocationStyle);
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

export function createFreshSession({ start = false, excludedCauseIds = [], allocationStyle = DEFAULT_ALLOCATION_STYLE, customCauses = [] } = {}) {
  const session = makeBaseSession(excludedCauseIds, allocationStyle, customCauses);
  return start ? startSession(session) : session;
}

export function resetSessionForEditing(session) {
  const next = clone(session);
  next.editingReturnPhase = session.phase;
  next.editingReturnCompletedAt = session.completedAt;
  next.phase = "intro";
  next.currentPair = null;
  next.allocations = null;
  next.confidence = null;
  next.completedAt = null;
  return next;
}

export function cancelSessionEditing(session) {
  if (session.phase !== "intro" || !session.editingReturnPhase) {
    return clone(session);
  }

  const next = clone(session);
  const returnPhase = next.editingReturnPhase;
  next.completedAt = next.editingReturnCompletedAt;
  next.editingReturnPhase = null;
  next.editingReturnCompletedAt = null;

  if (returnPhase === "results") {
    return finalize(next, { preserveCompletedAt: true });
  }

  next.phase = "comparing";
  next.allocations = null;
  next.confidence = null;
  return ensureComparisonPair(next);
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

export function updateComparison(session, comparisonId, choice) {
  if (session.phase === "intro" || !comparisonId) {
    return clone(session);
  }

  const index = session.comparisons.findIndex((comparison) => comparison.id === comparisonId);
  if (index === -1) {
    return clone(session);
  }

  const nextComparisons = session.comparisons.map((comparison, comparisonIndex) =>
    comparisonIndex === index ? { ...comparison, choice } : comparison,
  );
  return replayComparisons(session, nextComparisons);
}

export function removeComparison(session, comparisonId) {
  if (session.phase === "intro" || !comparisonId) {
    return clone(session);
  }

  const nextComparisons = session.comparisons.filter((comparison) => comparison.id !== comparisonId);
  if (nextComparisons.length === session.comparisons.length) {
    return clone(session);
  }

  return replayComparisons(session, nextComparisons);
}

export function normalizeSession(rawSession) {
  if (!rawSession || rawSession.version !== SESSION_VERSION) {
    return createFreshSession();
  }

  const customCauses = normalizeCustomCauses(rawSession.customCauses);
  const sessionCauses = [...causes, ...customCauses];
  const session = {
    ...makeBaseSession([], DEFAULT_ALLOCATION_STYLE, customCauses),
    ...clone(rawSession),
    version: SESSION_VERSION,
    id: rawSession.id || crypto.randomUUID(),
    ratings: { ...createInitialRatings(sessionCauses), ...(rawSession.ratings || {}) },
    comparisons: Array.isArray(rawSession.comparisons) ? rawSession.comparisons : [],
    currentPair: rawSession.currentPair || null,
    allocations: Array.isArray(rawSession.allocations) ? rawSession.allocations : null,
    confidence: rawSession.confidence || null,
    customCauses,
    excludedCauseIds: normalizeCauseIds(rawSession.excludedCauseIds || [], sessionCauses),
    allocationStyle: normalizeAllocationStyle(rawSession.allocationStyle ?? DEFAULT_ALLOCATION_STYLE),
  };

  session.comparisonTarget = computeComparisonTarget(sessionCauses.length - session.excludedCauseIds.length);

  const normalized = ensureComparisonPair(session);

  if (normalized.phase === "results") {
    const finalized = finalize(normalized, { preserveCompletedAt: true });
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

  if (next.comparisonCount >= next.comparisonTarget) {
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
    let next = clone(session);
    if (Array.isArray(actionPayload.customCauses)) {
      next.customCauses = normalizeCustomCauses(actionPayload.customCauses);
      const nextCauses = getSessionCauses(next);
      next.ratings = { ...createInitialRatings(nextCauses), ...next.ratings };
    }
    const nextCauses = getSessionCauses(next);
    if (Array.isArray(actionPayload.excludedCauseIds)) {
      next.excludedCauseIds = normalizeCauseIds(actionPayload.excludedCauseIds, nextCauses);
    }
    if (actionPayload.allocationStyle !== undefined) {
      next.allocationStyle = normalizeAllocationStyle(actionPayload.allocationStyle);
    }
    const excludedCauseIds = new Set(next.excludedCauseIds || []);
    const validCauseIds = new Set(nextCauses.filter((cause) => !excludedCauseIds.has(cause.id)).map((cause) => cause.id));
    const validComparisons = next.comparisons.filter(
      (comparison) => validCauseIds.has(comparison.leftId) && validCauseIds.has(comparison.rightId),
    );
    if (validComparisons.length !== next.comparisons.length) {
      next = rebuildSessionFromComparisons(next, validComparisons);
    }
    next.editingReturnPhase = null;
    next.editingReturnCompletedAt = null;
    next.comparisonTarget = computeComparisonTarget(nextCauses.length - (next.excludedCauseIds || []).length);
    return startSession(next);
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

  if (action === "edit-causes") {
    return resetSessionForEditing(session);
  }

  if (action === "cancel-edit") {
    return cancelSessionEditing(session);
  }

  if (action === "allocation-style") {
    return setAllocationStyle(session, actionPayload.allocationStyle);
  }

  if (action === "undo") {
    return undoLastChoice(session);
  }

  if (action === "update-comparison") {
    return updateComparison(session, actionPayload.comparisonId, actionPayload.choice);
  }

  if (action === "remove-comparison") {
    return removeComparison(session, actionPayload.comparisonId);
  }

  return clone(session);
}

export function buildSessionShareUrl(baseUrl, sessionId) {
  const url = new URL(baseUrl);
  url.searchParams.set("session", sessionId);
  return url.toString();
}
