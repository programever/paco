import { Alert, alertsFor, Context, emptyMemory, Memory } from './alerts';
import { LatLon } from './geo';
import { Candidate, Fix, isTrustworthy, resolve, RouteState, routeState } from './position';
import { km, Km } from './route';

/** Everything known about a race in progress. Stored after every processed fix. */
export type Run = {
  readonly raceId: string;
  readonly startedAt: number;
  readonly km: Km;
  readonly updatedAt: number;
  /** When a fix was last looked at, precise or not. */
  readonly checkedAt: number;
  /** The last fix precise and close enough to move the milestone. */
  readonly lastFix: Fix | null;
  /** The newest fix of any quality: what the screen shows. */
  readonly latestFix: Fix | null;
  readonly routeState: RouteState | null;
  /** The nearest point on the whole course: the way back when lost. */
  readonly nearest: Candidate | null;
  /** The fix matched two passes of the course equally well, so the milestone was not moved. */
  readonly ambiguous: boolean;
  readonly passedAt: Readonly<Record<string, number>>;
  /** Where the runner has been, newest first: the grey dots on the map, the way back when lost. */
  readonly breadcrumbs: readonly LatLon[];
  /** The km was typed by the runner, not measured: the map puts the dot on the course at that km. */
  readonly declared: boolean;
  readonly memory: Memory;
};

export const startRun = (raceId: string, startedAt: number): Run => ({
  raceId,
  startedAt,
  km: km(0),
  updatedAt: startedAt,
  checkedAt: 0,
  lastFix: null,
  latestFix: null,
  routeState: null,
  nearest: null,
  ambiguous: false,
  passedAt: {},
  breadcrumbs: [],
  declared: false,
  memory: emptyMemory,
});

/** Half an hour of trail at one fix every 10 s. */
const maxBreadcrumbs = 180;

/** A passed checkpoint is un-passed only when the runner is clearly behind it again, not on GPS noise. */
const unpassMarginKm = 0.3;

export function applyFix(context: Context, run: Run, fix: Fix): { run: Run; alerts: Alert[] } {
  const resolution = resolve(context.race.route, run, fix);
  if (resolution === null) return { run: { ...run, checkedAt: fix.takenAt, latestFix: fix }, alerts: [] };
  const trusted = isTrustworthy(fix, resolution.nearest) && resolution.kind === 'resolved';
  const reached = trusted && resolution.kind === 'resolved' ? resolution.progress.km : run.km;
  const state = routeState(fix, resolution.nearest);
  const { alerts, memory } = alertsFor(context, run.memory, {
    now: fix.takenAt,
    fix,
    reachedKm: reached,
    routeState: state,
    nearest: resolution.nearest,
  });
  return {
    run: {
      ...run,
      km: reached,
      updatedAt: trusted ? fix.takenAt : run.updatedAt,
      checkedAt: fix.takenAt,
      lastFix: trusted ? fix : run.lastFix,
      latestFix: fix,
      routeState: state,
      nearest: resolution.nearest,
      ambiguous: resolution.kind === 'ambiguous',
      passedAt: passed(context, run.passedAt, reached, fix.takenAt),
      breadcrumbs: [fix.at, ...run.breadcrumbs].slice(0, maxBreadcrumbs),
      declared: trusted ? false : run.declared,
      memory,
    },
    alerts,
  };
}

function passed(context: Context, before: Run['passedAt'], reached: number, now: number): Run['passedAt'] {
  const after: Record<string, number> = {};
  for (const checkpoint of context.race.checkpoints) {
    const at = before[checkpoint.id];
    if (at !== undefined && reached >= checkpoint.km - unpassMarginKm) after[checkpoint.id] = at;
    else if (reached >= checkpoint.km) after[checkpoint.id] = now;
  }
  return after;
}

/**
 * The runner typing a km is a decision, not a measurement, and overrides the
 * last fix. The old fix is dropped so the next one is not judged against a
 * place the runner has said they are no longer at.
 */
export function declareKm(context: Context, run: Run, reached: number, now: number): Run {
  const at = km(Math.min(reached, context.race.route.totalKm));
  return {
    ...run,
    km: at,
    updatedAt: now,
    lastFix: null,
    ambiguous: false,
    declared: true,
    passedAt: passed(context, run.passedAt, at, now),
  };
}
