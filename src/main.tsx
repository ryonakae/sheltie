import { MotionConfig } from 'motion/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from '@/App';
import { setupAppExitCoordinator } from '@/lib/app-exit';
import { runEditCommand } from '@/lib/edit-commands';
import { runFileCommand } from '@/lib/file-commands';
import { onEditCommand, onFileCommand, onViewCommand } from '@/lib/tauri-bridge';
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
setupThemeListener();
setupEditCommandListener();
setupFileCommandListener();
setupViewCommandListener();
setupAppExitCoordinatorListener();
// 非同期で初期テーマを適用（React マウントをブロックしない）
void useThemeStore
  .getState()
  .initialize()
  .catch((error: unknown) => {
    console.error('[theme-store] 初期テーマの適用に失敗:', error);
  });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user" transition={{ duration: 0.22, ease: 'easeOut' }}>
      <App />
    </MotionConfig>
  </StrictMode>,
);
