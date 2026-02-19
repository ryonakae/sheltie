import { DragDropProvider } from '@dnd-kit/react';
import { isSortable } from '@dnd-kit/react/sortable';
import House from '@gravity-ui/icons/House';
import Plus from '@gravity-ui/icons/Plus';
import { Button } from '@heroui/react';
import { useShallow } from 'zustand/react/shallow';

import { HOME_ID } from '../../types/tab';
import { useTabStore } from '../../store/tab-store';
import { TabItem } from './TabItem';

export function TabBar() {
  const { tabs, activeId, setActive, addTab, removeTab, reorderTabs } = useTabStore(
    useShallow((s) => ({
      tabs: s.tabs,
      activeId: s.activeId,
      setActive: s.setActive,
      addTab: s.addTab,
      removeTab: s.removeTab,
      reorderTabs: s.reorderTabs,
    })),
  );

  const isHomeActive = activeId === HOME_ID;

  return (
    <header className="flex h-9 shrink-0 items-stretch border-b border-gray-200 bg-gray-100">
      {/* ホームボタン: クリックでホームキャンバスに切り替え */}
      <button
        className={[
          'flex shrink-0 cursor-pointer items-center border-r border-b-2 border-gray-200 px-3 transition-colors select-none',
          isHomeActive
            ? 'border-b-blue-500 bg-white text-gray-900'
            : 'border-b-transparent text-gray-500 hover:bg-gray-200/50 hover:text-gray-700',
        ].join(' ')}
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
          const newTabs = [...tabs];
          const [removed] = newTabs.splice(fromIndex, 1);
          newTabs.splice(toIndex, 0, removed);
          reorderTabs(newTabs);
        }}
      >
        <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
          {tabs.map((tab, index) => (
            <TabItem
              key={tab.id}
              tab={tab}
              index={index}
              isActive={tab.id === activeId}
              onActivate={() => setActive(tab.id)}
              onClose={() => removeTab(tab.id)}
            />
          ))}
        </div>
      </DragDropProvider>

      {/* タブ追加ボタン */}
      <Button
        isIconOnly
        variant="ghost"
        size="sm"
        className="mx-1 self-center"
        aria-label="タブを追加"
        onPress={() => addTab()}
      >
        <Plus className="size-4" />
      </Button>
    </header>
  );
}
