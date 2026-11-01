// Keeps files a person has chosen in THIS browser (IndexedDB) so a screen can come back with the same files selected. Nothing here is ever sent anywhere, it expires with the
// draft (24 hours), and every call fails quietly: if the browser refuses storage, the screen simply works as it did before.
export const FILE_TTL_MS = 24 * 3_600_000;
export const FILE_MAX_BYTES = 64 * 1024 * 1024;   // all files of one screen together

export const withinLimit = (sizes: number[], max = FILE_MAX_BYTES): boolean => sizes.length > 0 && sizes.every((n) => Number.isFinite(n) && n >= 0) && sizes.reduce((a, b) => a + b, 0) <= max;
export const isExpired = (savedAt: number, now = Date.now(), ttl = FILE_TTL_MS): boolean => !Number.isFinite(savedAt) || now - savedAt > ttl || savedAt > now + 60_000;

const DB = "qb-local-drafts", STORE = "files";
type Saved = { key: string; savedAt: number; files: Array<{ name: string; type: string; blob: Blob }> };

function open(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "key" }); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
}
const done = <T>(r: IDBRequest<T>): Promise<T | undefined> => new Promise((resolve) => { r.onsuccess = () => resolve(r.result); r.onerror = () => resolve(undefined); });

export async function putFiles(key: string, files: File[]): Promise<boolean> {
  try {
    if (!withinLimit(files.map((f) => f.size))) { await clearFiles(key); return false; }
    const db = await open(); if (!db) return false;
    const rec: Saved = { key, savedAt: Date.now(), files: files.map((f) => ({ name: f.name, type: f.type, blob: f.slice(0, f.size, f.type) })) };
    const ok = await new Promise<boolean>((resolve) => { const tx = db.transaction(STORE, "readwrite"); tx.objectStore(STORE).put(rec); tx.oncomplete = () => resolve(true); tx.onerror = () => resolve(false); tx.onabort = () => resolve(false); });
    db.close(); return ok;
  } catch { return false; }
}

export async function getFiles(key: string): Promise<File[]> {
  try {
    const db = await open(); if (!db) return [];
    const rec = (await done(db.transaction(STORE, "readonly").objectStore(STORE).get(key))) as Saved | undefined;
    db.close();
    if (!rec) return [];
    if (isExpired(rec.savedAt)) { await clearFiles(key); return []; }
    return rec.files.map((f) => new File([f.blob], f.name, { type: f.type }));
  } catch { return []; }
}

export async function clearFiles(key: string): Promise<void> {
  try { const db = await open(); if (!db) return; await new Promise<void>((resolve) => { const tx = db.transaction(STORE, "readwrite"); tx.objectStore(STORE).delete(key); tx.oncomplete = () => resolve(); tx.onerror = () => resolve(); tx.onabort = () => resolve(); }); db.close(); } catch { /* nothing to clear */ }
}
