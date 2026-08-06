export { clipboardApi } from '@/lib/tauri-bridge/clipboard';
export { api } from '@/lib/tauri-bridge/project';
export { themeApi, getPlatformInfo } from '@/lib/tauri-bridge/theme';
export {
  onAppExitRequested,
  onEditCommand,
  onFileCommand,
  onMcpLifecycleChanged,
  onMcpRendererRequest,
  onViewCommand,
} from '@/lib/tauri-bridge/events';
export { webviewApi } from '@/lib/tauri-bridge/webview';
export type {
  AppExitSaveRequest,
  AppExitSaveResponse,
  AppExitStateRequest,
  AppExitStateResponse,
  AppExitStateSnapshot,
  FileCommand,
  McpLifecycleStatus,
  McpRendererRequest,
  McpRendererResponse,
  ViewCommand,
  NavigationState,
  PlatformInfo,
  SaveProjectStatus,
} from '@/lib/tauri-bridge/types';
