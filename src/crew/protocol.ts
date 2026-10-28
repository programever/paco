/**
 * What Paco and the crew page say to each other through Firestore. Shared by
 * the app and the page, so both read the same names. Pure: no phone, no browser.
 *
 * paco/{key}              the live record: the race, the newest position, the km
 * paco/{key}/taps/{id}    the runner's taps (OK, Injured, Need, ...), one record each
 * paco/{key}/msgs/{id}    the crew's messages to the runner
 *
 * The key is a long random code made once by Paco. Whoever has the link has the key.
 */

/** Public by design, like in Haba: it only names the project. The Firestore rules protect the data. */
export const firebaseConfig = {
  apiKey: 'AIzaSyDtkJvnZLPIkIAJzj9w3F486bX2E8T5kuU',
  authDomain: 'habits-433f8.firebaseapp.com',
  projectId: 'habits-433f8',
  storageBucket: 'habits-433f8.firebasestorage.app',
  messagingSenderId: '632547558396',
  appId: '1:632547558396:web:5bdf411d492236c5686879',
};

export const crewPageUrl = 'https://programever.github.io/paco/';

/** Pushover's codes for the runner's phone. They ride in the link, never in the code: see README. */
export type Pushover = { readonly token: string; readonly user: string };

/**
 * The part after `#` never leaves the browser, so the Pushover codes in it
 * reach only the phones that have the link. Without Pushover it is just the key.
 */
export function crewLink(key: string, pushover: Pushover | null = null): string {
  if (pushover === null) return `${crewPageUrl}#${key}`;
  // Built by hand: React Native's URLSearchParams is not complete. All three are letters and digits.
  return `${crewPageUrl}#k=${key}&t=${pushover.token}&u=${pushover.user}`;
}

/** Reads both link forms: `#key` and `#k=key&t=token&u=user`. */
export function readCrewLink(hash: string): { key: string; pushover: Pushover | null } {
  const text = hash.replace(/^#/, '');
  if (!text.includes('=')) return { key: text, pushover: null };
  const params = new URLSearchParams(text);
  const token = params.get('t') ?? '';
  const user = params.get('u') ?? '';
  return { key: params.get('k') ?? '', pushover: token !== '' && user !== '' ? { token, user } : null };
}

/** "Call me" rings until the runner taps it; every other message rings once, even in quiet hours. */
export const urgentMessages: readonly string[] = ['Call me'];

/** The rules only accept keys at least this long. */
export const keyLength = 24;

export const injuries = ['knee', 'ankle', 'foot', 'cramp', 'stomach', 'other'] as const;
export type Injury = (typeof injuries)[number];

export const needs = ['water', 'food', 'gel', 'salt', 'medicine', 'socks', 'warm clothes', 'headlamp', 'power bank'] as const;
export type Need = (typeof needs)[number];

/** `seen` is the runner's "Got it" on a crew message; the others are statuses. */
export const tapKinds = ['ok', 'tired', 'resting', 'injured', 'need', 'quit', 'sos', 'seen'] as const;
export type TapKind = (typeof tapKinds)[number];

export const tapLabel: Record<TapKind, string> = {
  ok: 'OK',
  tired: 'Tired',
  resting: 'Resting',
  injured: 'Injured',
  need: 'Need',
  quit: 'Quit',
  sos: 'SOS',
  seen: 'Got it',
};

/** Taps the crew must not miss: the page rings for these. */
export const urgentKinds: readonly TapKind[] = ['injured', 'need', 'quit', 'sos'];

export type Tap = {
  readonly id: string;
  readonly kind: TapKind;
  /** Injured: the body parts. Need: the things. Empty otherwise. */
  readonly items: readonly string[];
  /** Seen: the id of the crew message. Empty otherwise. */
  readonly msg: string;
  /** Phone time of the tap, ms. */
  readonly t: number;
};

export type Live = {
  readonly race: string;
  readonly state: 'running' | 'ended';
  /** The run's start, ms. */
  readonly start: number;
  readonly km: number;
  /** The newest position. Absent before the first GPS fix. */
  readonly lat?: number;
  readonly lon?: number;
  readonly acc?: number;
  /** Phone time of that fix, ms. */
  readonly fix?: number;
  /** Server time of the newest crew message the phone has downloaded, or empty. */
  readonly got: string;
};

export const quickMessages = ['Medicine is ready', 'Hurry, COT is close', 'Slow down, you are fine', 'Go go go!', 'Call me'] as const;
export const waitingAt = (checkpoint: string): string => `I am at ${checkpoint}, waiting`;

export const maxMessageLength = 200;

/** Letters and digits only, so the key is safe in a URL and a Firestore path. */
export function randomId(length: number, random: () => number = Math.random): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  return Array.from({ length }, () => alphabet[Math.floor(random() * alphabet.length)]).join('');
}
