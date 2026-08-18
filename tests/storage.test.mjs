import test from "node:test";
import assert from "node:assert/strict";
import { chooseNewestState } from "../src/storage.js";

test("IndexedDB remains authoritative when the localStorage mirror is missing", () => {
  const indexed = { updatedAt: 20, people: [{ name: "Анна" }] };
  assert.equal(chooseNewestState(indexed, null), indexed);
});

test("localStorage mirror remains available when IndexedDB cannot be read", () => {
  const mirrored = { updatedAt: 20, people: [{ name: "Анна" }] };
  assert.equal(chooseNewestState(null, mirrored), mirrored);
});

test("the newest of two valid storage copies wins", () => {
  const indexed = { revision: 1, updatedAt: 20 };
  const mirrored = { revision: 2, updatedAt: 21 };
  assert.equal(chooseNewestState(indexed, mirrored), mirrored);
  assert.equal(chooseNewestState({ revision: 3, updatedAt: 19 }, mirrored).revision, 3);
});

test("the synchronous mirror wins an exact tie", () => {
  const indexed = { revision: 2, updatedAt: 20, marker: "indexed" };
  const mirrored = { revision: 2, updatedAt: 20, marker: "mirror" };
  assert.equal(chooseNewestState(indexed, mirrored), mirrored);
});
