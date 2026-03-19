import { DragDropProvider } from '@dnd-kit/react';
import { isSortable } from '@dnd-kit/react/sortable';
import HouseFill from '@gravity-ui/icons/HouseFill';
import Plus from '@gravity-ui/icons/Plus';
import { motion } from 'motion/react';
import { twMerge } from 'tailwind-merge';
import { useShallow } from 'zustand/react/shallow';

import { AppButton } from '@/components/Common/AppButton';
import { TabItem } from '@/components/TabBar/TabItem';
import { ThemeToggle } from '@/components/TabBar/ThemeToggle';
import { HOME_ID } from '@/constants';
import { useWindowControlsInset } from '@/hooks/useWindowControlsInset';
import { requestProjectTabClose } from '@/lib/project-close';
import { isProjectDirty } from '@/lib/project-document';
import { useProjectStore } from '@/store/tab-store';

export function TabBar() {
  const { projects, openIds, activeId, setActive, createProject, reorderOpenProjects } =
    useProjectStore(
      useShallow((s) => ({
        projects: s.projects,
        openIds: s.openIds,
        activeId: s.activeId,
        setActive: s.setActive,
        createProject: s.createProject,
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
    // data-tauri-drag-region で Tauri のウィンドウドラッグ領域を指定
    <header
      className="flex h-9 shrink-0 items-stretch border-b border-border bg-default"
      data-tauri-drag-region
      style={{ paddingLeft: left, paddingRight: right }}
    >
      {/* ホームボタン: クリックでホームキャンバスに切り替え */}
      <motion.button
        className={twMerge(
          'ml-2 flex shrink-0 items-center border-r border-border px-3',
          isHomeActive
            ? 'bg-surface text-foreground'
            : 'text-muted hover:bg-default/50 hover:text-foreground',
        )}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        transition={{ duration: 0.15 }}
        onClick={() => setActive(HOME_ID)}
        aria-label="ホームに切り替え"
      >
        <HouseFill className="size-4" />
      </motion.button>

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
        {/* タブが少ない時の空き領域でもウィンドウドラッグできるよう data-tauri-drag-region を付与 */}
        <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto" data-tauri-drag-region>
          {openProjects.map((project, index) => (
            <TabItem
              key={project.id}
              project={project}
              index={index}
              isDirty={isProjectDirty(project)}
              isActive={project.id === activeId}
              onActivate={() => setActive(project.id)}
              onClose={() => {
                void requestProjectTabClose(project.id);
              }}
            />
          ))}
          {/* タブ追加ボタン: 最後のタブのすぐ右に配置 */}
          <AppButton
            className="mx-1 self-center"
            aria-label="プロジェクトを追加"
            onPress={() => createProject()}
          >
            <Plus className="size-4" />
          </AppButton>
        </div>
      </DragDropProvider>

      {/* テーマ切替ボタン: DragDropProvider の外、ウィンドウコントロールの左に配置 */}
      <div className="flex shrink-0 items-center px-1" data-tauri-drag-region>
        <ThemeToggle />
      </div>
    </header>
  );
}
