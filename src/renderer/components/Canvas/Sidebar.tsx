import { forwardRef, useCallback } from 'react';

import Xmark from '@gravity-ui/icons/Xmark';

import { selectActiveProject, useProjectStore } from '../../store/tab-store';
import { AddPageForm } from './AddPageForm';

interface SidebarProps {
  initialWidth: number;
}

export const Sidebar = forwardRef<HTMLElement, SidebarProps>(function Sidebar(
  { initialWidth },
  ref,
) {
  const activeProject = useProjectStore(selectActiveProject);
  const activeId = useProjectStore((s) => s.activeId);
  const addPage = useProjectStore((s) => s.addPage);
  const removePage = useProjectStore((s) => s.removePage);

  const handleAdd = useCallback(
    (url: string) => {
      addPage(activeId, url);
    },
    [addPage, activeId],
  );

  const pages = activeProject?.pages ?? [];

  return (
    <aside
      ref={ref}
      className="flex shrink-0 flex-col gap-3 overflow-y-auto bg-default p-3"
      style={{ width: initialWidth }}
    >
      <AddPageForm onAdd={handleAdd} />

      {/* ページ一覧 */}
      {pages.length > 0 && (
        <ul className="flex flex-col gap-1">
          {pages.map((page) => (
            <li
              key={page.id}
              className="group flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm hover:bg-default-hover"
            >
              <span className="min-w-0 flex-1 truncate text-foreground" title={page.url}>
                {page.title || page.url}
              </span>
              <button
                className="shrink-0 rounded-sm p-0.5 text-muted opacity-0 group-hover:opacity-100 hover:bg-background-tertiary hover:text-foreground"
                onClick={() => removePage(activeId, page.id)}
                aria-label="ページを削除"
              >
                <Xmark className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
});
