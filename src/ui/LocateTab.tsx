import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Climb } from '../core/climbs';
import { bearing, compass, haversineKm, project } from '../core/geo';
import { acceptableAccuracyM } from '../core/position';
import { Race } from '../core/race';
import { atKm } from '../core/route';
import { Run } from '../core/run';
import { CourseMap, fitAll, fitTo, MapView, You } from './CourseMap';
import { Profile } from './Profile';
import { colors, compassArrow, kmOrMetres, kmValue, mono } from './theme';
import { WayArrow } from './WayArrow';

type Props = {
  race: Race;
  climbs: readonly Climb[];
  run: Run | null;
  view: MapView;
  onView: (view: MapView) => void;
  aheadText: string;
  onAheadText: (text: string) => void;
  cursorKm: number | null;
  onCursor: (km: number | null) => void;
  onDragging: (dragging: boolean) => void;
};

const defaultAheadM = 500;

/** Blank or nonsense falls back to the default, so clearing the box to retype does not blank the arrows. */
export function aheadKmOf(text: string): number {
  const metres = Number.parseInt(text.trim(), 10);
  return (Number.isFinite(metres) && metres >= 0 ? metres : defaultAheadM) / 1000;
}

export function LocateTab(props: Props) {
  const { race, run } = props;
  const reached = run?.km ?? 0;
  const lost = run?.routeState === 'off-route' && run.memory.joined;
  const you: You =
    run?.declared === true
      ? { kind: 'declared' }
      : run?.latestFix == null
        ? { kind: 'none' }
        : { kind: 'measured', at: run.latestFix.at, accuracyM: run.latestFix.accuracyM };
  const me = () => {
    props.onCursor(null);
    props.onView(fitTo(you.kind === 'measured' ? project(race.route.projection, you.at) : atKm(race.route, reached).plane));
  };

  return (
    <View>
      {run !== null && <Guide run={run} />}
      <View style={styles.mapCard}>
        <CourseMap
          race={race}
          view={props.view}
          onView={props.onView}
          reachedKm={reached}
          aheadKm={aheadKmOf(props.aheadText)}
          you={you}
          lost={lost}
          uncertain={run?.routeState === 'uncertain'}
          wayBack={lost ? (run?.nearest?.snap ?? null) : null}
          cursorKm={props.cursorKm}
          breadcrumbs={run?.breadcrumbs ?? []}
          onDragging={props.onDragging}
        />
        <View style={styles.mapFoot}>
          <View style={styles.ahead}>
            <Text style={styles.label}>Arrows ahead (m)</Text>
            <TextInput
              style={styles.input}
              value={props.aheadText}
              onChangeText={props.onAheadText}
              keyboardType="number-pad"
              returnKeyType="done"
            />
          </View>
          <MiniButton label="My position" onPress={me} />
          <MiniButton label="Full route" onPress={() => props.onView(fitAll(race.route))} />
        </View>
      </View>
      <Profile race={race} climbs={props.climbs} reachedKm={reached} cursorKm={props.cursorKm} onCursor={props.onCursor} onDragging={props.onDragging} />
    </View>
  );
}

