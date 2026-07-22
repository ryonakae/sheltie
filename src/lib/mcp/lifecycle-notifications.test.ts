import { describe, expect, it, vi } from 'vitest';

import {
  setupMcpLifecycleToastListener,
  type McpLifecycleStatus,
} from '@/lib/mcp/lifecycle-notifications';

describe('setupMcpLifecycleToastListener', () => {
  it('MCPサーバーの起動成功をトーストで通知する', async () => {
    let notify: ((status: McpLifecycleStatus) => void) | undefined;
    const unlisten = vi.fn();
    const onLifecycleChanged = vi.fn((callback: (status: McpLifecycleStatus) => void) => {
      notify = callback;
      return Promise.resolve(unlisten);
    });
    const showSuccess = vi.fn();

    const cleanup = await setupMcpLifecycleToastListener(onLifecycleChanged, showSuccess);
    notify?.('started');

    expect(showSuccess).toHaveBeenCalledWith('MCP server started');
    cleanup();
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it('MCPサーバーの停止成功をトーストで通知する', async () => {
    let notify: ((status: McpLifecycleStatus) => void) | undefined;
    const onLifecycleChanged = (callback: (status: McpLifecycleStatus) => void) => {
      notify = callback;
      return Promise.resolve(() => {});
    };
    const showSuccess = vi.fn();

    await setupMcpLifecycleToastListener(onLifecycleChanged, showSuccess);
    notify?.('stopped');

    expect(showSuccess).toHaveBeenCalledWith('MCP server stopped');
  });
});
