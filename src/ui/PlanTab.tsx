import { StyleSheet, Text, View } from 'react-native';

import { Checkpoint, checkpointLabel, clockText, cutoffMoment, nextAhead, nextWithCutoff, Race } from '../core/race';
import { ascentBetweenM, descentBetweenM } from '../core/route';
import { clockOf, colors, compactDuration, kmValue, mono, signedDuration } from './theme';

type Props = {
  race: Race;
  reachedKm: number;
  /** When the race started, or null before the start: cutoffs cannot be placed in time yet. */
  startedAt: number | null;
  passedAt: Readonly<Record<string, number>>;
  now: number;
};

/** What a runner looks at mid-race, tired, one handed: four numbers, then the whole race. */
export function PlanTab(props: Props) {
  return (
    <View>
      <NextCard {...props} />
      <Text style={styles.sectionTitle}>Whole race</Text>
      {props.race.checkpoints.map((c) => (
        <LedgerRow key={c.id} {...props} checkpoint={c} />
      ))}
    </View>
  );
}

function NextCard({ race, reachedKm, startedAt, now }: Props) {
  const next = nextAhead(race, reachedKm);
  if (next === undefined) {
    return (
      <View style={styles.card}>
        <View style={styles.top}>
          <Text style={styles.eyebrow}>Next checkpoint</Text>
          <Text style={styles.name}>Passed the last checkpoint</Text>
          <Text style={styles.dist}>Well done, you finished!</Text>
        </View>
      </View>
    );
  }
  const binding = nextWithCutoff(race, reachedKm);
  const closesAt = binding === undefined || startedAt === null ? null : cutoffMoment(race, startedAt, binding);
  const borrowed = binding !== undefined && binding.id !== next.id ? binding : null;
  return (
    <View style={styles.card}>
      <View style={styles.top}>
        <Text style={styles.eyebrow}>Next checkpoint</Text>
        <Text style={styles.name}>{checkpointLabel(next)}</Text>
        <Text style={styles.dist}>
          at km {kmValue(next.km)} · you are at km {kmValue(reachedKm)}
        </Text>
      </View>
      <View style={styles.quad}>
        <Cell label="Left" value={kmValue(next.km - reachedKm)} unit="km" style={[styles.cellRight, styles.cellBottom]} />
        <Cell label="Up" value={String(Math.round(ascentBetweenM(race.route, reachedKm, next.km)))} unit="m" style={styles.cellBottom} />
        <Cell label="Down" value={String(Math.round(descentBetweenM(race.route, reachedKm, next.km)))} unit="m" style={styles.cellRight} />
        <Cell
          label={borrowed === null ? 'To COT' : `To COT · ${checkpointLabel(borrowed)}`}
          value={closesAt === null ? '–' : compactDuration(closesAt - now)}
          unit=""
        />
      </View>
      <Verdict binding={binding ?? null} borrowed={borrowed} closesAt={closesAt} now={now} />
    </View>
  );
}

/** Which cutoff binds and when it falls. A fact off the race sheet, not a judgement of pace: red only once it is behind. */
function Verdict({
  binding,
  borrowed,
  closesAt,
  now,
}: {
  binding: Checkpoint | null;
  borrowed: Checkpoint | null;
  closesAt: number | null;
  now: number;
}) {
  if (binding === null) return <Text style={[styles.verdict, styles.verdictNone]}>No checkpoint ahead has a COT</Text>;
  const clock = closesAt === null ? clockText(binding.cutoff!) : clockOf(closesAt);
  const late = closesAt !== null && closesAt < now;
  if (borrowed !== null) {
    return (
      <View style={[styles.verdictBox, late ? styles.verdictLate : styles.verdictNoneBox]}>
        <Text style={[styles.verdictText, late && styles.lateText]}>This checkpoint has no COT</Text>
        <Text style={styles.verdictDetail}>
          The next one is {checkpointLabel(borrowed)} at km {kmValue(borrowed.km)}, closing at {clock}
        </Text>
      </View>
    );
  }
  return (
    <Text style={[styles.verdict, late ? [styles.verdictLate, styles.lateText] : styles.verdictNone]}>
      {late ? `Already past the COT ${clock}` : `Closes at ${clock}`}
    </Text>
  );
}

function Cell({ label, value, unit, style }: { label: string; value: string; unit: string; style?: object }) {
  return (
    <View style={[styles.cell, style]}>
      <Text style={styles.cellLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.cellValue}>
        {value}
        {unit !== '' && <Text style={styles.cellUnit}> {unit}</Text>}
      </Text>
    </View>
  );
}

