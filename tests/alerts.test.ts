import { describe, expect, it } from 'vitest';

import { Alert } from '../src/core/alerts';
import { climbs } from '../src/core/climbs';
import { applyFix, Run, startRun } from '../src/core/run';
import { context, eastward, fix, minutes, race } from './fixtures';

/** Runs east along the course, one fix every `stepM` metres, 1 m/s, and collects what is said. */
function runAlong(ctx: ReturnType<typeof context>, fromM: number, toM: number, stepM = 50, startRunState?: Run) {
  let run = startRunState ?? startRun('test', 0);
  const said: Alert[] = [];
  for (let m = fromM; m <= toM; m += stepM) {
    const result = applyFix(ctx, run, fix(m, m * 1000));
    run = result.run;
    said.push(...result.alerts);
  }
  return { run, said };
}

describe('km to the next checkpoint', () => {
  it('says each whole km once, only those shorter than the stretch', () => {
    const r = race(eastward(10_000), [{ name: 'Aid', km: 3.5 }]);
    const { said } = runAlong(context(r, 0), 0, 3500);
    expect(said.map((a) => a.voice)).toEqual(['km_3', 'km_2', 'km_1']);
  });

  it('after a GPS gap says only the nearest step', () => {
    const r = race(eastward(10_000), [{ name: 'Aid', km: 6 }]);
    const ctx = context(r, 0);
    let run = runAlong(ctx, 0, 500).run;
    const jump = applyFix(ctx, run, fix(4200, minutes(30)));
    expect(jump.alerts.map((a) => a.voice)).toEqual(['km_2']);
    run = jump.run;
    expect(applyFix(ctx, run, fix(4300, minutes(31))).alerts).toEqual([]);
  });

  it('names the checkpoint and the climb in the text', () => {
    const r = race(eastward(5000, (m) => m / 50), [{ name: 'Quán cô Hường', km: 4 }]);
    const { said } = runAlong(context(r, 0), 0, 2100);
    expect(said[0].title).toMatch(/to Quán cô Hường$/);
    expect(said[0].body).toMatch(/^Up \d+ m, down 0 m\.$/);
  });
});

describe('poles', () => {
  it('says use the poles before the climb and no need after it, once each', () => {
    const route = eastward(3000, (m) => (m < 1000 ? 0 : m < 1600 ? (m - 1000) * 0.2 : 120));
    const r = race(route, []);
    const { said } = runAlong(context(r, 0, climbs(route)), 0, 3000);
    const voices = said.map((a) => a.voice).filter((v) => v === 'use_poles' || v === 'no_poles');
    expect(voices).toEqual(['use_poles', 'no_poles']);
  });
});

describe('off course', () => {
  const r = race(eastward(5000), [{ name: 'Aid', km: 4.9 }]);
  const ctx = context(r, 0);

  it('waits 20 s, then says it, repeats every 2 minutes, and says back on course', () => {
    let run = runAlong(ctx, 0, 1000).run;
    const t = 1_000_000;
    const step = (ms: number, northM: number) => {
      const result = applyFix(ctx, run, fix(1000, t + ms, { northM }));
      run = result.run;
      return result.alerts.map((a) => a.title);
    };
    expect(step(0, 120)).toEqual([]);
    expect(step(10_000, 120)).toEqual([]);
    expect(step(25_000, 120)).toEqual(['You are off the course']);
    expect(step(60_000, 120)).toEqual([]);
    expect(step(150_000, 120)).toEqual(['You are off the course']);
    expect(step(160_000, 0)).toEqual(['Back on the course']);
  });

  it('points back towards the course', () => {
    let run = runAlong(ctx, 0, 1000).run;
    run = applyFix(ctx, run, fix(1000, 2_000_000, { northM: 120 })).run;
    const said = applyFix(ctx, run, fix(1000, 2_030_000, { northM: 120 })).alerts[0];
    expect(said.body).toMatch(/^The course is 1[12]\d m to the south\.$/);
  });

  it('says nothing before the runner has been on the course', () => {
    let run = startRun('test', 0);
    const far = (ms: number) => {
      const result = applyFix(ctx, run, fix(0, ms, { northM: 5000 }));
      run = result.run;
      return result.alerts;
    };
    expect([...far(0), ...far(30_000), ...far(200_000)]).toEqual([]);
  });

  it('says nothing for one stray fix', () => {
    let run = runAlong(ctx, 0, 1000).run;
    run = applyFix(ctx, run, fix(1000, 3_000_000, { northM: 120 })).run;
    expect(applyFix(ctx, run, fix(1010, 3_005_000)).alerts).toEqual([]);
  });
});

describe('cutoff', () => {
  it('warns once, 30 minutes before the next cutoff ahead', () => {
    const start = new Date(2026, 11, 27, 2, 0).getTime();
    const r = race(eastward(10_000), [{ name: 'CP2', km: 8, cutoff: '04:00' }]);
    const ctx = { ...context(r, start), settings: { ...context(r, start).settings, kmVoices: false } };
    let run = startRun('test', start);
    const at = (minute: number, metre: number) => {
      const result = applyFix(ctx, run, fix(metre, start + minutes(minute)));
      run = result.run;
      return result.alerts.map((a) => a.title);
    };
    expect(at(60, 3000)).toEqual([]);
    expect(at(95, 5000)).toEqual(['CP2 closes in 25 min']);
    expect(at(100, 5200)).toEqual([]);
  });
});

describe('gps weak', () => {
  it('says it once after 3 minutes without a precise fix', () => {
    const r = race(eastward(5000), []);
    const ctx = context(r, 0);
    let run = runAlong(ctx, 0, 500).run;
    const weak = (ms: number) => {
      const result = applyFix(ctx, run, fix(600, 1_000_000 + ms, { accuracyM: 90 }));
      run = result.run;
      return result.alerts.map((a) => a.title);
    };
    expect(weak(0)).toEqual([]);
    expect(weak(200_000)).toEqual(['GPS is weak']);
    expect(weak(400_000)).toEqual([]);
  });
});

describe('typed km', () => {
  it('moves the runner and the passed checkpoints, and the next fix continues from there', async () => {
    const { declareKm } = await import('../src/core/run');
    const r = race(eastward(10_000), [{ name: 'A', km: 2 }, { name: 'B', km: 6 }]);
    const ctx = context(r, 0);
    let run = runAlong(ctx, 0, 500).run;
    run = declareKm(ctx, run, 6.5, 600_000);
    expect(run.km).toBeCloseTo(6.5);
    expect(Object.keys(run.passedAt).sort()).toEqual(['1', '2', 'start']);
    run = applyFix(ctx, run, fix(6600, 660_000)).run;
    expect(run.km).toBeCloseTo(6.6, 1);
  });
});

describe('help message', () => {
  it('has the coordinates, the km, the accuracy and a map link', async () => {
    const { helpMessage } = await import('../src/core/sos');
    const text = helpMessage({ at: { lat: 10.514876, lon: 107.118466 }, accuracyM: 12, takenAt: new Date(2026, 11, 27, 9, 5).getTime() }, 7.34);
    expect(text).toBe(
      'Toi bi lac va hien o vi tri 10.514876, 107.118466 vao luc 27/12/2026 09:05. Diem gan nhat tren duong chay la km 7.3. Sai so GPS 12 m. Ban do: https://maps.google.com/?q=10.514876,107.118466',
    );
  });
});
