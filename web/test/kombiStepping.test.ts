import { describe, expect, it, vi } from 'vitest';
import { lampBits } from '@/lib/kombi/protocol';
import { buildReport } from '@/lib/kombi/report';
import { referenceFromFile } from '@/lib/kombi/checks';
import { presetImage } from '@/lib/link/mockLink';
import { readVins } from '@/lib/domain/vin';

/**
 * TEST's stepped checks through the REAL hook: useKombiLink, the real KombiLink and
 * WebSerialTransport, and PRACTICE's simulated cluster. A lamp is lit, the reader answers, the
 * next is lit - the whole way to the last one, then all off.
 *
 * vitest runs in node with no DOM, so React's hooks are stood in for by the smallest thing that
 * behaves like them for this hook: state kept in call-order slots, a re-render after a change, and
 * callbacks that keep their closure until their deps change - which is exactly where a stepped
 * check could go stale.
 */

type Slot = { v?: unknown; deps?: unknown[]; fn?: unknown };
const slots: Slot[] = [];
let cursor = 0;
let scheduled = false;
let render: () => void = () => {};
const effects: (() => void)[] = [];
const sameDeps = (a?: unknown[], b?: unknown[]) => !!a && !!b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
function rerender() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    render();
  });
}

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useState: (init: unknown) => {
      const i = cursor++;
      if (!(i in slots)) slots[i] = { v: typeof init === 'function' ? (init as () => unknown)() : init };
      const set = (next: unknown) => {
        const s = slots[i]!;
        const v = typeof next === 'function' ? (next as (p: unknown) => unknown)(s.v) : next;
        if (!Object.is(v, s.v)) {
          s.v = v;
          rerender();
        }
      };
      return [slots[i]!.v, set];
    },
    useReducer: (reducer: (s: unknown, a: unknown) => unknown, init: unknown) => {
      const i = cursor++;
      if (!(i in slots)) slots[i] = { v: init };
      return [
        slots[i]!.v,
        (a: unknown) => {
          slots[i]!.v = reducer(slots[i]!.v, a);
          rerender();
        },
      ];
    },
    useRef: (init: unknown) => {
      const i = cursor++;
      if (!(i in slots)) slots[i] = { v: { current: init } };
      return slots[i]!.v;
    },
    useCallback: (fn: unknown, deps: unknown[]) => {
      const i = cursor++;
      const s = slots[i];
      if (s && sameDeps(s.deps, deps)) return s.fn;
      slots[i] = { fn, deps };
      return fn;
    },
    useEffect: (fn: () => void, deps?: unknown[]) => {
      const i = cursor++;
      const s = slots[i];
      if (s && deps && sameDeps(s.deps, deps)) return;
      slots[i] = { deps };
      effects.push(fn);
    },
  };
});

const { useKombiLink } = await import('@/lib/hooks/useKombiLink');

/** The hook as a component would hold it: `current` is always the latest render's return. */
function mount() {
  slots.length = 0;
  effects.length = 0;
  const h = { current: null as unknown as ReturnType<typeof useKombiLink> };
  render = () => {
    cursor = 0;
    h.current = useKombiLink();
    for (const e of effects.splice(0)) e();
  };
  render();
  return h;
}

const settle = () => new Promise((r) => setTimeout(r, 30));

/** Waits for the hook to stop being busy, as a reader waits for the lamp before answering. */
async function whenIdle(h: { current: ReturnType<typeof useKombiLink> }) {
  for (let t = 0; t < 400 && (h.current.busy || h.current.running); t++) await settle();
  await settle();
}

