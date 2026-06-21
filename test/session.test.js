import test from "node:test";
import assert from "node:assert/strict";

import { causes } from "../src/data.js";
import {
  applyChoice,
  applyAction,
  buildSessionShareUrl,
  createFreshSession,
  normalizeSession,
  removeComparison,
  undoLastChoice,
  startSession,
} from "../src/session.js";

function pickPreferredChoice(session, causeId) {
  if (session.currentPair.leftId === causeId) {
    return "left";
  }

  if (session.currentPair.rightId === causeId) {
    return "right";
  }

  return "left";
}

test("a repeated strong preference produces a dominant allocation", () => {
  const excludedCauseIds = causes
    .filter((cause) => cause.id !== "global-health" && cause.id !== "poverty")
    .map((cause) => cause.id);
  let session = startSession(createFreshSession({ excludedCauseIds, allocationStyle: 100 }));

  for (let i = 0; i < session.comparisonTarget * 2 && session.phase === "comparing"; i += 1) {
    const choice = pickPreferredChoice(session, "global-health");
    session = applyChoice(session, choice);
  }

  assert.equal(session.allocations[0].id, "global-health");
  const touchedIds = new Set(session.comparisons.flatMap((comparison) => [comparison.leftId, comparison.rightId]));
  for (const item of session.allocations) {
    if (!touchedIds.has(item.id)) {
      assert.equal(item.share, 0);
    }
  }
  assert.equal(session.phase, "results");
});

test("share URLs embed the session id", () => {
  const url = buildSessionShareUrl("http://localhost:3000", "abc123");
  assert.equal(url, "http://localhost:3000/?session=abc123");
});

test("undoLastChoice restores the previous comparison", () => {
  let session = startSession(createFreshSession());
  const originalPair = session.currentPair;
  session = applyChoice(session, originalPair.leftId === "global-health" ? "left" : "right");

  assert.equal(session.comparisons.length, 1);

  const undone = undoLastChoice(session);

  assert.equal(undone.comparisons.length, 0);
  assert.equal(undone.comparisonCount, 0);
  assert.deepEqual(undone.currentPair, originalPair);
  assert.equal(undone.phase, "comparing");
});

test("excluded causes do not appear in comparisons or allocations", () => {
  const excludedCauseIds = causes.filter((cause) => cause.id !== "global-health").map((cause) => cause.id);
  let session = startSession(createFreshSession({ excludedCauseIds }));

  assert.equal(session.phase, "results");
  const globalHealth = session.allocations.find((item) => item.id === "global-health");
  assert.equal(globalHealth?.share, 100);

  for (const item of session.allocations) {
    if (item.id !== "global-health") {
      assert.equal(item.share, 0);
    }
  }
});

test("comparison target scales with the number of active causes", () => {
  const baseline = createFreshSession();
  assert.equal(baseline.comparisonTarget, causes.length * 2);

  const excludedCauseIds = causes.slice(0, 7).map((cause) => cause.id);
  const reduced = createFreshSession({ excludedCauseIds });
  assert.equal(reduced.comparisonTarget, 3);
});

test("custom causes are included in comparisons and saved allocations", () => {
  const customCause = {
    id: "custom-arts",
    name: "Arts and Culture",
    description: "Creative work and public access to culture.",
  };
  const excludedCauseIds = causes.map((cause) => cause.id);
  let session = createFreshSession({ customCauses: [customCause], excludedCauseIds });

  assert.deepEqual(session.customCauses, [{ ...customCause, category: "custom" }]);
  session = startSession(session);

  assert.equal(session.phase, "results");
  assert.equal(session.allocations.find((item) => item.id === customCause.id)?.share, 100);

  const restored = normalizeSession(structuredClone(session));
  assert.equal(restored.allocations.find((item) => item.id === customCause.id)?.share, 100);
});

test("allocation style can be updated on a finished session", () => {
  const initial = applyAction(startSession(createFreshSession()), { action: "finish" });
  const originalCompletedAt = initial.completedAt;
  const updated = applyAction(initial, { action: "allocation-style", allocationStyle: 100 });

  assert.equal(updated.allocationStyle, 100);
  assert.equal(updated.phase, "results");
  assert.equal(updated.completedAt, originalCompletedAt);
  assert.ok(updated.allocations[0].share >= initial.allocations[0].share);
});

