import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';

import { isProbeRunning, startProbe, stopProbe } from './src/probe/gpsTask';
import { notify, sounds } from './src/probe/sounds';
import {
  clearEntries,
  defaultSettings,
  Entry,
  IntervalSeconds,
  Mode,
  readEntries,
  readSettings,
  Settings,
} from './src/probe/store';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export default function App() {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [running, setRunning] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);

  const refresh = useCallback(async () => {
    setRunning(await isProbeRunning());
    setEntries(readEntries());
  }, []);

  useEffect(() => {
    setSettings(readSettings());
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  const start = async () => {
    const problem = await askPermissions();
    if (problem !== null) {
      Alert.alert('Paco needs permission', problem);
      return;
    }
    await startProbe(settings);
    await refresh();
  };

  const stop = async () => {
    await stopProbe();
    await refresh();
  };

  const playAll = async () => {
    for (const [index, sound] of sounds.entries()) {
      setTimeout(() => notify('Paco sound test', sound, sound), index * 4000);
    }
  };

  const share = () => Share.share({ message: readEntries().map((e) => JSON.stringify(e)).join('\n') });

  const clear = () =>
    Alert.alert('Clear the log?', 'All test results are deleted.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => (clearEntries(), refresh()) },
    ]);

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.title}>Paco GPS test</Text>
      <Text style={styles.status}>{running ? 'Running. You can lock the screen.' : 'Stopped.'}</Text>

      <Text style={styles.label}>GPS mode</Text>
      <Choice<Mode>
        value={settings.mode}
        options={[
          ['steady', 'Steady GPS'],
          ['saver', 'Power saver'],
        ]}
        disabled={running}
        onChange={(mode) => setSettings({ ...settings, mode })}
      />

      <Text style={styles.label}>Check every</Text>
      <Choice<IntervalSeconds>
        value={settings.intervalSeconds}
        options={[
          [300, '5 minutes'],
          [30, '30 seconds'],
        ]}
        disabled={running}
        onChange={(intervalSeconds) => setSettings({ ...settings, intervalSeconds })}
      />

      <Button label={running ? 'Stop test' : 'Start test'} onPress={running ? stop : start} strong />
      <Button label="Play all 8 sounds" onPress={playAll} />
      <Button label="Share the log" onPress={share} />
      <Button label="Clear the log" onPress={clear} />

      <Text style={styles.label}>Last results</Text>
      {[...entries].reverse().slice(0, 30).map((entry, index) => (
        <Text key={index} style={styles.entry}>
          {describe(entry)}
        </Text>
      ))}
      <StatusBar style="auto" />
    </ScrollView>
  );
}

async function askPermissions(): Promise<string | null> {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (!foreground.granted) return 'Allow Location for Paco in Settings.';
  if (!(await alwaysLocationGranted())) return 'Set Location for Paco to "Always" in Settings.';
  const alerts = await Notifications.requestPermissionsAsync();
  if (!alerts.granted) return 'Allow Notifications for Paco in Settings.';
  return null;
}

// iOS answers the "Always" request before the runner has tapped the upgrade
// dialog, so the first answer can be a stale "no". Ask again for a while.
async function alwaysLocationGranted(): Promise<boolean> {
  if ((await Location.requestBackgroundPermissionsAsync()).granted) return true;
  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    if ((await Location.getBackgroundPermissionsAsync()).granted) return true;
  }
  return false;
}

const time = (at: number): string => new Date(at).toLocaleTimeString();

function describe(entry: Entry): string {
  switch (entry.kind) {
    case 'start':
      return `${time(entry.at)}  Started: ${entry.settings.mode}, every ${entry.settings.intervalSeconds} s`;
    case 'stop':
      return `${time(entry.at)}  Stopped`;
    case 'check':
      return `${time(entry.at)}  GPS ±${entry.accuracy} m, battery ${entry.battery}%, ${entry.fixes} readings, longest gap ${entry.longestGapSeconds} s`;
    case 'error':
      return `${time(entry.at)}  Error: ${entry.message}`;
  }
}

function Choice<T>(props: {
  value: T;
  options: [T, string][];
  disabled: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.row}>
      {props.options.map(([value, label]) => (
        <Pressable
          key={label}
          disabled={props.disabled}
          onPress={() => props.onChange(value)}
          style={[styles.choice, value === props.value && styles.chosen, props.disabled && styles.dim]}
        >
          <Text style={value === props.value ? styles.chosenText : styles.choiceText}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function Button(props: { label: string; onPress: () => void; strong?: boolean }) {
  return (
    <Pressable onPress={props.onPress} style={[styles.button, props.strong && styles.strong]}>
      <Text style={props.strong ? styles.strongText : styles.buttonText}>{props.label}</Text>
    </Pressable>
  );
}

const orange = '#E8590C';

const styles = StyleSheet.create({
  page: { padding: 20, paddingTop: 70, gap: 10, backgroundColor: '#fff' },
  title: { fontSize: 28, fontWeight: '700' },
  status: { fontSize: 17, marginBottom: 8 },
  label: { fontSize: 15, fontWeight: '600', marginTop: 12, color: '#555' },
  row: { flexDirection: 'row', gap: 8 },
  choice: { flex: 1, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#ccc', alignItems: 'center' },
  chosen: { backgroundColor: orange, borderColor: orange },
  dim: { opacity: 0.5 },
  choiceText: { fontSize: 16 },
  chosenText: { fontSize: 16, color: '#fff', fontWeight: '600' },
  button: { padding: 14, borderRadius: 10, backgroundColor: '#f1f1f1', alignItems: 'center' },
  strong: { backgroundColor: orange, marginTop: 12 },
  buttonText: { fontSize: 17 },
  strongText: { fontSize: 18, color: '#fff', fontWeight: '700' },
  entry: { fontSize: 13, fontFamily: 'Menlo', color: '#333' },
});
