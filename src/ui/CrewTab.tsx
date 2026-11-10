import { useEffect, useState } from 'react';
import { Pressable, Share, StyleSheet, Text, TextInput, View } from 'react-native';

import { Crew, crewRetry, crewSay, Outgoing, pushover, readCrew, syncCrew } from '../app/crew';
import { ChatLine, crewLink, maxMessageLength } from '../crew/protocol';
import { Run } from '../core/run';
import { clockOf, colors, longDuration, mono } from './theme';

/** While this tab is on screen the screen is lit anyway, so messages are fetched this often. */
const inboxEveryMs = 30_000;

/**
 * One chat with the crew page, like a messenger: newest at the bottom. The box
 * to type in is `CrewCompose`, fixed at the bottom of the screen, outside the scroll.
 * `sent` changes when the box sends, so the new message shows at once.
 */
export function CrewTab({ run, now, sent }: { run: Run | null; now: number; sent: number }) {
  const [crew, setCrew] = useState<Crew>(() => readCrew());
  const reload = () => setCrew(readCrew());

  useEffect(() => {
    if (run === null) return;
    const check = () => void syncCrew({ inbox: true }).then(reload);
    check();
    const timer = setInterval(check, inboxEveryMs);
    return () => clearInterval(timer);
  }, [run?.startedAt]);
  // The GPS task writes the same file; the screen's refresh tick picks that up.
  useEffect(reload, [now, sent]);

  return (
    <View>
      <View style={styles.link}>
        <Text style={styles.linkState}>{linkState(crew, now)}</Text>
        <Pressable
          style={({ pressed }) => [styles.share, pressed && styles.pressed]}
          hitSlop={8}
          onPress={() => void Share.share({ message: crewLink(crew.key, pushover()) })}
        >
          <Text style={styles.shareText}>Share link</Text>
        </Pressable>
      </View>

      <View style={styles.chat}>
        {crew.chat.length === 0 && crew.outbox.length === 0 ? (
          <Text style={styles.empty}>No messages</Text>
        ) : (
          <>
            {crew.chat.map((line) => (
              <Bubble key={line.id} line={line} />
            ))}
            {crew.outbox.map((line) => (
              <Bubble key={line.id} line={line} waiting={line} />
            ))}
          </>
        )}
      </View>

    </View>
  );
}

/** The box and Send, fixed at the bottom of the Crew tab in place of Enter km and End. */
export function CrewCompose({ onSent }: { onSent: () => void }) {
  const [text, setText] = useState('');
  const send = () => {
    if (text.trim() === '') return;
    void crewSay(text).then(onSent);
    setText('');
    onSent();
  };
  return (
    <View style={styles.compose}>
      <TextInput
        style={styles.input}
        value={text}
        onChangeText={setText}
        placeholder="Message"
        placeholderTextColor={colors.muted}
        maxLength={maxMessageLength}
        multiline
      />
      <Pressable style={({ pressed }) => [styles.send, text.trim() === '' && styles.off, pressed && styles.pressed]} onPress={send}>
        <Text style={styles.sendText}>Send</Text>
      </Pressable>
    </View>
  );
}

/** Runner on the right, crew on the left. A message not on the server yet says so, and why. */
function Bubble({ line, waiting }: { line: ChatLine; waiting?: Outgoing }) {
  const mine = line.from === 'runner';
  const when = clockOf(line.at !== '' ? Date.parse(line.at) : line.t);
  return (
    <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
      <Text style={styles.text}>{line.text}</Text>
      <View style={styles.meta}>
        <Text style={styles.when}>{when}</Text>
        {mine && waiting === undefined && <Text style={styles.sent}>✓ sent</Text>}
        {waiting !== undefined && !waiting.refused && (
          <Text style={styles.sending}>{waiting.error === '' ? 'sending…' : 'no signal · trying again'}</Text>
        )}
        {waiting?.refused === true && (
          <Pressable hitSlop={8} onPress={() => void crewRetry(waiting.id)}>
            <Text style={styles.failed}>not sent · Retry</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function linkState(crew: Crew, now: number): string {
  const waiting = crew.outbox.filter((o) => !o.refused).length;
  if (waiting > 0) return `NO SIGNAL · ${waiting} NOT SENT`;
  if (crew.reachedAt === 0) return 'NOT CONNECTED YET';
  const age = now - crew.reachedAt;
  return age < 60_000 ? 'CREW LINK OK · JUST NOW' : `CREW LINK OK · ${longDuration(age).toUpperCase()} AGO`;
}

const styles = StyleSheet.create({
  link: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderRadius: 14,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.ink2,
  },
  linkState: { flex: 1, fontFamily: mono, fontSize: 12.5, fontWeight: '800', letterSpacing: 0.5, color: colors.paper },
  share: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 9, borderWidth: 1, borderColor: colors.tape },
  shareText: { fontFamily: mono, fontSize: 12.5, fontWeight: '800', color: colors.tape },
  chat: { marginTop: 14, gap: 8 },
  empty: { fontSize: 13.5, color: colors.muted, textAlign: 'center', paddingVertical: 24 },
  bubble: { maxWidth: '84%', borderRadius: 14, paddingVertical: 9, paddingHorizontal: 12 },
  mine: { alignSelf: 'flex-end', backgroundColor: 'rgba(255,122,47,.16)', borderWidth: 1, borderColor: colors.tapeDim, borderBottomRightRadius: 4 },
  theirs: { alignSelf: 'flex-start', backgroundColor: colors.ink3, borderWidth: 1, borderColor: colors.line, borderBottomLeftRadius: 4 },
  text: { fontSize: 16, color: colors.paper, lineHeight: 21 },
  meta: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 4 },
  when: { fontFamily: mono, fontSize: 11, color: colors.muted },
  sent: { fontFamily: mono, fontSize: 11, color: colors.ok },
  sending: { fontFamily: mono, fontSize: 11, color: colors.warn },
  failed: { fontFamily: mono, fontSize: 11, fontWeight: '800', color: colors.late },
  compose: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input: {
    flex: 1,
    minHeight: 48,
    maxHeight: 120,
    backgroundColor: colors.ink,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    color: colors.paper,
    fontSize: 16,
    paddingTop: 13,
    paddingBottom: 13,
    paddingHorizontal: 12,
  },
  send: { minHeight: 48, paddingHorizontal: 18, borderRadius: 12, backgroundColor: colors.tape, justifyContent: 'center' },
  off: { opacity: 0.4 },
  sendText: { fontSize: 16, fontWeight: '800', color: colors.onTape },
  pressed: { transform: [{ translateY: 1 }] },
});
