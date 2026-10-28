/**
 * What the crew page works out from Paco's records. Pure, so it is tested
 * with the rest of the core.
 */
import { checkpointLabel, Checkpoint, cutoffMoment, Race } from '../core/race';
import { Tap, TapKind } from './protocol';

/** No position for this long: the page rings. */
export const staleAfterMs = 30 * 60_000;

/** Below this the pace so far is mostly the walk to the start line. */
const minKmForPace = 0.5;

export type Arrival = {
  readonly checkpoint: Checkpoint;
  readonly name: string;
  readonly passed: boolean;
  /** A guess from the pace so far; null before there is a pace. */
  readonly eta: number | null;
  readonly cutoff: number | null;
  /** Cutoff minus the guess: positive is time to spare. */
  readonly marginMs: number | null;
};

/** Milliseconds per km so far, or null. `at` is the moment the km was true. */
export function paceMsPerKm(start: number, km: number, at: number): number | null {
  if (km < minKmForPace || at <= start) return null;
  return (at - start) / km;
}

export function arrivals(race: Race, start: number, km: number, at: number): Arrival[] {
  const pace = paceMsPerKm(start, km, at);
  return race.checkpoints
    .filter((c) => c.role !== 'start')
    .map((checkpoint) => {
      const passed = km >= checkpoint.km;
      const eta = passed || pace === null ? null : at + (checkpoint.km - km) * pace;
      const cutoff = cutoffMoment(race, start, checkpoint);
      return {
        checkpoint,
        name: checkpointLabel(checkpoint),
        passed,
        eta,
        cutoff,
        marginMs: eta !== null && cutoff !== null ? cutoff - eta : null,
      };
    });
}

/** The runner's newest status; "Got it" is not a status. */
export const latestStatus = (taps: readonly Tap[]): Tap | undefined =>
  [...taps].filter((t) => t.kind !== 'seen').sort((a, b) => b.t - a.t)[0];

export const isStale = (lastUpdate: number, now: number): boolean => now - lastUpdate >= staleAfterMs;

/** The phone has downloaded every message up to `got` (both server timestamps). */
export const delivered = (messageAt: number, got: string): boolean => got !== '' && messageAt <= Date.parse(got);

export const seenIds = (taps: readonly Tap[]): Set<string> => new Set(taps.filter((t) => t.kind === 'seen').map((t) => t.msg));

export const statusTone: Record<TapKind, 'ok' | 'warn' | 'bad'> = {
  ok: 'ok',
  tired: 'warn',
  resting: 'warn',
  injured: 'bad',
  need: 'warn',
  quit: 'bad',
  sos: 'bad',
  seen: 'ok',
};
