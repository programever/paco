import { Alert, alertsFor, Context, emptyMemory, Memory } from './alerts';
import { Candidate, Fix, isTrustworthy, resolve, RouteState, routeState } from './position';
import { km, Km } from './route';

/** Everything known about a race in progress. Stored after every processed fix. */
export type Run = {
  readonly raceId: string;
  readonly startedAt: number;
  readonly km: Km;
  readonly updatedAt: number;
  readonly lastFix: Fix | null;
  readonly routeState: RouteState | null;
  /** The nearest point on the whole course: the way back when lost. */
  readonly nearest: Candidate | null;
  /** The fix matched two passes of the course equally well, so the milestone was not moved. */
  readonly ambiguous: boolean;
  readonly passedAt: Readonly<Record<string, number>>;
  readonly memory: Memory;
};

export const startRun = (raceId: string, startedAt: number): Run => ({
  raceId,
  startedAt,
  km: km(0),
  updatedAt: startedAt,
  lastFix: null,
  routeState: null,
  nearest: null,
  ambiguous: false,
  passedAt: {},
  memory: emptyMemory,
});

/** A passed checkpoint is un-passed only when the runner is clearly behind it again, not on GPS noise. */
const unpassMarginKm = 0.3;

export function applyFix(context: Context, run: Run, fix: Fix): { run: Run; alerts: Alert[] } {
  const resolution = resolve(context.race.route, run, fix);
  if (resolution === null) return { run, alerts: [] };
  const trusted = isTrustworthy(fix, resolution.nearest) && resolution.kind === 'resolved';
  const reached = trusted && resolution.kind === 'resolved' ? resolution.progress.km : run.km;
  const state = routeState(fix, resolution.nearest);
  const { alerts, memory } = alertsFor(context, run.memory, {
    now: fix.takenAt,
    fix,
    reachedKm: reached,
    routeState: state,
    nearest: resolution.nearest,
    trusted,
  });
  return {
    run: {
      ...run,
      km: reached,
      updatedAt: trusted ? fix.takenAt : run.updatedAt,
      lastFix: trusted ? fix : run.lastFix,
      routeState: state,
      nearest: resolution.nearest,
      ambiguous: resolution.kind === 'ambiguous',
      passedAt: passed(context, run.passedAt, reached, fix.takenAt),
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
