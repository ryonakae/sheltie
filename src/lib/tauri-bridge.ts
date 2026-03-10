export { api } from '@/lib/tauri-bridge/project';
export { themeApi, getPlatformInfo } from '@/lib/tauri-bridge/theme';
export { onEditCommand, onFileCommand } from '@/lib/tauri-bridge/events';
export { webviewApi } from '@/lib/tauri-bridge/webview';
export type { FileCommand, NavigationState, PlatformInfo } from '@/lib/tauri-bridge/types';
