import { haversineKm, LatLon, Plane, project, Projection, projection } from './geo';

/**
 * A milestone: a position along the course, in km from the start line.
 * Branded so that a milestone is never mixed up with a length between two
 * milestones, which is a plain number named with its unit.
 */
export type Km = number & { readonly __brand: 'Km' };
export const km = (value: number): Km => Math.max(0, value) as Km;

/** One raw track point, exactly as it comes out of the GPX file. */
export type Sample = { readonly lat: number; readonly lon: number; readonly ele: number };

export type Waypoint = { readonly name: string; readonly position: LatLon };

export type Point = {
  readonly position: LatLon;
  readonly elevationM: number;
  readonly km: Km;
  readonly ascentSoFarM: number;
  readonly descentSoFarM: number;
  readonly plane: Plane;
};

/**
 * The course: a chain of points with cumulative distance and climb already
 * worked out, plus the projection every geometric question is answered in.
 * Building it is the only place raw GPX numbers are trusted.
 */
export type Route = {
  readonly points: readonly Point[];
  readonly totalKm: Km;
  readonly totalAscentM: number;
  readonly totalDescentM: number;
  readonly waypoints: readonly Waypoint[];
  readonly projection: Projection;
};

/** Enough to keep every switchback on a 70 km course, few enough to snap a fix instantly. */
const maxPoints = 3000;

/** Metres of altitude change below which a step is sensor noise. */
const climbThresholdM = 0.5;

export function routeFromSamples(raw: readonly Sample[], waypoints: readonly Waypoint[]): Route | null {
  const samples = thin(raw.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon)));
  if (samples.length < 2) return null;
  const referenceLatitude = samples.reduce((sum, s) => sum + s.lat, 0) / samples.length;
  const proj = projection(referenceLatitude);
  const points = accumulate(proj, smoothElevations(samples));
  const last = points[points.length - 1];
  return {
    points,
    totalKm: last.km,
    totalAscentM: last.ascentSoFarM,
    totalDescentM: last.descentSoFarM,
    waypoints,
    projection: proj,
  };
}

/** Keeps at most `maxPoints`, always including the last so the total distance is not cut short. */
function thin(samples: readonly Sample[]): readonly Sample[] {
  if (samples.length <= maxPoints) return samples;
  const stride = Math.floor(samples.length / maxPoints) + 1;
  return [...samples.filter((_, index) => index % stride === 0), samples[samples.length - 1]];
}

/**
 * A five point moving average over altitude. Raw samples jitter by a couple of
 * metres each, and summing them unsmoothed inflates the total climb to about
 * half again the organiser's published figure.
 */
function smoothElevations(samples: readonly Sample[]): readonly Sample[] {
  return samples.map((sample, index) => {
    const window = samples.slice(Math.max(0, index - 2), Math.min(samples.length, index + 3));
    return { ...sample, ele: window.reduce((sum, s) => sum + s.ele, 0) / window.length };
  });
}

/**
 * Climb is counted against the last height that moved by more than the noise
 * threshold, not per step. Per step (as easy-pacer does it) a steady 5 % climb
 * recorded every 10 m rises 0.5 m a step and adds up to nothing.
 */
function accumulate(proj: Projection, samples: readonly Sample[]): Point[] {
  const points: Point[] = [];
  let referenceM = samples[0]?.ele ?? 0;
  for (const sample of samples) {
    const position = { lat: sample.lat, lon: sample.lon };
    const previous = points[points.length - 1];
    if (previous === undefined) {
      points.push({
        position,
        elevationM: sample.ele,
        km: km(0),
        ascentSoFarM: 0,
        descentSoFarM: 0,
        plane: project(proj, position),
      });
      continue;
    }
    const delta = sample.ele - referenceM;
    const moved = Math.abs(delta) > climbThresholdM;
    if (moved) referenceM = sample.ele;
    points.push({
      position,
      elevationM: sample.ele,
      km: km(previous.km + haversineKm(previous.position, position)),
      ascentSoFarM: previous.ascentSoFarM + (moved && delta > 0 ? delta : 0),
      descentSoFarM: previous.descentSoFarM + (moved && delta < 0 ? -delta : 0),
      plane: project(proj, position),
    });
  }
  return points;
}

/** The point at a milestone, interpolated. A milestone outside the course is clamped to its ends. */
export function atKm(route: Route, wanted: number): Point {
  const target = km(Math.min(route.totalKm, wanted));
  const index = firstAtOrPast(route.points, target);
  const after = route.points[index];
  const before = route.points[index - 1];
  return before === undefined ? after : interpolate(before, after, target);
}

/** Index of the first point at or past `target`; points are sorted by km by construction. */
function firstAtOrPast(points: readonly Point[], target: Km): number {
  let low = 0;
  let high = points.length - 1;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (points[middle].km < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function interpolate(before: Point, after: Point, target: Km): Point {
  const span = after.km - before.km;
  const fraction = span <= 0 ? 0 : (target - before.km) / span;
  const blend = (from: number, to: number) => from + (to - from) * fraction;
  return {
    position: { lat: blend(before.position.lat, after.position.lat), lon: blend(before.position.lon, after.position.lon) },
    elevationM: blend(before.elevationM, after.elevationM),
    km: target,
    ascentSoFarM: blend(before.ascentSoFarM, after.ascentSoFarM),
    descentSoFarM: blend(before.descentSoFarM, after.descentSoFarM),
    plane: { x: blend(before.plane.x, after.plane.x), y: blend(before.plane.y, after.plane.y) },
  };
}

/**
 * The stretch between two milestones: the exact point at `from`, every point
 * strictly between, and the exact point at `to`. A `to` at or before `from`
 * yields just the point at `from`, so nothing draws backwards.
 */
export function slice(route: Route, from: number, to: number): Point[] {
  const start = atKm(route, from);
  const end = atKm(route, to);
  if (end.km <= start.km) return [start];
  return [start, ...route.points.filter((p) => p.km > start.km && p.km < end.km), end];
}

export const ascentBetweenM = (route: Route, from: number, to: number): number =>
  to <= from ? 0 : atKm(route, to).ascentSoFarM - atKm(route, from).ascentSoFarM;

export const descentBetweenM = (route: Route, from: number, to: number): number =>
  to <= from ? 0 : atKm(route, to).descentSoFarM - atKm(route, from).descentSoFarM;

/** Lowest and highest altitude on the course, for scaling the profile. */
export function elevationRangeM(route: Route): { low: number; high: number } {
  const metres = route.points.map((p) => p.elevationM);
  const low = Math.min(...metres);
  return { low, high: Math.max(Math.max(...metres), low + 1) };
}
