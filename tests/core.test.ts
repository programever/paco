import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { climbs } from '../src/core/climbs';
import { resolve, routeState } from '../src/core/position';
import { cutoffMoment, nextAhead, nextWithCutoff, raceFromPlanFile } from '../src/core/race';
import { ascentBetweenM, atKm, km, slice } from '../src/core/route';
import { at, eastward, fix, outAndBack, race } from './fixtures';

describe('route', () => {
  it('measures distance and climb along the track', () => {
    const route = eastward(2000, (m) => m / 20);
    expect(route.totalKm).toBeCloseTo(2, 2);
    expect(Math.abs(route.totalAscentM - 100)).toBeLessThan(2);
    expect(route.totalDescentM).toBe(0);
  });

  it('interpolates a milestone and clamps outside the course', () => {
    const route = eastward(1000, (m) => m / 10);
    expect(atKm(route, 0.505).elevationM).toBeCloseTo(50.5, 0);
    expect(atKm(route, 7).km).toBeCloseTo(route.totalKm, 6);
  });

  it('slices nothing backwards', () => {
    const route = eastward(1000);
    expect(slice(route, 0.6, 0.4)).toHaveLength(1);
    expect(slice(route, 0.2, 0.4).length).toBeGreaterThan(2);
  });

  it('ignores altitude noise below half a metre per step', () => {
    const route = eastward(1000, (m) => (m % 20 === 0 ? 0.2 : 0));
    expect(route.totalAscentM).toBe(0);
  });
});

describe('position', () => {
  const route = outAndBack(2000);
  const fresh = { km: km(0), updatedAt: 0, lastFix: null, startedAt: 0 };

  it('puts a first fix on the nearest pass', () => {
    const result = resolve(route, fresh, fix(500, 1000));
    expect(result?.kind).toBe('resolved');
  });

  it('on the way back, picks the return pass when the runner was far along', () => {
    const known = { km: km(2.8), updatedAt: 0, lastFix: fix(1200, 0), startedAt: -minutes(30) };
    const result = resolve(route, known, fix(1000, minutes(1)));
    expect(result?.kind === 'resolved' && result.progress.km).toBeCloseTo(3.0, 1);
  });

  it('never jumps further than a human can run', () => {
    const known = { km: km(0.4), updatedAt: 0, lastFix: fix(400, 0), startedAt: -minutes(5) };
    const result = resolve(route, known, fix(500, minutes(1)));
    expect(result?.kind === 'resolved' && result.progress.km).toBeCloseTo(0.5, 1);
  });

  it('keeps the way back on the whole course, not only ahead', () => {
    const known = { km: km(1.5), updatedAt: 0, lastFix: fix(1500, 0), startedAt: -minutes(15) };
    const result = resolve(route, known, fix(1500, minutes(1), { northM: 100 }));
    expect(result?.nearest.deviationM).toBeCloseTo(100, -1);
  });

  it('calls 80 m off course with a precise fix off-route, with a vague fix uncertain', () => {
    const nearest = { km: km(1), deviationM: 80, snap: at(1000) };
    expect(routeState(fix(1000, 0, { accuracyM: 5 }), nearest)).toBe('off-route');
    expect(routeState(fix(1000, 0, { accuracyM: 60 }), nearest)).toBe('uncertain');
  });

  function minutes(n: number) {
    return n * 60_000;
  }
});

describe('race', () => {
  const route = eastward(10_000);

  it('chains cutoffs across midnight', () => {
    const r = race(route, [
      { name: 'A', km: 3, cutoff: '23:30' },
      { name: 'B', km: 6, cutoff: '01:15' },
    ]);
    const start = new Date(2026, 11, 26, 22, 0).getTime();
    const b = cutoffMoment(r, start, r.checkpoints[2])!;
    expect(new Date(b).getDate()).toBe(27);
    expect(new Date(b).getHours()).toBe(1);
  });

  it('borrows the next cutoff ahead when the next station has none', () => {
    const r = race(route, [{ name: 'Water', km: 3 }, { name: 'CP', km: 6, cutoff: '09:00' }]);
    expect(nextAhead(r, 1)?.name).toBe('Water');
    expect(nextWithCutoff(r, 1)?.name).toBe('CP');
  });

  it('decodes every bundled race', () => {
    const folder = join(__dirname, '..', 'races');
    for (const file of readdirSync(folder).filter((f) => f.endsWith('.json'))) {
      const r = raceFromPlanFile(file, JSON.parse(readFileSync(join(folder, file), 'utf8')));
      expect(r.checkpoints[0].role).toBe('start');
      expect(r.checkpoints[r.checkpoints.length - 1].role).toBe('finish');
      expect(r.route.totalKm).toBeGreaterThan(3);
      expect(r.checkpoints.every((c) => c.cutoff === null)).toBe(true);
    }
  });
});

describe('climbs', () => {
  it('finds a long steep climb and ignores a gentle one', () => {
    const route = eastward(3000, (m) => (m < 1000 ? 0 : m < 1600 ? (m - 1000) * 0.2 : 120));
    const found = climbs(route);
    expect(found).toHaveLength(1);
    expect(found[0].startKm).toBeCloseTo(0.9, 0);
    expect(found[0].gainM).toBeGreaterThan(100);
    expect(climbs(eastward(3000, (m) => m * 0.05))).toHaveLength(0);
  });

  it('ignores a steep step too short to need poles', () => {
    const route = eastward(2000, (m) => (m < 1000 ? 0 : m < 1150 ? (m - 1000) * 0.2 : 30));
    expect(climbs(route)).toHaveLength(0);
  });

  it('finds the climbs on the real 20 km route', () => {
    const plan = JSON.parse(readFileSync(join(__dirname, '..', 'races', 'la-mia-cung-cam.json'), 'utf8'));
    const found = climbs(raceFromPlanFile('la-mia', plan).route);
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((c) => c.endKm > c.startKm)).toBe(true);
  });
});

it('measures ascent between milestones', () => {
  const route = eastward(1000, (m) => m / 10);
  expect(ascentBetweenM(route, 0.2, 0.7)).toBeCloseTo(50, 0);
  expect(ascentBetweenM(route, 0.7, 0.2)).toBe(0);
});
