import type { SongRecord } from '../types';

const DB_NAME = 'hitthatbeat';
const STORE = 'songs';

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const db = {
  all: () => tx<SongRecord[]>('readonly', (s) => s.getAll()),
  get: (id: string) => tx<SongRecord | undefined>('readonly', (s) => s.get(id)),
  put: (song: SongRecord) => tx('readwrite', (s) => s.put(song)),
  remove: (id: string) => tx('readwrite', (s) => s.delete(id)),
};
