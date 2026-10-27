import { ascentBetweenM, atKm, Route } from './route';

/** A stretch steep and long enough that poles help. */
export type Climb = { readonly startKm: number; readonly endKm: number; readonly gainM: number };

export type ClimbRules = {
  /** Rise over run, measured over `windowKm`. 0.15 is 15 %. */
  readonly minGrade: number;
  readonly minGainM: number;
};

export const defaultClimbRules: ClimbRules = { minGrade: 0.15, minGainM: 50 };

const stepKm = 0.05;
const windowKm = 0.2;

/** Steep parts closer than this are one climb: a short flat bit does not mean "put the poles away". */
const joinGapKm = 0.15;

/** Every climb on the course, in order. Worked out once per race, not per fix. */
export function climbs(route: Route, rules: ClimbRules = defaultClimbRules): Climb[] {
  const stretches: { startKm: number; endKm: number }[] = [];
  for (let at = 0; at + windowKm <= route.totalKm; at += stepKm) {
    const grade = (atKm(route, at + windowKm).elevationM - atKm(route, at).elevationM) / (windowKm * 1000);
    if (grade < rules.minGrade) continue;
    const last = stretches[stretches.length - 1];
    if (last !== undefined && at - last.endKm <= joinGapKm) last.endKm = at + windowKm;
    else stretches.push({ startKm: at, endKm: at + windowKm });
  }
  return stretches
    .map((s) => ({ ...s, gainM: ascentBetweenM(route, s.startKm, s.endKm) }))
    .filter((c) => c.gainM >= rules.minGainM);
}
