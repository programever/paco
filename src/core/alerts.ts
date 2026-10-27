import { Climb } from './climbs';
import { bearing, compass, haversineKm } from './geo';
import { Candidate, Fix, RouteState } from './position';
import { checkpointLabel, clockText, cutoffMoment, nextAhead, nextWithCutoff, Race } from './race';
import { ascentBetweenM, descentBetweenM } from './route';

/** The bundled voice files. Kept few on purpose: details go in the text, not the voice. */
export type Voice = 'use_poles' | 'no_poles' | 'km_5' | 'km_4' | 'km_3' | 'km_2' | 'km_1' | 'off_course';

/** `voice: null` plays the normal notification sound. */
export type Alert = { readonly voice: Voice | null; readonly title: string; readonly body: string };

/** What has already been said, so nothing is said twice. Stored with the run. */
export type Memory = {
  readonly kmSaid: Readonly<Record<string, readonly number[]>>;
  readonly polesOn: readonly number[];
  readonly polesOff: readonly number[];
  readonly cutoffWarned: readonly string[];
  readonly offCourse: { readonly since: number; readonly lastSaidAt: number | null } | null;
  readonly weakSince: number | null;
  readonly weakSaid: boolean;
};

export const emptyMemory: Memory = {
  kmSaid: {},
  polesOn: [],
  polesOff: [],
  cutoffWarned: [],
  offCourse: null,
  weakSince: null,
  weakSaid: false,
};

/** One processed GPS reading, as the alerts see it. */
export type Observation = {
  readonly now: number;
  readonly fix: Fix;
  /** The runner's milestone after this fix. */
  readonly reachedKm: number;
  readonly routeState: RouteState;
  readonly nearest: Candidate;
  /** Whether the fix was precise enough to move the milestone. */
  readonly trusted: boolean;
};

export type Settings = {
  readonly kmVoices: boolean;
  readonly poles: boolean;
  readonly offCourse: boolean;
  readonly cutoffWarning: boolean;
  readonly gpsWeak: boolean;
  readonly cutoffWarningMinutes: number;
};

export const defaultSettings: Settings = {
  kmVoices: true,
  poles: true,
  offCourse: true,
  cutoffWarning: true,
  gpsWeak: true,
  cutoffWarningMinutes: 30,
};

const kmSteps = [5, 4, 3, 2, 1] as const;

/** A step is only said when the stretch is clearly longer, so "5 km" is not said on leaving a 5.0 km stretch. */
const kmStepMarginKm = 0.3;

const polesLeadKm = 0.15;

/** Off course must last this long before the voice speaks: one stray fix is not a lost runner. */
const offCourseConfirmMs = 20_000;
const offCourseRepeatMs = 120_000;
const weakAfterMs = 180_000;

export type Context = {
  readonly race: Race;
  readonly climbs: readonly Climb[];
  readonly startedAt: number;
  readonly settings: Settings;
};

export function alertsFor(context: Context, memory: Memory, seen: Observation): { alerts: Alert[]; memory: Memory } {
  const rules = [kmToNext, poles, offCourse, cutoffSoon, gpsWeak];
  return rules.reduce(
    (result, rule) => {
      const next = rule(context, result.memory, seen);
      return { alerts: [...result.alerts, ...next.alerts], memory: next.memory };
    },
    { alerts: [] as Alert[], memory },
  );
}

type Rule = (context: Context, memory: Memory, seen: Observation) => { alerts: Alert[]; memory: Memory };

const nothing = (memory: Memory) => ({ alerts: [], memory });

const kmText = (value: number): string => `${value.toFixed(1)} km`;

const kmToNext: Rule = ({ race, settings }, memory, seen) => {
  if (!settings.kmVoices || seen.routeState === 'off-route') return nothing(memory);
  const next = nextAhead(race, seen.reachedKm);
  if (next === undefined) return nothing(memory);
  const previousKm = [...race.checkpoints].reverse().find((c) => c.km <= seen.reachedKm)?.km ?? 0;
  const stretchKm = next.km - previousKm;
  const leftKm = next.km - seen.reachedKm;
  const said = memory.kmSaid[next.id] ?? [];
  const crossed = kmSteps.filter((step) => stretchKm > step + kmStepMarginKm && leftKm <= step && !said.includes(step));
  if (crossed.length === 0) return nothing(memory);
  const step = Math.min(...crossed);
  const up = Math.round(ascentBetweenM(race.route, seen.reachedKm, next.km));
  const down = Math.round(descentBetweenM(race.route, seen.reachedKm, next.km));
  const cutoff = next.cutoff === null ? '' : ` Closes at ${clockText(next.cutoff)}.`;
  return {
    alerts: [
      {
        voice: `km_${step}` as Voice,
        title: `${kmText(leftKm)} to ${checkpointLabel(next)}`,
        body: `Up ${up} m, down ${down} m.${cutoff}`,
      },
    ],
    memory: { ...memory, kmSaid: { ...memory.kmSaid, [next.id]: [...said, ...crossed] } },
  };
};

