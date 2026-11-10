import { describe, expect, it } from 'vitest';

import { delivered, isStale, staleAfterMs, stops } from '../src/crew/follow';
import { crewLink, keyLength, randomId, readCrewLink } from '../src/crew/protocol';
import { chatFields, liveFields } from '../src/crew/rest';
import { eastward, race } from './fixtures';

const minute = 60_000;

describe('crew records', () => {
  it('sends whole-number times as integers, as the rules ask', () => {
    const fields = chatFields({ id: 'a', from: 'runner', text: 'need water', t: 1234.6, at: '' });
    expect(fields).toEqual({ from: { stringValue: 'runner' }, text: { stringValue: 'need water' }, t: { integerValue: '1235' } });
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

  it('lists the checkpoints after the start, passed once the runner is beyond them', () => {
    const [cp1, finish] = stops(r, 5);
    expect(cp1.name).toBe('CP1');
    expect(cp1.passed).toBe(true);
    expect(finish.passed).toBe(false);
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
