/**
 * Stored records: an append-only history of what was read from, and sent to, a
 * chip.
 *
 * The record is never rewritten. A device write appends an entry carrying the
 * hash of the bytes that were actually sent, so an earlier entry can never end
 * up pointing at bytes that were never on the wire. Two writes of the same
 * image are a normal, representable thing.
 */

import { hashImage } from './image';

const DB_NAME = 'm35080-odo';
const DB_VERSION = 1;
const STORE = 'records';

export type RecordKind = 'backup' | 'rewrite' | 'reset' | 'restore';

export type DeviceRecord = {
  id: string;
  createdAt: number;
  kind: RecordKind;
  /** What the chip read, or what we sent - see `kind`. */
  bytes: Uint8Array;
  hash: string;
  vin: string | null;
  km: number | null;
  /** Did this touch hardware, or was it a PRACTICE rehearsal? */
  practice: boolean;
  /** The record this one was derived from, if any. */
  parentId?: string;
  note?: string;
};

export type NewRecord = Omit<DeviceRecord, 'id' | 'createdAt' | 'hash'>;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable in this context'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('could not open the record store'));
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('record store operation failed'));
        t.oncomplete = () => db.close();
      }),
  );
}

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `r${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  }
}

export async function addRecord(record: NewRecord): Promise<DeviceRecord> {
  const full: DeviceRecord = {
    ...record,
    id: newId(),
    createdAt: Date.now(),
    hash: await hashImage(record.bytes),
  };
  // Structured-clone keeps the Uint8Array as bytes, not as JSON numbers.
  await tx('readwrite', (s) => s.add(full));
  return full;
}

export async function listRecords(): Promise<DeviceRecord[]> {
  const all = await tx<DeviceRecord[]>('readonly', (s) => s.getAll() as IDBRequest<DeviceRecord[]>);
  return all.sort((a, b) => b.createdAt - a.createdAt); // newest first
}

export async function getRecord(id: string): Promise<DeviceRecord | undefined> {
  return tx('readonly', (s) => s.get(id) as IDBRequest<DeviceRecord | undefined>);
}

export async function deleteRecord(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id) as unknown as IDBRequest<undefined>);
}

/* ------------------------------ file naming ------------------------------ */

/**
 * The filename must agree with what produced it. A backup of a chip reading
 * 155,940 km with VIN KT17727 is named for exactly that, so a directory of
 * them stays readable without opening any.
 */
export function backupFilename(
  vin: string | null,
  km: number | null,
  when = new Date(),
): string {
  const stamp =
    when.getFullYear().toString() +
    String(when.getMonth() + 1).padStart(2, '0') +
    String(when.getDate()).padStart(2, '0') +
    '-' +
    String(when.getHours()).padStart(2, '0') +
    String(when.getMinutes()).padStart(2, '0');
  const parts = ['Backup', vin ?? 'noVIN', km === null ? 'noKM' : `${km}km`, stamp];
  return `${parts.join('_')}.bin`;
}

/** Trigger a download of an image as a .bin file. */
export function downloadImage(image: Uint8Array, filename: string): void {
  const buf = new ArrayBuffer(image.byteLength);
  new Uint8Array(buf).set(image);
  const blob = new Blob([buf], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
