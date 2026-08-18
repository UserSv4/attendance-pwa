import test from "node:test";
import assert from "node:assert/strict";
import {
  addPeople,
  archivePerson,
  createBackupPayload,
  createEmptyState,
  fillMissingFromDefaults,
  getActivePeople,
  getDailyCounts,
  getEntry,
  getOverviewPeople,
  initializeDay,
  restoreBackupPayload,
  restoreBulkSnapshot,
  setAllActivePeopleStatus,
  setPersonStatus
} from "../src/model.js";

test("new roster entries start present for a zero-tap first day", () => {
  const state = createEmptyState(1);
  initializeDay(state, "2026-08-18", { seedDefaults: true, timestamp: 2 });
  const people = addPeople(state, "Анна\nИван", "2026-08-18", 3);

  assert.equal(people.length, 2);
  assert.deepEqual(getDailyCounts(state, "2026-08-18"), {
    present: 2,
    sick: 0,
    drunk: 0,
    absent: 0,
    missing: 0,
    total: 2
  });
  assert.ok(people.every((person) => person.defaultStatus === "present"));
});

test("manual choices become defaults without changing initialized history", () => {
  const state = createEmptyState(1);
  const [person] = addPeople(state, "Анна", "2026-08-17", 2);
  setPersonStatus(state, "2026-08-17", person.id, "sick", 3);
  initializeDay(state, "2026-08-18", { seedDefaults: true, timestamp: 4 });

  assert.equal(getEntry(state, "2026-08-18", person.id).status, "sick");
  setPersonStatus(state, "2026-08-18", person.id, "drunk", 5);
  assert.equal(getEntry(state, "2026-08-17", person.id).status, "sick");
  assert.equal(person.defaultStatus, "drunk");
});

test("Нету is a persistent red attendance status and next-day default", () => {
  const state = createEmptyState(1);
  const [person] = addPeople(state, "Анна", "2026-08-17", 2);
  setPersonStatus(state, "2026-08-17", person.id, "absent", 3);
  initializeDay(state, "2026-08-18", { seedDefaults: true, timestamp: 4 });

  assert.equal(person.defaultStatus, "absent");
  assert.equal(getEntry(state, "2026-08-18", person.id).status, "absent");
  assert.equal(getDailyCounts(state, "2026-08-18").absent, 1);
});

test("unopened past days stay blank until explicitly filled", () => {
  const state = createEmptyState(1);
  const [person] = addPeople(state, "Анна", "2026-08-18", 2);
  assert.equal(getEntry(state, "2026-08-16", person.id), null);
  const filled = fillMissingFromDefaults(state, "2026-08-16", 3);
  assert.equal(filled, 1);
  assert.equal(getEntry(state, "2026-08-16", person.id).status, "present");
  assert.equal(person.defaultStatus, "present");
});

test("bulk action undo restores entries and sticky defaults", () => {
  const state = createEmptyState(1);
  const [anna, ivan] = addPeople(state, "Анна\nИван", "2026-08-18", 2);
  setPersonStatus(state, "2026-08-18", anna.id, "sick", 3);
  const snapshot = setAllActivePeopleStatus(state, "2026-08-18", "present", 4);
  assert.equal(anna.defaultStatus, "present");
  assert.equal(ivan.defaultStatus, "present");

  restoreBulkSnapshot(state, "2026-08-18", snapshot, 5);
  assert.equal(getEntry(state, "2026-08-18", anna.id).status, "sick");
  assert.equal(anna.defaultStatus, "sick");
  assert.equal(getEntry(state, "2026-08-18", ivan.id).status, "present");
});

test("archived people leave the live roster but remain in seven-day overview", () => {
  const state = createEmptyState(1);
  const [person] = addPeople(state, "Анна", "2026-08-18", 2);
  archivePerson(state, person.id, 3);
  assert.equal(getActivePeople(state).length, 0);
  assert.deepEqual(getOverviewPeople(state, ["2026-08-18"]).map((item) => item.id), [person.id]);
  assert.equal(getOverviewPeople(state, ["2026-08-17"]).length, 0);
});

test("versioned backups restore roster and attendance", () => {
  const state = createEmptyState(1);
  const [person] = addPeople(state, "Анна", "2026-08-18", 2);
  setPersonStatus(state, "2026-08-18", person.id, "absent", 3);
  const restored = restoreBackupPayload(createBackupPayload(state, 4), 5);

  assert.equal(restored.people[0].name, "Анна");
  assert.equal(restored.people[0].defaultStatus, "absent");
  assert.equal(getEntry(restored, "2026-08-18", restored.people[0].id).status, "absent");
});
