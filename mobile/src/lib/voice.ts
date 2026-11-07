/** Voice in (on-device speech recognition) and out (text-to-speech). */

import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import * as Speech from 'expo-speech';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

type Handlers = { onText: (text: string, isFinal: boolean) => void; onEnd?: () => void; onError?: (message: string) => void };

/** Tap-to-dictate. Interim results stream into `onText`; `onEnd` fires when recognition stops (silence or manual). */
export function useDictation(handlers: Handlers) {
  const [listening, setListening] = useState(false);
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });

  useSpeechRecognitionEvent('start', () => setListening(true));
  useSpeechRecognitionEvent('end', () => {
    setListening(false);
    ref.current.onEnd?.();
  });
  useSpeechRecognitionEvent('result', (e) => ref.current.onText(e.results[0]?.transcript ?? '', e.isFinal));
  useSpeechRecognitionEvent('error', (e) => {
    setListening(false);
    if (e.error !== 'no-speech' && e.error !== 'aborted') ref.current.onError?.(e.message || e.error);
  });

  const start = useCallback(async () => {
    if (Platform.OS === 'web') return ref.current.onError?.('Voice input needs the Android app.');
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) return ref.current.onError?.('Microphone access was denied. Allow it in Android Settings → Apps → Hermes → Permissions.');
    ExpoSpeechRecognitionModule.start({ lang: Intl.DateTimeFormat().resolvedOptions().locale || 'en-US', interimResults: true, continuous: false });
  }, []);

  const stop = useCallback(() => ExpoSpeechRecognitionModule.stop(), []);
  return { listening, start, stop };
}

/** Strip markdown so the voice doesn't read out asterisks and code fences. */
export function plainSpeech(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' (code omitted) ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/[*_>~|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export const speak = (md: string) => {
  Speech.stop();
  Speech.speak(plainSpeech(md).slice(0, 3900), { language: Intl.DateTimeFormat().resolvedOptions().locale });
};
export const stopSpeaking = () => Speech.stop();