/** Where the runner stands relative to the route. Facts only. */
function Guide({ run }: { run: Run }) {
  const fix = run.latestFix;
  if (fix === null || run.nearest === null || run.routeState === null) {
    return (
      <View style={styles.guide}>
        <Text style={styles.head}>{run.declared ? `KM ${kmValue(run.km)} · ENTERED` : 'WAITING FOR GPS'}</Text>
      </View>
    );
  }
  const deviationM = Math.round(run.nearest.deviationM);
  const gps = `GPS ±${Math.round(fix.accuracyM)} m`;
  const weak = fix.accuracyM > acceptableAccuracyM ? <Text style={styles.reject}>{gps} · km not updated</Text> : null;

  if (!run.memory.joined && run.routeState !== 'on-route') {
    const away = haversineKm(fix.at, run.nearest.snap);
    const heading = bearing(fix.at, run.nearest.snap);
    return (
      <View style={styles.guide}>
        <Text style={styles.head}>NOT ON THE ROUTE YET</Text>
        <WayArrow bearing={heading} fallback={compassArrow[compass(heading)]} />
        <Text style={styles.distance}>{kmOrMetres(away)}</Text>
        <Text style={styles.detail}>
          {kmOrMetres(away)} {compass(bearing(fix.at, run.nearest.snap))} · nearest at km {kmValue(run.nearest.km)}
        </Text>
      </View>
    );
  }

  switch (run.routeState) {
    case 'on-route':
      return (
        <View style={[styles.guide, styles.onRoute]}>
          <Text style={[styles.head, styles.okText]}>ON THE ROUTE</Text>
          <Text style={styles.detail}>
            km {kmValue(run.km)} · {deviationM} m from the line · {gps}
          </Text>
          {weak}
        </View>
      );
    case 'uncertain':
      return (
        <View style={[styles.guide, styles.unsure]}>
          <Text style={[styles.head, styles.warnText]}>NOT SURE</Text>
          <Text style={styles.detail}>
            {deviationM} m from the line · {gps}
          </Text>
          {weak}
        </View>
      );
    case 'off-route': {
      const heading = bearing(fix.at, run.nearest.snap);
      const direction = compass(heading);
      const behind = run.nearest.km < run.km;
      return (
        <View style={[styles.guide, styles.offRoute]}>
          <Text style={[styles.head, styles.lateText]}>OFF THE ROUTE · {deviationM} M</Text>
          <WayArrow bearing={heading} fallback={compassArrow[direction]} />
          <Text style={styles.distance}>{deviationM} m</Text>
          <Text style={styles.detail}>
            {direction} {heading}° · {deviationM} m · back at km {kmValue(run.nearest.km)}
            {behind ? ' (already run)' : ''}
          </Text>
          {weak}
        </View>
      );
    }
  }
}

function MiniButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.mini, pressed && styles.pressed]} onPress={onPress}>
      <Text style={styles.miniText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  guide: { marginTop: 14, borderRadius: 14, paddingVertical: 15, paddingHorizontal: 16, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.ink2 },
  onRoute: { borderColor: 'rgba(53,208,165,.5)', backgroundColor: 'rgba(53,208,165,.1)' },
  unsure: { borderColor: colors.warn, backgroundColor: 'rgba(255,197,61,.1)' },
  offRoute: { borderColor: colors.late, backgroundColor: 'rgba(255,92,108,.12)' },
  head: { fontFamily: mono, fontSize: 13.5, fontWeight: '800', letterSpacing: 0.5, color: colors.paper },
  okText: { color: colors.ok },
  warnText: { color: colors.warn },
  lateText: { color: colors.late },
  distance: { fontFamily: mono, fontSize: 28, fontWeight: '800', textAlign: 'center', color: colors.paper },
  detail: { fontSize: 13.5, color: colors.paper, marginTop: 4, lineHeight: 19 },
  reject: { marginTop: 10, fontSize: 13.5, fontWeight: '600', color: colors.late },
  mapCard: { marginTop: 14, backgroundColor: colors.ink2, borderWidth: 1, borderColor: colors.line, borderRadius: 14, overflow: 'hidden' },
  mapFoot: { flexDirection: 'row', gap: 8, padding: 10, paddingHorizontal: 12, borderTopWidth: 1, borderTopColor: colors.line, alignItems: 'flex-end' },
  ahead: { flex: 1, minWidth: 0 },
  label: { fontSize: 10.5, color: colors.muted, marginBottom: 3 },
  input: {
    backgroundColor: colors.ink,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 9,
    color: colors.paper,
    fontFamily: mono,
    fontSize: 14,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  mini: { minHeight: 38, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 9, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.ink3, justifyContent: 'center' },
  miniText: { fontFamily: mono, fontSize: 12, fontWeight: '700', color: colors.paper },
  pressed: { transform: [{ translateY: 1 }] },
});
