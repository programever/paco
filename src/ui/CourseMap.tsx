import { useMemo } from 'react';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';

import { LatLon, Plane, project } from '../core/geo';
import { Race } from '../core/race';
import { atKm, Point, slice } from '../core/route';
import { colors } from './theme';

type Props = {
  race: Race;
  width: number;
  height: number;
  /** The runner's milestone: the course behind it is grey, ahead is orange. */
  reachedKm: number;
  runner: LatLon | null;
  /** When off the course: the nearest point on the course, to draw the way back. */
  wayBack: LatLon | null;
};

const padding = 14;

/** The course drawn from the GPX alone: no map tiles, no network. North is up. */
export function CourseMap({ race, width, height, reachedKm, runner, wayBack }: Props) {
  const { route } = race;
  const toScreen = useMemo(() => fit(route.points.map((p) => p.plane), width, height), [route, width, height]);
  const screenOf = (position: LatLon) => toScreen(project(route.projection, position));
  const line = (points: Point[]) => points.map((p) => toScreen(p.plane)).map((s) => `${s.x},${s.y}`).join(' ');
  const done = line(slice(route, 0, reachedKm));
  const ahead = line(slice(route, reachedKm, route.totalKm));
  const here = runner === null ? null : screenOf(runner);
  const back = wayBack === null ? null : screenOf(wayBack);

  return (
    <Svg width={width} height={height}>
      <Polyline points={done} fill="none" stroke={colors.done} strokeWidth={4} strokeLinejoin="round" />
      <Polyline points={ahead} fill="none" stroke={colors.accent} strokeWidth={4} strokeLinejoin="round" />
      {race.checkpoints.map((c) => {
        const s = toScreen(atKm(route, c.km).plane);
        return <Circle key={c.id} cx={s.x} cy={s.y} r={6} fill={colors.page} stroke={colors.ink} strokeWidth={2} />;
      })}
      {here !== null && back !== null && (
        <Line x1={here.x} y1={here.y} x2={back.x} y2={back.y} stroke={colors.danger} strokeWidth={3} strokeDasharray="6,4" />
      )}
      {here !== null && <Circle cx={here.x} cy={here.y} r={8} fill="#1971c2" stroke={colors.page} strokeWidth={3} />}
    </Svg>
  );
}

/** Scales the course to fill the box, keeping its shape. */
function fit(planes: Plane[], width: number, height: number): (p: Plane) => { x: number; y: number } {
  const xs = planes.map((p) => p.x);
  const ys = planes.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const spanX = Math.max(Math.max(...xs) - minX, 0.001);
  const spanY = Math.max(Math.max(...ys) - minY, 0.001);
  const scale = Math.min((width - 2 * padding) / spanX, (height - 2 * padding) / spanY);
  const offsetX = (width - spanX * scale) / 2;
  const offsetY = (height - spanY * scale) / 2;
  return (p) => ({ x: offsetX + (p.x - minX) * scale, y: offsetY + (p.y - minY) * scale });
}