describe('a stepped check, answered one item at a time (PRACTICE, KOMBI46)', () => {
  it('lights every lamp in turn, records each answer, then puts them all out', async () => {
    const h = mount();
    await h.current.connect('practice', null);
    await whenIdle(h);
    h.current.setBench(true);
    await settle();

    await h.current.startStepping('lamps');
    await whenIdle(h);
    const keys = lampBits('KOMBI46').map((b) => `B${b.byte}.b${b.bit}`);
    expect(h.current.stepping).toMatchObject({ check: 'lamps', keys, index: 0 });

    for (let i = 0; i < keys.length; i++) {
      expect(h.current.stepping?.index, `waiting on ${keys[i]}`).toBe(i);
      expect(h.current.commanded.lamps?.reduce((n, b) => n + (b ? 1 : 0), 0), `one lamp lit at ${keys[i]}`).toBe(1);
      h.current.observe(keys[i]!, i === 3 ? 'not-seen' : 'seen');
      await whenIdle(h);
    }

    expect(h.current.stepping).toBeNull();
    expect(h.current.commanded.lamps).toBeNull();
    const answers = h.current.session!.items.filter((x) => /^B\d/.test(x.item));
    expect(answers.map((x) => x.item)).toEqual(keys);
    expect(answers.filter((x) => x.observed === 'not-seen').map((x) => x.item)).toEqual([keys[3]]);
    expect(answers.every((x) => x.sent === 'acknowledged')).toBe(true);
    // The last telegram of the check puts every lamp out: address, length, control, the lamp
    // selector, then the lamp bytes - all zero - and the checksum.
    const lampTelegrams = h.current.session!.telegrams.filter((t) => t.kind === 'lamps');
    expect(lampTelegrams).toHaveLength(keys.length + 1);
    expect(Array.from(lampTelegrams.at(-1)!.frame.subarray(4, -1)).every((b) => b === 0)).toBe(true);

    await h.current.disconnect();
  }, 30_000);

  it('steps the output port the same way, and a second START begins again at the first bit', async () => {
    const h = mount();
    await h.current.connect('practice', null);
    await whenIdle(h);
    h.current.setBench(true);
    await settle();

    for (let round = 0; round < 2; round++) {
      await h.current.startStepping('outputs');
      await whenIdle(h);
      expect(h.current.stepping, `round ${round}`).toMatchObject({ check: 'outputs', index: 0 });
      const keys = h.current.stepping!.keys;
      for (const key of keys) {
        h.current.observe(key, 'seen');
        await whenIdle(h);
      }
      expect(h.current.stepping).toBeNull();
      expect(h.current.commanded.outputs).toBeNull();
    }

    await h.current.disconnect();
  }, 30_000);
});

describe('the reads, with no chip image to compare them with (PRACTICE, KOMBI46)', () => {
  it("keeps what the cluster answered and the EEPROM's words, and compares nothing", async () => {
    const h = mount();
    await h.current.connect('practice', null);
    await whenIdle(h);
    for (const id of ['vin', 'odometer', 'eeprom'] as const) {
      await h.current.run(id);
      await whenIdle(h);
      expect(h.current.runs[id], id).toEqual({ status: 'done' });
    }

    const s = h.current.session!;
    const chip = presetImage('late');
    expect(s.reference).toBeNull();
    expect(s.vin).toEqual({ ok: true, value: readVins(chip).coded!.text });
    expect(s.odometer).toMatchObject({ ok: true });
    expect(s.eeprom).toMatchObject({ fromWord: 0, words: 0x100 });
    // The cluster's own copy: the practice chip, but for the one word it holds differently.
    const bytes = s.eeprom!.bytes.ok ? s.eeprom!.bytes.value : new Uint8Array();
    expect(bytes).toHaveLength(0x200);
    expect([...bytes.keys()].filter((i) => bytes[i] !== chip[i])).toEqual([0x30, 0x31]);

    const report = buildReport(s);
    expect(report.compared).toBeNull();
    expect(report.read.eeprom?.bytes).toHaveLength(0x200 * 3 - 1);

    await h.current.disconnect();
  }, 30_000);

  it('moves a needle and sounds the gong with no chip image anywhere: a drive waits for ON THE BENCH, nothing else', async () => {
    const h = mount();
    await h.current.connect('practice', null);
    await whenIdle(h);
    expect(h.current.session!.reference).toBeNull();

    await h.current.run('gong');
    await whenIdle(h);
    expect(h.current.runs.gong).toEqual({ status: 'refused', reason: 'bench-unconfirmed' });

    h.current.setBench(true);
    await settle();
    await h.current.run('gong');
    await whenIdle(h);
    await h.current.runNeedle('speed');
    await whenIdle(h);
    const items = h.current.session!.items;
    expect(items.find((x) => x.item === 'gong')).toMatchObject({ sent: 'acknowledged' });
    expect(items.find((x) => x.item === 'speed')).toMatchObject({ sent: 'acknowledged' });
    // The sweep ends at 10 degrees, above the dial's zero: 9F hands the needle back to the cluster.
    expect(h.current.session!.telegrams.at(-1)).toMatchObject({ kind: 'end-session', outcome: { kind: 'acknowledged' } });
    expect(h.current.commanded.needles.speed).toBeUndefined();
    expect(h.current.sessionOpen).toBe(true);

    await h.current.disconnect();
  }, 30_000);

  it('holds the reads against a dump opened after CONNECT, from then on', async () => {
    const h = mount();
    await h.current.connect('practice', null);
    await whenIdle(h);
    await h.current.run('odometer');
    await whenIdle(h);
    expect(buildReport(h.current.session!).compared).toBeNull();

    const chip = presetImage('late');
    const opened = referenceFromFile('Backup_practice.bin', chip.slice().buffer);
    if (!opened.ok) throw new Error('the practice chip should open as a reference');
    h.current.setReference(opened.reference);
    await settle();
    const report = buildReport(h.current.session!);
    expect(report.reference).toEqual({ source: 'file', label: 'Backup_practice.bin', at: null });
    expect(report.compared?.odometer).toMatchObject({ result: 'equal' });

    await h.current.disconnect();
  }, 30_000);
});
