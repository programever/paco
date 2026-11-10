import { File, Paths } from 'expo-file-system';

import { ChatLine, keyLength, Live, maxMessageLength, Pushover, randomId } from '../crew/protocol';
import { chatAfter, deleteBefore, RestError, writeChat, writeLive } from '../crew/rest';
import { Run } from '../core/run';
import { notify } from './notify';
import { readRun } from './store';

/**
 * The link to the crew page. Where the runner is matters most on the page
 * (Iker, 2026-11-10), so the position goes out this often, and at once when
 * something happens (`crewPositionNow`). GPS is on all race long anyway; one
 * small request every 2 minutes adds little to that. Chat messages go out at
 * once. Crew messages are fetched on the same trips.
 */
export const positionEveryMs = 2 * 60_000;

/** A runner message the server has not accepted yet. */
export type Outgoing = ChatLine & {
  /** Why the last try failed, for the screen; empty before the first failure. */
  readonly error: string;
  /** The server refused it for good: it waits for the runner's Retry and holds nothing up. */
  readonly refused: boolean;
};

/** Everything the crew link needs on the phone. Kept in a file, so a message typed without signal survives iOS closing Paco. */
export type Crew = {
  readonly key: string;
  /** The run the chat belongs to; a new run starts a new chat. */
  readonly runStart: number;
  /** Runner messages not yet on the server, oldest first. They go out one by one, in this order. */
  readonly outbox: readonly Outgoing[];
  /** Messages the server has, both ways, oldest first. */
  readonly chat: readonly ChatLine[];
  /** Server time of the newest message fetched: the next fetch starts after it. Not our own sends' times, which can be newer than a crew message not fetched yet. */
  readonly fetchedTo: string;
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
  // Older files also hold the status taps (queue, sent, inbox); nothing reads them.
  const crew: Crew = {
    key: '',
    runStart: 0,
    outbox: [],
    chat: [],
    fetchedTo: '',
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
 * A new run starts clean (Iker, 2026-10-28): the last race's chat and unsent
 * messages are dropped here, and deleted on the server on the next trip.
 */
export function crewStartRun(run: Run): Promise<void> {
  update((crew) => ({ ...crew, runStart: run.startedAt, outbox: [], chat: [], fetchedTo: '', liveDue: true, wipeDue: true }));
  return syncCrew();
}

export async function crewEndRun(run: Run): Promise<void> {
  update((crew) => ({ ...crew, liveDue: true }));
  await syncCrew({ ended: run });
}

/** A message from the runner: queued behind any not yet sent, then sent at once if there is signal. */
export function crewSay(text: string): Promise<void> {
  const clean = text.trim().slice(0, maxMessageLength);
  if (clean === '') return Promise.resolve();
  const line: Outgoing = { id: randomId(20), from: 'runner', text: clean, t: Date.now(), at: '', error: '', refused: false };
  update((crew) => ({ ...crew, outbox: [...crew.outbox, line] }));
  return syncCrew();
}

/** The runner's Retry on a refused message: it goes back in line, at the end. */
export function crewRetry(id: string): Promise<void> {
  update((crew) => {
    const line = crew.outbox.find((o) => o.id === id);
    if (line === undefined) return crew;
    const again: Outgoing = { ...line, id: randomId(20), t: Date.now(), error: '', refused: false };
    return { ...crew, outbox: [...crew.outbox.filter((o) => o.id !== id), again] };
  });
  return syncCrew();
}

/** Something the crew should see now (a km typed, a checkpoint passed, off or back on the route): send the position on this trip. */
export function crewPositionNow(): Promise<void> {
  update((crew) => ({ ...crew, liveDue: true }));
  return syncCrew();
}

// The GPS task and the screen may both ask for a trip; one at a time.
let trip: Promise<void> = Promise.resolve();

/**
 * One trip to the server, if there is a reason: messages waiting, the live
 * record due, or the position older than `positionEveryMs`. `inbox` also
 * fetches messages when nothing else is due (the Crew tab open on screen).
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
  const waiting = crew.outbox.some((o) => !o.refused);
  if (!waiting && !crew.liveDue && !crew.wipeDue && !positionDue && !inbox) return;

  // Before anything new goes up: the server only deletes records older than this run.
  if (crew.wipeDue && crew.runStart > 0) {
    await deleteBefore(crew.key, crew.runStart)
      .then(() => update((c) => ({ ...c, wipeDue: false })))
      .catch(() => {});
  }

  // Messages first, so the live record can already say which ones arrived.
  // Each step on its own: one refused request must not block the others.
  if (run !== null && ended === undefined) await fetchInbox(crew, run).catch(() => {});
  await sendOutbox().catch(() => {});
  if (run !== null && (readCrew().liveDue || positionDue)) await sendLive(run, ended !== undefined).catch(() => {});
}

async function fetchInbox(crew: Crew, run: Run): Promise<void> {
  const since = crew.fetchedTo || new Date(crew.runStart || run.startedAt).toISOString();
  const arrived = await chatAfter(crew.key, since);
  const newest = arrived[arrived.length - 1]?.at;
  update((c) => ({ ...c, reachedAt: Date.now(), fetchedTo: newest ?? c.fetchedTo }));
  const fresh = arrived.filter((l) => !crew.chat.some((known) => known.id === l.id));
  if (fresh.length === 0) return;
  // The live record carries the newest message the phone has, so the page can show "on phone".
  update((c) => ({ ...c, chat: merge(c.chat, fresh), liveDue: fresh.some((l) => l.from === 'crew') || c.liveDue }));
  for (const line of fresh.filter((l) => l.from === 'crew')) {
    await notify({ voice: 'crew_message', title: 'Message from crew', body: line.text });
  }
}

/** Known messages plus new ones, without doubles, oldest first: by server time, else by the sender's clock. */
function merge(known: readonly ChatLine[], fresh: readonly ChatLine[]): ChatLine[] {
  const byId = new Map(known.map((l) => [l.id, l]));
  for (const line of fresh) byId.set(line.id, { ...byId.get(line.id), ...line });
  const when = (l: ChatLine) => (l.at !== '' ? Date.parse(l.at) : l.t);
  return [...byId.values()].sort((a, b) => when(a) - when(b)).slice(-200);
}

/**
 * Strictly in order: a message goes only once every message before it is on
 * the server. A failure stops the line; the next trip tries again from there.
 */
async function sendOutbox(): Promise<void> {
  for (const line of readCrew().outbox) {
    if (line.refused) continue;
    try {
      const at = await writeChat(readCrew().key, line);
      const sent: ChatLine = { id: line.id, from: line.from, text: line.text, t: line.t, at };
      update((c) => ({ ...c, outbox: c.outbox.filter((o) => o.id !== line.id), chat: merge(c.chat, [sent]), reachedAt: Date.now() }));
    } catch (error) {
      const refused = error instanceof RestError && error.final;
      const reason = error instanceof Error ? error.message : String(error);
      update((c) => ({ ...c, outbox: c.outbox.map((o) => (o.id === line.id ? { ...o, error: reason, refused } : o)) }));
      // Refused for good: the runner decides (Retry). Anything else: keep the order, stop here.
      if (!refused) throw error;
    }
  }
}

async function sendLive(run: Run, ended: boolean): Promise<void> {
  const crew = readCrew();
  const fix = run.latestFix;
  // A typed km beats the last GPS fix: the page then puts the runner on the route at that km.
  const position = fix === null || run.declared ? {} : { lat: fix.at.lat, lon: fix.at.lon, acc: fix.accuracyM, fix: fix.takenAt };
  const live: Live = {
    race: run.raceId,
    state: ended ? 'ended' : 'running',
    start: run.startedAt,
    km: run.km,
    got: [...crew.chat].reverse().find((l) => l.from === 'crew')?.at ?? '',
    ...position,
  };
  await writeLive(crew.key, live);
  update((c) => ({ ...c, liveAt: Date.now(), liveDue: false, reachedAt: Date.now() }));
}
