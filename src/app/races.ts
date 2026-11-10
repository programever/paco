import { Climb, climbs } from '../core/climbs';
import { Race, raceFromPlanFile } from '../core/race';

/** Every race in the app. To add one: put its JSON in races/ and list it here (see races/README.md). */
const bundled: { id: string; load: () => unknown }[] = [
  { id: 'la-mia-cung-cam', load: () => require('../../races/la-mia-cung-cam.json') },
  { id: 'hbs-ma-kieu-co-huong-la-ban', load: () => require('../../races/hbs-ma-kieu-co-huong-la-ban.json') },
  { id: 'hbs-thien-vien-la-ban', load: () => require('../../races/hbs-thien-vien-la-ban.json') },
  { id: 'hbs-di-da-son-ong-nuoc-la-ban', load: () => require('../../races/hbs-di-da-son-ong-nuoc-la-ban.json') },
  { id: 'hbs-suoi-da-5-ho-la-ban', load: () => require('../../races/hbs-suoi-da-5-ho-la-ban.json') },
];

export type LoadedRace = { readonly race: Race; readonly climbs: readonly Climb[] };

const cache = new Map<string, LoadedRace>();

export const raceIds = (): string[] => bundled.map((b) => b.id);

export function loadRace(id: string): LoadedRace | null {
  const cached = cache.get(id);
  if (cached !== undefined) return cached;
  const entry = bundled.find((b) => b.id === id);
  if (entry === undefined) return null;
  const race = raceFromPlanFile(id, entry.load());
  const loaded = { race, climbs: climbs(race.route) };
  cache.set(id, loaded);
  return loaded;
}