const poles: Rule = ({ climbs, settings }, memory, seen) => {
  if (!settings.poles || seen.routeState === 'off-route') return nothing(memory);
  const at = seen.reachedKm;
  const starting = climbs.findIndex(
    (c, index) => at >= c.startKm - polesLeadKm && at < c.endKm && !memory.polesOn.includes(index),
  );
  if (starting >= 0) {
    const climb = climbs[starting];
    return {
      alerts: [
        {
          voice: 'use_poles',
          title: 'Use the poles now',
          body: `Climb of ${Math.round(climb.gainM)} m over ${kmText(climb.endKm - climb.startKm)}.`,
        },
      ],
      memory: { ...memory, polesOn: [...memory.polesOn, starting] },
    };
  }
  const ended = climbs.findIndex(
    (c, index) => at >= c.endKm && memory.polesOn.includes(index) && !memory.polesOff.includes(index),
  );
  if (ended >= 0) {
    return {
      alerts: [{ voice: 'no_poles', title: 'No need for poles', body: 'The climb is over.' }],
      memory: { ...memory, polesOff: [...memory.polesOff, ended] },
    };
  }
  return nothing(memory);
};

const offCourse: Rule = ({ settings }, memory, seen) => {
  if (!settings.offCourse || seen.routeState === 'uncertain') return nothing(memory);
  if (seen.routeState === 'on-route') {
    if (memory.offCourse === null) return nothing(memory);
    const back: Alert[] =
      memory.offCourse.lastSaidAt === null ? [] : [{ voice: null, title: 'Back on the course', body: 'Well done.' }];
    return { alerts: back, memory: { ...memory, offCourse: null } };
  }
  const state = memory.offCourse ?? { since: seen.now, lastSaidAt: null };
  const due =
    seen.now - state.since >= offCourseConfirmMs &&
    (state.lastSaidAt === null || seen.now - state.lastSaidAt >= offCourseRepeatMs);
  if (!due) return { alerts: [], memory: { ...memory, offCourse: state } };
  const metres = Math.round(haversineKm(seen.fix.at, seen.nearest.snap) * 1000);
  const direction = compass(bearing(seen.fix.at, seen.nearest.snap));
  return {
    alerts: [
      { voice: 'off_course', title: 'You are off the course', body: `The course is ${metres} m to the ${direction}.` },
    ],
    memory: { ...memory, offCourse: { since: state.since, lastSaidAt: seen.now } },
  };
};

const cutoffSoon: Rule = ({ race, startedAt, settings }, memory, seen) => {
  if (!settings.cutoffWarning) return nothing(memory);
  const checkpoint = nextWithCutoff(race, seen.reachedKm);
  if (checkpoint === undefined || memory.cutoffWarned.includes(checkpoint.id)) return nothing(memory);
  const closesAt = cutoffMoment(race, startedAt, checkpoint);
  if (closesAt === null) return nothing(memory);
  const minutes = Math.floor((closesAt - seen.now) / 60_000);
  if (minutes < 0 || minutes > settings.cutoffWarningMinutes) return nothing(memory);
  return {
    alerts: [
      {
        voice: null,
        title: `${checkpointLabel(checkpoint)} closes in ${minutes} min`,
        body: `At ${clockText(checkpoint.cutoff!)}. ${kmText(checkpoint.km - seen.reachedKm)} to go.`,
      },
    ],
    memory: { ...memory, cutoffWarned: [...memory.cutoffWarned, checkpoint.id] },
  };
};

const gpsWeak: Rule = ({ settings }, memory, seen) => {
  if (seen.trusted) {
    return memory.weakSince === null ? nothing(memory) : { alerts: [], memory: { ...memory, weakSince: null, weakSaid: false } };
  }
  const since = memory.weakSince ?? seen.now;
  if (!settings.gpsWeak || memory.weakSaid || seen.now - since < weakAfterMs) {
    return { alerts: [], memory: { ...memory, weakSince: since } };
  }
  return {
    alerts: [{ voice: null, title: 'GPS is weak', body: 'Your position is not updated. Find an open place if you need it.' }],
    memory: { ...memory, weakSince: since, weakSaid: true },
  };
};
