import { File, Paths } from 'expo-file-system';

import { defaultSettings, emptyMemory, Settings } from '../core/alerts';
import { Run, startRun } from '../core/run';

const runFile = new File(Paths.document, 'run.json');
const settingsFile = new File(Paths.document, 'alert-settings.json');

function readJson<T>(file: File): T | null {
  if (!file.exists) return null;
  try {
    return JSON.parse(file.textSync()) as T;
  } catch {
    return null;
  }
}

function writeJson(file: File, value: unknown): void {
  if (!file.exists) file.create();
  file.write(JSON.stringify(value));
}

/**
 * The race in progress, or null. Written by the GPS task, read by the screens.
 * A race stored by an older Paco lacks newer fields; an update in the middle
 * of a race must not break it, so missing fields get their starting values.
 */
export function readRun(): Run | null {
  const stored = readJson<Partial<Run> & Pick<Run, 'raceId' | 'startedAt'>>(runFile);
  if (stored === null) return null;
  const fresh = startRun(stored.raceId, stored.startedAt);
  return { ...fresh, ...stored, memory: { ...emptyMemory, ...stored.memory } };
}
export const writeRun = (run: Run): void => writeJson(runFile, run);
export const clearRun = (): void => {
  if (runFile.exists) runFile.delete();
};

export const readSettings = (): Settings => ({ ...defaultSettings, ...readJson<Partial<Settings>>(settingsFile) });
export const writeSettings = (settings: Settings): void => writeJson(settingsFile, settings);
