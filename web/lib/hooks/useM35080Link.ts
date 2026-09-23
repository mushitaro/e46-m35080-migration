'use client';

/**
 * Link state for the UI: the one place device operations are started, and the
 * ONE WRITE PATH every route to hardware goes through.
 *
 * Because there is exactly one write handler, the backup-first check, the
 * validation, the read-back verify and the honest failure report exist once.
 * A secondary action that needs to write arms the workspace and lets the hub
 * do it - it never opens a second write path with its own copy of the safety
 * story.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  WebSerialM35080Link,
  BridgeError,
  BridgeConnectionError,
  type M35080Link,
} from '@/lib/link/m35080Link';
import { MockM35080Link, type MockChipPreset } from '@/lib/link/mockLink';
import { LinkError, requestPort } from '@/lib/transport/webSerialTransport';
import type { BridgeInfo } from '@/lib/codec/bridgeProtocol';
import { type StatusBits } from '@/lib/domain/status';
import {
  IMAGE_SIZE,
  assessChip,
  diagnoseImage,
  diff,
  hashImage,
  secureOf,
} from '@/lib/domain/image';
import { applyPlanPreview } from '@/lib/domain/operations';
import { decodeOdometer } from '@/lib/domain/odometer';
import { readVin } from '@/lib/domain/vin';
import type { ByteWrite } from '@/lib/domain/operations';
import type { WriteOp } from '@/lib/domain/odometer';
import {
  addRecord,
  backupFilename,
  downloadImage,
  type RecordKind,
} from '@/lib/domain/records';
import { t } from '@/lib/i18n';
import { setLinkBusy } from '@/lib/pwa/linkBusy';
import { reportLinkFailure } from '@/lib/sync/errorRecords';

export type Phase =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reading'
  | 'writing'
  | 'verifying';

/** A failure the UI can branch on. A UI cannot branch on a sentence. */
export type ErrorKind = 'transport' | 'semantic' | 'refused' | null;

export type Progress = { done: number; total: number; label: string } | null;

export type WriteJob = {
  kind: Exclude<RecordKind, 'backup'>;
  byteWrites: ByteWrite[];
  secureOps: WriteOp[];
};

export type LinkState = {
  phase: Phase;
  info: BridgeInfo | null;
  image: Uint8Array | null;
  status: StatusBits | null;
  error: string | null;
  errorKind: ErrorKind;
  notice: string | null;
  progress: Progress;
  practice: boolean;
  /** Hash of the image that has been backed up, if any. */
  backedUpHash: string | null;
};

const INITIAL: LinkState = {
  phase: 'disconnected',
  info: null,
  image: null,
  status: null,
  error: null,
  errorKind: null,
  notice: null,
  progress: null,
  practice: false,
  backedUpHash: null,
};

