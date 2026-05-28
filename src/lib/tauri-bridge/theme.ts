import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

import type { ThemeMode } from '@/types';

import type { PlatformInfo } from './types';

const THEME_COMMAND_EVENT = 'theme-command';

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system';
}

export const themeApi = {
  loadTheme: (): Promise<ThemeMode> => invoke('load_theme'),

  setTheme: (mode: ThemeMode): Promise<boolean> => invoke('set_theme', { mode }),

  onThemeChanged: (callback: (isDark: boolean) => void): void => {
    void getCurrentWindow().onThemeChanged(({ payload }) => {
      callback(payload === 'dark');
    });
  },

  onThemeCommand: (callback: (mode: ThemeMode) => void): void => {
    void getCurrentWindow().listen<string>(THEME_COMMAND_EVENT, ({ payload }) => {
      if (isThemeMode(payload)) callback(payload);
    });
  },
};

export const getPlatformInfo = async (): Promise<PlatformInfo> => {
  const [platform, trafficLightWidth] = await invoke<[string, number]>('get_platform_info');
  return { platform, trafficLightWidth };
};
