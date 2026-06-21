import test from "node:test";
import assert from "node:assert/strict";

import {
  buildConfidence,
  buildResultExplanation,
  chooseNextPair,
  createInitialRatings,
  ratingsToAllocations,
  updateRatings,
} from "../src/ranking.js";

const causes = [
  { id: "global-health", name: "Global Health", description: "Global Health" },
  { id: "poverty", name: "Poverty", description: "Poverty" },
  { id: "animal-welfare", name: "Animal Welfare", description: "Animal Welfare" },
  { id: "climate", name: "Climate", description: "Climate" },
];

test("updateRatings increases the selected side and decreases the other", () => {
  const ratings = createInitialRatings(causes);
  const next = updateRatings(ratings, "global-health", "poverty", "left", 32);

  assert.ok(next["global-health"] > ratings["global-health"]);
  assert.ok(next.poverty < ratings.poverty);
});

test("updateRatings treats a tie as a balanced outcome", () => {
  const ratings = createInitialRatings(causes);
  const next = updateRatings(ratings, "global-health", "poverty", "tie", 32);

  assert.equal(next["global-health"], ratings["global-health"]);
  assert.equal(next.poverty, ratings.poverty);
});

test("ratingsToAllocations gives a strong lead to a clearly preferred cause", () => {
  const ratings = {
    "global-health": 1105,
    poverty: 1000,
    "animal-welfare": 1000,
    climate: 1000,
  };

  const activeIds = new Set(["global-health", "poverty", "animal-welfare"]);
  const allocations = ratingsToAllocations(causes, ratings, undefined, activeIds);
  const globalHealth = allocations.find((item) => item.id === "global-health");
  const total = allocations.reduce((sum, item) => sum + item.share, 0);

  assert.equal(Number(total.toFixed(1)), 100.0);
  assert.ok(globalHealth.share > 35);
  assert.equal(allocations.find((item) => item.id === "climate").share, 0);
});

test("allocation style can make the result more decisive", () => {
  const ratings = {
    "global-health": 1080,
    poverty: 1000,
    "animal-welfare": 980,
    climate: 960,
  };

  const activeIds = new Set(["global-health", "poverty", "animal-welfare", "climate"]);
  const balanced = ratingsToAllocations(causes, ratings, undefined, activeIds, 0);
  const decisive = ratingsToAllocations(causes, ratings, undefined, activeIds, 100);

  const balancedGlobal = balanced.find((item) => item.id === "global-health");
  const decisiveGlobal = decisive.find((item) => item.id === "global-health");
  const balancedClimate = balanced.find((item) => item.id === "climate");
  const decisiveClimate = decisive.find((item) => item.id === "climate");

  assert.ok(decisiveGlobal.share > balancedGlobal.share);
  assert.ok(decisiveClimate.share < balancedClimate.share);
});

test("chooseNextPair cools down a recently winning cause", () => {
  const ratings = {
    "global-health": 1090,
    poverty: 1000,
    "animal-welfare": 995,
    climate: 1000,
  };

  const comparisons = [
    { leftId: "global-health", rightId: "poverty", choice: "left" },
    { leftId: "global-health", rightId: "animal-welfare", choice: "left" },
  ];

  const next = chooseNextPair(causes, ratings, comparisons, () => 0.2);

  assert.ok(next);
  assert.notEqual(next.leftId, "global-health");
  assert.notEqual(next.rightId, "global-health");
});

test("chooseNextPair does not repeat a pair that was already compared", () => {
  const ratings = createInitialRatings(causes);
  const comparisons = [{ leftId: "global-health", rightId: "poverty", choice: "left" }];

  const next = chooseNextPair(causes, ratings, comparisons, () => 0.5);

  assert.ok(next);
  assert.notEqual(
    `${next.leftId}__${next.rightId}`.split("__").sort().join("__"),
    "global-health__poverty",
  );
});

test("chooseNextPair avoids reusing either cause from the previous question", () => {
  const ratings = createInitialRatings(causes);
  const comparisons = [{ leftId: "global-health", rightId: "poverty", choice: "left" }];

  const next = chooseNextPair(causes, ratings, comparisons, () => 0.5);

  assert.ok(next);
  assert.notEqual(next.leftId, "global-health");
  assert.notEqual(next.rightId, "global-health");
  assert.notEqual(next.leftId, "poverty");
  assert.notEqual(next.rightId, "poverty");
});

test("buildConfidence returns a labeled confidence state", () => {
  const allocations = [
    { share: 43 },
    { share: 23 },
    { share: 18 },
    { share: 16 },
  ];
  const confidence = buildConfidence(14, allocations);

  assert.ok(confidence.score >= 0);
  assert.ok(["Light signal", "Moderate signal", "Strong signal"].includes(confidence.label));
});

test("buildResultExplanation gives a short result summary", () => {
  const allocations = [
    { id: "global-health", name: "Global Health", share: 52.5 },
    { id: "poverty", name: "Poverty Alleviation", share: 28.7 },
    { id: "animal-welfare", name: "Animal Welfare", share: 17.7 },
  ];
  const comparisons = [
    { leftId: "global-health", rightId: "poverty", choice: "left" },
    { leftId: "global-health", rightId: "animal-welfare", choice: "left" },
    { leftId: "poverty", rightId: "animal-welfare", choice: "left" },
  ];

  const explanation = buildResultExplanation({ allocations, comparisons, allocationStyle: 50 });

  assert.ok(explanation.length >= 2);
  assert.equal(explanation[0].title, "Global Health ranked first");
  assert.match(explanation[0].text, /won/i);
  assert.match(explanation[explanation.length - 1].title, /allocation style/i);
});
