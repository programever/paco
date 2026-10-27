import Svg, { Line, Path, Rect } from 'react-native-svg';

import { Climb } from '../core/climbs';
import { Race } from '../core/race';
import { elevationRangeM } from '../core/route';
import { colors } from './theme';

type Props = { race: Race; climbs: readonly Climb[]; width: number; height: number; reachedKm: number };

/** Height along the course. Steep climbs (where Paco says "use the poles") are shaded. */
export function Profile({ race, climbs, width, height, reachedKm }: Props) {
  const { route } = race;
  const { low, high } = elevationRangeM(route);
  const x = (km: number) => (km / route.totalKm) * width;
  const y = (m: number) => height - 6 - ((m - low) / (high - low)) * (height - 12);
  const outline = route.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.km)},${y(p.elevationM)}`).join(' ');
  const area = `${outline} L${width},${height} L0,${height} Z`;

  return (
    <Svg width={width} height={height}>
      {climbs.map((c, i) => (
        <Rect key={i} x={x(c.startKm)} y={0} width={x(c.endKm) - x(c.startKm)} height={height} fill={colors.accentSoft} />
      ))}
      <Path d={area} fill={colors.surface} />
      <Path d={outline} fill="none" stroke={colors.ink} strokeWidth={2} />
      {race.checkpoints.map((c) => (
        <Line key={c.id} x1={x(c.km)} y1={0} x2={x(c.km)} y2={height} stroke={colors.muted} strokeWidth={1} strokeDasharray="3,3" />
      ))}
      <Line x1={x(reachedKm)} y1={0} x2={x(reachedKm)} y2={height} stroke={colors.accent} strokeWidth={3} />
    </Svg>
  );
}
