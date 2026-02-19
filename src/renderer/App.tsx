import { useCallback, useRef } from 'react';

const SIDEBAR_MIN_WIDTH = 160;
const SIDEBAR_MAX_WIDTH = 480;
const SIDEBAR_DEFAULT_WIDTH = 320;

export default function App() {
  const sidebarRef = useRef<HTMLElement>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarRef.current?.offsetWidth ?? SIDEBAR_DEFAULT_WIDTH;

    const onMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - startX;
      const newWidth = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, startWidth + delta));
      if (sidebarRef.current) {
        sidebarRef.current.style.width = `${newWidth}px`;
      }
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.userSelect = '';
    };

    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  return (
    <div className="flex h-full">
      <aside
        ref={sidebarRef}
        className="flex shrink-0 items-center justify-center bg-gray-100"
        style={{ width: SIDEBAR_DEFAULT_WIDTH }}
      >
        <span className="text-sm text-gray-500">side</span>
      </aside>

      {/* リサイズハンドル */}
      <div
        className="
          w-1 shrink-0 cursor-col-resize bg-gray-200
          hover:bg-blue-400
        "
        onMouseDown={handleMouseDown}
      />

      <main className="flex flex-1 items-center justify-center bg-white">
        <span className="text-sm text-gray-500">main</span>
      </main>
    </div>
  );
}
