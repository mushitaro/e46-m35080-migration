/**
 * RESTORE: an account copy back into this device's record store, as the record it was.
 *
 * lib/domain/records.ts owns the store and has one way in, `addRecord`, which mints a NEW id and a
 * new timestamp - right for a record the device is making, wrong for one coming back. Restored
 * through it, the same backup would exist twice in the account after the next SYNC, under two ids,
 * and its date would say when it was restored rather than when the chip was read. So this puts the
 * record back with its own id, date and parent, and records.ts is not edited for it.
 *
 * It keeps the store's rules:
 *   - append-only: a record whose id is already here is left alone (`add`, never `put`);
 *   - the hash describes the bytes: a record whose image does not hash to its `hash` is refused,
 *     because RECORDS offers that image as a backup, and a backup is the one thing between an
 *     irreversible write and a dead cluster.
 *
 * The store's name and schema stay records.ts's: `listRecords()` opens (and, on a device that has
 * never had one, creates) it first, and this then opens it at whatever version it is.
 */
import { hashImage } from '@/lib/domain/image';
import { listRecords, type DeviceRecord } from '@/lib/domain/records';

const DB_NAME = 'm35080-odo';
const STORE = 'records';

export type ImportResult = 'added' | 'exists' | 'bad-hash';

export async function importRecord(record: DeviceRecord): Promise<ImportResult> {
  if ((await hashImage(record.bytes)) !== record.hash) return 'bad-hash';
  const existing = await listRecords();
  if (existing.some((r) => r.id === record.id)) return 'exists';

  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('could not open the record store'));
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction(STORE, 'readwrite');
      t.objectStore(STORE).add(record);
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error ?? new Error('record store write failed'));
      t.onabort = () => reject(t.error ?? new Error('record store write aborted'));
    });
  } catch (e) {
    // Lost a race with another tab restoring the same record: it is there, which is the outcome.
    if (e instanceof DOMException && e.name === 'ConstraintError') return 'exists';
    throw e;
  } finally {
    db.close();
  }
  return 'added';
}
