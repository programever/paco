import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';

import { Crew, crewTap, readCrew, syncCrew } from '../app/crew';
import { crewLink, injuries, needs, Tap, TapKind, tapLabel } from '../crew/protocol';
import { Run } from '../core/run';
import { clockOf, colors, longDuration, mono } from './theme';

/** While this tab is on screen the screen is lit anyway, so messages are fetched this often. */
const inboxEveryMs = 30_000;

type Picking = 'injured' | 'need' | null;

export function CrewTab({ run, now }: { run: Run | null; now: number }) {
  const [crew, setCrew] = useState<Crew>(() => readCrew());
  const [picking, setPicking] = useState<Picking>(null);
  const [chosen, setChosen] = useState<string[]>([]);

  const reload = () => setCrew(readCrew());
  useEffect(() => {
    if (run === null) return;
    const check = () => void syncCrew({ inbox: true }).then(reload);
    check();
    const timer = setInterval(check, inboxEveryMs);
    return () => clearInterval(timer);
  }, [run?.startedAt]);
  // The GPS task writes the same file; the screen's refresh tick picks that up.
  useEffect(reload, [now]);

  const tap = (kind: TapKind, items: readonly string[] = [], msg = '') => {
    setPicking(null);
    setChosen([]);
    void crewTap(kind, items, msg).then(reload);
    reload();
  };
  const confirm = (kind: TapKind, title: string) =>
    Alert.alert(title, undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Send', style: 'destructive', onPress: () => tap(kind) },
    ]);
  const pick = (what: Picking) => {
    setPicking(picking === what ? null : what);
    setChosen([]);
  };
  const toggle = (item: string) => setChosen(chosen.includes(item) ? chosen.filter((c) => c !== item) : [...chosen, item]);

  const seen = new Set([...crew.sent, ...crew.queue].filter((t) => t.kind === 'seen').map((t) => t.msg));
  const lastStatus = [...crew.queue].reverse().find((t) => t.kind !== 'seen') ?? crew.sent.find((t) => t.kind !== 'seen');

  return (
    <View>
      <View style={styles.card}>
        <Text style={styles.head}>{linkState(crew, now)}</Text>
        {lastStatus !== undefined && (
          <Text style={styles.detail}>
            Last: {describe(lastStatus)} · {clockOf(lastStatus.t)} · {crew.queue.some((q) => q.id === lastStatus.id) ? 'waiting' : 'sent ✓'}
          </Text>
        )}
      </View>

      {run === null ? null : (
        <>
          <View style={styles.grid}>
            <StatusButton label="OK" colour={colors.ok} onPress={() => tap('ok')} />
            <StatusButton label="Tired" colour={colors.warn} onPress={() => tap('tired')} />
            <StatusButton label="Resting" colour={colors.checkpoint} onPress={() => tap('resting')} />
            <StatusButton label="Injured" colour={colors.tape} on={picking === 'injured'} onPress={() => pick('injured')} />
            <StatusButton label="Need" colour={colors.tape} on={picking === 'need'} onPress={() => pick('need')} />
            <StatusButton label="Quit" colour={colors.late} onPress={() => confirm('quit', 'Send "I quit" to your crew?')} />
          </View>
          {picking !== null && (
            <View style={styles.picker}>
              <View style={styles.chips}>
                {(picking === 'injured' ? injuries : needs).map((item) => (
                  <Pressable key={item} style={[styles.chip, chosen.includes(item) && styles.chipOn]} onPress={() => toggle(item)}>
                    <Text style={[styles.chipText, chosen.includes(item) && styles.chipTextOn]}>{item}</Text>
                  </Pressable>
                ))}
              </View>
              <Pressable
                style={({ pressed }) => [styles.send, chosen.length === 0 && styles.sendOff, pressed && styles.pressed]}
                disabled={chosen.length === 0}
                onPress={() => tap(picking, chosen)}
              >
                <Text style={styles.sendText}>Send {tapLabel[picking]}</Text>
              </Pressable>
            </View>
          )}
          <Pressable style={({ pressed }) => [styles.sos, pressed && styles.pressed]} onPress={() => confirm('sos', 'Send SOS to your crew?')}>
            <Text style={styles.sosText}>SOS</Text>
          </Pressable>
        </>
      )}

      <Text style={styles.section}>MESSAGES</Text>
      {crew.inbox.length === 0 ? (
        <Text style={styles.muted}>None</Text>
      ) : (
        // Its own scroll box: a long chat must not push the crew link off the page.
        <ScrollView style={styles.inbox} nestedScrollEnabled>
          {crew.inbox.map((message) => (
          <View key={message.id} style={styles.message}>
            <View style={styles.messageBody}>
              <Text style={styles.messageText}>{message.text}</Text>
              <Text style={styles.muted}>{clockOf(Date.parse(message.at))}</Text>
            </View>
            {seen.has(message.id) ? (
              <Text style={styles.gotIt}>✓</Text>
            ) : (
              <Pressable style={({ pressed }) => [styles.ack, pressed && styles.pressed]} onPress={() => tap('seen', [], message.id)}>
                <Text style={styles.ackText}>Got it</Text>
              </Pressable>
            )}
          </View>
          ))}
        </ScrollView>
      )}

      <Text style={styles.section}>CREW LINK</Text>
      <Pressable style={({ pressed }) => [styles.link, pressed && styles.pressed]} onPress={() => void Share.share({ message: crewLink(crew.key) })}>
        <Text style={styles.linkText} numberOfLines={1}>
          {crewLink(crew.key)}
        </Text>
        <Text style={styles.shareText}>Share</Text>
      </Pressable>
    </View>
  );
}

