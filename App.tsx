import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';

import { startRace, stopRace } from './src/app/gpsTask';
import { showWhileOpen } from './src/app/notify';
import { loadRace } from './src/app/races';
import { readRun } from './src/app/store';
import { Run } from './src/core/run';
import { askPermissions } from './src/ui/permissions';
import { RaceList } from './src/ui/RaceList';
import { RaceView } from './src/ui/RaceView';

showWhileOpen();

/** The screens read the run the GPS task writes; this often is enough for a runner glancing down. */
const refreshEveryMs = 3000;

export default function App() {
  const [run, setRun] = useState<Run | null>(() => readRun());
  const [openRaceId, setOpenRaceId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const refresh = useCallback(() => {
    setRun(readRun());
    setNow(Date.now());
  }, []);

  useEffect(() => {
    const timer = setInterval(refresh, refreshEveryMs);
    return () => clearInterval(timer);
  }, [refresh]);

  const raceId = run?.raceId ?? openRaceId;
  const loaded = raceId === null ? null : loadRace(raceId);

  const start = async () => {
    if (loaded === null) return;
    const problem = await askPermissions();
    if (problem !== null) {
      Alert.alert('Paco needs permission', problem);
      return;
    }
    await startRace(loaded.race.id);
    refresh();
  };

  const stop = async () => {
    await stopRace();
    setOpenRaceId(null);
    refresh();
  };

  return (
    <>
      {loaded === null ? (
        <RaceList onOpen={setOpenRaceId} />
      ) : (
        <RaceView
          loaded={loaded}
          run={run}
          now={now}
          onBack={() => setOpenRaceId(null)}
          onStart={start}
          onStop={stop}
        />
      )}
      <StatusBar style="dark" />
    </>
  );
}
