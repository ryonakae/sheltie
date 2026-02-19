import { useCallback, useEffect, useRef } from 'react';
import { Button } from '@heroui/react';

const SIDEBAR_MIN_WIDTH = 160;
const SIDEBAR_MAX_WIDTH = 480;
const SIDEBAR_DEFAULT_WIDTH = 320;

export default function App() {
  const sidebarRef = useRef<HTMLElement>(null);
  const isResizing = useRef(false);
  const dragInfo = useRef({ startX: 0, startWidth: 0 });

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    dragInfo.current = {
      startX: e.clientX,
      startWidth: sidebarRef.current?.offsetWidth ?? SIDEBAR_DEFAULT_WIDTH,
    };
    document.body.style.userSelect = 'none';
  }, []);

  const handleDoubleClick = useCallback(() => {
    if (sidebarRef.current) {
      sidebarRef.current.style.width = `${SIDEBAR_DEFAULT_WIDTH}px`;
    }
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) {
        return;
      }
      const { startX, startWidth } = dragInfo.current;
      const delta = e.clientX - startX;
      const newWidth = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, startWidth + delta));
      if (sidebarRef.current) {
        sidebarRef.current.style.width = `${newWidth}px`;
      }
    };

    const handleMouseUp = () => {
      if (isResizing.current) {
        isResizing.current = false;
        document.body.style.userSelect = '';
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  return (
    <div className="flex h-full">
      <aside
        ref={sidebarRef}
        className="flex shrink-0 items-center justify-center bg-gray-100"
        style={{ width: SIDEBAR_DEFAULT_WIDTH }}
      >
        <span className="text-sm text-gray-500">side</span>
        <Button variant="primary">HeroUI テスト</Button>
      </aside>

      {/* リサイズハンドル */}
      <div
        className="w-1 shrink-0 cursor-col-resize bg-gray-200 hover:bg-blue-400"
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
      />

      <main className="flex flex-1 items-center justify-center bg-white">
        <span className="text-sm text-gray-500">main</span>
      </main>
    </div>
  );
}
