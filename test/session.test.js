import test from "node:test";
import assert from "node:assert/strict";

import { causes } from "../src/data.js";
import {
  applyChoice,
  applyAction,
  buildSessionShareUrl,
  createFreshSession,
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
  let session = startSession(createFreshSession());

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

test("allocation style can be updated on a finished session", () => {
  const initial = applyAction(startSession(createFreshSession()), { action: "finish" });
  const originalCompletedAt = initial.completedAt;
  const updated = applyAction(initial, { action: "allocation-style", allocationStyle: 100 });

  assert.equal(updated.allocationStyle, 100);
  assert.equal(updated.phase, "results");
  assert.equal(updated.completedAt, originalCompletedAt);
  assert.ok(updated.allocations[0].share >= initial.allocations[0].share);
});
