/**
 * What the crew page works out from Paco's records. Pure, so it is tested
 * with the rest of the core.
 */
import { checkpointLabel, Checkpoint, Race } from '../core/race';

/** No position for this long: the page rings. */
export const staleAfterMs = 30 * 60_000;

/**
 * The checkpoints as the page lists them. No guessed arrival time and no
 * margin (Iker, 2026-11-10): an average pace ignores the climbs, and on Núi
 * Dinh that guess was off by up to an hour.
 */
export type Stop = {
  readonly checkpoint: Checkpoint;
  readonly name: string;
  readonly passed: boolean;
};

export const stops = (race: Race, km: number): Stop[] =>
  race.checkpoints
    .filter((c) => c.role !== 'start')
    .map((checkpoint) => ({ checkpoint, name: checkpointLabel(checkpoint), passed: km >= checkpoint.km }));

export const isStale = (lastUpdate: number, now: number): boolean => now - lastUpdate >= staleAfterMs;

/** The phone has downloaded every message up to `got` (both server timestamps). */
export const delivered = (messageAt: number, got: string): boolean => got !== '' && messageAt <= Date.parse(got);
