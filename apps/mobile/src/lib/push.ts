import type { MobilePushStatus } from '@dealflow/types';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { ApiClient } from './api';

/*
 * Notifications on the phone (ADR 0072, M8). The person turns them on from Profile; the phone then asks the system
 * for permission, gets a push token from Expo and gives it to SampForce. Which notifications arrive is decided by the
 * organisation's Mobile Configuration, on the server.
 */

/** Notifications need a real phone: not the web build, not a simulator. */
export function pushSupported(): boolean {
  return Platform.OS !== 'web' && Device.isDevice;
}

/** The app's Expo project, which holds the Apple and Google push credentials (set when the app is built). */
function projectId(): string | null {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? null;
}

export class PushNotAllowedError extends Error {
  constructor() {
    super('Allow notifications for SampForce in your phone’s settings.');
  }
}

if (Platform.OS !== 'web') {
  // A notification that arrives while the app is open still shows as a banner.
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
}

async function token(): Promise<string> {
  const id = projectId();
  if (!id) throw new Error('This build of the app cannot receive notifications yet.');
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', { name: 'SampForce', importance: Notifications.AndroidImportance.HIGH });
  }
  return (await Notifications.getExpoPushTokenAsync({ projectId: id })).data;
}

/** Asks for permission (once; after a refusal only the phone's settings can allow it) and registers the phone. */
export async function turnOnPush(api: ApiClient): Promise<MobilePushStatus> {
  const current = await Notifications.getPermissionsAsync();
  const granted = current.granted || (current.canAskAgain && (await Notifications.requestPermissionsAsync()).granted);
  if (!granted) throw new PushNotAllowedError();
  return api.put<MobilePushStatus>('/mobile/push', { token: await token() });
}

export function turnOffPush(api: ApiClient): Promise<MobilePushStatus> {
  return api.delete('/mobile/push').then(() => api.get<MobilePushStatus>('/mobile/push'));
}

/**
 * At start: when notifications are allowed and the server expects them, send the current token again (Apple and
 * Google can change it). Never asks for permission.
 */
export async function refreshPush(api: ApiClient): Promise<void> {
  if (!pushSupported() || !projectId()) return;
  const status = await api.get<MobilePushStatus>('/mobile/push');
  if (!status.enabled || !status.registered) return;
  if (!(await Notifications.getPermissionsAsync()).granted) {
    await api.delete('/mobile/push');
    return;
  }
  await api.put('/mobile/push', { token: await token() });
}

/** Calls `open` with the screen a tapped notification points to, including the one that started the app. */
export function onNotificationTap(open: (route: string | null) => void): () => void {
  if (Platform.OS === 'web') return () => undefined;
  const route = (r: Notifications.NotificationResponse) => {
    const value = (r.notification.request.content.data as { route?: unknown } | undefined)?.route;
    return typeof value === 'string' && value.startsWith('/') ? value : null;
  };
  void Notifications.getLastNotificationResponseAsync().then((r) => r && open(route(r)));
  const sub = Notifications.addNotificationResponseReceivedListener((r) => open(route(r)));
  return () => sub.remove();
}
