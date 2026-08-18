import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_OVERVIEW_CANVAS_HEIGHT,
  OVERVIEW_PAGE_SIZE,
  getOverviewCanvasHeight,
  paginatePeople
} from "../src/overview.js";

test("large rosters are split before reaching unsafe iOS canvas sizes", () => {
  const people = Array.from({ length: 191 }, (_, index) => ({ id: String(index) }));
  const pages = paginatePeople(people);
  assert.deepEqual(pages.map((page) => page.length), [50, 50, 50, 41]);
  assert.equal(pages.flat().length, people.length);
  assert.equal(OVERVIEW_PAGE_SIZE, 50);
  assert.ok(getOverviewCanvasHeight(OVERVIEW_PAGE_SIZE) <= MAX_OVERVIEW_CANVAS_HEIGHT);
  assert.ok(getOverviewCanvasHeight(OVERVIEW_PAGE_SIZE + 6) > MAX_OVERVIEW_CANVAS_HEIGHT);
});