export function useM35080Link() {
  const [state, setState] = useState<LinkState>(INITIAL);
  const linkRef = useRef<M35080Link | null>(null);
  /** Guards the single write path against re-entry from a second click. */
  const writingRef = useRef(false);

  /* The service worker asks every open page before it installs an update,
     and a page with the bridge connected says not now (lib/pwa/linkBusy.ts):
     nothing is downloaded, let alone swapped, while a chip is on the cable. */
  useEffect(() => {
    setLinkBusy(state.phase !== 'disconnected');
  }, [state.phase]);

  /* The state as last rendered, for the error record a failure files. Read
     from the two sinks below, which every failure and refusal passes through;
     the record is the preview's only (lib/sync/errorRecords.ts - production
     sends nothing) and is fire-and-forget, so it can never add a second
     failure to the one it describes. */
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const fileErrorRecord = useCallback((error: string, errorKind: ErrorKind) => {
    const s = stateRef.current;
    reportLinkFailure({
      phase: s.phase,
      error,
      errorKind,
      practice: s.practice,
      image: s.image,
      status: s.status,
      firmware: s.info?.firmware ?? null,
      progress: s.progress,
    });
  }, []);

  const patch = useCallback((p: Partial<LinkState>) => {
    setState((s) => ({ ...s, ...p }));
  }, []);

  /** One helper sets both; a stale kind beside a fresh message is worse than none. */
  const fail = useCallback(
    (e: unknown) => {
      const kind: ErrorKind =
        e instanceof BridgeError ? (e.retriable ? 'transport' : 'semantic') : 'transport';
      const message = e instanceof BridgeConnectionError
        ? t().bridgeConnectionFailed(e.message)
        : e instanceof Error ? e.message : String(e);
      setState((s) => ({ ...s, error: message, errorKind: kind, progress: null }));
      fileErrorRecord(message, kind);
    },
    [fileErrorRecord],
  );

  const refuse = useCallback(
    (reason: string) => {
      setState((s) => ({ ...s, error: reason, errorKind: 'refused', progress: null }));
      fileErrorRecord(reason, 'refused');
    },
    [fileErrorRecord],
  );

  const clearError = useCallback(() => {
    setState((s) => ({ ...s, error: null, errorKind: null }));
  }, []);

  /* ----------------------------- connect ------------------------------- */

  const connect = useCallback(
    async (mode: 'serial' | 'practice', preset: MockChipPreset = 'used') => {
      clearError();
      patch({ phase: 'connecting', notice: null });
      try {
        const link: M35080Link =
          mode === 'practice'
            ? new MockM35080Link(preset)
            : new WebSerialM35080Link(await requestPort());
        const info = await link.connect();
        linkRef.current = link;
        patch({
          phase: 'connected',
          info,
          practice: mode === 'practice',
          notice: mode === 'practice' ? t().practiceMode : null,
        });
      } catch (e) {
        linkRef.current = null;
        patch({ phase: 'disconnected', info: null });
        fail(e);
      }
    },
    [clearError, fail, patch],
  );

  const disconnect = useCallback(async () => {
    try {
      await linkRef.current?.disconnect();
    } catch {
      /* already gone; nothing useful to report on the way out */
    }
    linkRef.current = null;
    setState(INITIAL);
  }, []);

  /* ------------------------------ read --------------------------------- */

  /**
   * Returns whether an image was actually taken, so the caller can navigate.
   *
   * A refusal must NOT read as success: both refusal paths below leave the
   * previous image in place, so a caller that assumed "read finished" would
   * send the user to a screen showing the PREVIOUS chip.
   */
  const read = useCallback(async (): Promise<boolean> => {
    const link = linkRef.current;
    if (!link) return false;
    clearError();
    patch({ phase: 'reading', progress: { done: 0, total: IMAGE_SIZE, label: 'READ' } });
    try {
      const status = await link.readStatus();
      const image = await link.readImage((done, total) =>
        patch({ progress: { done, total, label: 'READ' } }),
      );
      /* A read that did not come from a chip is not a read.
         A uniform 1 KB image is the BUS, not the part: even a virgin M35080 is
         0x00 in the secure counters and 0xFF in the standard array, so it can
         never be uniform. Accepting one is how a floating wire was once shown
         as a confident "1,048,560 km" with a BACKUP button beside it. */
      const diagnosis = diagnoseImage(image, status.raw);
      if (diagnosis.kind !== 'ok') {
        patch({ phase: 'connected', progress: null });
        refuse(t().imageNotFromChip(diagnosis));
        return false;
      }

      // A DIFFERENT chip has not been backed up, even though the previous one
      // was. Without this the flag survives a chip swap and the write gate
      // opens on the strength of the OLD chip's backup - and swapping the chip
      // then re-reading is exactly what the new-chip flow asks people to do.
      //
      // Compared by hash rather than cleared unconditionally, so re-reading the
      // SAME chip does not throw away a backup the user already took.
      /* Read the chip a SECOND time and compare.
         A backup is the only thing between an irreversible write and a dead
         cluster, so it has to be known-good, not assumed-good. Measured: a
         bench read of a real chip differed from a commercial programmer's dump
         of that same chip in 3 of 1024 bytes - two of them 0xFF where data
         lived, which is the signature of a marginal MISO rather than a clean
         failure. One read cannot see that. Two reads that disagree can, and
         one of the three bad bytes was inside the secure area, which is the
         part a restore can never take back. */
      const confirm = await link.readImage((done, total) =>
        patch({ progress: { done, total, label: 'VERIFY' } }),
      );
      const unstable = diff(image, confirm);
      if (unstable.length > 0) {
        const at = unstable[0];
        patch({ phase: 'connected', progress: null });
        refuse(t().readUnstable(unstable.length, at, image[at], confirm[at]));
        return false;
      }

      const hash = await hashImage(image).catch(() => null);
      setState((s) => ({
        ...s,
        phase: 'connected',
        image,
        status,
        progress: null,
        backedUpHash: hash !== null && hash === s.backedUpHash ? s.backedUpHash : null,
      }));
      return true;
    } catch (e) {
      patch({ phase: 'connected' });
      fail(e);
      return false;
    }
  }, [clearError, fail, patch, refuse]);

  /* ----------------------------- backup -------------------------------- */

  /** Frictionless: reversible, so no confirm. Records what was actually read. */
  const backup = useCallback(async () => {
    const image = state.image;
    if (!image) return null;
    clearError();
    const decoded = decodeOdometer(secureOf(image));
    const vin = readVin(image);
    try {
      const record = await addRecord({
        kind: 'backup',
        bytes: image,
        vin: vin.found?.text ?? null,
        km: decoded.ok ? decoded.km : null,
        practice: state.practice,
      });
      /* A backup that exists only in the browser's database is not a backup.
         Clearing site data deletes the one thing standing between an
         irreversible write and a dead cluster - and that record was what
         unlocked writing, while the .bin on disk counted for nothing. The
         durable copy has to be part of taking a backup, not a separate button
         someone might not press. */
      downloadImage(
        image,
        backupFilename(vin.found?.text ?? null, decoded.ok ? decoded.km : null, new Date(), state.practice),
      );
      patch({ backedUpHash: record.hash, notice: null });
      return record;
    } catch (e) {
      fail(e);
      return null;
    }
  }, [clearError, fail, patch, state.image, state.practice]);

  /* -------------------------- THE WRITE PATH ---------------------------- */

  /**
   * Every route that sends bytes to the chip comes through here.
   *
   * Order matters and is deliberate:
   *   1. validate everything, before the first byte goes out
   *   2. refuse without a backup
   *   3. secure-area WRINCs first (the irreversible part), then the array
   *   4. read back and compare
   *   5. re-read the whole image so the UI shows the chip, not our intent
   *   6. append a record of what was actually sent
   *
   * A cancel is NOT honoured between steps: abandoning inside a write
   * sequence leaves a half-written chip.
   */
  const runWrite = useCallback(
    async (job: WriteJob): Promise<boolean> => {
      const link = linkRef.current;
      const image = state.image;
      if (!link || !image) return false;
      if (writingRef.current) return false;

      if (!state.backedUpHash) {
        refuse(t().refuseNoBackup);
        return false;
      }

      writingRef.current = true;
      clearError();

      /* The image the plan was built against - the baseline the result is
         checked against once the writes land. */
      const before = state.image;

      const totalOps = job.secureOps.length + job.byteWrites.length;
      let completed = 0;
      patch({ phase: 'writing', progress: { done: 0, total: totalOps, label: 'WRITE' } });

      try {
        // 1. The irreversible part first, one register at a time so a failure
        //    reports exactly how far it got.
        for (const op of job.secureOps) {
          await link.writeSecure(op.address, op.to);
          completed++;
          patch({ progress: { done: completed, total: totalOps, label: 'WRINC' } });
        }

        // 2. The standard array, each write verified by read-back.
        patch({ phase: 'verifying' });
        for (const w of job.byteWrites) {
          await link.writeAndVerify(w.address, w.data);
          completed++;
          patch({ progress: { done: completed, total: totalOps, label: 'VERIFY' } });
        }

        // 3. Re-read, so what is on screen is the chip and not our intent.
        const status = await link.readStatus();
        const after = await link.readImage();
        const decoded = decodeOdometer(secureOf(after));
        const vin = readVin(after);

        await addRecord({
          kind: job.kind,
          bytes: after,
          vin: vin.found?.text ?? null,
          km: decoded.ok ? decoded.km : null,
          practice: state.practice,
        });

        /* Compare the chip against the INTENT, not just show it.
           The standard array was verified write-by-write, but the secure area -
           the one part that can never be undone - had no read-back at all,
           while the UI still announced "verified". Verifying the reversible
           half and trusting the irreversible half is backwards. The record is
           written first either way: a mismatched result is evidence. */
        const expected = before && applyPlanPreview(before, job.byteWrites, job.secureOps);
        const wrong = expected ? diff(after, expected) : [];
        if (wrong.length > 0) {
          patch({
            phase: 'connected',
            image: after,
            status,
            progress: null,
            backedUpHash: null,
          });
          refuse(t().verifyMismatch(wrong.length, wrong[0]));
          return false;
        }

        patch({
          phase: 'connected',
          image: after,
          status,
          progress: null,
          notice: t().writeOk,
          /* The new image has not been backed up; require a fresh one.
             This used to store hash(after), which is the hash of an image that
             exists only on the chip and in IndexedDB - no .bin was ever written
             for it. The gate is a plain null check, so storing anything here
             let a SECOND irreversible write proceed while the only file on disk
             was the PRE-write image. The comment already said what the line
             should do; now it does it. */
          backedUpHash: null,
        });
        return true;
      } catch (e) {
        /* A write that threw part-way leaves the chip in a state no backup
           describes, so the gate has to close here as well - the mirror of the
           chip-swap check in read(). */
        patch({
          backedUpHash: null,
          phase: 'connected',
          progress: null,
          notice: t().writeFailedAt(completed, totalOps),
        });
        fail(e);
        // Re-read so the UI shows the chip's real state after a partial write.
        try {
          const after = await link.readImage();
          patch({ image: after, status: await link.readStatus() });
        } catch {
          /* the read failed too; leave the last known image and the error */
        }
        return false;
      } finally {
        writingRef.current = false;
      }
    },
    [clearError, fail, patch, refuse, state.backedUpHash, state.image, state.practice],
  );

  /* ---------------------------- derived -------------------------------- */

  const chip = state.image ? assessChip(state.image, { uv: state.status?.uv }) : null;
  const odometer = state.image ? decodeOdometer(secureOf(state.image)) : null;
  const vin = state.image ? readVin(state.image) : null;
  const busy =
    state.phase === 'connecting' ||
    state.phase === 'reading' ||
    state.phase === 'writing' ||
    state.phase === 'verifying';

  return {
    ...state,
    link: linkRef.current,
    chip,
    odometer,
    vin,
    busy,
    connect,
    disconnect,
    read,
    backup,
    runWrite,
    clearError,
  };
}

export type UseM35080Link = ReturnType<typeof useM35080Link>;
export { LinkError };
