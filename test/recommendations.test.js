import test from "node:test";
import assert from "node:assert/strict";

import { EFFECTIVE_GIVING_GUIDE } from "../src/recommendations.js";

test("effective giving guide links to the maintained recommendations catalogue", () => {
  assert.equal(EFFECTIVE_GIVING_GUIDE.name, "Giving What We Can");
  assert.match(EFFECTIVE_GIVING_GUIDE.url, /^https:\/\/www\.givingwhatwecan\.org\//);
});
