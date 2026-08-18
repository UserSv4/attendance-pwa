import { normalizeState } from "./model.js";

const DATABASE_NAME = "attendance-pwa";
const DATABASE_VERSION = 1;
const STORE_NAME = "documents";
const STATE_KEY = "app-state";
const MIRROR_KEY = "attendance-pwa.state.v1";
let indexedWriteQueue = Promise.resolve();

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in globalThis)) {
      reject(new Error("IndexedDB is unavailable"));
      return;
    }

    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open IndexedDB"));
    request.onblocked = () => reject(new Error("IndexedDB upgrade was blocked"));
  });
}

async function readIndexedState() {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(STATE_KEY);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error ?? new Error("Could not read IndexedDB"));
    });
  } finally {
    database.close();
  }
}

async function writeIndexedState(state) {
  const database = await openDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(state, STATE_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not write IndexedDB"));
      transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB write was aborted"));
    });
  } finally {
    database.close();
  }
}

function readMirroredState() {
  try {
    const raw = localStorage.getItem(MIRROR_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeMirroredState(state) {
  try {
    localStorage.setItem(MIRROR_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function chooseNewestState(indexedState, mirroredState) {
  if (indexedState && !mirroredState) return indexedState;
  if (mirroredState && !indexedState) return mirroredState;
  if (!indexedState && !mirroredState) return null;
  const indexedRevision = Number(indexedState.revision) || 0;
  const mirroredRevision = Number(mirroredState.revision) || 0;
  if (indexedRevision !== mirroredRevision) {
    return indexedRevision > mirroredRevision ? indexedState : mirroredState;
  }

  const indexedUpdatedAt = Number(indexedState.updatedAt) || 0;
  const mirroredUpdatedAt = Number(mirroredState.updatedAt) || 0;
  if (indexedUpdatedAt !== mirroredUpdatedAt) {
    return indexedUpdatedAt > mirroredUpdatedAt ? indexedState : mirroredState;
  }

  // The mirror is written synchronously before the queued IndexedDB write.
  return mirroredState;
}

export async function loadState() {
  const mirrored = readMirroredState();
  let indexed = null;

  try {
    indexed = await readIndexedState();
  } catch {
    // The mirrored state keeps the app usable if IndexedDB is temporarily unavailable.
  }

  const newest = chooseNewestState(indexed, mirrored);
  return normalizeState(newest);
}

export function saveState(state) {
  state.revision = (Number.isSafeInteger(state.revision) ? state.revision : 0) + 1;
  state.updatedAt = Date.now();
  const normalized = normalizeState(state);
  const mirrorSaved = writeMirroredState(normalized);
  const indexedWrite = indexedWriteQueue
    .catch(() => undefined)
    .then(() => writeIndexedState(normalized));
  indexedWriteQueue = indexedWrite;

  return indexedWrite
    .then(() => normalized)
    .catch((error) => {
      if (!mirrorSaved) throw error;
      return normalized;
    });
}

export async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
