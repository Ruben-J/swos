import { SAVE_VERSION, type CareerSave } from "@pitch/shared";

/**
 * IndexedDB-laag voor career-saves en replays met versiebeheer + migratie-harness.
 * Elke save draagt meta.saveVersion; bij laden migreren we stapsgewijs omhoog.
 */

const DB_NAME = "pitch-db";
const DB_VERSION = 1;
const STORE_SAVES = "saves";
const STORE_REPLAYS = "replays";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_SAVES)) {
        db.createObjectStore(STORE_SAVES, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_REPLAYS)) {
        db.createObjectStore(STORE_REPLAYS, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        t.oncomplete = () => db.close();
      }),
  );
}

// --- Migratie-harness ----------------------------------------------------

type Migration = (save: CareerSave) => CareerSave;

/**
 * Migraties van versie N -> N+1. Index 0 migreert v1->v2, enz.
 * Voeg een functie toe bij elke verhoging van SAVE_VERSION.
 */
const MIGRATIONS: Migration[] = [
  // Voorbeeld voor de toekomst:
  // (save) => ({ ...save, worldState: { ...save.worldState, /* nieuw veld */ } }),
];

export function migrateSave(save: CareerSave): CareerSave {
  let current = save;
  let version = current.meta.saveVersion;
  while (version < SAVE_VERSION) {
    const migrate = MIGRATIONS[version - 1];
    if (!migrate) break;
    current = migrate(current);
    version += 1;
    current = { ...current, meta: { ...current.meta, saveVersion: version } };
  }
  return current;
}

// --- Public API ----------------------------------------------------------

export async function putSave(save: CareerSave): Promise<void> {
  const stamped: CareerSave = { ...save, updatedAt: new Date().toISOString() };
  await tx(STORE_SAVES, "readwrite", (s) => s.put(stamped));
}

export async function getSave(id: string): Promise<CareerSave | null> {
  const raw = await tx<CareerSave | undefined>(STORE_SAVES, "readonly", (s) => s.get(id));
  if (!raw) return null;
  return migrateSave(raw);
}

export async function listSaves(): Promise<CareerSave[]> {
  const all = await tx<CareerSave[]>(STORE_SAVES, "readonly", (s) => s.getAll());
  return all.map(migrateSave).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function deleteSave(id: string): Promise<void> {
  await tx(STORE_SAVES, "readwrite", (s) => s.delete(id));
}

export async function putReplay(id: string, blob: Blob): Promise<void> {
  await tx(STORE_REPLAYS, "readwrite", (s) => s.put({ id, blob }));
}
