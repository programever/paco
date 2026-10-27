import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';

/** null when everything is allowed, otherwise what the runner must change in Settings. */
export async function askPermissions(): Promise<string | null> {
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
