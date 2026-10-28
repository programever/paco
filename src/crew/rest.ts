/**
 * Firestore over plain HTTPS. The Firebase package keeps a connection open,
 * which costs battery and dies anyway while iOS holds Paco asleep; one short
 * request when there is something to say is cheaper.
 */
import { firebaseConfig, Live, Tap } from './protocol';

const base = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents`;
const docName = (path: string) => `projects/${firebaseConfig.projectId}/databases/(default)/documents/${path}`;

/** A request that hangs on one bar of signal is given up, and tried again on a later check. */
const timeoutMs = 15_000;

type Value =
  | { stringValue: string }
  | { integerValue: string }
  | { doubleValue: number }
  | { arrayValue: { values?: Value[] } }
  | { timestampValue: string };

export class RestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
  /** The server said no for good (rules, a record already there): retrying cannot help. */
  get final(): boolean {
    return this.status >= 400 && this.status < 500 && this.status !== 408 && this.status !== 429;
  }
}

async function post(url: string, body: unknown): Promise<unknown> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const response = await fetch(`${url}?key=${firebaseConfig.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: abort.signal,
    });
    const json = (await response.json().catch(() => null)) as { error?: { status?: string; message?: string } } | null;
    if (!response.ok) throw new RestError(response.status, json?.error?.status ?? '', json?.error?.message ?? `HTTP ${response.status}`);
    return json;
  } finally {
    clearTimeout(timer);
  }
}

const str = (value: string): Value => ({ stringValue: value });
const int = (value: number): Value => ({ integerValue: String(Math.round(value)) });
const num = (value: number): Value => ({ doubleValue: value });

export function liveFields(live: Live): Record<string, Value> {
  const fields: Record<string, Value> = {
    race: str(live.race),
    state: str(live.state),
    start: int(live.start),
    km: num(live.km),
    got: str(live.got),
  };
  if (live.lat !== undefined && live.lon !== undefined && live.acc !== undefined && live.fix !== undefined) {
    fields.lat = num(live.lat);
    fields.lon = num(live.lon);
    fields.acc = num(Math.min(live.acc, 99_999));
    fields.fix = int(live.fix);
  }
  return fields;
}

export const tapFields = (tap: Tap): Record<string, Value> => ({
  kind: str(tap.kind),
  items: { arrayValue: { values: tap.items.map(str) } },
  msg: str(tap.msg),
  t: int(tap.t),
});

/** `at` is the server's clock, so a wrong phone clock cannot fool the page's "last update". */
export const writeLive = (key: string, live: Live): Promise<unknown> =>
  post(`${base}:commit`, {
    writes: [
      {
        update: { name: docName(`paco/${key}`), fields: liveFields(live) },
        updateTransforms: [{ fieldPath: 'at', setToServerValue: 'REQUEST_TIME' }],
      },
    ],
  });

/**
 * A tap is written once: if the answer was lost and the tap is sent again,
 * the second write fails because the record exists, and that counts as sent.
 */
export async function writeTap(key: string, tap: Tap): Promise<void> {
  try {
    await post(`${base}:commit`, {
      writes: [
        {
          update: { name: docName(`paco/${key}/taps/${tap.id}`), fields: tapFields(tap) },
          updateTransforms: [{ fieldPath: 'sent', setToServerValue: 'REQUEST_TIME' }],
          currentDocument: { exists: false },
        },
      ],
    });
  } catch (error) {
    if (error instanceof RestError && (error.code === 'FAILED_PRECONDITION' || error.code === 'ALREADY_EXISTS')) return;
    throw error;
  }
}

export type CrewMessage = { readonly id: string; readonly text: string; readonly at: string };

/** Crew messages written after `since` (a server timestamp), oldest first. */
export async function messagesAfter(key: string, since: string): Promise<CrewMessage[]> {
  const rows = (await post(`${base}/paco/${key}:runQuery`, {
    structuredQuery: {
      from: [{ collectionId: 'msgs' }],
      where: { fieldFilter: { field: { fieldPath: 'at' }, op: 'GREATER_THAN', value: { timestampValue: since } } },
      orderBy: [{ field: { fieldPath: 'at' }, direction: 'ASCENDING' }],
      limit: 30,
    },
  })) as { document?: { name: string; fields?: Record<string, Value> } }[];
  return rows.flatMap((row) => {
    const fields = row.document?.fields;
    if (row.document === undefined || fields === undefined) return [];
    const text = 'stringValue' in (fields.text ?? {}) ? (fields.text as { stringValue: string }).stringValue : '';
    const at = 'timestampValue' in (fields.at ?? {}) ? (fields.at as { timestampValue: string }).timestampValue : '';
    if (at === '') return [];
    return [{ id: row.document.name.split('/').pop() ?? '', text, at }];
  });
}

/** Names of the records in `collection` older than `before`, at most `limit`. */
async function olderThan(key: string, collection: 'taps' | 'msgs', before: number, limit: number): Promise<string[]> {
  const field = collection === 'taps' ? 't' : 'at';
  const value = collection === 'taps' ? { integerValue: String(Math.round(before)) } : { timestampValue: new Date(before).toISOString() };
  const rows = (await post(`${base}/paco/${key}:runQuery`, {
    structuredQuery: {
      from: [{ collectionId: collection }],
      select: { fields: [{ fieldPath: '__name__' }] },
      where: { fieldFilter: { field: { fieldPath: field }, op: 'LESS_THAN', value } },
      limit,
    },
  })) as { document?: { name: string } }[];
  return rows.flatMap((row) => (row.document === undefined ? [] : [row.document.name]));
}

/**
 * Deletes every tap and crew message from before `before` (a new run's start).
 * Only older records: if this runs late, the new run's records stay.
 */
export async function deleteBefore(key: string, before: number): Promise<number> {
  let deleted = 0;
  for (const collection of ['taps', 'msgs'] as const) {
    for (;;) {
      const names = await olderThan(key, collection, before, 300);
      if (names.length === 0) break;
      await post(`${base}:commit`, { writes: names.map((name) => ({ delete: name })) });
      deleted += names.length;
    }
  }
  return deleted;
}
