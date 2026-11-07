/** Pick or capture photos, shrink them for mobile data, and return OpenAI-style data URLs. */

import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

export type Attachment = { id: string; uri: string; dataUrl: string };

const MAX_EDGE = 1280;
export const MAX_ATTACHMENTS = 4;

async function shrink(uri: string, width: number): Promise<Attachment> {
  const ctx = ImageManipulator.ImageManipulator.manipulate(uri);
  if (width > MAX_EDGE) ctx.resize({ width: MAX_EDGE });
  const rendered = await ctx.renderAsync();
  const out = await rendered.saveAsync({ format: ImageManipulator.SaveFormat.JPEG, compress: 0.7, base64: true });
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, uri: out.uri, dataUrl: `data:image/jpeg;base64,${out.base64}` };
}

export async function pickFromLibrary(limit: number): Promise<Attachment[]> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error('Photo access was denied. Allow it in Android Settings → Apps → Hermes → Permissions.');
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: limit, quality: 1 });
  if (res.canceled) return [];
  return Promise.all(res.assets.slice(0, limit).map((a) => shrink(a.uri, a.width)));
}

export async function takePhoto(): Promise<Attachment | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) throw new Error('Camera access was denied. Allow it in Android Settings → Apps → Hermes → Permissions.');
  const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
  if (res.canceled || !res.assets[0]) return null;
  return shrink(res.assets[0].uri, res.assets[0].width);
}
