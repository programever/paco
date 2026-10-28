import { describe, expect, it } from 'vitest';

import { arrivals, delivered, isStale, latestStatus, paceMsPerKm, staleAfterMs } from '../src/crew/follow';
import { crewLink, keyLength, randomId, readCrewLink, Tap } from '../src/crew/protocol';
import { liveFields, tapFields } from '../src/crew/rest';
import { eastward, race } from './fixtures';

const minute = 60_000;
const tap = (kind: Tap['kind'], t: number, msg = ''): Tap => ({ id: `${kind}${t}`, kind, items: [], msg, t });

describe('crew records', () => {
  it('sends whole-number times as integers, as the rules ask', () => {
    const fields = tapFields({ id: 'a', kind: 'need', items: ['water', 'gel'], msg: '', t: 1234.6 });
    expect(fields.t).toEqual({ integerValue: '1235' });
    expect(fields.items).toEqual({ arrayValue: { values: [{ stringValue: 'water' }, { stringValue: 'gel' }] } });
  });

  it('leaves the position out until there is a fix', () => {
    const base = { race: 'r', state: 'running' as const, start: 0, km: 0, got: '' };
    expect(Object.keys(liveFields(base)).sort()).toEqual(['got', 'km', 'race', 'start', 'state']);
    const fixed = liveFields({ ...base, lat: 10.5, lon: 107, acc: Infinity, fix: 5 });
    expect(fixed.acc).toEqual({ doubleValue: 99_999 });
  });

  it('carries the Pushover codes in the link and reads both link forms', () => {
    const pushover = { token: 'a'.repeat(30), user: 'u'.repeat(30) };
    const link = crewLink('k'.repeat(24), pushover);
    expect(readCrewLink(new URL(link).hash)).toEqual({ key: 'k'.repeat(24), pushover });
    expect(readCrewLink('#' + 'k'.repeat(24))).toEqual({ key: 'k'.repeat(24), pushover: null });
  });

  it('makes keys the rules accept', () => {
    const key = randomId(keyLength);
    expect(key).toMatch(/^[a-z0-9]{24}$/);
  });
});

describe('crew page', () => {
  const route = eastward(10_000);
  const r = race(route, [{ name: 'CP1', km: 4, cutoff: '08:00' }]);
  const start = new Date(2026, 10, 1, 6, 0).getTime();

  it('guesses arrivals from the pace so far and sets them against the cutoff', () => {
    // 2 km in 20 minutes: 10 min/km, so CP1 (2 km on) is 20 minutes later.
    const at = start + 20 * minute;
    const [cp1, finish] = arrivals(r, start, 2, at);
    expect(cp1.eta).toBe(at + 20 * minute);
    expect(cp1.cutoff).toBe(new Date(2026, 10, 1, 8, 0).getTime());
    expect(cp1.marginMs).toBe(80 * minute);
    expect(finish.marginMs).toBeNull();
  });

  it('has no guess before the runner is properly under way', () => {
    expect(paceMsPerKm(start, 0.2, start + 5 * minute)).toBeNull();
    expect(arrivals(r, start, 0.2, start + 5 * minute)[0].eta).toBeNull();
  });

  it('marks checkpoints behind the runner as passed', () => {
    const [cp1] = arrivals(r, start, 5, start + 50 * minute);
    expect(cp1.passed).toBe(true);
    expect(cp1.eta).toBeNull();
  });

  it('takes the newest status and ignores "got it"', () => {
    expect(latestStatus([tap('injured', 2), tap('ok', 1), tap('seen', 3, 'm')])?.kind).toBe('injured');
  });

  it('rings after 30 minutes without news', () => {
    expect(isStale(0, staleAfterMs - 1)).toBe(false);
    expect(isStale(0, staleAfterMs)).toBe(true);
  });

  it('counts a message delivered once the phone has one at least as new', () => {
    const got = '2026-11-01T01:00:00.123456Z';
    expect(delivered(Date.parse('2026-11-01T01:00:00.123Z'), got)).toBe(true);
    expect(delivered(Date.parse('2026-11-01T01:00:01Z'), got)).toBe(false);
    expect(delivered(0, '')).toBe(false);
  });
});
