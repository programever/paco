/**
 * Positions on the earth, and the flat projection used for everything that has
 * to be fast: snapping a fix onto the course, drawing the map.
 *
 * A trail course spans a few tens of kilometres at most, so an equirectangular
 * projection anchored at the course's own latitude is accurate to well under a
 * metre, and "closest point on the course" becomes plain 2D geometry.
 */

export type LatLon = { readonly lat: number; readonly lon: number };

/** Kilometres in the flat projection. North is negative y, so the map draws north up. */
export type Plane = { readonly x: number; readonly y: number };

/** A Plane is only comparable with another Plane from the same Projection. */
export type Projection = { readonly referenceLatitude: number };

export type Compass = 'north' | 'north-east' | 'east' | 'south-east' | 'south' | 'south-west' | 'west' | 'north-west';

const earthRadiusKm = 6371;
const radians = (degrees: number): number => (degrees * Math.PI) / 180;

/** Kilometres between two positions along the earth's surface. */
export function haversineKm(from: LatLon, to: LatLon): number {
  const dLat = radians(to.lat - from.lat);
  const dLon = radians(to.lon - from.lon);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(radians(from.lat)) * Math.cos(radians(to.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(Math.min(1, a)));
}

/** Degrees clockwise from north, 0 to 359. */
export function bearing(from: LatLon, to: LatLon): number {
  const phiFrom = radians(from.lat);
  const phiTo = radians(to.lat);
  const dLon = radians(to.lon - from.lon);
  const y = Math.sin(dLon) * Math.cos(phiTo);
  const x = Math.cos(phiFrom) * Math.sin(phiTo) - Math.sin(phiFrom) * Math.cos(phiTo) * Math.cos(dLon);
  return Math.round((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const compassPoints: readonly Compass[] = [
  'north',
  'north-east',
  'east',
  'south-east',
  'south',
  'south-west',
  'west',
  'north-west',
];

export const compass = (degrees: number): Compass => compassPoints[Math.round(degrees / 45) % 8];

export const projection = (referenceLatitude: number): Projection => ({ referenceLatitude });

export const project = (p: Projection, position: LatLon): Plane => ({
  x: position.lon * 111.32 * Math.cos(radians(p.referenceLatitude)),
  y: -(position.lat * 110.57),
});

export const planeDistanceKm = (a: Plane, b: Plane): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Closest point on segment a–b to `point`, as a fraction along it, clamped to the segment. */
export function projectOntoSegment(a: Plane, b: Plane, point: Plane): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 0) return 0;
  return Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
}

/** Six decimals is about 10 cm: finer than any phone fix, short enough to retype in a message. */
export const coordinateText = (position: LatLon): string =>
  `${position.lat.toFixed(6)}, ${position.lon.toFixed(6)}`;