test("edit-causes returns the session to the intro screen", () => {
  const started = startSession(createFreshSession({ excludedCauseIds: ["research"] }));
  const finished = applyAction(started, { action: "finish" });
  const edited = applyAction(finished, { action: "edit-causes" });

  assert.equal(edited.phase, "intro");
  assert.equal(edited.comparisons.length, finished.comparisons.length);
  assert.equal(edited.comparisonCount, finished.comparisonCount);
  assert.equal(edited.allocations, null);
  assert.equal(edited.confidence, null);
  assert.deepEqual(edited.excludedCauseIds, finished.excludedCauseIds);
  assert.equal(edited.allocationStyle, finished.allocationStyle);
  assert.equal(edited.editingReturnPhase, "results");
});

test("cancel editing restores completed results when causes are unchanged", () => {
  const finished = applyAction(startSession(createFreshSession()), { action: "finish" });
  const edited = applyAction(finished, { action: "edit-causes" });
  const restored = applyAction(edited, { action: "cancel-edit" });

  assert.equal(restored.phase, "results");
  assert.deepEqual(restored.allocations, finished.allocations);
  assert.equal(restored.completedAt, finished.completedAt);
  assert.equal(restored.editingReturnPhase, null);
});

test("start action can resume an edited session without losing history", () => {
  const started = startSession(createFreshSession());
  const firstChoice = started.currentPair.leftId === "global-health" ? "left" : "right";
  const answered = applyAction(started, { action: "choice", choice: firstChoice });
  const edited = applyAction(answered, { action: "edit-causes" });
  const resumed = applyAction(edited, {
    action: "start",
    excludedCauseIds: edited.excludedCauseIds,
    allocationStyle: edited.allocationStyle,
  });

  assert.equal(resumed.comparisons.length, answered.comparisons.length);
  assert.equal(resumed.comparisonCount, answered.comparisonCount);
  assert.equal(resumed.phase, "comparing");
  assert.ok(resumed.currentPair);
});

test("removing a custom cause also removes comparisons that reference it", () => {
  const customCause = { id: "custom-arts", name: "Arts", description: "Creative work." };
  const builtInExclusions = causes.slice(1).map((cause) => cause.id);
  const started = startSession(createFreshSession({ customCauses: [customCause], excludedCauseIds: builtInExclusions }));
  const answered = applyAction(started, { action: "choice", choice: "left" });
  const edited = applyAction(answered, { action: "edit-causes" });
  const resumed = applyAction(edited, {
    action: "start",
    customCauses: [],
    excludedCauseIds: builtInExclusions,
  });

  assert.equal(resumed.comparisons.length, 0);
  assert.equal(resumed.comparisonCount, 0);
  assert.equal(resumed.phase, "results");
});

test("changing causes rebuilds progress from comparisons among kept causes", () => {
  let session = startSession(createFreshSession());
  while (session.phase === "comparing" && session.comparisonCount < 6) {
    session = applyAction(session, { action: "choice", choice: "left" });
  }

  const keptIds = ["global-health", "poverty"];
  const edited = applyAction(session, { action: "edit-causes" });
  const resumed = applyAction(edited, {
    action: "start",
    excludedCauseIds: causes.filter((cause) => !keptIds.includes(cause.id)).map((cause) => cause.id),
  });

  assert.ok(resumed.comparisonCount <= resumed.comparisonTarget);
  assert.equal(resumed.comparisonTarget, 1);
  assert.ok(resumed.comparisons.every(
    (comparison) => keptIds.includes(comparison.leftId) && keptIds.includes(comparison.rightId),
  ));
});

test("editing a prior comparison replays the remaining history", () => {
  const keptIds = causes.slice(0, 3).map((cause) => cause.id);
  let session = startSession(createFreshSession({
    excludedCauseIds: causes.filter((cause) => !keptIds.includes(cause.id)).map((cause) => cause.id),
  }));

  while (session.phase === "comparing") {
    session = applyChoice(session, "left");
  }

  const edited = applyAction(session, {
    action: "update-comparison",
    comparisonId: session.comparisons[0].id,
    choice: "tie",
  });

  assert.equal(edited.phase, "results");
  assert.equal(edited.comparisonCount, session.comparisonCount);
  assert.equal(edited.comparisons.length, session.comparisons.length);
  assert.equal(edited.comparisons[0].choice, "tie");
});

test("removing a past comparison replays the remaining answers", () => {
  const keptIds = causes.slice(0, 3).map((cause) => cause.id);
  let session = startSession(createFreshSession({
    excludedCauseIds: causes.filter((cause) => !keptIds.includes(cause.id)).map((cause) => cause.id),
  }));

  while (session.phase === "comparing") {
    session = applyChoice(session, "left");
  }

  const removed = removeComparison(session, session.comparisons[1].id);

  assert.equal(removed.phase, "comparing");
  assert.equal(removed.comparisonCount, session.comparisonCount - 1);
  assert.equal(removed.comparisons.length, session.comparisons.length - 1);
  assert.ok(removed.currentPair);
});