function LedgerRow({ race, reachedKm, startedAt, passedAt, now, checkpoint }: Props & { checkpoint: Checkpoint }) {
  const arrived = passedAt[checkpoint.id];
  const passed = arrived !== undefined;
  const closesAt = startedAt === null ? null : cutoffMoment(race, startedAt, checkpoint);
  const detail = passed
    ? `km ${kmValue(checkpoint.km)} · passed at ${clockOf(arrived)}`
    : `km ${kmValue(checkpoint.km)} · ${kmValue(Math.max(0, checkpoint.km - reachedKm))} km left · ↑${Math.round(
        ascentBetweenM(race.route, reachedKm, checkpoint.km),
      )} ↓${Math.round(descentBetweenM(race.route, reachedKm, checkpoint.km))} m`;
  return (
    <View style={[styles.row, passed && styles.rowPassed]}>
      <View style={styles.rowBody}>
        <Text style={styles.rowName} numberOfLines={1}>
          {checkpointLabel(checkpoint)}
        </Text>
        <Text style={styles.rowSub}>{detail}</Text>
      </View>
      <Amount checkpoint={checkpoint} closesAt={closesAt} arrived={arrived} now={now} />
    </View>
  );
}

/**
 * Ahead: a countdown to the cutoff, red only once it is behind. After arrival:
 * the margin the runner actually had, a fixed fact that does not drift with the clock.
 */
function Amount({ checkpoint, closesAt, arrived, now }: { checkpoint: Checkpoint; closesAt: number | null; arrived?: number; now: number }) {
  if (checkpoint.cutoff === null) {
    return (
      <View style={styles.amount}>
        <Text style={[styles.amountValue, styles.flat]}>—</Text>
        <Text style={styles.amountSmall}>no COT</Text>
      </View>
    );
  }
  const clock = closesAt === null ? clockText(checkpoint.cutoff) : clockOf(closesAt);
  if (closesAt === null) {
    return (
      <View style={styles.amount}>
        <Text style={[styles.amountValue, styles.flat]}>{clock}</Text>
        <Text style={styles.amountSmall}>COT</Text>
      </View>
    );
  }
  if (arrived === undefined) {
    return (
      <View style={styles.amount}>
        <Text style={[styles.amountValue, closesAt < now && styles.lateText]}>{compactDuration(closesAt - now)}</Text>
        <Text style={styles.amountSmall}>COT {clock}</Text>
      </View>
    );
  }
  const margin = closesAt - arrived;
  return (
    <View style={styles.amount}>
      <Text style={[styles.amountValue, margin < 0 ? styles.lateText : styles.okText]}>{signedDuration(margin)}</Text>
      <Text style={styles.amountSmall}>vs COT {clock}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: 16, backgroundColor: colors.ink2, borderWidth: 1, borderColor: colors.line, borderRadius: 16, overflow: 'hidden' },
  top: { padding: 16, paddingBottom: 14 },
  eyebrow: { fontFamily: mono, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: colors.muted },
  name: { fontSize: 21, fontWeight: '700', color: colors.paper, marginTop: 2 },
  dist: { fontFamily: mono, fontSize: 13, color: colors.muted, marginTop: 4 },
  quad: { flexDirection: 'row', flexWrap: 'wrap', borderTopWidth: 1, borderTopColor: colors.line },
  cell: { width: '50%', paddingVertical: 13, paddingHorizontal: 16 },
  cellRight: { borderRightWidth: 1, borderRightColor: colors.line },
  cellBottom: { borderBottomWidth: 1, borderBottomColor: colors.line },
  cellLabel: { fontFamily: mono, fontSize: 10.5, letterSpacing: 1, textTransform: 'uppercase', color: colors.muted },
  cellValue: { fontFamily: mono, fontSize: 27, fontWeight: '800', color: colors.paper, marginTop: 3 },
  cellUnit: { fontSize: 13, fontWeight: '600', color: colors.muted },
  verdict: {
    paddingVertical: 13,
    paddingHorizontal: 16,
    fontFamily: mono,
    fontSize: 13.5,
    fontWeight: '700',
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  verdictBox: { paddingVertical: 13, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: colors.line },
  verdictText: { fontFamily: mono, fontSize: 13.5, fontWeight: '700', color: colors.muted },
  verdictDetail: { fontFamily: mono, fontSize: 12, color: colors.muted, marginTop: 3 },
  verdictNone: { backgroundColor: colors.ink3, color: colors.muted },
  verdictNoneBox: { backgroundColor: colors.ink3 },
  verdictLate: { backgroundColor: 'rgba(255,92,108,.14)' },
  lateText: { color: colors.late },
  okText: { color: colors.ok },
  flat: { color: colors.muted },
  sectionTitle: {
    fontFamily: mono,
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.muted,
    fontWeight: '700',
    marginTop: 18,
    marginBottom: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.ink2,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 13,
    marginBottom: 8,
  },
  rowPassed: { opacity: 0.5 },
  rowBody: { flex: 1, minWidth: 0 },
  rowName: { fontSize: 14.5, fontWeight: '600', color: colors.paper },
  rowSub: { fontFamily: mono, fontSize: 11.5, color: colors.muted, marginTop: 2 },
  amount: { alignItems: 'flex-end' },
  amountValue: { fontFamily: mono, fontSize: 14, fontWeight: '800', color: colors.paper },
  amountSmall: { fontFamily: mono, fontSize: 10, color: colors.muted, letterSpacing: 0.6 },
});
