import { Toast } from '@heroui/react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useRef } from 'react';

import { getProjectDisplayName } from '@/lib/project-display-name';
import { api } from '@/lib/tauri-bridge';
import { ProjectScreen } from '@/screens/Project';
import { useProjectStore } from '@/store/tab-store';

export default function App() {
  const isLoaded = useProjectStore((s) => s.isLoaded);
  const project = useProjectStore((s) => s.project);
  const hasPresentedRef = useRef(false);

  useEffect(() => {
    if (!project) return;
    void getCurrentWindow()
      .setTitle(getProjectDisplayName(project))
      .catch((error) => {
        if (!import.meta.env.DEV) return;
        console.warn('[App] failed to update window title', error);
      });
  }, [project]);

  // 初回 commit 後に Rust 側に通知してウインドウを可視化する。
  // Rust 側は document window を visible(false) で生成しており、
  // React が描画準備を整えてからユーザーに見せることで白いフラッシュを防ぐ
  useEffect(() => {
    if (!isLoaded || hasPresentedRef.current) return;
    hasPresentedRef.current = true;
    void api.presentDocumentWindow().catch((error) => {
      console.error('[App] failed to present document window:', error);
    });
  }, [isLoaded]);

  // 保存済み状態の読み込み完了まで非表示
  // (Rust 側で visible(false) のためユーザーにはまだ見えていない)
  if (!isLoaded) return null;

  return (
    <div className="flex h-full select-none">
      <ProjectScreen key={project?.id ?? 'project'} />
      <Toast.Provider placement="bottom" />
    </div>
  );
}
