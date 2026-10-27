import { File, Paths } from 'expo-file-system';

export type Mode = 'steady' | 'saver';
export type IntervalSeconds = 300 | 30;

export type Settings = { mode: Mode; intervalSeconds: IntervalSeconds };

export type Phase = 'resting' | 'seeking';

export type TaskState = {
  lastCheckAt: number;
  checks: number;
  phase: Phase;
  seekingSince: number;
  lastFixAt: number;
  fixesSinceCheck: number;
  longestGapSeconds: number;
};

export type Entry =
  | { kind: 'start'; at: number; settings: Settings }
  | { kind: 'stop'; at: number }
  | {
      kind: 'check';
      at: number;
      lat: number;
      lon: number;
      accuracy: number;
      battery: number;
      fixes: number;
      longestGapSeconds: number;
      sound: string;
    }
  | { kind: 'error'; at: number; message: string };

const settingsFile = new File(Paths.document, 'probe-settings.json');
const stateFile = new File(Paths.document, 'probe-state.json');
const logFile = new File(Paths.document, 'probe-log.jsonl');

export const defaultSettings: Settings = { mode: 'steady', intervalSeconds: 300 };

export const freshState = (now: number): TaskState => ({
  lastCheckAt: now,
  checks: 0,
  phase: 'resting',
  seekingSince: 0,
  lastFixAt: now,
  fixesSinceCheck: 0,
  longestGapSeconds: 0,
});

function readJson<T>(file: File, fallback: T): T {
  if (!file.exists) return fallback;
  try {
    return JSON.parse(file.textSync()) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: File, value: unknown): void {
  if (!file.exists) file.create();
  file.write(JSON.stringify(value));
}

export const readSettings = (): Settings => readJson(settingsFile, defaultSettings);
export const writeSettings = (settings: Settings): void => writeJson(settingsFile, settings);

export const readState = (): TaskState => readJson(stateFile, freshState(Date.now()));
export const writeState = (state: TaskState): void => writeJson(stateFile, state);

export async function appendEntry(entry: Entry): Promise<void> {
  if (!logFile.exists) logFile.create();
  await logFile.write(JSON.stringify(entry) + '\n', { append: true });
}

export function readEntries(): Entry[] {
  if (!logFile.exists) return [];
  return logFile
    .textSync()
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Entry);
}

export function clearEntries(): void {
  if (logFile.exists) logFile.delete();
}
