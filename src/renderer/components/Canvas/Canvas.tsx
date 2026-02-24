import { useCallback, useEffect, useRef } from 'react';

import { selectActiveProject, useProjectStore } from '@/renderer/store/tab-store';
import { Artboard } from '@/renderer/components/Artboard/Artboard';
import { ResizeHandle } from '@/renderer/components/Canvas/ResizeHandle';
import { Sidebar } from '@/renderer/components/Canvas/Sidebar';

const SIDEBAR_MIN_WIDTH = 160;
const SIDEBAR_MAX_WIDTH = 480;
const SIDEBAR_DEFAULT_WIDTH = 320;

export function Canvas() {
  const activeProject = useProjectStore(selectActiveProject);
  const activeId = useProjectStore((s) => s.activeId);
  const updateSidebarWidth = useProjectStore((s) => s.updateSidebarWidth);

  const sidebarRef = useRef<HTMLElement>(null);
  const isResizing = useRef(false);
  const dragInfo = useRef({ startX: 0, startWidth: 0 });

  const sidebarWidth = activeProject?.sidebarWidth ?? SIDEBAR_DEFAULT_WIDTH;

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
      // サイドバー幅変更後に artboard の bounds を再同期する
      window.dispatchEvent(new Event('resize'));
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
      <Artboard />
    </div>
  );
}
