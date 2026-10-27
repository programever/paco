import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { loadRace, raceIds } from '../app/races';
import { colors, kmText, metresText } from './theme';

export function RaceList({ onOpen }: { onOpen: (raceId: string) => void }) {
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.title}>Paco</Text>
      <Text style={styles.subtitle}>Pick a race</Text>
      {raceIds().map((id) => {
        const loaded = loadRace(id);
        if (loaded === null) return null;
        const { race } = loaded;
        const stations = race.checkpoints.filter((c) => c.role === 'station').length;
        return (
          <Pressable key={id} style={styles.card} onPress={() => onOpen(id)}>
            <Text style={styles.name}>{race.name}</Text>
            <View style={styles.facts}>
              <Text style={styles.fact}>{kmText(race.route.totalKm)}</Text>
              <Text style={styles.fact}>↑ {metresText(race.route.totalAscentM)}</Text>
              <Text style={styles.fact}>↓ {metresText(race.route.totalDescentM)}</Text>
              <Text style={styles.fact}>{stations} stations</Text>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 20, paddingTop: 70, gap: 12, backgroundColor: colors.page },
  title: { fontSize: 34, fontWeight: '800', color: colors.ink },
  subtitle: { fontSize: 17, color: colors.muted, marginBottom: 8 },
  card: { padding: 16, borderRadius: 14, backgroundColor: colors.surface, gap: 8 },
  name: { fontSize: 18, fontWeight: '700', color: colors.ink },
  facts: { flexDirection: 'row', gap: 14, flexWrap: 'wrap' },
  fact: { fontSize: 15, color: colors.muted },
});
