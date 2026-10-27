import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { Fix } from '../core/position';
import { applyFix, Run, startRun } from '../core/run';
import { notify } from './notify';
import { loadRace } from './races';
import { clearRun, readRun, readSettings, writeRun } from './store';

const gpsTask = 'paco-gps';

/**
 * GPS stays on for the whole race: iOS only keeps a locked-screen app alive
 * while it is receiving positions. Paco looks at a fix at most this often,
 * which is plenty for alerts and keeps the work small.
 */
const processEveryMs = 10_000;

export async function startRace(raceId: string): Promise<void> {
  const loaded = loadRace(raceId);
  const now = Date.now();
  writeRun(startRun(raceId, loaded?.race.startsAt ?? now));
  await Location.startLocationUpdatesAsync(gpsTask, {
    accuracy: Location.Accuracy.BestForNavigation,
    distanceInterval: 5,
    activityType: Location.ActivityType.Fitness,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
  });
}

export async function stopRace(): Promise<void> {
  if (await Location.hasStartedLocationUpdatesAsync(gpsTask)) await Location.stopLocationUpdatesAsync(gpsTask);
  clearRun();
}

// iOS can deliver several batches at once, for example after a relaunch;
// each would read the same run and say the same alert. One batch at a time.
let queue: Promise<void> = Promise.resolve();

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(gpsTask, ({ data, error }) => {
  if (error || data?.locations === undefined) return queue;
  const locations = data.locations;
  queue = queue.then(() => handle(locations)).catch(() => {});
  return queue;
});

async function handle(locations: Location.LocationObject[]): Promise<void> {
  const run = readRun();
  const newest = locations[locations.length - 1];
  if (run === null || newest === undefined) return;
  if (!due(run, newest.timestamp)) return;
  const loaded = loadRace(run.raceId);
  if (loaded === null) return;
  const context = { race: loaded.race, climbs: loaded.climbs, startedAt: run.startedAt, settings: readSettings() };
  const result = applyFix(context, run, toFix(mostAccurate(locations)));
  writeRun(result.run);
  for (const alert of result.alerts) await notify(alert);
}

/** Off the course every fix counts, so the way back is always fresh. */
function due(run: Run, now: number): boolean {
  return run.routeState === 'off-route' || run.routeState === 'uncertain' || now - run.checkedAt >= processEveryMs;
}

const mostAccurate = (locations: Location.LocationObject[]): Location.LocationObject =>
  [...locations].sort((a, b) => (a.coords.accuracy ?? Infinity) - (b.coords.accuracy ?? Infinity))[0];

const toFix = (location: Location.LocationObject): Fix => ({
  at: { lat: location.coords.latitude, lon: location.coords.longitude },
  accuracyM: location.coords.accuracy ?? Infinity,
  takenAt: location.timestamp,
});
