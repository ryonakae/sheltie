import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { setupProjectPersistence } from './store/tab-persistence';
import './index.css';

// React マウント前に永続化をセットアップ（zustand は External Store のため React ライフサイクル外で安全に呼び出せる）
setupProjectPersistence();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
