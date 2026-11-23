import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import type { ApiClient } from './api';
import { useController } from './session';

/*
 * Profile photos on the phone (ADR 0072, M6). Photos need the person's token, so the app downloads them itself and
 * keeps each version once (their URLs carry a version, so a new photo is a new address).
 */

const cache = new Map<string, Promise<string | null>>();

/** The API path for a photo URL the server gave ("/api/v1/people/…" → "/people/…"). */
export const apiPath = (url: string) => url.replace(/^\/api\/v1/, '');

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the photo.'));
    reader.readAsDataURL(blob);
  });
}

export function loadPhoto(api: ApiClient, url: string): Promise<string | null> {
  let p = cache.get(url);
  if (!p) {
    p = api
      .getFile(apiPath(url))
      .then(toDataUrl)
      .catch(() => {
        cache.delete(url);
        return null;
      });
    cache.set(url, p);
  }
  return p;
}

/** A photo as an image source the app can show, or null while it loads or when there is none. */
export function usePhoto(url: string | null | undefined): string | null {
  const c = useController();
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    setSrc(null);
    if (!url) return;
    let live = true;
    void loadPhoto(c.api, url).then((s) => live && setSrc(s));
    return () => {
      live = false;
    };
  }, [c, url]);
  return src;
}

/** Square, 512 pixels, JPEG: small enough to send over a weak connection, sharp enough for any screen. */
export const PHOTO_SIZE = 512;

/**
 * Lets the person choose a photo (or take one), crops it square, shrinks it and uploads it. Returns the new photo
 * URL, or null if they cancelled.
 */
export async function choosePhoto(api: ApiClient, source: 'library' | 'camera'): Promise<string | null> {
  const permission = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new PhotoPermissionError();
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1 };
  const picked = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (picked.canceled || !picked.assets[0]) return null;
  const asset = picked.assets[0];
  const side = Math.min(asset.width || PHOTO_SIZE, asset.height || PHOTO_SIZE);
  const actions: ImageManipulator.Action[] = [];
  // The picker crops square on phones; on the web it may not, so crop the centre here.
  if (asset.width && asset.height && asset.width !== asset.height) actions.push({ crop: { originX: (asset.width - side) / 2, originY: (asset.height - side) / 2, width: side, height: side } });
  actions.push({ resize: { width: Math.min(PHOTO_SIZE, side), height: Math.min(PHOTO_SIZE, side) } });
  const small = await ImageManipulator.manipulateAsync(asset.uri, actions, { compress: 0.82, format: ImageManipulator.SaveFormat.JPEG });
  const blob = await (await fetch(small.uri)).blob();
  const res = await api.putFile<{ photoUrl: string }>('/me/photo', blob, 'image/jpeg');
  return res.photoUrl;
}

export class PhotoPermissionError extends Error {
  constructor() {
    super('Allow SampForce to use your photos in your phone’s settings.');
  }
}
