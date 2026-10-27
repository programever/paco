export const colors = {
  ink: '#1c1c1e',
  muted: '#6b6b70',
  line: '#e3e3e6',
  surface: '#f4f4f6',
  page: '#ffffff',
  accent: '#E8590C',
  accentSoft: '#fde8dc',
  done: '#b9b9bf',
  danger: '#c92a2a',
  dangerSoft: '#fde2e2',
  good: '#2b8a3e',
};

export const kmText = (value: number): string => `${value.toFixed(1)} km`;

export const metresText = (value: number): string => `${Math.round(value)} m`;

export function durationText(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours === 0 ? `${minutes} min` : `${hours} h ${String(minutes).padStart(2, '0')}`;
}

export const timeText = (at: number): string =>
  new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
