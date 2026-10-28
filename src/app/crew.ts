import { File, Paths } from 'expo-file-system';

import { keyLength, Live, Pushover, randomId, Tap, TapKind } from '../crew/protocol';
import { CrewMessage, deleteBefore, messagesAfter, RestError, writeLive, writeTap } from '../crew/rest';
import { Run } from '../core/run';
import { notify } from './notify';
import { readRun } from './store';

/**
 * The link to the crew page. The position goes out at most this often: each
 * request wakes the phone's radio, and battery matters more than freshness.
 * Taps go out at once. Crew messages are fetched on the same trips.
 */
export const positionEveryMs = 5 * 60_000;

/** Everything the crew link needs on the phone. Kept in a file, so a tap made without signal survives iOS closing Paco. */
export type Crew = {
  readonly key: string;
  /** The run the inbox belongs to; a new run starts a new inbox. */
  readonly runStart: number;
  /** Taps not yet accepted by the server, oldest first. */
  readonly queue: readonly Tap[];
  /** Taps the server has, newest first, for the screen. */
  readonly sent: readonly Tap[];
  /** Crew messages of this run, newest first. */
  readonly inbox: readonly CrewMessage[];
  /** When the live record was last accepted (phone time), 0 never. */
  readonly liveAt: number;
  /** The live record must go out on the next trip, whatever the time. */
  readonly liveDue: boolean;
  /** When the last trip reached the server (phone time), 0 never. */
  readonly reachedAt: number;
  /** The last run's taps and messages are still on the server: delete them on the next trip. */
  readonly wipeDue: boolean;
};

const crewFile = new File(Paths.document, 'crew.json');

/**
 * Pushover's codes, put into the app at build time from `.env.local` (not in
 * git). Paco only passes them on inside the crew link.
 */
export function pushover(): Pushover | null {
  const token = process.env.EXPO_PUBLIC_PUSHOVER_TOKEN ?? '';
  const user = process.env.EXPO_PUBLIC_PUSHOVER_USER ?? '';
  return token !== '' && user !== '' ? { token, user } : null;
}

export function readCrew(): Crew {
  let stored: Partial<Crew> | null = null;
  if (crewFile.exists) {
    try {
      stored = JSON.parse(crewFile.textSync()) as Partial<Crew>;
    } catch {
      stored = null;
    }
  }
  const crew: Crew = {
    key: '',
    runStart: 0,
    queue: [],
    sent: [],
    inbox: [],
    liveAt: 0,
    liveDue: false,
    reachedAt: 0,
    wipeDue: false,
    ...stored,
  };
  if (crew.key.length >= keyLength) return crew;
  // The key is made once and kept: the crew saves one link for every race.
  const fresh = { ...crew, key: randomId(keyLength) };
  writeCrew(fresh);
  return fresh;
}

function writeCrew(crew: Crew): void {
  if (!crewFile.exists) crewFile.create();
  crewFile.write(JSON.stringify(crew));
}

const update = (change: (crew: Crew) => Crew): Crew => {
  const next = change(readCrew());
  writeCrew(next);
  return next;
};

/**
 * A new run starts clean (Iker, 2026-10-28): the last race's taps, messages and
 * unsent taps are dropped here, and deleted on the server on the next trip.
 */
export function crewStartRun(run: Run): Promise<void> {
  update((crew) => ({ ...crew, runStart: run.startedAt, queue: [], sent: [], inbox: [], liveDue: true, wipeDue: true }));
  return syncCrew();
}

export async function crewEndRun(run: Run): Promise<void> {
  update((crew) => ({ ...crew, liveDue: true }));
  await syncCrew({ ended: run });
}

export function crewTap(kind: TapKind, items: readonly string[] = [], msg = ''): Promise<void> {
  const tap: Tap = { id: randomId(20), kind, items, msg, t: Date.now() };
  update((crew) => ({ ...crew, queue: [...crew.queue, tap] }));
  return syncCrew();
}

// The GPS task and the screen may both ask for a trip; one at a time.
let trip: Promise<void> = Promise.resolve();

/**
 * One trip to the server, if there is a reason: taps waiting, the live record
 * due, or the position older than `positionEveryMs`. `inbox` also fetches
 * messages when nothing else is due (the Crew tab open on screen).
 */
export function syncCrew(options: { ended?: Run; inbox?: boolean } = {}): Promise<void> {
  trip = trip.then(() => tripNow(options)).catch(() => {});
  return trip;
}

async function tripNow({ ended, inbox }: { ended?: Run; inbox?: boolean }): Promise<void> {
  const run = ended ?? readRun();
  const crew = readCrew();
  const now = Date.now();
  const positionDue = run !== null && now - crew.liveAt >= positionEveryMs;
  if (crew.queue.length === 0 && !crew.liveDue && !crew.wipeDue && !positionDue && !inbox) return;

  // Before anything new goes up: the server only deletes records older than this run.
  if (crew.wipeDue && crew.runStart > 0) {
    await deleteBefore(crew.key, crew.runStart)
      .then(() => update((c) => ({ ...c, wipeDue: false })))
      .catch(() => {});
  }

  // Messages first, so the live record can already say which ones arrived.
  // Each step on its own: one refused request must not block the others.
  if (run !== null && ended === undefined) await fetchInbox(crew, run).catch(() => {});
  await sendTaps().catch(() => {});
  if (run !== null && (readCrew().liveDue || positionDue)) await sendLive(run, ended !== undefined).catch(() => {});
}

async function fetchInbox(crew: Crew, run: Run): Promise<void> {
  const since = crew.inbox[0]?.at ?? new Date(crew.runStart || run.startedAt).toISOString();
  const fresh = (await messagesAfter(crew.key, since)).filter((m) => !crew.inbox.some((known) => known.id === m.id));
  update((c) => ({ ...c, reachedAt: Date.now() }));
  if (fresh.length === 0) return;
  // The live record carries the newest message the phone has, so the page can show "delivered".
  update((c) => ({ ...c, inbox: [...[...fresh].reverse(), ...c.inbox].slice(0, 50), liveDue: true }));
  for (const message of fresh) await notify({ voice: 'crew_message', title: 'Message from crew', body: message.text });
}

async function sendTaps(): Promise<void> {
  for (const tap of readCrew().queue) {
    try {
      await writeTap(readCrew().key, tap);
    } catch (error) {
      // A tap the rules refuse can never go; keeping it would block every tap after it.
      if (!(error instanceof RestError && error.final)) throw error;
    }
    update((c) => ({
      ...c,
      queue: c.queue.filter((q) => q.id !== tap.id),
      sent: [tap, ...c.sent].slice(0, 30),
      reachedAt: Date.now(),
    }));
  }
}

async function sendLive(run: Run, ended: boolean): Promise<void> {
  const crew = readCrew();
  const fix = run.latestFix;
  const live: Live = {
    race: run.raceId,
    state: ended ? 'ended' : 'running',
    start: run.startedAt,
    km: run.km,
    got: crew.inbox[0]?.at ?? '',
    ...(fix === null ? {} : { lat: fix.at.lat, lon: fix.at.lon, acc: fix.accuracyM, fix: fix.takenAt }),
  };
  await writeLive(crew.key, live);
  update((c) => ({ ...c, liveAt: Date.now(), liveDue: false, reachedAt: Date.now() }));
}
