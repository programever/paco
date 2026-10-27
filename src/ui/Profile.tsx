import { useMemo, useRef } from 'react';
import { PanResponder, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

import { Climb } from '../core/climbs';
import { Checkpoint, checkpointLabel, Race } from '../core/race';
import { atKm, elevationRangeM, Route } from '../core/route';
import { colors, kmValue, mono, stationColour } from './theme';

const width = 320;
const height = 96;
const padding = 6;

/** More points than this are invisible on a phone and cost redraws under a moving finger. */
const samples = 160;

type Props = {
  race: Race;
  climbs: readonly Climb[];
  reachedKm: number;
  cursorKm: number | null;
  onCursor: (km: number | null) => void;
};

/** The course side on. Dragging a finger moves a cursor here and on the map. */
export function Profile({ race, climbs, reachedKm, cursorKm, onCursor }: Props) {
  const { route } = race;
  const { low, high } = elevationRangeM(route);
  const total = Math.max(0.001, route.totalKm);
  const x = (km: number) => (km / total) * width;
  const y = (m: number) => height - padding - ((m - low) / (high - low)) * (height - padding * 2);
  const outline = useMemo(
    () =>
      Array.from({ length: samples + 1 }, (_, step) => atKm(route, (total * step) / samples))
        .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.km).toFixed(1)} ${y(p.elevationM).toFixed(1)}`)
        .join(' '),
    [route],
  );
  const scrub = useScrub(route, onCursor);
  const ticks = ticksOf(race.checkpoints);

  return (
    <View style={styles.card}>
      <View {...scrub.panHandlers} onLayout={(e) => scrub.setWidth(e.nativeEvent.layout.width)}>
        <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
          {climbs.map((c, i) => (
            <Rect key={i} x={x(c.startKm)} y={0} width={x(c.endKm) - x(c.startKm)} height={height} fill="rgba(255,122,47,.12)" />
          ))}
          <Path d={`${outline} L${width} ${height} L0 ${height} Z`} fill="rgba(255,122,47,.16)" />
          <Path d={outline} fill="none" stroke={colors.route} strokeWidth={1.6} />
          {ticks.map(({ colour, checkpoint }) => (
            <Line
              key={checkpoint.id}
              x1={x(checkpoint.km)}
              y1={0}
              x2={x(checkpoint.km)}
              y2={height}
              stroke={colour}
              strokeWidth={1}
              strokeDasharray="3 3"
              opacity={0.6}
            />
          ))}
          <Marker x={x(reachedKm)} y={y(atKm(route, reachedKm).elevationM)} colour={colors.paper} radius={4.5} />
          {cursorKm !== null && <Marker x={x(cursorKm)} y={y(atKm(route, cursorKm).elevationM)} colour={colors.scrub} radius={5} />}
        </Svg>
      </View>
      <View style={styles.legend}>
        <Text style={styles.small}>Start</Text>
        <Text style={styles.small}>You at km {kmValue(reachedKm)}</Text>
        <Text style={styles.small}>Finish km {kmValue(route.totalKm)}</Text>
      </View>
      <View style={styles.captions}>
        {ticks.map(({ colour, checkpoint }) => (
          <View key={checkpoint.id} style={styles.caption}>
            <View style={[styles.dot, { backgroundColor: colour }]} />
            <Text style={styles.small}>
              {checkpointLabel(checkpoint)} · km {kmValue(checkpoint.km)}
            </Text>
          </View>
        ))}
      </View>
      <Text style={[styles.readout, cursorKm !== null && styles.readoutLive]}>
        {cursorKm === null ? 'Touch and drag on the chart to see the slope ahead. Light orange: steep climbs, where Paco says "Use the poles now".' : readout(route, cursorKm)}
      </Text>
    </View>
  );
}

function Marker({ x, y, colour, radius }: { x: number; y: number; colour: string; radius: number }) {
  return (
    <>
      <Line x1={x} y1={0} x2={x} y2={height} stroke={colour} strokeWidth={1.3} />
      <Circle cx={x} cy={y} r={radius} fill={colour} stroke={colors.ink} strokeWidth={1.5} />
    </>
  );
}

/** What the cursor points at, and what is left from there to the finish. */
function readout(route: Route, km: number): string {
  const point = atKm(route, km);
  const finish = atKm(route, route.totalKm);
  return (
    `km ${kmValue(km)} · height ${Math.round(point.elevationM)} m · from the start up ${Math.round(point.ascentSoFarM)} m, ` +
    `down ${Math.round(point.descentSoFarM)} m · ${kmValue(route.totalKm - km)} km to the finish, ` +
    `up ${Math.round(finish.ascentSoFarM - point.ascentSoFarM)} m, down ${Math.round(finish.descentSoFarM - point.descentSoFarM)} m`
  );
}

/**
 * Every checkpoint the chart marks, with its colour. Not the start: it is the
 * chart's left edge. Stations cycle through the hues; the finish has its own.
 */
export function ticksOf(checkpoints: readonly Checkpoint[]): { colour: string; checkpoint: Checkpoint }[] {
  let taken = 0;
  return checkpoints
    .filter((c) => c.role !== 'start')
    .map((checkpoint) => ({ colour: checkpoint.role === 'finish' ? colors.finish : stationColour(taken++), checkpoint }));
}

function useScrub(route: Route, onCursor: (km: number | null) => void) {
  const width = useRef(320);
  const latest = useRef(onCursor);
  latest.current = onCursor;
  const at = (x: number) => Math.min(1, Math.max(0, x / Math.max(1, width.current))) * route.totalKm;
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => latest.current(at(e.nativeEvent.locationX)),
        onPanResponderMove: (e) => latest.current(at(e.nativeEvent.locationX)),
      }),
    [route],
  );
  return { panHandlers: responder.panHandlers, setWidth: (w: number) => (width.current = w) };
}

const styles = StyleSheet.create({
  card: {
    marginTop: 14,
    backgroundColor: colors.ink2,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    padding: 12,
    paddingBottom: 8,
  },
  legend: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  captions: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 4, marginTop: 6 },
  caption: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  small: { fontFamily: mono, fontSize: 10.5, color: colors.muted },
  readout: { fontFamily: mono, fontSize: 11.5, color: colors.muted, marginTop: 6, lineHeight: 16 },
  readoutLive: { color: colors.warn },
});
