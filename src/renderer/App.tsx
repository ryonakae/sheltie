import { Canvas } from './components/Canvas/Canvas';
import { HomeScreen } from './components/HomeScreen/HomeScreen';
import { TabBar } from './components/TabBar/TabBar';
import { selectIsHome, useProjectStore } from './store/tab-store';

export default function App() {
  const isLoaded = useProjectStore((s) => s.isLoaded);
  const isHome = useProjectStore(selectIsHome);
  const activeId = useProjectStore((s) => s.activeId);

  // 保存済み状態の読み込み完了まで非表示
  // (BaseWindow は ready-to-show まで show: false なのでユーザーには見えない)
  if (!isLoaded) return null;

  return (
    <div className="flex h-full flex-col">
      <TabBar />
      {isHome ? <HomeScreen /> : <Canvas key={activeId} />}
    </div>
  );
}
