import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { LoadedRace } from '../app/races';
import { bearing, compass, haversineKm } from '../core/geo';
import { checkpointLabel, clockText, cutoffMoment, nextAhead, nextWithCutoff } from '../core/race';
import { ascentBetweenM, descentBetweenM } from '../core/route';
import { Run } from '../core/run';
import { CourseMap } from './CourseMap';
import { Profile } from './Profile';
import { colors, durationText, kmText, metresText, timeText } from './theme';

type Tab = 'map' | 'profile' | 'checkpoints';

type Props = {
  loaded: LoadedRace;
  /** null before the start: the screen is a preview with a Start button. */
  run: Run | null;
  now: number;
  onBack: () => void;
  onStart: () => void;
  onStop: () => void;
};

export function RaceView({ loaded, run, now, onBack, onStart, onStop }: Props) {
  const { race, climbs } = loaded;
  const [tab, setTab] = useState<Tab>('map');
  const { width } = useWindowDimensions();
  const reached = run?.km ?? 0;
  const drawWidth = width - 40;

  const confirmStop = () =>
    Alert.alert('Stop the race?', 'GPS and alerts stop. Your progress is deleted.', [
      { text: 'Keep running', style: 'cancel' },
      { text: 'Stop', style: 'destructive', onPress: onStop },
    ]);

  return (
    <ScrollView contentContainerStyle={styles.page}>
      {run === null && (
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={styles.back}>‹ Races</Text>
        </Pressable>
      )}
      <Text style={styles.title}>{race.name}</Text>
      <Text style={styles.muted}>
        {kmText(race.route.totalKm)} · ↑ {metresText(race.route.totalAscentM)} · ↓ {metresText(race.route.totalDescentM)}
      </Text>

      {run !== null && <Status run={run} now={now} />}
      {run !== null && <NextCheckpoint loaded={loaded} run={run} now={now} />}

      <View style={styles.tabs}>
        {(['map', 'profile', 'checkpoints'] as const).map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} style={[styles.tab, tab === t && styles.tabOn]}>
            <Text style={tab === t ? styles.tabTextOn : styles.tabText}>
              {t === 'map' ? 'Map' : t === 'profile' ? 'Profile' : 'Checkpoints'}
            </Text>
          </Pressable>
        ))}
      </View>

      {tab === 'map' && (
        <View style={styles.box}>
          <CourseMap
            race={race}
            width={drawWidth}
            height={drawWidth}
            reachedKm={reached}
            runner={run?.lastFix?.at ?? null}
            wayBack={run?.routeState === 'off-route' ? (run.nearest?.snap ?? null) : null}
          />
        </View>
      )}
      {tab === 'profile' && (
        <View style={styles.box}>
          <Profile race={race} climbs={climbs} width={drawWidth} height={180} reachedKm={reached} />
          <Text style={styles.note}>Orange areas: steep climbs, where Paco says "Use the poles now".</Text>
        </View>
      )}
      {tab === 'checkpoints' && <Checkpoints loaded={loaded} run={run} />}

      {run === null ? (
        <Pressable style={styles.start} onPress={onStart}>
          <Text style={styles.startText}>Start</Text>
        </Pressable>
      ) : (
        <Pressable style={styles.stop} onPress={confirmStop}>
          <Text style={styles.stopText}>Stop the race</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

function Status({ run, now }: { run: Run; now: number }) {
  if (run.routeState === 'off-route' && run.nearest !== null && run.lastFix !== null) {
    const metres = Math.round(haversineKm(run.lastFix.at, run.nearest.snap) * 1000);
    const direction = compass(bearing(run.lastFix.at, run.nearest.snap));
    return (
      <View style={[styles.banner, styles.bannerDanger]}>
        <Text style={styles.bannerTitle}>You are off the course</Text>
        <Text style={styles.bannerText}>
          The course is {metres} m to the {direction}. The red line on the map shows the way back.
        </Text>
      </View>
    );
  }
  const age = run.lastFix === null ? null : now - run.lastFix.takenAt;
  const text =
    run.lastFix === null
      ? 'Waiting for GPS…'
      : `GPS ±${Math.round(run.lastFix.accuracyM)} m · updated ${age !== null && age < 60_000 ? 'just now' : `${durationText(age ?? 0)} ago`}`;
  return (
    <View style={styles.banner}>
      <Text style={styles.bannerText}>
        {text}
        {run.ambiguous ? ' · Two places on the course match: position kept.' : ''}
      </Text>
      <Text style={styles.bannerText}>Running for {durationText(now - run.startedAt)}</Text>
    </View>
  );
}

function NextCheckpoint({ loaded, run, now }: { loaded: LoadedRace; run: Run; now: number }) {
  const { race } = loaded;
  const next = nextAhead(race, run.km);
  if (next === undefined) {
    return (
      <View style={styles.next}>
        <Text style={styles.nextLabel}>Finished</Text>
        <Text style={styles.nextName}>Well done!</Text>
      </View>
    );
  }
  const deadline = nextWithCutoff(race, run.km);
  const closesAt = deadline === undefined ? null : cutoffMoment(race, run.startedAt, deadline);
  return (
    <View style={styles.next}>
      <Text style={styles.nextLabel}>Next checkpoint</Text>
      <Text style={styles.nextName}>{checkpointLabel(next)}</Text>
      <Text style={styles.nextBig}>{kmText(next.km - run.km)}</Text>
      <Text style={styles.nextFacts}>
        ↑ {metresText(ascentBetweenM(race.route, run.km, next.km))} · ↓ {metresText(descentBetweenM(race.route, run.km, next.km))}
      </Text>
      {deadline !== undefined && closesAt !== null && (
        <Text style={[styles.nextFacts, closesAt - now < 30 * 60_000 && styles.urgent]}>
          {deadline.id === next.id ? 'Closes' : `${checkpointLabel(deadline)} closes`} at {clockText(deadline.cutoff!)} · in{' '}
          {durationText(closesAt - now)}
        </Text>
      )}
      <Text style={styles.muted}>
        Done {kmText(run.km)} of {kmText(race.route.totalKm)}
      </Text>
    </View>
  );
}

function Checkpoints({ loaded, run }: { loaded: LoadedRace; run: Run | null }) {
  const { race } = loaded;
  const reached = run?.km ?? 0;
  return (
    <View style={styles.ledger}>
      {race.checkpoints.map((c) => {
        const passedAt = run?.passedAt[c.id];
        return (
          <View key={c.id} style={styles.row}>
            <Text style={styles.rowKm}>{c.km.toFixed(1)}</Text>
            <View style={styles.rowMain}>
              <Text style={[styles.rowName, passedAt !== undefined && styles.rowDone]}>{checkpointLabel(c)}</Text>
              <Text style={styles.rowFacts}>
                {passedAt !== undefined
                  ? `Passed at ${timeText(passedAt)}`
                  : `↑ ${metresText(ascentBetweenM(race.route, reached, c.km))} from here`}
                {' · '}
                {c.cutoff === null ? 'No COT' : `COT ${clockText(c.cutoff)}`}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: 20, paddingTop: 64, paddingBottom: 48, gap: 12, backgroundColor: colors.page },
  back: { fontSize: 17, color: colors.accent, fontWeight: '600' },
  title: { fontSize: 26, fontWeight: '800', color: colors.ink },
  muted: { fontSize: 15, color: colors.muted },
  banner: { padding: 12, borderRadius: 12, backgroundColor: colors.surface, gap: 4 },
  bannerDanger: { backgroundColor: colors.dangerSoft },
  bannerTitle: { fontSize: 18, fontWeight: '800', color: colors.danger },
  bannerText: { fontSize: 15, color: colors.ink },
  next: { padding: 16, borderRadius: 16, backgroundColor: colors.accentSoft, gap: 4 },
  nextLabel: { fontSize: 14, fontWeight: '600', color: colors.muted, textTransform: 'uppercase' },
  nextName: { fontSize: 20, fontWeight: '700', color: colors.ink },
  nextBig: { fontSize: 48, fontWeight: '800', color: colors.accent },
  nextFacts: { fontSize: 17, color: colors.ink },
  urgent: { color: colors.danger, fontWeight: '700' },
  tabs: { flexDirection: 'row', gap: 8, marginTop: 4 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: colors.surface, alignItems: 'center' },
  tabOn: { backgroundColor: colors.ink },
  tabText: { fontSize: 15, color: colors.ink },
  tabTextOn: { fontSize: 15, color: colors.page, fontWeight: '700' },
  box: { borderRadius: 14, backgroundColor: colors.page, borderWidth: 1, borderColor: colors.line, padding: 0, gap: 6 },
  note: { fontSize: 13, color: colors.muted, padding: 10 },
  ledger: { gap: 2 },
  row: { flexDirection: 'row', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.line },
  rowKm: { width: 44, fontSize: 16, fontWeight: '700', color: colors.ink, textAlign: 'right' },
  rowMain: { flex: 1, gap: 2 },
  rowName: { fontSize: 16, color: colors.ink },
  rowDone: { color: colors.muted, textDecorationLine: 'line-through' },
  rowFacts: { fontSize: 14, color: colors.muted },
  start: { marginTop: 8, padding: 18, borderRadius: 14, backgroundColor: colors.accent, alignItems: 'center' },
  startText: { fontSize: 20, fontWeight: '800', color: colors.page },
  stop: { marginTop: 8, padding: 16, borderRadius: 14, borderWidth: 2, borderColor: colors.danger, alignItems: 'center' },
  stopText: { fontSize: 17, fontWeight: '700', color: colors.danger },
});
