import { create } from 'zustand';

import { themeApi } from '@/lib/tauri-bridge';
import { applyThemeToDocument } from '@/lib/theme';
import type { ThemeMode } from '@/types';

interface ThemeState {
  mode: ThemeMode;
  isDark: boolean;
  initialize: () => Promise<void>;
  setMode: (mode: ThemeMode) => Promise<void>;
}

export const useThemeStore = create<ThemeState>((set) => ({
  mode: 'system',
  isDark: false,

  initialize: async () => {
    const mode = await themeApi.loadTheme();
    // setTheme を呼んで OS ダークモード状態を取得
    const isDark = await themeApi.setTheme(mode);
    applyThemeToDocument(isDark);
    set({ mode, isDark });
  },

  setMode: async (mode: ThemeMode) => {
    const isDark = await themeApi.setTheme(mode);
    applyThemeToDocument(isDark);
    set({ mode, isDark });
  },
}));

/** OS テーマ変更イベントのリスナーを登録する。main.tsx から1回だけ呼び出す */
export function setupThemeListener(): void {
  themeApi.onThemeChanged((isDark: boolean) => {
    applyThemeToDocument(isDark);
    useThemeStore.setState({ isDark });
  });
}
