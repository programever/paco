import * as Location from 'expo-location';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { colors, mono } from './theme';

type Heading = { readonly degrees: number; readonly weak: boolean };

/**
 * Where the top of the phone points, in degrees from true north. Only runs
 * while the arrow is on screen: the compass costs battery.
 */
function useHeading(): Heading | null {
  const [heading, setHeading] = useState<Heading | null>(null);
  useEffect(() => {
    let subscription: Location.LocationSubscription | null = null;
    let stopped = false;
    Location.watchHeadingAsync((h) => {
      const degrees = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
      // iOS level 0 means more than 50 degrees of doubt.
      setHeading({ degrees, weak: h.accuracy === 0 });
    })
      .then((s) => (stopped ? s.remove() : (subscription = s)))
      .catch(() => setHeading(null));
    return () => {
      stopped = true;
      subscription?.remove();
    };
  }, []);
  return heading;
}

/**
 * A big arrow that points at the target whichever way the phone faces. Without
 * a compass it falls back to a fixed arrow with north at the top of the screen.
 */
export function WayArrow({ bearing, fallback }: { bearing: number; fallback: string }) {
  const heading = useHeading();
  if (heading === null) return <Text style={styles.fixed}>{fallback}</Text>;
  const turn = (bearing - heading.degrees + 360) % 360;
  return (
    <View style={styles.box}>
      <View style={{ transform: [{ rotate: `${turn}deg` }] }}>
        <Svg width={120} height={120} viewBox="-60 -60 120 120">
          <Path d="M0 -54 L34 18 L10 8 L10 50 L-10 50 L-10 8 L-34 18 Z" fill={colors.paper} />
        </Svg>
      </View>
      {heading.weak && <Text style={styles.weak}>Compass weak</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', marginTop: 12, marginBottom: 8 },
  fixed: { fontSize: 44, lineHeight: 50, marginTop: 10, marginBottom: 6, color: colors.paper },
  weak: { marginTop: 6, fontFamily: mono, fontSize: 12, fontWeight: '700', color: colors.warn },
});
