import { km, Km, Route, routeFromSamples, Sample, Waypoint } from './route';

/** A time of day as printed on a race sheet. It names no day; see `cutoffMoment`. */
export type Clock = { readonly hours: number; readonly minutes: number };

export type Role = 'start' | 'station' | 'finish';

export type Checkpoint = {
  readonly id: string;
  readonly name: string;
  readonly km: Km;
  /** null means the checkpoint has no cutoff (COT). */
  readonly cutoff: Clock | null;
  readonly role: Role;
};

export type Race = {
  readonly id: string;
  readonly name: string;
  readonly route: Route;
  /** Sorted by km: start first, finish last. */
  readonly checkpoints: readonly Checkpoint[];
  /** A fixed start moment from the race sheet, or null when the runner's own Start tap is the start. */
  readonly startsAt: number | null;
};

export function clockFromText(text: unknown): Clock | null {
  if (typeof text !== 'string') return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (match === null) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? { hours, minutes } : null;
}

export const clockText = (clock: Clock): string =>
  `${String(clock.hours).padStart(2, '0')}:${String(clock.minutes).padStart(2, '0')}`;

/**
 * Decodes easy-pacer's plan file (version 1). A bundled race that does not
 * decode is a build mistake, so this throws with the reason instead of
 * loading half a race.
 */
export function raceFromPlanFile(id: string, json: unknown): Race {
  const plan = json as {
    name?: unknown;
    route?: { samples?: unknown; waypoints?: unknown } | null;
    checkpoints?: unknown;
    date?: unknown;
    time?: unknown;
  };
  if (!Array.isArray(plan.route?.samples)) throw new Error(`${id}: no route samples`);
  const samples = (plan.route.samples as { lat: unknown; lon: unknown; ele?: unknown }[]).map(
    (s): Sample => ({ lat: Number(s.lat), lon: Number(s.lon), ele: typeof s.ele === 'number' ? s.ele : 0 }),
  );
  const waypoints = (Array.isArray(plan.route.waypoints) ? plan.route.waypoints : []).map(
    (w: { name?: unknown; lat: unknown; lon: unknown }): Waypoint => ({
      name: typeof w.name === 'string' ? w.name : '',
      position: { lat: Number(w.lat), lon: Number(w.lon) },
    }),
  );
  const route = routeFromSamples(samples, waypoints);
  if (route === null) throw new Error(`${id}: the route has fewer than two points`);
  if (!Array.isArray(plan.checkpoints)) throw new Error(`${id}: no checkpoints`);
  const checkpoints = (plan.checkpoints as Record<string, unknown>[])
    .map(
      (c, index): Checkpoint => ({
        id: String(c.id ?? index),
        name: typeof c.name === 'string' ? c.name : '',
        km: km(Math.min(Number(c.km), route.totalKm)),
        cutoff: clockFromText(c.cutoff ?? c.cot),
        role: c.role === 'start' || c.role === 'finish' ? c.role : 'station',
      }),
    )
    .sort((a, b) => a.km - b.km);
  return {
    id,
    name: typeof plan.name === 'string' && plan.name !== '' ? plan.name : id,
    route,
    checkpoints,
    startsAt: fixedStart(plan.date, plan.time),
  };
}

function fixedStart(date: unknown, time: unknown): number | null {
  const clock = clockFromText(time);
  if (typeof date !== 'string' || clock === null) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (match === null) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), clock.hours, clock.minutes).getTime();
}

/** The first moment showing this clock time at or after the anchor, with a minute of slack. */
function firstAtOrAfter(anchor: number, clock: Clock): number {
  const sameDay = new Date(anchor);
  sameDay.setHours(clock.hours, clock.minutes, 0, 0);
  if (sameDay.getTime() < anchor - 60_000) sameDay.setDate(sameDay.getDate() + 1);
  return sameDay.getTime();
}

/**
 * A cutoff anchored to a real moment. A clock names a time of day, not a day,
 * so each cutoff is the first occurrence of its clock at or after the cutoff
 * before it, starting from the start. Midnight can pass any number of times.
 */
export function cutoffMoment(race: Race, startedAt: number, checkpoint: Checkpoint): number | null {
  if (checkpoint.cutoff === null) return null;
  let anchor = startedAt;
  for (const current of race.checkpoints) {
    if (current.cutoff === null) continue;
    anchor = firstAtOrAfter(anchor, current.cutoff);
    if (current.id === checkpoint.id) return anchor;
  }
  return null;
}

export const ahead = (race: Race, reached: number): Checkpoint[] =>
  race.checkpoints.filter((c) => c.km > reached);

export const nextAhead = (race: Race, reached: number): Checkpoint | undefined => ahead(race, reached)[0];

/**
 * The nearest checkpoint ahead that actually closes. A water station has no
 * cutoff of its own, but the deadline still exists somewhere in front.
 */
export const nextWithCutoff = (race: Race, reached: number): Checkpoint | undefined =>
  ahead(race, reached).find((c) => c.cutoff !== null);

export const checkpointLabel = (checkpoint: Checkpoint): string =>
  checkpoint.name !== '' ? checkpoint.name : checkpoint.role === 'finish' ? 'Finish' : 'Checkpoint';
