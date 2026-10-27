import { ascentBetweenM, atKm, Route } from './route';

/** A climb long and steep enough that poles help. */
export type Climb = { readonly startKm: number; readonly endKm: number; readonly gainM: number };

export type ClimbRules = {
  /** Average rise over run of a whole climb, bottom to top. 0.07 is 7 %. */
  readonly minGrade: number;
  /** Rise over run of a steep piece inside a longer, gentler climb, measured over `windowKm`. */
  readonly minSteepGrade: number;
  readonly minGainM: number;
};

export const defaultClimbRules: ClimbRules = { minGrade: 0.07, minSteepGrade: 0.12, minGainM: 40 };

const stepKm = 0.025;
const windowKm = 0.2;

/** A dip or a rise smaller than this is a bump in the path, not the end of a climb. */
const swingM = 10;

/** Climbs closer than this are one climb: no "put the poles away" for a short flat bit. */
const joinGapKm = 0.3;

/**
 * Every climb on the route, in order, worked out once per race. Two views,
 * joined: whole climbs, bottom to top, catch the long steady ones; steep
 * pieces catch a wall hidden inside a long climb whose average is gentle.
 */
export function climbs(route: Route, rules: ClimbRules = defaultClimbRules): Climb[] {
  const withGain = (c: Climb) => ({ ...c, gainM: ascentBetweenM(route, c.startKm, c.endKm) });
  const grade = (c: Climb) => c.gainM / ((c.endKm - c.startKm) * 1000);
  const whole = swingsUp(route).map(withGain).filter((c) => grade(c) >= rules.minGrade);
  const steep = steepPieces(route, rules.minSteepGrade);
  const all = [...whole, ...steep].sort((a, b) => a.startKm - b.startKm);
  return join(all)
    .map(withGain)
    .filter((c) => c.gainM >= rules.minGainM);
}

/** Stretches where every `windowKm` ahead rises at least `minGrade`, joined across short breaks. */
function steepPieces(route: Route, minGrade: number): Climb[] {
  const pieces: Climb[] = [];
  for (let at = 0; at + windowKm <= route.totalKm; at += stepKm) {
    const rise = atKm(route, at + windowKm).elevationM - atKm(route, at).elevationM;
    if (rise / (windowKm * 1000) < minGrade) continue;
    const last = pieces[pieces.length - 1];
    if (last !== undefined && at <= last.endKm) pieces[pieces.length - 1] = { ...last, endKm: at + windowKm };
    else pieces.push({ startKm: at, endKm: at + windowKm, gainM: 0 });
  }
  return pieces;
}

/** Every bottom-to-top rise of at least `swingM`, found with a 10 m dead band so path noise does not split them. */
function swingsUp(route: Route): Climb[] {
  const found: Climb[] = [];
  let bottom = { km: 0, m: atKm(route, 0).elevationM };
  let top = bottom;
  let rising = false;
  for (let at = 0; at <= route.totalKm + stepKm / 2; at += stepKm) {
    const here = { km: Math.min(at, route.totalKm), m: atKm(route, at).elevationM };
    if (rising) {
      if (here.m > top.m) top = here;
      else if (top.m - here.m >= swingM) {
        found.push({ startKm: bottom.km, endKm: top.km, gainM: top.m - bottom.m });
        rising = false;
        bottom = here;
      }
    } else if (here.m <= bottom.m) {
      bottom = here;
    } else if (here.m - bottom.m >= swingM) {
      rising = true;
      top = here;
    }
  }
  if (rising) found.push({ startKm: bottom.km, endKm: top.km, gainM: top.m - bottom.m });
  return found;
}

function join(list: Climb[]): Climb[] {
  const joined: Climb[] = [];
  for (const climb of list) {
    const last = joined[joined.length - 1];
    if (last !== undefined && climb.startKm - last.endKm <= joinGapKm) {
      joined[joined.length - 1] = { ...last, endKm: Math.max(last.endKm, climb.endKm) };
    } else {
      joined.push(climb);
    }
  }
  return joined;
}
