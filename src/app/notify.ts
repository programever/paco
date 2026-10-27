import * as Notifications from 'expo-notifications';

import { Alert } from '../core/alerts';

export async function notify(alert: Alert): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: alert.title,
      body: alert.body,
      sound: alert.voice === null ? 'default' : `${alert.voice}.wav`,
      interruptionLevel: 'active',
    },
    trigger: null,
  });
}

/** Lets a notification show and play while Paco is open on screen, not only in the background. */
export function showWhileOpen(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}
