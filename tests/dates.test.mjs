import test from "node:test";
import assert from "node:assert/strict";
import {
  formatOverviewRange,
  fromDateKey,
  getDateWindow,
  isDateKey,
  shiftDateKey,
  toDateKey
} from "../src/dates.js";

test("local date keys round-trip without UTC conversion", () => {
  const date = new Date(2026, 7, 18, 0, 5);
  assert.equal(toDateKey(date), "2026-08-18");
  assert.equal(toDateKey(fromDateKey("2026-08-18")), "2026-08-18");
});

test("date shifting handles leap days and year boundaries", () => {
  assert.equal(shiftDateKey("2024-02-28", 1), "2024-02-29");
  assert.equal(shiftDateKey("2026-12-31", 1), "2027-01-01");
  assert.equal(shiftDateKey("2026-01-01", -1), "2025-12-31");
});

test("seven-day window is chronological and includes its end date", () => {
  assert.deepEqual(getDateWindow("2026-08-18", 7), [
    "2026-08-12",
    "2026-08-13",
    "2026-08-14",
    "2026-08-15",
    "2026-08-16",
    "2026-08-17",
    "2026-08-18"
  ]);
});

test("date validation rejects impossible dates", () => {
  assert.equal(isDateKey("2026-02-29"), false);
  assert.equal(isDateKey("2024-02-29"), true);
  assert.equal(isDateKey("18-08-2026"), false);
});

test("overview range uses Russian genitive month", () => {
  assert.equal(
    formatOverviewRange(getDateWindow("2026-08-18", 7)),
    "12–18 августа 2026"
  );
});