function linkState(crew: Crew, now: number): string {
  if (crew.queue.length > 0) return `NO SIGNAL · ${crew.queue.length} NOT SENT`;
  if (crew.reachedAt === 0) return 'NOT CONNECTED YET';
  const age = now - crew.reachedAt;
  return age < 60_000 ? 'CREW LINK OK · JUST NOW' : `CREW LINK OK · ${longDuration(age).toUpperCase()} AGO`;
}

const describe = (tap: Tap): string => [tapLabel[tap.kind], ...tap.items].join(' · ');

function StatusButton({ label, colour, on, onPress }: { label: string; colour: string; on?: boolean; onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.status, { borderColor: colour }, on && { backgroundColor: colour }, pressed && styles.pressed]}
      onPress={onPress}
    >
      <Text style={[styles.statusText, { color: on ? colors.onTape : colour }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: 14, borderRadius: 14, paddingVertical: 13, paddingHorizontal: 16, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.ink2 },
  head: { fontFamily: mono, fontSize: 13, fontWeight: '800', letterSpacing: 0.5, color: colors.paper },
  detail: { fontSize: 13.5, color: colors.paper, marginTop: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  status: { width: '31.9%', minHeight: 72, borderRadius: 14, borderWidth: 2, backgroundColor: colors.ink2, alignItems: 'center', justifyContent: 'center' },
  statusText: { fontSize: 17, fontWeight: '800' },
  picker: { marginTop: 10, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.ink2, gap: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.ink3 },
  chipOn: { backgroundColor: colors.tape, borderColor: colors.tape },
  chipText: { fontSize: 15, fontWeight: '600', color: colors.paper },
  chipTextOn: { color: colors.onTape },
  send: { minHeight: 52, borderRadius: 12, backgroundColor: colors.tape, alignItems: 'center', justifyContent: 'center' },
  sendOff: { opacity: 0.4 },
  sendText: { fontSize: 17, fontWeight: '800', color: colors.onTape },
  sos: { marginTop: 10, minHeight: 64, borderRadius: 14, backgroundColor: colors.late, alignItems: 'center', justifyContent: 'center' },
  sosText: { fontFamily: mono, fontSize: 22, fontWeight: '900', letterSpacing: 4, color: '#FFFFFF' },
  section: { fontFamily: mono, fontSize: 11, fontWeight: '700', letterSpacing: 1, color: colors.muted, marginTop: 22, marginBottom: 8 },
  muted: { fontSize: 12.5, color: colors.muted },
  inbox: { maxHeight: 320 },
  message: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, marginBottom: 8, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.ink2 },
  messageBody: { flex: 1, gap: 3 },
  messageText: { fontSize: 16, fontWeight: '600', color: colors.paper },
  ack: { minHeight: 44, paddingHorizontal: 14, borderRadius: 10, backgroundColor: colors.ok, justifyContent: 'center' },
  ackText: { fontSize: 15, fontWeight: '800', color: colors.onTape },
  gotIt: { fontSize: 20, fontWeight: '800', color: colors.ok, paddingHorizontal: 10 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.ink2 },
  linkText: { flex: 1, fontFamily: mono, fontSize: 12, color: colors.paper },
  shareText: { fontFamily: mono, fontSize: 13, fontWeight: '800', color: colors.tape },
  pressed: { transform: [{ translateY: 1 }] },
});
