import { Capacitor, registerPlugin } from '@capacitor/core';
import type { PhotoRef } from './types';

interface NativePhotoLinks {
  pickPhoto(): Promise<{ uri: string; name: string }>;
  takePhoto(): Promise<{ uri: string; name: string }>;
  readPhoto(options: { uri: string; maxWidth: number }): Promise<{ dataUrl: string }>;
  pruneCapturedPhotos(options: { uris: string[] }): Promise<void>;
}

const native = registerPlugin<NativePhotoLinks>('PhotoLinks');

export async function addPhoto(source: 'gallery' | 'camera'): Promise<PhotoRef> {
  if (!Capacitor.isNativePlatform()) throw new Error('请在安卓应用中使用照片功能');
  const result = source === 'gallery' ? await native.pickPhoto() : await native.takePhoto();
  return { id: crypto.randomUUID(), uri: result.uri, name: result.name, source };
}

export async function photoData(uri: string, maxWidth = 1200): Promise<string> {
  if (!Capacitor.isNativePlatform()) throw new Error('照片只能在安卓应用中查看');
  const result = await native.readPhoto({ uri, maxWidth });
  return result.dataUrl;
}

export async function pruneCapturedPhotos(uris: string[]): Promise<void> {
  if (Capacitor.isNativePlatform()) await native.pruneCapturedPhotos({ uris });
}
