import { useColorScheme } from 'react-native';

const light = {
  bg: '#F6F7F9', card: '#FFFFFF', text: '#111827', muted: '#6B7280', border: '#E5E7EB',
  accent: '#4F46E5', accentText: '#FFFFFF', userBubble: '#4F46E5', userText: '#FFFFFF',
  botBubble: '#FFFFFF', code: '#F3F4F6', danger: '#DC2626', warn: '#D97706', ok: '#059669',
};
const dark: typeof light = {
  bg: '#0B0D12', card: '#151821', text: '#F3F4F6', muted: '#9CA3AF', border: '#262A36',
  accent: '#818CF8', accentText: '#0B0D12', userBubble: '#4F46E5', userText: '#FFFFFF',
  botBubble: '#151821', code: '#1E2230', danger: '#F87171', warn: '#FBBF24', ok: '#34D399',
};

export type Theme = typeof light;
export const useTheme = (): Theme => (useColorScheme() === 'dark' ? dark : light);
export const mono = { fontFamily: 'monospace' as const };
