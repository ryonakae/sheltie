import { forwardRef, useCallback, useEffect, useRef } from 'react';

import Xmark from '@gravity-ui/icons/Xmark';

import { selectActiveProject, useProjectStore } from '@/renderer/store/tab-store';
import { AddPageForm } from '@/renderer/components/Canvas/AddPageForm';
import {
  DEFAULT_PAGE_HEIGHT,
  DEFAULT_PAGE_WIDTH,
  DEFAULT_VIEWPORT,
  isPageMoved,
} from '@/renderer/types/tab';

interface SidebarProps {
  initialWidth: number;
  selectedPageId: string | null;
  onSelectPage: (pageId: string) => void;
  /** サイドバー選択時にセンタリング完了したら呼ぶ */
  onCentered?: (pageId: string) => void;
}

/** アートボードの中心付近に収まる初期矩形を算出する */
function getCenteredFrame(viewportZoom: number, viewportPanX: number, viewportPanY: number) {
  const artboard = document.querySelector<HTMLElement>('[data-artboard-container]');
  if (!artboard) return null;

  const rect = artboard.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0 || viewportZoom <= 0) return null;

  const maxWorldWidth = rect.width / viewportZoom;
  const maxWorldHeight = rect.height / viewportZoom;
  const scale = Math.min(
    maxWorldWidth / DEFAULT_PAGE_WIDTH,
    maxWorldHeight / DEFAULT_PAGE_HEIGHT,
    1,
  );
  if (scale <= 0) return null;

  const width = Math.round(DEFAULT_PAGE_WIDTH * scale);
  const height = Math.round(DEFAULT_PAGE_HEIGHT * scale);

  const x = (rect.width / viewportZoom - width) / 2 - viewportPanX / viewportZoom;
  const y = (rect.height / viewportZoom - height) / 2 - viewportPanY / viewportZoom;

  return { x, y, width, height };
}

export const Sidebar = forwardRef<HTMLElement, SidebarProps>(function Sidebar(
  { initialWidth, selectedPageId, onSelectPage, onCentered },
  ref,
) {
  const activeProject = useProjectStore(selectActiveProject);
  const activeId = useProjectStore((s) => s.activeId);
  const addPage = useProjectStore((s) => s.addPage);
  const removePage = useProjectStore((s) => s.removePage);
  const updateViewport = useProjectStore((s) => s.updateViewport);
  const viewport = activeProject?.viewport;
  const centeringFrameRef = useRef<number | null>(null);

  const cancelCentering = useCallback(() => {
    if (centeringFrameRef.current !== null) {
      cancelAnimationFrame(centeringFrameRef.current);
      centeringFrameRef.current = null;
    }
  }, []);

  const ensureFrameVisible = useCallback(
    (target: { x: number; y: number; width: number; height: number }, onCentered?: () => void) => {
      const artboard = document.querySelector<HTMLElement>('[data-artboard-container]');
      if (!artboard || !viewport) return;
      const rect = artboard.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || viewport.zoom <= 0) return;

      const nextPanX = viewport.panX;
      const nextPanY = viewport.panY;
      const left = target.x * viewport.zoom + nextPanX;
      const top = target.y * viewport.zoom + nextPanY;
      const right = left + target.width * viewport.zoom;
      const bottom = top + target.height * viewport.zoom;

      let panX = nextPanX;
      let panY = nextPanY;

      const isOutsideX = left < 0 || right > rect.width;
      const isOutsideY = top < 0 || bottom > rect.height;

      if (isOutsideX) {
        panX = (rect.width - target.width * viewport.zoom) / 2 - target.x * viewport.zoom;
      }

      if (isOutsideY) {
        panY = (rect.height - target.height * viewport.zoom) / 2 - target.y * viewport.zoom;
      }

      if (panX === nextPanX && panY === nextPanY) {
        onCentered?.();
        return;
      }

      cancelCentering();
      const fromPanX = nextPanX;
      const fromPanY = nextPanY;
      const targetPanX = panX;
      const targetPanY = panY;
      const start = performance.now();
      const duration = 260;
      const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

      const animate = (now: number) => {
        const elapsed = now - start;
        const progress = Math.min(1, elapsed / duration);
        const eased = easeOutCubic(progress);
        const nextX = fromPanX + (targetPanX - fromPanX) * eased;
        const nextY = fromPanY + (targetPanY - fromPanY) * eased;
        updateViewport(activeId, { panX: nextX, panY: nextY });

        if (progress < 1) {
          centeringFrameRef.current = requestAnimationFrame(animate);
          return;
        }

        centeringFrameRef.current = null;
        onCentered?.();
      };

      centeringFrameRef.current = requestAnimationFrame(animate);
    },
    [activeId, updateViewport, viewport, cancelCentering],
  );

  useEffect(() => cancelCentering, [cancelCentering]);

  const handleAdd = useCallback(
    (url: string) => {
      const centered = getCenteredFrame(
        viewport?.zoom ?? DEFAULT_VIEWPORT.zoom,
        viewport?.panX ?? DEFAULT_VIEWPORT.panX,
        viewport?.panY ?? DEFAULT_VIEWPORT.panY,
      );
      const created = addPage(activeId, url, centered ? centered : undefined);
      if (created) {
        onSelectPage(created.id);
        ensureFrameVisible(created, () => onCentered?.(created.id));
      }
    },
    [addPage, activeId, viewport, ensureFrameVisible, onSelectPage, onCentered],
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
          {pages.map((page) => {
            const isSelected = selectedPageId === page.id;
            const addedUrl = page.addedUrl ?? page.url;

            return (
              <li
                key={page.id}
                className={`group flex items-start gap-1.5 rounded-md px-2 py-1.5 text-sm ${
                  isSelected ? 'bg-default-hover/80' : ''
                } hover:bg-default-hover`}
                onClick={() => {
                  onSelectPage(page.id);
                  ensureFrameVisible(page, () => onCentered?.(page.id));
                }}
                aria-current={isSelected ? 'true' : undefined}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-foreground" title={page.title || page.url}>
                    {page.title || page.url}
                    {isPageMoved(page) && <span className="ml-1 text-muted">(Moved)</span>}
                  </p>
                  <p className="truncate text-xs text-muted" title={addedUrl}>
                    {addedUrl}
                  </p>
                </div>
                <button
                  className="shrink-0 rounded-sm p-0.5 text-muted opacity-0 group-hover:opacity-100 hover:bg-background-tertiary hover:text-foreground"
                  onClick={(event) => {
                    event.stopPropagation();
                    removePage(activeId, page.id);
                  }}
                  aria-label="ページを削除"
                >
                  <Xmark className="size-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
});
