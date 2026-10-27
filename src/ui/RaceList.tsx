import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';

import { loadRace, raceIds } from '../app/races';
import { colors, kmValue, mono } from './theme';

export function RaceList({ onOpen }: { onOpen: (raceId: string) => void }) {
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.bar}>
        <Text style={styles.mark}>
          PA<Text style={styles.markTape}>CO</Text>
        </Text>
      </View>
      <ScrollView contentContainerStyle={styles.page}>
        <Text style={styles.eyebrow}>Pick a race</Text>
        {raceIds().map((id) => {
          const loaded = loadRace(id);
          if (loaded === null) return null;
          const { race } = loaded;
          const stations = race.checkpoints.filter((c) => c.role === 'station').length;
          const withCot = race.checkpoints.some((c) => c.cutoff !== null);
          return (
            <Pressable key={id} style={({ pressed }) => [styles.card, pressed && styles.pressed]} onPress={() => onOpen(id)}>
              <Text style={styles.name}>{race.name}</Text>
              <Text style={styles.facts}>
                {kmValue(race.route.totalKm)} km · ↑{Math.round(race.route.totalAscentM)} m · ↓{Math.round(race.route.totalDescentM)} m ·{' '}
                {stations} stations{withCot ? ' · COT' : ''}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  bar: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.line },
  mark: { fontFamily: mono, fontSize: 15, fontWeight: '700', letterSpacing: 1, color: colors.paper },
  markTape: { color: colors.tape },
  page: { padding: 16, gap: 10 },
  eyebrow: { fontFamily: mono, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: colors.muted, fontWeight: '700', marginBottom: 2 },
  card: { backgroundColor: colors.ink2, borderWidth: 1, borderColor: colors.line, borderRadius: 14, padding: 15, gap: 6 },
  pressed: { borderColor: colors.tape },
  name: { fontSize: 16, fontWeight: '700', color: colors.paper },
  facts: { fontFamily: mono, fontSize: 12, color: colors.muted },
});
