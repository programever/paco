import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

import { defaultSettings } from '../src/core/alerts';
import { climbs } from '../src/core/climbs';
import { raceFromPlanFile } from '../src/core/race';
import { atKm } from '../src/core/route';
import { applyFix, startRun } from '../src/core/run';

const folder = join(__dirname, '..', 'races');
const races = readdirSync(folder)
  .filter((f) => f.endsWith('.json'))
  .map((f) => raceFromPlanFile(f, JSON.parse(readFileSync(join(folder, f), 'utf8'))));

/** Same noise on every run, so a failure can be replayed. */
function noise(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2 ** 31;
    return s / 2 ** 31 - 0.5;
  };
}

const metresPerDegree = 111_320;

/**
 * Every bundled race is a Núi Dinh route: loops, start and finish in one place,
 * trails run twice. Run each from start to finish with noisy GPS and check the
 * km never lands on the wrong pass.
 */
describe.each(races.map((r) => [r.name, r] as const))('%s', (_, race) => {
  const cases = [
    { name: 'every 30 s, slow climb pace', everyS: 30, kmPerHour: 4 },
    { name: 'every 5 min (screen off), slow', everyS: 300, kmPerHour: 4 },
    { name: 'every 5 min (screen off), fast', everyS: 300, kmPerHour: 10 },
    { name: 'every 5 min, 20 min rest at a third of the race', everyS: 300, kmPerHour: 6, restAt: 1 / 3 },
    { name: 'every 5 min, fast first half then slow', everyS: 300, kmPerHour: 10, slowAfter: 1 / 2 },
    { name: 'every 30 s, weak GPS (±30 m)', everyS: 30, kmPerHour: 6, spreadM: 60 },
  ];
  it.each(cases)('$name', ({ everyS, kmPerHour, restAt, slowAfter, spreadM = 20 }) => {
    const total = race.route.totalKm;
    const restKm = restAt === undefined ? Infinity : total * restAt;
    const slowKm = slowAfter === undefined ? Infinity : total * slowAfter;
    const restH = 20 / 60;
    /** Where the runner truly is after `hours`. */
    const truth = (hours: number): number => {
      let h = hours;
      let at = 0;
      const leg = (to: number, speed: number) => {
        const span = Math.min(to - at, h * speed);
        at += span;
        h -= span / speed;
      };
      leg(Math.min(restKm, slowKm, total), kmPerHour);
      if (restKm < total && h > 0) h = Math.max(0, h - restH);
      leg(Math.min(slowKm, total), kmPerHour);
      leg(total, kmPerHour / 2.5);
      return at;
    };
    const context = { race, climbs: climbs(race.route), startedAt: 0, settings: defaultSettings };
    const jitter = noise(race.route.totalKm * 1000);
    let run = startRun(race.id, 0);
    let worst = 0;
    for (let t = 0; ; t += everyS * 1000) {
      const trueKm = truth(t / 3_600_000);
      const p = atKm(race.route, trueKm).position;
      const fix = {
        at: { lat: p.lat + (jitter() * spreadM) / metresPerDegree, lon: p.lon + (jitter() * spreadM) / metresPerDegree },
        accuracyM: spreadM / 2,
        takenAt: t,
      };
      run = applyFix(context, run, fix).run;
      worst = Math.max(worst, Math.abs(run.km - trueKm));
      if (trueKm >= race.route.totalKm) break;
    }
    expect(worst).toBeLessThan(0.5);
    expect(run.km).toBeGreaterThan(race.route.totalKm - 0.3);
  });

  it('a first fix at the start line is km 0, not the finish', () => {
    const context = { race, climbs: climbs(race.route), startedAt: 0, settings: defaultSettings };
    const start = atKm(race.route, 0).position;
    const { run } = applyFix(context, startRun(race.id, 0), { at: start, accuracyM: 10, takenAt: 60_000 });
    expect(run.km).toBeLessThan(0.3);
  });
});
