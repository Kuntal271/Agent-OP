import { useColorScheme } from 'react-native';

import { useSettings } from '@/state/SettingsContext';

const light = {
  bg: '#F4F5FA', card: '#FFFFFF', surface: '#ECEEF6', text: '#0F172A', muted: '#64748B', border: '#D3D8E8',
  accent: '#4F46E5', accentText: '#FFFFFF', accentSoft: '#E4E7FF',
  userBubble: '#4F46E5', userText: '#FFFFFF', botBubble: '#FFFFFF',
  code: '#F1F3F9', danger: '#DC2626', dangerSoft: '#FDE8E8', warn: '#B45309', warnSoft: '#FEF3C7',
  ok: '#047857', okSoft: '#D9F5E8', overlay: 'rgba(15,23,42,0.5)', track: '#C3C9DC',
};
const dark: typeof light = {
  bg: '#0A0C12', card: '#141824', surface: '#1B2030', text: '#F1F5F9', muted: '#94A3B8', border: '#343C57',
  accent: '#8B93FF', accentText: '#0A0C12', accentSoft: '#232859',
  userBubble: '#4F46E5', userText: '#FFFFFF', botBubble: '#141824',
  code: '#1B2030', danger: '#F87171', dangerSoft: '#3B1D22', warn: '#FBBF24', warnSoft: '#3A2D10',
  ok: '#34D399', okSoft: '#12332A', overlay: 'rgba(0,0,0,0.65)', track: '#444D70',
};

export type Theme = typeof light;

export function useIsDark(): boolean {
  const system = useColorScheme();
  const { settings } = useSettings();
  return settings.themeMode === 'system' ? system === 'dark' : settings.themeMode === 'dark';
}

export const useTheme = (): Theme => (useIsDark() ? dark : light);

export const mono = { fontFamily: 'monospace' as const };
export const radius = { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 };
