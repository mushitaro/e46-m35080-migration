'use client';

/**
 * The app's state language, in one 8px dot.
 *
 * Idle = grey steady, busy = violet PULSING, error = M-red steady,
 * ok = ice blue steady. Each state carries its own glow: a single fixed halo
 * would ring an error dot in the primary accent, which is actively wrong once
 * the OK state is itself blue-family.
 *
 * Four states on an 8px dot is at the limit of what hue can carry, which is
 * why busy is the one that moves - the pulse is what survives when hue does
 * not, for a colour-vision-impaired user or a glance across the bench.
 */

export type LedState = 'idle' | 'busy' | 'error' | 'ok';

const COLOR: Record<LedState, string> = {
  idle: 'bg-slate-600',
  busy: 'bg-amber-500 shadow-[0_0_8px_rgba(155,132,232,0.6)] animate-pulse', // violet
  error: 'bg-red-500 shadow-[0_0_8px_rgba(241,26,34,0.6)]',
  ok: 'bg-emerald-500 shadow-[0_0_8px_rgba(143,216,242,0.6)]', // ice blue
};

export function StatusLED({ state, title }: { state: LedState; title?: string }) {
  return <div className={`w-2 h-2 rounded-full shrink-0 ${COLOR[state]}`} title={title ?? state} />;
}

/**
 * A labelled status row - the 32px slot from the sizing system. The label is
 * muted chrome; the value is mono, because it is read from a machine.
 */
export function StatusRow({
  label,
  value,
  state,
  reason,
}: {
  label: string;
  value: string;
  state: LedState;
  /** Rendered, not just a title: a touch device has no hover. */
  reason?: string;
}) {
  return (
    <div className="h-[32px] flex items-center gap-2 min-w-0">
      <StatusLED state={state} />
      <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500 shrink-0">
        {label}
      </span>
      <span className="text-[10px] font-mono text-slate-300 truncate ml-auto" title={reason}>
        {value}
      </span>
    </div>
  );
}
