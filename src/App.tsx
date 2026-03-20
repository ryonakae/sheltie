import { Toast } from '@heroui/react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect } from 'react';

import { UnsavedChangesDialog } from '@/components/Common/UnsavedChangesDialog';
import { getProjectDisplayName } from '@/lib/project-display-name';
import { ProjectScreen } from '@/screens/Project';
import { useProjectStore } from '@/store/tab-store';

export default function App() {
  const isLoaded = useProjectStore((s) => s.isLoaded);
  const project = useProjectStore((s) => s.project);

  useEffect(() => {
    if (!project) return;
    void getCurrentWindow()
      .setTitle(getProjectDisplayName(project))
      .catch((error) => {
        if (!import.meta.env.DEV) return;
        console.warn('[App] window title 更新に失敗', error);
      });
  }, [project]);

  // 保存済み状態の読み込み完了まで非表示
  // (BaseWindow は ready-to-show まで show: false なのでユーザーには見えない)
  if (!isLoaded) return null;

  return (
    <div className="flex h-full select-none">
      <ProjectScreen key={project?.id ?? 'project'} />
      <UnsavedChangesDialog />
      <Toast.Provider placement="bottom" />
    </div>
  );
}
