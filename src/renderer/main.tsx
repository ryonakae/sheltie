import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { setupProjectPersistence } from './store/tab-persistence';
import { setupThemeListener, useThemeStore } from './store/theme-store';
import './index.css';

// React マウント前に永続化・テーマをセットアップ
setupProjectPersistence();
setupThemeListener();
// 非同期で初期テーマを適用（React マウントをブロックしない）
void useThemeStore.getState().initialize();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
