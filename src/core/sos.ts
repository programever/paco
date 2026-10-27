import { coordinateText } from './geo';
import { Fix } from './position';

/**
 * The text a lost runner sends. Vietnamese without accents: it is read by the
 * organiser or family, and plain letters keep the SMS short enough to go out
 * on one bar of signal. It carries the accuracy, so whoever searches knows
 * what radius to sweep.
 */
export function helpMessage(fix: Fix, nearestKm: number | null): string {
  const when = new Date(fix.takenAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${pad(when.getDate())}/${pad(when.getMonth() + 1)}/${when.getFullYear()} ${pad(when.getHours())}:${pad(when.getMinutes())}`;
  return [
    'Toi bi lac va hien o vi tri',
    coordinateText(fix.at),
    'vao luc',
    `${stamp}.`,
    nearestKm === null ? '' : `Diem gan nhat tren duong chay la km ${nearestKm.toFixed(1)}.`,
    `Sai so GPS ${Math.round(fix.accuracyM)} m.`,
    `Ban do: https://maps.google.com/?q=${coordinateText(fix.at).replace(', ', ',')}`,
  ]
    .filter((part) => part !== '')
    .join(' ');
}
