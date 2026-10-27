/** easy-pacer's palette and type, so Paco reads the same at a glance. */
export const colors = {
  ink: '#101823',
  ink2: '#18222F',
  ink3: '#22303F',
  mapGround: '#0C131C',
  line: '#2E3F52',
  paper: '#EEF3F7',
  muted: '#8DA1B4',
  tape: '#FF7A2F',
  tapeDim: '#B4521C',
  onTape: '#1A0C03',
  ok: '#35D0A5',
  warn: '#FFC53D',
  late: '#FF5C6C',
  route: '#FF7A2F',
  passed: '#5A6B7D',
  checkpoint: '#6EC1FF',
  you: '#35D0A5',
  uncertain: '#FFC53D',
  lost: '#FF5C6C',
  scrub: '#FFC53D',
  finish: '#A8B8C8',
};

/**
 * Hues for the station ticks on the profile, repeating after five. Not orange
 * (the route) and not yellow (the finger cursor), so a tick is never mistaken
 * for either while dragging.
 */
const stationHues = ['#FF4D4D', '#3DD65C', '#3D8BFF', '#B44DFF', '#00D9E8'];
export const stationColour = (index: number): string => stationHues[index % stationHues.length];

export const mono = 'Menlo';

/** One decimal: a runner glancing at a station does not want three. */
export const kmValue = (value: number): string => (Math.round(value * 10) / 10).toFixed(1);

export const kmOrMetres = (km: number): string => (km >= 1 ? `${kmValue(km)} km` : `${Math.round(km * 1000)} m`);

/** "2h10", "45m"; a negative duration (a cutoff behind) is signed. */
export function compactDuration(ms: number): string {
  const sign = ms < 0 ? '−' : '';
  const totalMinutes = Math.floor(Math.abs(ms) / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours === 0 ? `${sign}${minutes}m` : `${sign}${hours}h${String(minutes).padStart(2, '0')}`;
}

/** A margin that is a fact, not a countdown: always signed. */
export const signedDuration = (ms: number): string => (ms >= 0 ? `+${compactDuration(ms)}` : compactDuration(ms));

export function longDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours === 0 ? `${minutes} min` : `${hours} h ${String(minutes).padStart(2, '0')} min`;
}

export const clockOf = (at: number): string => {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export const compassArrow: Record<string, string> = {
  north: '↑',
  'north-east': '↗',
  east: '→',
  'south-east': '↘',
  south: '↓',
  'south-west': '↙',
  west: '←',
  'north-west': '↖',
};
