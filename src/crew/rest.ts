/**
 * Firestore over plain HTTPS. The Firebase package keeps a connection open,
 * which costs battery and dies anyway while iOS holds Paco asleep; one short
 * request when there is something to say is cheaper.
 */
import { ChatLine, firebaseConfig, Live } from './protocol';

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

export const chatFields = (line: ChatLine): Record<string, Value> => ({
  from: str(line.from),
  text: str(line.text),
  t: int(line.t),
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
 * A chat message is written once: if the answer was lost and it is sent again,
 * the second write fails because the record exists, and that counts as sent.
 * Returns the server's time of arrival, or empty when that answer was lost.
 */
export async function writeChat(key: string, line: ChatLine): Promise<string> {
  try {
    const answer = (await post(`${base}:commit`, {
      writes: [
        {
          update: { name: docName(`paco/${key}/chat/${line.id}`), fields: chatFields(line) },
          updateTransforms: [{ fieldPath: 'at', setToServerValue: 'REQUEST_TIME' }],
          currentDocument: { exists: false },
        },
      ],
    })) as { commitTime?: string } | null;
    return answer?.commitTime ?? '';
  } catch (error) {
    if (error instanceof RestError && (error.code === 'FAILED_PRECONDITION' || error.code === 'ALREADY_EXISTS')) return '';
    throw error;
  }
}

const text = (value: Value | undefined): string => (value !== undefined && 'stringValue' in value ? value.stringValue : '');

/** Chat messages, both ways, that reached the server after `since` (a server time), oldest first. */
export async function chatAfter(key: string, since: string): Promise<ChatLine[]> {
  const rows = (await post(`${base}/paco/${key}:runQuery`, {
    structuredQuery: {
      from: [{ collectionId: 'chat' }],
      where: { fieldFilter: { field: { fieldPath: 'at' }, op: 'GREATER_THAN', value: { timestampValue: since } } },
      orderBy: [{ field: { fieldPath: 'at' }, direction: 'ASCENDING' }],
      limit: 50,
    },
  })) as { document?: { name: string; fields?: Record<string, Value> } }[];
  return rows.flatMap((row): ChatLine[] => {
    const fields = row.document?.fields;
    if (row.document === undefined || fields === undefined) return [];
    const at = 'timestampValue' in (fields.at ?? {}) ? (fields.at as { timestampValue: string }).timestampValue : '';
    const from = text(fields.from);
    if (at === '' || (from !== 'runner' && from !== 'crew')) return [];
    const t = 'integerValue' in (fields.t ?? {}) ? Number((fields.t as { integerValue: string }).integerValue) : Date.parse(at);
    return [{ id: row.document.name.split('/').pop() ?? '', from, text: text(fields.text), t, at }];
  });
}

type Collection = 'taps' | 'msgs' | 'chat';

/** Names of the records in `collection` older than `before`, at most `limit`. */
async function olderThan(key: string, collection: Collection, before: number, limit: number): Promise<string[]> {
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
 * Deletes every chat message from before `before` (a new run's start), and
 * what is left of the old status taps and crew messages.
 * Only older records: if this runs late, the new run's records stay.
 */
export async function deleteBefore(key: string, before: number): Promise<number> {
  let deleted = 0;
  for (const collection of ['chat', 'taps', 'msgs'] as const) {
    for (;;) {
      const names = await olderThan(key, collection, before, 300);
      if (names.length === 0) break;
      await post(`${base}:commit`, { writes: names.map((name) => ({ delete: name })) });
      deleted += names.length;
    }
  }
  return deleted;
}
