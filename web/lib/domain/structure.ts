/**
 * What is ACTUALLY in an image, derived from the bytes in front of us.
 *
 * This is deliberately NOT a map of the E46 KOMBI EEPROM. No such map survived
 * contact with the dumps: four real chips were compared byte by byte and not
 * one 64-byte region was common to all of them - each cluster uses a different
 * part of the array. A fixed map would be a guess dressed as a fact, and one
 * such guess was already wrong in this project (0x2E8 was called "the VIN"; on
 * two of those four chips it holds live data, and the only ASCII identifier
 * found anywhere sat at 0x183-0x18A - a VIN at 0x184 and one byte that is not).
 *
 * NCS SP-DATEN names the fields a cluster stores - Fahrgestell_Nr, km_Offset,
 * km_Service_Intervall, SIA_Zaehler, Teilenummer_BMW, Produktionsdaten and the
 * rest - but its BLOCKNR/WORTADR/BYTEADR are coding-block addresses, and
 * nothing here establishes how they land in this 1 KB. Until that mapping is
 * proven, naming an address would be inventing it.
 *
 * So: report structure, never meaning.
 */

import { SECURE_BYTES } from './odometer';

export const SECURE_LAST = SECURE_BYTES - 1;

/** The increment-only counter area. The one region whose purpose IS known. */
export type SecureFinding = { kind: 'secure'; from: number; to: number };
/** A printable identifier - a part number, a VIN, a tool's label. */
export type AsciiFinding = {
  kind: 'ascii';
  from: number;
  to: number;
  text: string;
  vinShaped: boolean;
};
/** The same value stored N times: redundancy, so one lost copy is survivable. */
export type RepeatFinding = {
  kind: 'repeat';
  from: number;
  to: number;
  hex: string;
  copies: number;
  stride: number;
};
/** A long run of one value. 0xFF is erased/unused; 0x00 is usually unwritten. */
export type RunFinding = { kind: 'run'; from: number; to: number; value: number };

export type Finding = SecureFinding | AsciiFinding | RepeatFinding | RunFinding;

/** Uppercase letters, digits and the separators real part numbers use. */
function isIdChar(b: number): boolean {
  return (
    (b >= 0x41 && b <= 0x5a) || // A-Z
    (b >= 0x30 && b <= 0x39) || // 0-9
    b === 0x2d ||
    b === 0x5f ||
    b === 0x2e
  );
}

const VIN_SHAPE = /^[A-Z]{2}[0-9]{5}$/;

/**
 * Identifier-looking runs.
 *
 * Restricted to UPPERCASE alphanumerics on purpose. Allowing the full printable
 * range turns random binary into "strings": a real E46 dump produced "lNFEx"
 * and "KZsZ|" that way, which is noise a reader would have to learn to ignore.
 */
export function asciiRuns(image: Uint8Array, min = 5): AsciiFinding[] {
  const out: AsciiFinding[] = [];
  let start = -1;
  for (let i = 0; i <= image.length; i++) {
    const ok = i < image.length && isIdChar(image[i]);
    if (ok && start < 0) start = i;
    if (!ok && start >= 0) {
      if (i - start >= min) {
        const text = Array.from(image.subarray(start, i), (b) => String.fromCharCode(b)).join('');
        out.push({
          kind: 'ascii',
          from: start,
          to: i - 1,
          text,
          // The BMW short-VIN shape, checked against any 7-char window in the run.
          vinShaped: [...Array(Math.max(0, text.length - 6))].some((_, k) =>
            VIN_SHAPE.test(text.slice(k, k + 7)),
          ),
        });
      }
      start = -1;
    }
  }
  return out;
}

/**
 * The same 16-bit value written N times at a constant stride.
 *
 * This is how the cluster survives a lost byte, and it is what made one failure
 * on this bench legible: a triple at 0x22/0x25/0x28 had all three copies gone,
 * while a triple at 0x30 had two of three still standing.
 */
export function repeatedGroups(image: Uint8Array, from = 0x20, to = 0x3ff): RepeatFinding[] {
  const out: RepeatFinding[] = [];
  const taken = new Set<number>();
  for (let a = from; a + 5 <= to; a++) {
    if (taken.has(a)) continue;
    const v = image.subarray(a, a + 2);
    if (v[0] === 0xff && v[1] === 0xff) continue;
    if (v[0] === 0x00 && v[1] === 0x00) continue;
    for (const stride of [2, 3, 4]) {
      let copies = 1;
      while (
        a + stride * copies + 1 <= to &&
        image[a + stride * copies] === v[0] &&
        image[a + stride * copies + 1] === v[1]
      ) {
        copies++;
      }
      if (copies >= 3) {
        const end = a + stride * (copies - 1) + 1;
        for (let k = a; k <= end; k++) taken.add(k);
        out.push({
          kind: 'repeat',
          from: a,
          to: end,
          hex: `${v[0].toString(16).padStart(2, '0')}${v[1].toString(16).padStart(2, '0')}`.toUpperCase(),
          copies,
          stride,
        });
        break;
      }
    }
  }
  return out;
}

/** Runs of one repeated byte - unused space, or a region that was erased. */
export function constantRuns(image: Uint8Array, min = 16): RunFinding[] {
  const out: RunFinding[] = [];
  let start = 0;
  for (let i = 1; i <= image.length; i++) {
    if (i === image.length || image[i] !== image[start]) {
      if (i - start >= min) {
        out.push({ kind: 'run', from: start, to: i - 1, value: image[start] });
      }
      start = i;
    }
  }
  return out;
}

/**
 * Everything the bytes are willing to say, in address order.
 *
 * The secure area is listed first and always, because it is the only region
 * whose meaning is established rather than observed.
 */
export function analyzeStructure(image: Uint8Array): Finding[] {
  const findings: Finding[] = [{ kind: 'secure', from: 0, to: SECURE_LAST }];
  findings.push(...asciiRuns(image));
  findings.push(...repeatedGroups(image));
  findings.push(...constantRuns(image));
  return findings.sort((a, b) => a.from - b.from || a.to - b.to);
}
