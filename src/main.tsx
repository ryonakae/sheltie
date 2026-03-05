import { MotionConfig } from 'motion/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from '@/App';
import { runEditCommand } from '@/lib/edit-commands';
import { onEditCommand } from '@/lib/tauri-bridge';
import { setupProjectPersistence } from '@/store/tab-persistence';
import { setupThemeListener, useThemeStore } from '@/store/theme-store';

import './index.css';

let isEditCommandListenerInitialized = false;
let editCommandUnlistenPromise: Promise<() => void> | null = null;
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

// React マウント前に永続化・テーマをセットアップ
setupProjectPersistence();
setupThemeListener();
setupEditCommandListener();
// 非同期で初期テーマを適用（React マウントをブロックしない）
void useThemeStore.getState().initialize();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user" transition={{ duration: 0.22, ease: 'easeOut' }}>
      <App />
    </MotionConfig>
  </StrictMode>,
);
