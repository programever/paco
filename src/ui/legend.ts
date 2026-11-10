/**
 * Checkpoint colours and the profile's readout. Pure, so Paco's screens and
 * the crew page draw the same colours and say the same words.
 */
import { haversineKm } from '../core/geo';
import { Checkpoint, Race } from '../core/race';
import { atKm, Route } from '../core/route';
import { colors, kmValue, stationColour } from './theme';

/**
 * Every checkpoint the chart marks, with its colour. Not the start: it is the
 * chart's left edge. Stations cycle through the hues; the finish has its own.
 */
export function ticksOf(checkpoints: readonly Checkpoint[]): { colour: string; checkpoint: Checkpoint }[] {
  let taken = 0;
  return checkpoints
    .filter((c) => c.role !== 'start')
    .map((checkpoint) => ({ colour: checkpoint.role === 'finish' ? colors.finish : stationColour(taken++), checkpoint }));
}

/** The colour a checkpoint wears on the chart, its legend and the map. The start is the chart's edge: plain paper. */
export function legendColour(checkpoints: readonly Checkpoint[], checkpoint: Checkpoint): string {
  return ticksOf(checkpoints).find((t) => t.checkpoint.id === checkpoint.id)?.colour ?? colors.paper;
}

/** Start and finish closer than this are one place: a loop. */
const samePlaceM = 50;

/** A loop starts and ends in one place: one "SF" mark, not an F hiding an S. */
export const loopsHome = (race: Race): boolean =>
  haversineKm(atKm(race.route, 0).position, atKm(race.route, race.route.totalKm).position) * 1000 < samePlaceM;

/** The short mark a checkpoint wears on the map and in the chart's list: S, 1, 2, 3…, F (SF on a loop). */
export function markOf(race: Race, checkpoint: Checkpoint): string {
  if (checkpoint.role === 'start') return 'S';
  if (checkpoint.role === 'finish') return loopsHome(race) ? 'SF' : 'F';
  return String(race.checkpoints.filter((c) => c.role === 'station').indexOf(checkpoint) + 1);
}

/** What the cursor points at, and what is left from there to the finish. */
export function readout(route: Route, km: number): string {
  const point = atKm(route, km);
  const finish = atKm(route, route.totalKm);
  return (
    `km ${kmValue(km)} · height ${Math.round(point.elevationM)} m · from the start up ${Math.round(point.ascentSoFarM)} m, ` +
    `down ${Math.round(point.descentSoFarM)} m · ${kmValue(route.totalKm - km)} km to the finish, ` +
    `up ${Math.round(finish.ascentSoFarM - point.ascentSoFarM)} m, down ${Math.round(finish.descentSoFarM - point.descentSoFarM)} m`
  );
}
