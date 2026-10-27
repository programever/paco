import * as Notifications from 'expo-notifications';

export const sounds = [
  'use_poles.wav',
  'no_poles.wav',
  'km_5.wav',
  'km_4.wav',
  'km_3.wav',
  'km_2.wav',
  'km_1.wav',
  'off_course.wav',
] as const;

export type Sound = (typeof sounds)[number];

export const soundForCheck = (check: number): Sound => sounds[check % sounds.length];

export async function notify(title: string, body: string, sound: Sound): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: { title, body, sound, interruptionLevel: 'active' },
    trigger: null,
  });
}
