import { useState } from 'react';
import { Alert, Linking, Pressable, SafeAreaView, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';

import { LoadedRace } from '../app/races';
import { Run } from '../core/run';
import { helpMessage } from '../core/sos';
import { fitAll, MapView } from './CourseMap';
import { LocateTab } from './LocateTab';
import { PlanTab } from './PlanTab';
import { colors, kmValue, longDuration, mono } from './theme';

type Tab = 'plan' | 'locate';

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

  return (
    <SafeAreaView style={styles.screen}>
      <Header run={run} now={now} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <Text style={styles.raceName}>{race.name}</Text>
        <Text style={styles.raceFacts}>
          {kmValue(race.route.totalKm)} km · ↑{Math.round(race.route.totalAscentM)} m · ↓{Math.round(race.route.totalDescentM)} m
        </Text>
        <View style={styles.tabs}>
          <TabButton label="Plan" on={tab === 'plan'} onPress={() => setTab('plan')} />
          <TabButton label="Locate" on={tab === 'locate'} onPress={() => setTab('locate')} />
        </View>
        {tab === 'plan' ? (
          <PlanTab race={race} reachedKm={run?.km ?? 0} startedAt={run?.startedAt ?? race.startsAt} passedAt={run?.passedAt ?? {}} now={now} />
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
          />
        )}
        {run === null ? (
          <View style={styles.dock}>
            <Text style={styles.hint}>
              After Start, Paco reads GPS by itself, also with the screen locked, and speaks the alerts.
            </Text>
            <BigButton label="Start" solid onPress={onStart} />
          </View>
        ) : (
          <>
            <Dock onDeclareKm={onDeclareKm} />
            <View style={styles.footer}>
              <QuietButton label="End" onPress={() => confirmEnd(onEnd)} />
            </View>
            <HelpPanel run={run} />
          </>
        )}
        <Text style={styles.credit}>Runs fully offline · sends nothing anywhere</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function confirmEnd(onEnd: () => void) {
  Alert.alert('End the race?', 'GPS and the alerts stop, and this race is cleared.', [
    { text: 'Keep running', style: 'cancel' },
    { text: 'End', style: 'destructive', onPress: onEnd },
  ]);
}

function Header({ run, now, onBack }: { run: Run | null; now: number; onBack: () => void }) {
  const age = run === null ? null : now - (run.latestFix?.takenAt ?? run.startedAt);
  return (
    <View style={styles.bar}>
      <View style={styles.brand}>
        {run === null && (
          <Pressable onPress={onBack} hitSlop={12} style={styles.back}>
            <Text style={styles.backText}>‹ Races</Text>
          </Pressable>
        )}
        <Text style={styles.mark}>
          PA<Text style={styles.markTape}>CO</Text>
        </Text>
      </View>
      {run !== null && age !== null && (
        <Text style={[styles.freshness, age > 10 * 60_000 && styles.stale]}>
          km {kmValue(run.km)}
          {'\n'}
          {age < 60_000 ? 'GPS just now' : `GPS ${longDuration(age)} ago`}
        </Text>
      )}
    </View>
  );
}

/** The backup when GPS cannot be trusted: the runner reads the km off a marker and types it. */
function Dock({ onDeclareKm }: { onDeclareKm: (km: number) => void }) {
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
    <View style={styles.dock}>
      <Text style={styles.hint}>Paco reads GPS by itself, also with the screen locked.</Text>
      <BigButton label="Enter km" onPress={() => setOpen(!open)} />
      {open && (
        <View style={styles.kmEntry}>
          <TextInput
            style={[styles.input, styles.kmInput]}
            placeholder="How many km have you run?"
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
    </View>
  );
}

/** A ready-made text with the position. SMS goes out where 4G does not, as long as there is phone signal. */
function HelpPanel({ run }: { run: Run }) {
  const [phone, setPhone] = useState('');
  const fix = run.latestFix;
  const message = fix === null ? null : helpMessage(fix, run.nearest?.km ?? run.km);
  const send = () => {
    if (message === null) return Alert.alert('No position yet', 'Wait for GPS first.');
    if (phone.trim() === '') return Alert.alert('No phone number', 'Type the number of the organiser or your family first.');
    Linking.openURL(`sms:${phone.trim()}&body=${encodeURIComponent(message)}`);
  };
  return (
    <View style={styles.help}>
      <Text style={styles.helpHead}>When you need help</Text>
      <Text style={styles.note}>
        A ready-made text with your position. A text message goes out even without 4G, as long as there is phone signal.
      </Text>
      <View style={styles.helpRow}>
        <TextInput
          style={[styles.input, styles.phone]}
          placeholder="Organiser or family number"
          placeholderTextColor={colors.muted}
          keyboardType="phone-pad"
          value={phone}
          onChangeText={setPhone}
        />
        <Pressable style={styles.mini} onPress={send}>
          <Text style={styles.miniText}>Send text</Text>
        </Pressable>
      </View>
      <Text style={styles.preview}>{message ?? 'Waiting for GPS to put your position in the message.'}</Text>
      <Pressable style={[styles.mini, styles.share]} onPress={() => message !== null && Share.share({ message })}>
        <Text style={styles.miniText}>Share or copy the message</Text>
      </Pressable>
    </View>
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
  freshness: { fontFamily: mono, fontSize: 11, color: colors.muted, textAlign: 'right', lineHeight: 15 },
  stale: { color: colors.warn },
  page: { paddingHorizontal: 16, paddingBottom: 48 },
  raceName: { fontSize: 17, fontWeight: '700', color: colors.paper, marginTop: 16 },
  raceFacts: { fontFamily: mono, fontSize: 12, color: colors.muted, marginTop: 2 },
  tabs: { flexDirection: 'row', gap: 6, marginTop: 14 },
  tab: { flex: 1, minHeight: 44, borderRadius: 11, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.ink2, alignItems: 'center', justifyContent: 'center' },
  tabOn: { backgroundColor: colors.tape, borderColor: colors.tape },
  tabText: { fontFamily: mono, fontSize: 13, fontWeight: '700', letterSpacing: 1, color: colors.muted },
  tabTextOn: { color: colors.onTape },
  dock: { marginTop: 18, gap: 10 },
  hint: { fontSize: 12.5, color: colors.muted, textAlign: 'center' },
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
  footer: { marginTop: 14 },
  quiet: { minHeight: 44, borderRadius: 11, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  quietText: { fontSize: 15, fontWeight: '600', color: colors.muted },
  help: { marginTop: 14, backgroundColor: colors.ink2, borderWidth: 1, borderColor: colors.line, borderRadius: 14, padding: 14, gap: 8 },
  helpHead: { fontFamily: mono, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: colors.muted, fontWeight: '700' },
  note: { fontSize: 13, color: colors.muted },
  helpRow: { flexDirection: 'row', gap: 8 },
  phone: { flex: 1 },
  preview: { backgroundColor: colors.ink, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 10, fontFamily: mono, fontSize: 12, color: colors.paper },
  mini: { minHeight: 40, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 9, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.ink3, justifyContent: 'center', alignItems: 'center' },
  miniText: { fontFamily: mono, fontSize: 12.5, fontWeight: '700', color: colors.paper },
  share: { alignSelf: 'flex-start' },
  credit: { fontFamily: mono, fontSize: 11, color: colors.muted, textAlign: 'center', marginTop: 22 },
});
