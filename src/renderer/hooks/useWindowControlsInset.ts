import { useEffect, useState } from 'react';

import { getPlatformInfo } from '@/renderer/lib/tauri-bridge';

interface WindowControlsOverlay {
  readonly visible: boolean;
  getTitlebarAreaRect(): DOMRect;
  addEventListener(type: 'geometrychange', listener: () => void): void;
  removeEventListener(type: 'geometrychange', listener: () => void): void;
}

/** WindowControlsOverlay の getTitlebarAreaRect を型安全に呼び出す */
function calcRightInset(): number {
  const wco = (navigator as Navigator & { windowControlsOverlay?: WindowControlsOverlay })
    .windowControlsOverlay;
  if (!wco?.visible) return 0;
  const rect = wco.getTitlebarAreaRect();
  return window.innerWidth - rect.width - rect.x;
}

/**
 * ウィンドウコントロール領域のインセット（px）を返す。
 * - macOS: 左インセット（トラフィックライト分）、右は 0
 * - Windows/Linux: 右インセット（コントロールボタン分）を動的取得、左は 0
 */
export function useWindowControlsInset(): { left: number; right: number } {
  const [platform, setPlatform] = useState<string>('');
  const [trafficLightWidth, setTrafficLightWidth] = useState(0);
  const [right, setRight] = useState(() => calcRightInset());

  useEffect(() => {
    getPlatformInfo()
      .then(({ platform: p, trafficLightWidth: tlw }) => {
        setPlatform(p);
        setTrafficLightWidth(tlw);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (platform === 'macos') return;

    const wco = (navigator as Navigator & { windowControlsOverlay?: WindowControlsOverlay })
      .windowControlsOverlay as WindowControlsOverlay | undefined;
    if (!wco) return;

    const handler = () => setRight(calcRightInset());
    wco.addEventListener('geometrychange', handler);
    return () => wco.removeEventListener('geometrychange', handler);
  }, [platform]);

  if (platform === 'macos') {
    return { left: trafficLightWidth, right: 0 };
  }

  return { left: 0, right };
}
