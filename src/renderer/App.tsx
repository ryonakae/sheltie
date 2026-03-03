import { Toast } from '@heroui/react';

import { TabBar } from '@/renderer/components/TabBar/TabBar';
import { HomeScreen } from '@/renderer/screens/Home';
import { ProjectScreen } from '@/renderer/screens/Project';
import { selectIsHome, useProjectStore } from '@/renderer/store/tab-store';

export default function App() {
  const isLoaded = useProjectStore((s) => s.isLoaded);
  const isHome = useProjectStore(selectIsHome);
  const activeId = useProjectStore((s) => s.activeId);

  // 保存済み状態の読み込み完了まで非表示
  // (BaseWindow は ready-to-show まで show: false なのでユーザーには見えない)
  if (!isLoaded) return null;

  return (
    <div className="flex h-full flex-col select-none">
      <TabBar />
      {isHome ? <HomeScreen /> : <ProjectScreen key={activeId} />}
      <Toast.Provider placement="bottom" />
    </div>
  );
}
