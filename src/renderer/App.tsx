import { Canvas } from './components/Canvas/Canvas';
import { TabBar } from './components/TabBar/TabBar';
import { selectIsHome, useTabStore } from './store/tab-store';

export default function App() {
  const isLoaded = useTabStore((s) => s.isLoaded);
  const isHome = useTabStore(selectIsHome);
  const activeId = useTabStore((s) => s.activeId);

  // 保存済み状態の読み込み完了まで非表示
  // （BrowserWindow は ready-to-show まで show: false なのでユーザーには見えない）
  if (!isLoaded) return null;

  return (
    <div className="flex h-full flex-col">
      <TabBar />
      {isHome ? (
        <div className="flex flex-1 items-center justify-center">
          <span className="text-2xl font-semibold text-gray-400">Browser Artboard</span>
        </div>
      ) : (
        <Canvas key={activeId} />
      )}
    </div>
  );
}
