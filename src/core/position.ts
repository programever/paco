import { haversineKm, LatLon, planeDistanceKm, project, projectOntoSegment } from './geo';
import { km, Km, Point, Route } from './route';

/** One GPS reading. */
export type Fix = { readonly at: LatLon; readonly accuracyM: number; readonly takenAt: number };

/** A place where the course passes near the runner. */
export type Candidate = { readonly km: Km; readonly deviationM: number; readonly snap: LatLon };

/**
 * One fix answers two questions that must not share an answer:
 * - how far have I run: the milestone ahead of where I was, filtered by what a
 *   human can have covered since the last fix;
 * - where is the way back: the nearest point on the WHOLE course, including
 *   parts already run, because when you are lost the shortest way back is
 *   often behind you.
 */
export type Resolution =
  | { readonly kind: 'resolved'; readonly progress: Candidate; readonly nearest: Candidate }
  | { readonly kind: 'ambiguous'; readonly options: readonly Candidate[]; readonly nearest: Candidate };

export type RouteState = 'on-route' | 'uncertain' | 'off-route';

/** What is known about the runner before this fix. */
export type Known = {
  readonly km: Km;
  readonly updatedAt: number;
  readonly lastFix: Fix | null;
  readonly startedAt: number;
};

/** Beyond this the runner has left the course, if the fix is precise enough to say so. */
const offRouteThresholdM = 30;

/**
 * A fix must be at least this precise to move the milestone. Under trees a
 * phone often reports 20 to 40 m; past 50 m the snapped milestone can be a
 * tenth of a kilometre out, and a wrong number is worse than an old one.
 */
export const acceptableAccuracyM = 50;

/** Further than this from the course a milestone means nothing: guide back instead. */
const acceptableDeviationM = 250;

/** No runner is faster than this. A sanity bound, not a pace model. */
const maxSpeedKmPerHour = 18;

/** GPS noise allowance for going backwards along the course. */
const backwardToleranceKm = 0.3;

/** Candidates closer than this in deviation are equally good. */
const tieWindowM = 50;

/** Candidates closer than this in km are the same pass seen twice. */
const mergeWindowKm = 0.4;

/** Whether a fix may move the milestone. Guidance back is given regardless. */
export const isTrustworthy = (fix: Fix, nearest: Candidate): boolean =>
  fix.accuracyM <= acceptableAccuracyM && nearest.deviationM <= acceptableDeviationM;

/**
 * Every local minimum of "distance from the fix to the course", nearest first.
 * Each pass of the course near the runner gives exactly one candidate.
 */
export function candidates(route: Route, position: LatLon): Candidate[] {
  const here = project(route.projection, position);
  const perSegment = route.points.slice(1).map((after, index) => nearestOnSegment(here, route.points[index], after));
  return localMinima(perSegment).sort((a, b) => a.deviationM - b.deviationM);
}

function nearestOnSegment(here: { x: number; y: number }, before: Point, after: Point): Candidate {
  const fraction = projectOntoSegment(before.plane, after.plane, here);
  const blend = (from: number, to: number) => from + (to - from) * fraction;
  const closest = { x: blend(before.plane.x, after.plane.x), y: blend(before.plane.y, after.plane.y) };
  return {
    km: km(blend(before.km, after.km)),
    deviationM: planeDistanceKm(here, closest) * 1000,
    snap: { lat: blend(before.position.lat, after.position.lat), lon: blend(before.position.lon, after.position.lon) },
  };
}

function localMinima(list: readonly Candidate[]): Candidate[] {
  const deviationAt = (index: number) => list[index]?.deviationM ?? Infinity;
  const minima = list.filter(
    (c, index) => c.deviationM <= deviationAt(index - 1) && c.deviationM <= deviationAt(index + 1),
  );
  const merged: Candidate[] = [];
  for (const current of minima) {
    const previous = merged[merged.length - 1];
    if (previous !== undefined && Math.abs(previous.km - current.km) < mergeWindowKm) {
      if (current.deviationM < previous.deviationM) merged[merged.length - 1] = current;
    } else {
      merged.push(current);
    }
  }
  return merged;
}

/**
 * The whole disambiguation, in one place.
 * 1. Only if a previous position is known: no going backwards beyond GPS noise,
 *    nothing faster than a human, and the milestone must advance by at least
 *    most of the straight line covered since the last fix, which rules out the
 *    wrong lap.
 * 2. If several survivors are equally close, prefer the one the runner's own
 *    measured speed predicts.
 * 3. Only when that does not decide either is the answer ambiguous.
 */
export function resolve(route: Route, known: Known, fix: Fix): Resolution | null {
  const all = candidates(route, fix.at);
  const nearest = all[0];
  if (nearest === undefined) return null;
  const pool = isPositionKnown(known) ? narrow(known, fix, all) : all;
  const best = pool[0] ?? nearest;
  const tied = pool.filter((c) => c.deviationM - best.deviationM < tieWindowM).slice(0, 4);
  if (tied.length <= 1) return { kind: 'resolved', progress: best, nearest };
  return settleTie(known, fix.takenAt, tied, nearest);
}

const isPositionKnown = (known: Known): boolean => known.lastFix !== null || known.km > 0.05;

function narrow(known: Known, fix: Fix, all: readonly Candidate[]): readonly Candidate[] {
  const floorKm = known.km - backwardToleranceKm;
  const elapsedHours = Math.max(0, (fix.takenAt - known.updatedAt) / 3_600_000);
  const ceilingKm = known.km + elapsedHours * maxSpeedKmPerHour + 2;
  const crowFliesKm = known.lastFix === null ? 0 : haversineKm(known.lastFix.at, fix.at);
  const strictFloorKm = crowFliesKm > 0.25 ? Math.max(floorKm, known.km + crowFliesKm * 0.8) : floorKm;
  const within = (low: number, high: number) => all.filter((c) => c.km >= low && c.km <= high);
  const attempts = [within(strictFloorKm, ceilingKm), within(floorKm, ceilingKm), within(floorKm, Infinity)];
  return attempts.find((attempt) => attempt.length > 0) ?? all;
}

/** A gap of more than 2 km in how well the options match the measured speed is decisive. */
function settleTie(known: Known, now: number, options: readonly Candidate[], nearest: Candidate): Resolution {
  const reference = expectedKm(known, now);
  const away = (c: Candidate) => Math.abs(c.km - reference);
  const ranked = [...options].sort((a, b) => away(a) - away(b));
  const [chosen, second] = ranked;
  if (second === undefined || away(second) - away(chosen) > 2) {
    return { kind: 'resolved', progress: chosen, nearest };
  }
  return { kind: 'ambiguous', options: ranked, nearest };
}

/** Where the runner would be now at the pace actually held so far. */
function expectedKm(known: Known, now: number): number {
  const minutes = (known.updatedAt - known.startedAt) / 60_000;
  if (minutes <= 0 || known.km <= 0.5) return known.km;
  const idleMinutes = Math.max(0, (now - known.updatedAt) / 60_000);
  return known.km + (known.km / minutes) * idleMinutes;
}

/**
 * Whether the runner has left the course, judged against the precision of the
 * fix that says so. 80 m off, measured by a fix accurate only to 80 m, is no
 * evidence: sending someone 80 m the wrong way in the dark is worse than silence.
 */
export function routeState(fix: Fix, nearest: Candidate): RouteState {
  const noiseM = fix.accuracyM * 1.5;
  if (nearest.deviationM <= offRouteThresholdM) return 'on-route';
  if (nearest.deviationM <= Math.max(offRouteThresholdM, noiseM)) return 'uncertain';
  return 'off-route';
}
