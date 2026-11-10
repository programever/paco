import { useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { LoadedRace } from '../app/races';
import { Run } from '../core/run';
import { fitAll, MapView } from './CourseMap';
import { CrewCompose, CrewTab } from './CrewTab';
import { LocateTab } from './LocateTab';
import { PlanTab } from './PlanTab';
import { colors, kmValue, longDuration, mono } from './theme';

type Tab = 'plan' | 'locate' | 'crew';

type Props = {
  loaded: LoadedRace;
  /** null before the start: the same screen, as a preview, with a Start button. */
  run: Run | null;
  now: number;
  onBack: () => void;
  onStart: () => void;
  onEnd: () => void;
  onDeclareKm: (km: number) => void;
};

export function RaceView({ loaded, run, now, onBack, onStart, onEnd, onDeclareKm }: Props) {
  const { race, climbs } = loaded;
  const [tab, setTab] = useState<Tab>('plan');
  const [view, setView] = useState<MapView>(() => fitAll(race.route));
  const [aheadText, setAheadText] = useState('500');
  const [cursorKm, setCursorKm] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const page = useRef<ScrollView>(null);
  const [sent, setSent] = useState(0);

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView style={styles.screen} behavior="padding">
        <Header onBack={run === null ? onBack : null} />
        {run !== null && <Status run={run} now={now} />}
        <View style={styles.top}>
          <Text style={styles.raceName}>{race.name}</Text>
          <Text style={styles.raceFacts}>
            {kmValue(race.route.totalKm)} km · ↑{Math.round(race.route.totalAscentM)} m · ↓{Math.round(race.route.totalDescentM)} m
          </Text>
          <View style={styles.tabs}>
            <TabButton label="Plan" on={tab === 'plan'} onPress={() => setTab('plan')} />
            <TabButton label="Locate" on={tab === 'locate'} onPress={() => setTab('locate')} />
            <TabButton label="Crew" on={tab === 'crew'} onPress={() => setTab('crew')} />
          </View>
        </View>
        <ScrollView
          ref={page}
          style={styles.scroll}
          contentContainerStyle={styles.page}
          keyboardShouldPersistTaps="handled"
          scrollEnabled={!dragging}
          // The chat reads bottom up, like any messenger: keep the newest message and the box in view.
          onContentSizeChange={() => tab === 'crew' && page.current?.scrollToEnd({ animated: false })}
        >
          {tab === 'plan' ? (
            <PlanTab race={race} reachedKm={run?.km ?? 0} startedAt={run?.startedAt ?? race.startsAt} passedAt={run?.passedAt ?? {}} now={now} />
          ) : tab === 'crew' ? (
            <CrewTab run={run} now={now} sent={sent} />
          ) : (
            <LocateTab
              race={race}
              climbs={climbs}
              run={run}
              view={view}
              onView={setView}
              aheadText={aheadText}
              onAheadText={setAheadText}
              cursorKm={cursorKm}
              onCursor={setCursorKm}
              onDragging={setDragging}
            />
          )}
        </ScrollView>
        {/* Always on screen: the runner never scrolls to find Start, Enter km, End, or the chat box. */}
        <View style={styles.dock}>
          {run === null ? (
            <BigButton label="Start" solid onPress={onStart} />
          ) : tab === 'crew' ? (
            <CrewCompose onSent={() => setSent((n) => n + 1)} />
          ) : (
            <Dock onDeclareKm={onDeclareKm} onEnd={() => confirmEnd(onEnd)} />
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function confirmEnd(onEnd: () => void) {
  Alert.alert('End the race?', 'GPS and the alerts stop, and this race is cleared.', [
    { text: 'Keep running', style: 'cancel' },
    { text: 'End', style: 'destructive', onPress: onEnd },
  ]);
}

function Header({ onBack }: { onBack: (() => void) | null }) {
  return (
    <View style={styles.bar}>
      <View style={styles.brand}>
        {onBack !== null && (
          <Pressable onPress={onBack} hitSlop={12} style={styles.back}>
            <Text style={styles.backText}>‹ Races</Text>
          </Pressable>
        )}
        <Text style={styles.mark}>
          PA<Text style={styles.markTape}>CO</Text>
        </Text>
      </View>
    </View>
  );
}

/** Where the runner is and how old that is, big enough to read at a glance. */
function Status({ run, now }: { run: Run; now: number }) {
  const age = now - (run.latestFix?.takenAt ?? run.startedAt);
  return (
    <View style={styles.status}>
      <Text style={styles.statusKm}>km {kmValue(run.km)}</Text>
      <Text style={[styles.statusGps, age > 10 * 60_000 && styles.stale]}>
        {age < 60_000 ? 'GPS just now' : `GPS ${longDuration(age)} ago`}
      </Text>
    </View>
  );
}

/** The backup when GPS cannot be trusted: the runner reads the km off a marker and types it. */
function Dock({ onDeclareKm, onEnd }: { onDeclareKm: (km: number) => void; onEnd: () => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const submit = () => {
    const value = Number.parseFloat(text.replace(',', '.'));
    if (!Number.isFinite(value) || value < 0) {
      Alert.alert('Enter a valid km', 'For example 12.5');
      return;
    }
    onDeclareKm(value);
    setOpen(false);
    setText('');
  };
  return (
    <>
      {open && (
        <View style={styles.kmEntry}>
          <TextInput
            style={[styles.input, styles.kmInput]}
            placeholder="Your km now"
            placeholderTextColor={colors.muted}
            keyboardType="decimal-pad"
            value={text}
            onChangeText={setText}
            autoFocus
          />
          <Pressable style={styles.update} onPress={submit}>
            <Text style={styles.updateText}>Update</Text>
          </Pressable>
        </View>
      )}
      <View style={styles.dockRow}>
        <View style={styles.dockMain}>
          <BigButton label={open ? 'Close' : 'Enter km'} onPress={() => setOpen(!open)} />
        </View>
        <QuietButton label="End" onPress={onEnd} />
      </View>
    </>
  );
}

function TabButton({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.tab, on && styles.tabOn]} onPress={onPress}>
      <Text style={[styles.tabText, on && styles.tabTextOn]}>{label.toUpperCase()}</Text>
    </Pressable>
  );
}

function BigButton({ label, onPress, solid }: { label: string; onPress: () => void; solid?: boolean }) {
  return (
    <Pressable style={({ pressed }) => [styles.big, solid && styles.solid, pressed && styles.pressed]} onPress={onPress}>
      <Text style={[styles.bigText, solid && styles.solidText]}>{label}</Text>
    </Pressable>
  );
}

function QuietButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.quiet, pressed && styles.pressed]} onPress={onPress}>
      <Text style={styles.quietText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    backgroundColor: colors.ink,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  back: { borderWidth: 1, borderColor: colors.line, borderRadius: 7, paddingVertical: 3, paddingHorizontal: 8 },
  backText: { fontFamily: mono, fontSize: 11, color: colors.muted },
  mark: { fontFamily: mono, fontSize: 15, fontWeight: '700', letterSpacing: 1, color: colors.paper },
  markTape: { color: colors.tape },
  status: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    backgroundColor: colors.ink2,
  },
  statusKm: { fontFamily: mono, fontSize: 20, fontWeight: '800', color: colors.paper },
  statusGps: { fontFamily: mono, fontSize: 14, fontWeight: '600', color: colors.muted },
  stale: { color: colors.warn },
  top: { paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.line },
  scroll: { flex: 1 },
  page: { paddingHorizontal: 16, paddingBottom: 24 },
  raceName: { fontSize: 17, fontWeight: '700', color: colors.paper, marginTop: 12 },
  raceFacts: { fontFamily: mono, fontSize: 12, color: colors.muted, marginTop: 2 },
  tabs: { flexDirection: 'row', gap: 6, marginTop: 12 },
  tab: { flex: 1, minHeight: 44, borderRadius: 11, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.ink2, alignItems: 'center', justifyContent: 'center' },
  tabOn: { backgroundColor: colors.tape, borderColor: colors.tape },
  tabText: { fontFamily: mono, fontSize: 13, fontWeight: '700', letterSpacing: 1, color: colors.muted },
  tabTextOn: { color: colors.onTape },
  dock: { gap: 10, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.ink },
  dockRow: { flexDirection: 'row', gap: 10, alignItems: 'stretch' },
  dockMain: { flex: 1 },
  big: { minHeight: 64, borderRadius: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.ink2, alignItems: 'center', justifyContent: 'center' },
  bigText: { fontSize: 17, fontWeight: '700', color: colors.paper },
  solid: { backgroundColor: colors.tape, borderColor: colors.tape },
  solidText: { color: colors.onTape, fontSize: 19 },
  pressed: { transform: [{ translateY: 1 }] },
  kmEntry: { flexDirection: 'row', gap: 8 },
  input: { backgroundColor: colors.ink, borderWidth: 1, borderColor: colors.line, borderRadius: 10, color: colors.paper, fontSize: 16, paddingVertical: 10, paddingHorizontal: 12 },
  kmInput: { flex: 1, fontFamily: mono, fontSize: 17 },
  update: { borderRadius: 10, backgroundColor: colors.tape, paddingHorizontal: 18, justifyContent: 'center' },
  updateText: { fontWeight: '700', color: colors.onTape, fontSize: 15 },
  quiet: { minHeight: 64, paddingHorizontal: 20, borderRadius: 14, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  quietText: { fontSize: 15, fontWeight: '600', color: colors.muted },
});
