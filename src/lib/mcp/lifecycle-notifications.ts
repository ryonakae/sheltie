import { toast } from '@heroui/react';

import { onMcpLifecycleChanged } from '@/lib/tauri-bridge';
import type { McpLifecycleStatus } from '@/lib/tauri-bridge';

export type { McpLifecycleStatus } from '@/lib/tauri-bridge';

type LifecycleListener = (callback: (status: McpLifecycleStatus) => void) => Promise<() => void>;

type ShowSuccessToast = (message: string) => unknown;

export function setupMcpLifecycleToastListener(
  onLifecycleChanged: LifecycleListener = onMcpLifecycleChanged,
  showSuccess: ShowSuccessToast = toast.success,
): Promise<() => void> {
  return onLifecycleChanged((status) => {
    showSuccess(status === 'started' ? 'MCP server started' : 'MCP server stopped');
  });
}
