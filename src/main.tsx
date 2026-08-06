import { MotionConfig } from 'motion/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from '@/App';
import { setupAppExitCoordinator } from '@/lib/app-exit';
import { runEditCommand } from '@/lib/edit-commands';
import { runFileCommand } from '@/lib/file-commands';
import { setupMcpLifecycleToastListener } from '@/lib/mcp/lifecycle-notifications';
import { setupMcpRendererBridge } from '@/lib/mcp/renderer-bridge';
import { onEditCommand, onFileCommand, onViewCommand, webviewApi } from '@/lib/tauri-bridge';
import { runViewCommand } from '@/lib/view-commands';
import { setupProjectPersistence } from '@/store/tab-persistence';
import { setupThemeListener, useThemeStore } from '@/store/theme-store';

import './index.css';

let isEditCommandListenerInitialized = false;
let editCommandUnlistenPromise: Promise<() => void> | null = null;
let isFileCommandListenerInitialized = false;
let fileCommandUnlistenPromise: Promise<() => void> | null = null;
let isViewCommandListenerInitialized = false;
let viewCommandUnlistenPromise: Promise<() => void> | null = null;
let isAppExitCoordinatorInitialized = false;
let appExitCoordinatorCleanupPromise: Promise<() => void> | null = null;
let isMcpRendererBridgeInitialized = false;
let mcpRendererBridgeCleanupPromise: Promise<() => void> | null = null;
let isMcpLifecycleToastListenerInitialized = false;
let mcpLifecycleToastUnlistenPromise: Promise<() => void> | null = null;
type HotModule = { dispose: (callback: () => void) => void };

function setupEditCommandListener(): void {
  if (isEditCommandListenerInitialized) return;
  isEditCommandListenerInitialized = true;

  editCommandUnlistenPromise = onEditCommand((command) => {
    runEditCommand(command);
  });

  const hot = (import.meta as ImportMeta & { hot?: HotModule }).hot;
  if (hot) {
    hot.dispose(() => {
      if (editCommandUnlistenPromise) {
        void editCommandUnlistenPromise.then((unlisten) => unlisten());
      }
      editCommandUnlistenPromise = null;
      isEditCommandListenerInitialized = false;
    });
  }
}

function setupFileCommandListener(): void {
  if (isFileCommandListenerInitialized) return;
  isFileCommandListenerInitialized = true;

  fileCommandUnlistenPromise = onFileCommand((command) => {
    void runFileCommand(command);
  });

  const hot = (import.meta as ImportMeta & { hot?: HotModule }).hot;
  if (hot) {
    hot.dispose(() => {
      if (fileCommandUnlistenPromise) {
        void fileCommandUnlistenPromise.then((unlisten) => unlisten());
      }
      fileCommandUnlistenPromise = null;
      isFileCommandListenerInitialized = false;
    });
  }
}

function setupViewCommandListener(): void {
  if (isViewCommandListenerInitialized) return;
  isViewCommandListenerInitialized = true;

  viewCommandUnlistenPromise = onViewCommand((command) => {
    runViewCommand(command);
  });

  const hot = (import.meta as ImportMeta & { hot?: HotModule }).hot;
  if (hot) {
    hot.dispose(() => {
      if (viewCommandUnlistenPromise) {
        void viewCommandUnlistenPromise.then((unlisten) => unlisten());
      }
      viewCommandUnlistenPromise = null;
      isViewCommandListenerInitialized = false;
    });
  }
}

function setupMcpLifecycleNotificationListener(): void {
  if (isMcpLifecycleToastListenerInitialized) return;
  isMcpLifecycleToastListenerInitialized = true;

  mcpLifecycleToastUnlistenPromise = setupMcpLifecycleToastListener();

  const hot = (import.meta as ImportMeta & { hot?: HotModule }).hot;
  if (hot) {
    hot.dispose(() => {
      if (mcpLifecycleToastUnlistenPromise) {
        void mcpLifecycleToastUnlistenPromise.then((unlisten) => unlisten());
      }
      mcpLifecycleToastUnlistenPromise = null;
      isMcpLifecycleToastListenerInitialized = false;
    });
  }
}

function setupMcpRendererBridgeListener(): void {
  if (isMcpRendererBridgeInitialized) return;
  isMcpRendererBridgeInitialized = true;

  mcpRendererBridgeCleanupPromise = setupMcpRendererBridge();

  const hot = (import.meta as ImportMeta & { hot?: HotModule }).hot;
  if (hot) {
    hot.dispose(() => {
      if (mcpRendererBridgeCleanupPromise) {
        void mcpRendererBridgeCleanupPromise.then((cleanup) => cleanup());
      }
      mcpRendererBridgeCleanupPromise = null;
      isMcpRendererBridgeInitialized = false;
    });
  }
}

function setupAppExitCoordinatorListener(): void {
  if (isAppExitCoordinatorInitialized) return;
  isAppExitCoordinatorInitialized = true;

  appExitCoordinatorCleanupPromise = setupAppExitCoordinator();

  const hot = (import.meta as ImportMeta & { hot?: HotModule }).hot;
  if (hot) {
    hot.dispose(() => {
      if (appExitCoordinatorCleanupPromise) {
        void appExitCoordinatorCleanupPromise.then((cleanup) => cleanup());
      }
      appExitCoordinatorCleanupPromise = null;
      isAppExitCoordinatorInitialized = false;
    });
  }
}

// React マウント前に永続化・テーマをセットアップ
setupProjectPersistence();
// 起動ごとに 1 回だけ、TTL を超えたスクリーンショットキャッシュを回収する
void webviewApi.pruneScreenshotCache().catch((error: unknown) => {
  // 起動は妨げないが、握り潰すと permission 漏れのような設定ミスに気付けない
  console.error('[screenshot-cache] failed to prune:', error);
});
setupThemeListener();
setupEditCommandListener();
setupFileCommandListener();
setupViewCommandListener();
setupMcpLifecycleNotificationListener();
setupMcpRendererBridgeListener();
setupAppExitCoordinatorListener();
// 非同期で初期テーマを適用（React マウントをブロックしない）
void useThemeStore
  .getState()
  .initialize()
  .catch((error: unknown) => {
    console.error('[theme-store] failed to apply initial theme:', error);
  });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user" transition={{ duration: 0.22, ease: 'easeOut' }}>
      <App />
    </MotionConfig>
  </StrictMode>,
);
