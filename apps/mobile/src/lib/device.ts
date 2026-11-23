import type { MobileDeviceInfo } from '@dealflow/types';
import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { installId } from './storage';

/** What the phone tells the server about itself at sign-in, for the organisation's device list. */
export async function deviceInfo(): Promise<MobileDeviceInfo> {
  const platform = Platform.OS === 'ios' ? 'IOS' : Platform.OS === 'android' ? 'ANDROID' : 'WEB';
  const clip = (s: string | null | undefined, n: number) => (s ? s.slice(0, n) : undefined);
  return {
    platform,
    installId: await installId(() => Crypto.randomUUID()),
    model: clip(Device.modelName ?? (platform === 'WEB' ? 'Browser' : null), 100),
    osVersion: clip(Device.osVersion, 40),
    appVersion: clip(Application.nativeApplicationVersion ?? '1.0.0', 40),
    name: clip(Device.deviceName, 100),
  };
}
