// store.js — IndexedDB für hochgeladene Stücke und Übungsverlauf, localStorage für Einstellungen
const DB_NAME = 'klavierohr', DB_VER = 1;
let dbp = null;
const mem = { pieces: new Map(), sessions: [], kv: new Map() };

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('pieces')) db.createObjectStore('pieces', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('sessions')) {
          const s = db.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true });
          s.createIndex('pieceId', 'pieceId');
        }
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbp;
}

function tx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then(r => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
const reqP = r => new Promise((ok, err) => { r.onsuccess = () => ok(r.result); r.onerror = () => err(r.error); });

export const store = {
  async persist() { try { return await navigator.storage?.persist?.(); } catch { return false; } },

  async listPieces() {
    const db = await open();
    if (!db) return [...mem.pieces.values()];
    return tx(db, 'pieces', 'readonly', s => reqP(s.getAll()));
  },
  async getPiece(id) {
    const db = await open();
    if (!db) return mem.pieces.get(id);
    return tx(db, 'pieces', 'readonly', s => reqP(s.get(id)));
  },
  async putPiece(p) {
    const db = await open();
    if (!db) { mem.pieces.set(p.id, p); return; }
    return tx(db, 'pieces', 'readwrite', s => reqP(s.put(p)));
  },
  async deletePiece(id) {
    const db = await open();
    if (!db) { mem.pieces.delete(id); return; }
    await tx(db, 'pieces', 'readwrite', s => reqP(s.delete(id)));
    const sess = await this.sessionsFor(id);
    await tx(db, 'sessions', 'readwrite', s => Promise.all(sess.map(x => reqP(s.delete(x.id)))));
  },
  async addSession(sess) {
    const db = await open();
    if (!db) { mem.sessions.push({ ...sess, id: mem.sessions.length + 1 }); return; }
    return tx(db, 'sessions', 'readwrite', s => reqP(s.add(sess)));
  },
  async sessionsFor(pieceId) {
    const db = await open();
    if (!db) return mem.sessions.filter(s => s.pieceId === pieceId);
    return tx(db, 'sessions', 'readonly', s => reqP(s.index('pieceId').getAll(pieceId)));
  },
  async allSessions() {
    const db = await open();
    if (!db) return mem.sessions;
    return tx(db, 'sessions', 'readonly', s => reqP(s.getAll()));
  },
  async getKV(key, fallback = null) {
    const db = await open();
    if (!db) return mem.kv.has(key) ? mem.kv.get(key) : fallback;
    const v = await tx(db, 'kv', 'readonly', s => reqP(s.get(key)));
    return v === undefined ? fallback : v;
  },
  async setKV(key, val) {
    const db = await open();
    if (!db) { mem.kv.set(key, val); return; }
    return tx(db, 'kv', 'readwrite', s => reqP(s.put(val, key)));
  },
};

const SETTINGS_KEY = 'klavierohr.settings';
export const DEFAULT_SETTINGS = {
  latency: null, sensitivity: 0.5, a4: 440, tuningCents: 0, clickSound: 'high', metronomeVolume: 0.6,
  tolerance: 'normal', names: 'de', zoom: 1, countIn: true,
};
export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return { ...DEFAULT_SETTINGS, ...(raw ? JSON.parse(raw) : {}) };
  } catch { return { ...DEFAULT_SETTINGS }; }
}
export function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { }
}
