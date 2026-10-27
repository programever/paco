import * as Battery from 'expo-battery';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { notify, soundForCheck } from './sounds';
import {
  appendEntry,
  freshState,
  readSettings,
  readState,
  Settings,
  TaskState,
  writeSettings,
  writeState,
} from './store';

export const gpsTask = 'paco-probe-gps';

const goodAccuracyMeters = 50;
const seekLimitMs = 60_000;

const precise: Location.LocationTaskOptions = {
  accuracy: Location.Accuracy.BestForNavigation,
  distanceInterval: 0,
  activityType: Location.ActivityType.Fitness,
  pausesUpdatesAutomatically: false,
  showsBackgroundLocationIndicator: true,
};

// Coarse accuracy lets iOS power the GPS chip down, but the app must keep a
// running location session or iOS suspends it with the screen locked.
const coarse: Location.LocationTaskOptions = {
  ...precise,
  accuracy: Location.Accuracy.Lowest,
};

export async function startProbe(settings: Settings): Promise<void> {
  writeSettings(settings);
  writeState(freshState(Date.now()));
  await appendEntry({ kind: 'start', at: Date.now(), settings });
  await Location.startLocationUpdatesAsync(gpsTask, settings.mode === 'saver' ? coarse : precise);
}

export async function stopProbe(): Promise<void> {
  if (await Location.hasStartedLocationUpdatesAsync(gpsTask)) {
    await Location.stopLocationUpdatesAsync(gpsTask);
  }
  await appendEntry({ kind: 'stop', at: Date.now() });
}

export const isProbeRunning = (): Promise<boolean> => Location.hasStartedLocationUpdatesAsync(gpsTask);

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(gpsTask, async ({ data, error }) => {
  if (error) {
    await appendEntry({ kind: 'error', at: Date.now(), message: error.message });
    return;
  }
  const best = mostAccurate(data.locations);
  if (best === undefined) return;
  const state = countFixes(readState(), data.locations.length, Date.now());
  writeState(await handleFix(state, best, readSettings()));
});

const mostAccurate = (locations: Location.LocationObject[]): Location.LocationObject | undefined =>
  [...locations].sort((a, b) => (a.coords.accuracy ?? Infinity) - (b.coords.accuracy ?? Infinity))[0];

function countFixes(state: TaskState, count: number, now: number): TaskState {
  const gapSeconds = Math.round((now - state.lastFixAt) / 1000);
  return {
    ...state,
    lastFixAt: now,
    fixesSinceCheck: state.fixesSinceCheck + count,
    longestGapSeconds: Math.max(state.longestGapSeconds, gapSeconds),
  };
}

async function handleFix(
  state: TaskState,
  fix: Location.LocationObject,
  settings: Settings,
): Promise<TaskState> {
  const now = Date.now();
  const due = now - state.lastCheckAt >= settings.intervalSeconds * 1000;
  const accuracy = fix.coords.accuracy ?? Infinity;

  if (settings.mode === 'steady') {
    return due ? check(state, fix, now) : state;
  }
  switch (state.phase) {
    case 'resting':
      if (!due) return state;
      await Location.startLocationUpdatesAsync(gpsTask, precise);
      return { ...state, phase: 'seeking', seekingSince: now };
    case 'seeking':
      if (accuracy > goodAccuracyMeters && now - state.seekingSince < seekLimitMs) return state;
      await Location.startLocationUpdatesAsync(gpsTask, coarse);
      return { ...(await check(state, fix, now)), phase: 'resting' };
  }
}

async function check(state: TaskState, fix: Location.LocationObject, now: number): Promise<TaskState> {
  const number = state.checks + 1;
  const sound = soundForCheck(state.checks);
  const battery = Math.round((await Battery.getBatteryLevelAsync()) * 100);
  const accuracy = Math.round(fix.coords.accuracy ?? -1);
  await appendEntry({
    kind: 'check',
    at: now,
    lat: fix.coords.latitude,
    lon: fix.coords.longitude,
    accuracy,
    battery,
    fixes: state.fixesSinceCheck,
    longestGapSeconds: state.longestGapSeconds,
    sound,
  });
  await notify(
    `Paco check ${number}`,
    `GPS ±${accuracy} m · battery ${battery}% · ${state.fixesSinceCheck} readings · longest gap ${state.longestGapSeconds} s`,
    sound,
  );
  return { ...state, lastCheckAt: now, checks: number, fixesSinceCheck: 0, longestGapSeconds: 0 };
}
