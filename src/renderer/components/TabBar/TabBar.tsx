import type React from 'react';

import { DragDropProvider } from '@dnd-kit/react';
import { isSortable } from '@dnd-kit/react/sortable';
import House from '@gravity-ui/icons/House';
import Plus from '@gravity-ui/icons/Plus';
import { Button } from '@heroui/react';
import { useShallow } from 'zustand/react/shallow';

import { HOME_ID } from '../../types/tab';
import { useProjectStore } from '../../store/tab-store';
import { useWindowControlsInset } from '../../hooks/useWindowControlsInset';
import { TabItem } from './TabItem';

export function TabBar() {
  const {
    projects,
    openIds,
    activeId,
    setActive,
    createProject,
    closeProject,
    reorderOpenProjects,
  } = useProjectStore(
    useShallow((s) => ({
      projects: s.projects,
      openIds: s.openIds,
      activeId: s.activeId,
      setActive: s.setActive,
      createProject: s.createProject,
      closeProject: s.closeProject,
      reorderOpenProjects: s.reorderOpenProjects,
    })),
  );

  // タブバーに表示するプロジェクトを openIds の順序で取得
  const openProjects = openIds
    .map((id) => projects.find((p) => p.id === id))
    .filter((p) => p !== undefined);

  const isHomeActive = activeId === HOME_ID;

  const { left, right } = useWindowControlsInset();

  return (
    <header
      className="flex h-9 shrink-0 items-stretch border-b border-gray-200 bg-gray-100"
      style={
        { WebkitAppRegion: 'drag', paddingLeft: left, paddingRight: right } as React.CSSProperties
      }
    >
      {/* ホームボタン: クリックでホームキャンバスに切り替え */}
      <button
        className={[
          'flex shrink-0 cursor-pointer items-center border-r border-b-2 border-gray-200 px-3 transition-colors select-none',
          isHomeActive
            ? 'border-b-blue-500 bg-white text-gray-900'
            : 'border-b-transparent text-gray-500 hover:bg-gray-200/50 hover:text-gray-700',
        ].join(' ')}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        onClick={() => setActive(HOME_ID)}
        aria-label="ホームに切り替え"
      >
        <House className="size-4" />
      </button>

      {/* タブリスト: DragDropProvider 内でタブの並び替えを管理 */}
      <DragDropProvider
        onDragEnd={(event) => {
          if (event.canceled) return;
          const { source } = event.operation;
          if (!source || !isSortable(source)) return;
          const fromIndex = source.initialIndex;
          const toIndex = source.index;
          if (fromIndex === toIndex) return;
          const newIds = [...openIds];
          const [removed] = newIds.splice(fromIndex, 1);
          newIds.splice(toIndex, 0, removed);
          reorderOpenProjects(newIds);
        }}
      >
        {/* コンテナは drag を継承し、タブが少ない時も空き領域でウィンドウドラッグ可能 */}
        <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
          {openProjects.map((project, index) => (
            <TabItem
              key={project.id}
              project={project}
              index={index}
              isActive={project.id === activeId}
              onActivate={() => setActive(project.id)}
              onClose={() => closeProject(project.id)}
            />
          ))}
          {/* タブ追加ボタン: 最後のタブのすぐ右に配置 */}
          <Button
            isIconOnly
            variant="ghost"
            size="sm"
            className="mx-1 self-center"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            aria-label="プロジェクトを追加"
            onPress={() => createProject()}
          >
            <Plus className="size-4" />
          </Button>
        </div>
      </DragDropProvider>
    </header>
  );
}
