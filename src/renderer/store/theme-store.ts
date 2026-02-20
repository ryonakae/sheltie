import { create } from 'zustand';

import type { ThemeMode } from '../../shared/types';
import { applyThemeToDocument } from '../lib/theme';

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
    const mode = await window.themeApi.loadTheme();
    // setTheme を呼んで nativeTheme.shouldUseDarkColors を取得
    const isDark = await window.themeApi.setTheme(mode);
    applyThemeToDocument(isDark);
    set({ mode, isDark });
  },

  setMode: async (mode: ThemeMode) => {
    const isDark = await window.themeApi.setTheme(mode);
    applyThemeToDocument(isDark);
    set({ mode, isDark });
  },
}));

/** OS テーマ変更イベントのリスナーを登録する。main.tsx から1回だけ呼び出す */
export function setupThemeListener(): void {
  window.themeApi.onThemeChanged((isDark: boolean) => {
    applyThemeToDocument(isDark);
    useThemeStore.setState({ isDark });
  });
}
