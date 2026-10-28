import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { Alert, AppState } from 'react-native';

import { syncCrew } from './src/app/crew';
import { startRace, stopRace } from './src/app/gpsTask';
import { showWhileOpen } from './src/app/notify';
import { loadRace } from './src/app/races';
import { readRun, readSettings, writeRun } from './src/app/store';
import { declareKm, Run } from './src/core/run';
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

  // Opened from the crew's Pushover doorbell: fetch the message now, not on the next check.
  useEffect(() => {
    const listener = AppState.addEventListener('change', (next) => {
      if (next === 'active' && readRun() !== null) void syncCrew({ inbox: true }).then(refresh);
    });
    return () => listener.remove();
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

  const end = async () => {
    await stopRace();
    setOpenRaceId(null);
    refresh();
  };

  const declare = (km: number) => {
    const current = readRun();
    if (current === null || loaded === null) return;
    const context = { race: loaded.race, climbs: loaded.climbs, startedAt: current.startedAt, settings: readSettings() };
    writeRun(declareKm(context, current, km, Date.now()));
    refresh();
  };

  return (
    <>
      {loaded === null ? (
        <RaceList onOpen={setOpenRaceId} />
      ) : (
        <RaceView
          key={loaded.race.id}
          loaded={loaded}
          run={run}
          now={now}
          onBack={() => setOpenRaceId(null)}
          onStart={start}
          onEnd={end}
          onDeclareKm={declare}
        />
      )}
      <StatusBar style="light" />
    </>
  );
}
