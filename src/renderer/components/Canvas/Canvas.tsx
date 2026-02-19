import { useCallback, useEffect, useRef } from 'react';

import { selectActiveTab, useTabStore } from '../../store/tab-store';
import { ResizeHandle } from './ResizeHandle';
import { Sidebar } from './Sidebar';

const SIDEBAR_MIN_WIDTH = 160;
const SIDEBAR_MAX_WIDTH = 480;
const SIDEBAR_DEFAULT_WIDTH = 320;

export function Canvas() {
  const activeTab = useTabStore(selectActiveTab);
  const activeId = useTabStore((s) => s.activeId);
  const updateSidebarWidth = useTabStore((s) => s.updateSidebarWidth);

  const sidebarRef = useRef<HTMLElement>(null);
  const isResizing = useRef(false);
  const dragInfo = useRef({ startX: 0, startWidth: 0 });

  const sidebarWidth = activeTab?.sidebarWidth ?? SIDEBAR_DEFAULT_WIDTH;

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    dragInfo.current = {
      startX: e.clientX,
      startWidth: sidebarRef.current?.offsetWidth ?? sidebarWidth,
    };
    document.body.style.userSelect = 'none';
  }, []);

  const handleDoubleClick = useCallback(() => {
    if (sidebarRef.current) {
      sidebarRef.current.style.width = `${SIDEBAR_DEFAULT_WIDTH}px`;
    }
    updateSidebarWidth(activeId, SIDEBAR_DEFAULT_WIDTH);
  }, [updateSidebarWidth, activeId]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      const { startX, startWidth } = dragInfo.current;
      const delta = e.clientX - startX;
      const newWidth = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, startWidth + delta));
      if (sidebarRef.current) {
        sidebarRef.current.style.width = `${newWidth}px`;
      }
    };

    const handleMouseUp = () => {
      if (!isResizing.current) return;
      isResizing.current = false;
      document.body.style.userSelect = '';
      if (sidebarRef.current) {
        updateSidebarWidth(activeId, sidebarRef.current.offsetWidth);
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [updateSidebarWidth, activeId]);

  return (
    <div className="flex flex-1 overflow-hidden">
      <Sidebar ref={sidebarRef} initialWidth={sidebarWidth} />
      <ResizeHandle onMouseDown={handleMouseDown} onDoubleClick={handleDoubleClick} />
      <main className="flex flex-1 items-center justify-center bg-white">
        <span className="text-sm text-gray-500">main</span>
      </main>
    </div>
  );
}
