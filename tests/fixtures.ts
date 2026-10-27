import { Climb } from '../src/core/climbs';
import { Context, defaultSettings } from '../src/core/alerts';
import { Fix } from '../src/core/position';
import { Checkpoint, Race } from '../src/core/race';
import { km, Route, routeFromSamples, Sample } from '../src/core/route';

export const lat = 10.5;
/** Degrees of longitude per metre at `lat`. */
const lonPerMetre = 1 / (111.32 * 1000 * Math.cos((lat * Math.PI) / 180));
const latPerMetre = 1 / 110570;

/** A straight course running east, one point every 10 m, with the given height at each metre mark. */
export function eastward(lengthM: number, heightAt: (metre: number) => number = () => 0): Route {
  const samples: Sample[] = [];
  for (let m = 0; m <= lengthM; m += 10) samples.push({ lat, lon: 107 + m * lonPerMetre, ele: heightAt(m) });
  return routeFromSamples(samples, [])!;
}

/** East for `legM`, then back west on the same track: an out-and-back. */
export function outAndBack(legM: number): Route {
  const samples: Sample[] = [];
  for (let m = 0; m <= legM; m += 10) samples.push({ lat, lon: 107 + m * lonPerMetre, ele: 0 });
  for (let m = legM - 10; m >= 0; m -= 10) samples.push({ lat, lon: 107 + m * lonPerMetre, ele: 0 });
  return routeFromSamples(samples, [])!;
}

/** A position `alongM` metres east of the start and `northM` metres north of the course. */
export const at = (alongM: number, northM = 0) => ({ lat: lat + northM * latPerMetre, lon: 107 + alongM * lonPerMetre });

export const fix = (alongM: number, takenAt: number, options: { northM?: number; accuracyM?: number } = {}): Fix => ({
  at: at(alongM, options.northM ?? 0),
  accuracyM: options.accuracyM ?? 5,
  takenAt,
});

export function race(route: Route, stations: { name: string; km: number; cutoff?: string }[]): Race {
  const checkpoints: Checkpoint[] = [
    { id: 'start', name: 'Start', km: km(0), cutoff: null, role: 'start' },
    ...stations.map(
      (s, index): Checkpoint => ({
        id: String(index + 1),
        name: s.name,
        km: km(s.km),
        cutoff: s.cutoff === undefined ? null : { hours: Number(s.cutoff.slice(0, 2)), minutes: Number(s.cutoff.slice(3)) },
        role: 'station',
      }),
    ),
    { id: 'finish', name: 'Finish', km: route.totalKm, cutoff: null, role: 'finish' },
  ];
  return { id: 'test', name: 'Test', route, checkpoints, startsAt: null };
}

export const context = (r: Race, startedAt: number, climbs: Climb[] = []): Context => ({
  race: r,
  climbs,
  startedAt,
  settings: defaultSettings,
});

export const minutes = (n: number) => n * 60_000;
