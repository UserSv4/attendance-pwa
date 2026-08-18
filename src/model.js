import {
  HISTORY_WINDOW_DAYS,
  SCHEMA_VERSION,
  STATUS_KEYS,
  isValidStatus
} from "./constants.js";
import { isDateKey, toDateKey } from "./dates.js";

const MAX_NAME_LENGTH = 80;

function makeId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `person-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeName(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME_LENGTH);
}

function clone(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

export function createEmptyState(now = Date.now()) {
  return {
    schemaVersion: SCHEMA_VERSION,
    people: [],
    attendance: {},
    initializedDays: {},
    settings: {
      historyWindowDays: HISTORY_WINDOW_DAYS
    },
    revision: 0,
    createdAt: now,
    updatedAt: now
  };
}

export function normalizeState(input, now = Date.now()) {
  if (!input || typeof input !== "object") return createEmptyState(now);

  const output = createEmptyState(Number(input.createdAt) || now);
  const rawPeople = Array.isArray(input.people) ? input.people : [];
  const seenIds = new Set();

  output.people = rawPeople.flatMap((rawPerson, index) => {
    const name = normalizeName(rawPerson?.name);
    if (!name) return [];

    let id = String(rawPerson?.id || makeId());
    if (seenIds.has(id)) id = makeId();
    seenIds.add(id);

    const defaultStatus = isValidStatus(rawPerson?.defaultStatus)
      ? rawPerson.defaultStatus
      : "present";

    return [{
      id,
      name,
      defaultStatus,
      active: rawPerson?.active !== false,
      sortOrder: Number.isFinite(rawPerson?.sortOrder) ? rawPerson.sortOrder : index,
      createdAt: Number(rawPerson?.createdAt) || now,
      updatedAt: Number(rawPerson?.updatedAt) || now,
      archivedAt: rawPerson?.archivedAt ? Number(rawPerson.archivedAt) : null
    }];
  });

  output.people.sort((left, right) => left.sortOrder - right.sortOrder || left.createdAt - right.createdAt);
  output.people.forEach((person, index) => {
    person.sortOrder = index;
  });

  const knownIds = new Set(output.people.map((person) => person.id));
  if (input.attendance && typeof input.attendance === "object") {
    for (const [dateKey, rawDay] of Object.entries(input.attendance)) {
      if (!isDateKey(dateKey) || !rawDay || typeof rawDay !== "object") continue;
      const day = {};

      for (const [personId, rawEntry] of Object.entries(rawDay)) {
        if (!knownIds.has(personId)) continue;
        const status = typeof rawEntry === "string" ? rawEntry : rawEntry?.status;
        if (!isValidStatus(status)) continue;
        day[personId] = {
          status,
          source: ["default", "manual", "bulk"].includes(rawEntry?.source)
            ? rawEntry.source
            : "manual",
          updatedAt: Number(rawEntry?.updatedAt) || now
        };
      }

      output.attendance[dateKey] = day;
    }
  }

  if (input.initializedDays && typeof input.initializedDays === "object") {
    for (const [dateKey, rawDay] of Object.entries(input.initializedDays)) {
      if (!isDateKey(dateKey)) continue;
      output.initializedDays[dateKey] = {
        initializedAt: Number(rawDay?.initializedAt) || now,
        updatedAt: Number(rawDay?.updatedAt) || now
      };
    }
  }

  for (const dateKey of Object.keys(output.attendance)) {
    output.initializedDays[dateKey] ??= { initializedAt: now, updatedAt: now };
  }

  const requestedWindow = Number(input.settings?.historyWindowDays);
  output.settings.historyWindowDays = Number.isInteger(requestedWindow) && requestedWindow >= 1
    ? Math.min(requestedWindow, 366)
    : HISTORY_WINDOW_DAYS;
  output.revision = Number.isSafeInteger(input.revision) && input.revision >= 0 ? input.revision : 0;
  output.updatedAt = Number(input.updatedAt) || now;
  return output;
}

export function initializeDay(state, dateKey, { seedDefaults = false, timestamp = Date.now() } = {}) {
  state.attendance[dateKey] ??= {};
  const wasInitialized = Boolean(state.initializedDays[dateKey]);
  state.initializedDays[dateKey] ??= { initializedAt: timestamp, updatedAt: timestamp };

  if (!wasInitialized && seedDefaults) {
    for (const person of getActivePeople(state)) {
      state.attendance[dateKey][person.id] = {
        status: person.defaultStatus,
        source: "default",
        updatedAt: timestamp
      };
    }
  }

  state.initializedDays[dateKey].updatedAt = timestamp;
  state.updatedAt = timestamp;
  return !wasInitialized;
}

export function addPeople(state, rawNames, dateKey = toDateKey(), timestamp = Date.now()) {
  const names = (Array.isArray(rawNames) ? rawNames : String(rawNames ?? "").split(/\r?\n/))
    .map(normalizeName)
    .filter(Boolean);

  if (!names.length) return [];

  initializeDay(state, dateKey, { timestamp });
  const people = names.map((name, offset) => ({
    id: makeId(),
    name,
    defaultStatus: "present",
    active: true,
    sortOrder: state.people.length + offset,
    createdAt: timestamp + offset,
    updatedAt: timestamp + offset,
    archivedAt: null
  }));

  state.people.push(...people);
  for (const person of people) {
    state.attendance[dateKey][person.id] = {
      status: "present",
      source: "default",
      updatedAt: timestamp
    };
  }
  state.updatedAt = timestamp;
  return people;
}

export function setPersonStatus(state, dateKey, personId, status, timestamp = Date.now()) {
  if (!isValidStatus(status)) throw new TypeError(`Unknown attendance status: ${status}`);
  const person = state.people.find((candidate) => candidate.id === personId && candidate.active);
  if (!person) return null;

  initializeDay(state, dateKey, { timestamp });
  const previous = {
    entry: state.attendance[dateKey][personId]
      ? clone(state.attendance[dateKey][personId])
      : null,
    defaultStatus: person.defaultStatus
  };

  state.attendance[dateKey][personId] = { status, source: "manual", updatedAt: timestamp };
  person.defaultStatus = status;
  person.updatedAt = timestamp;
  state.updatedAt = timestamp;
  return previous;
}

export function setAllActivePeopleStatus(state, dateKey, status, timestamp = Date.now()) {
  if (!isValidStatus(status)) throw new TypeError(`Unknown attendance status: ${status}`);
  initializeDay(state, dateKey, { timestamp });

  const snapshot = getActivePeople(state).map((person) => ({
    personId: person.id,
    entry: state.attendance[dateKey][person.id]
      ? clone(state.attendance[dateKey][person.id])
      : null,
    defaultStatus: person.defaultStatus
  }));

  for (const person of getActivePeople(state)) {
    state.attendance[dateKey][person.id] = { status, source: "bulk", updatedAt: timestamp };
    person.defaultStatus = status;
    person.updatedAt = timestamp;
  }

  state.updatedAt = timestamp;
  return snapshot;
}

export function restoreBulkSnapshot(state, dateKey, snapshot, timestamp = Date.now()) {
  initializeDay(state, dateKey, { timestamp });
  for (const item of snapshot) {
    const person = state.people.find((candidate) => candidate.id === item.personId);
    if (!person) continue;
    if (item.entry) state.attendance[dateKey][person.id] = clone(item.entry);
    else delete state.attendance[dateKey][person.id];
    if (isValidStatus(item.defaultStatus)) person.defaultStatus = item.defaultStatus;
    person.updatedAt = timestamp;
  }
  state.updatedAt = timestamp;
}

export function fillMissingFromDefaults(state, dateKey, timestamp = Date.now()) {
  initializeDay(state, dateKey, { timestamp });
  let filled = 0;

  for (const person of getActivePeople(state)) {
    if (state.attendance[dateKey][person.id]) continue;
    state.attendance[dateKey][person.id] = {
      status: person.defaultStatus,
      source: "default",
      updatedAt: timestamp
    };
    filled += 1;
  }

  state.updatedAt = timestamp;
  return filled;
}

export function getActivePeople(state) {
  return state.people
    .filter((person) => person.active)
    .sort((left, right) => left.sortOrder - right.sortOrder);
}

export function getArchivedPeople(state) {
  return state.people
    .filter((person) => !person.active)
    .sort((left, right) => left.sortOrder - right.sortOrder);
}

export function getEntry(state, dateKey, personId) {
  return state.attendance[dateKey]?.[personId] ?? null;
}

export function getDailyCounts(state, dateKey) {
  const counts = { present: 0, sick: 0, drunk: 0, absent: 0, missing: 0, total: 0 };
  const day = state.attendance[dateKey] ?? {};

  for (const person of getActivePeople(state)) {
    counts.total += 1;
    const status = day[person.id]?.status;
    if (isValidStatus(status)) counts[status] += 1;
    else counts.missing += 1;
  }
  return counts;
}

export function getOverviewPeople(state, dateKeys) {
  const dateSet = new Set(dateKeys);
  return state.people
    .filter((person) => {
      if (person.active) return true;
      return Object.entries(state.attendance).some(([dateKey, day]) =>
        dateSet.has(dateKey) && Boolean(day[person.id])
      );
    })
    .sort((left, right) => left.sortOrder - right.sortOrder);
}

export function renamePerson(state, personId, rawName, timestamp = Date.now()) {
  const person = state.people.find((candidate) => candidate.id === personId);
  const name = normalizeName(rawName);
  if (!person || !name || person.name === name) return false;
  person.name = name;
  person.updatedAt = timestamp;
  state.updatedAt = timestamp;
  return true;
}

export function archivePerson(state, personId, timestamp = Date.now()) {
  const person = state.people.find((candidate) => candidate.id === personId && candidate.active);
  if (!person) return false;
  person.active = false;
  person.archivedAt = timestamp;
  person.updatedAt = timestamp;
  state.updatedAt = timestamp;
  return true;
}

export function restorePerson(state, personId, timestamp = Date.now()) {
  const person = state.people.find((candidate) => candidate.id === personId && !candidate.active);
  if (!person) return false;
  person.active = true;
  person.archivedAt = null;
  person.updatedAt = timestamp;
  state.updatedAt = timestamp;
  return true;
}

export function movePerson(state, personId, direction, timestamp = Date.now()) {
  const activePeople = getActivePeople(state);
  const index = activePeople.findIndex((person) => person.id === personId);
  const targetIndex = index + direction;
  if (index < 0 || targetIndex < 0 || targetIndex >= activePeople.length) return false;

  const target = activePeople[targetIndex];
  const current = activePeople[index];
  [current.sortOrder, target.sortOrder] = [target.sortOrder, current.sortOrder];
  current.updatedAt = timestamp;
  target.updatedAt = timestamp;
  state.updatedAt = timestamp;
  return true;
}

export function createBackupPayload(state, timestamp = Date.now()) {
  return {
    format: "attendance-pwa-backup",
    formatVersion: 1,
    exportedAt: timestamp,
    state: normalizeState(state, timestamp)
  };
}

export function restoreBackupPayload(payload, timestamp = Date.now()) {
  if (payload?.format !== "attendance-pwa-backup" || payload?.formatVersion !== 1 || !payload.state) {
    throw new TypeError("Unsupported backup file");
  }
  const restored = normalizeState(payload.state, timestamp);
  restored.updatedAt = timestamp;
  return restored;
}

export function statusDistribution(state, dateKey, people) {
  const counts = Object.fromEntries(STATUS_KEYS.map((status) => [status, 0]));
  counts.missing = 0;
  const day = state.attendance[dateKey] ?? {};
  for (const person of people) {
    const status = day[person.id]?.status;
    if (isValidStatus(status)) counts[status] += 1;
    else counts.missing += 1;
  }
  return counts;
}
