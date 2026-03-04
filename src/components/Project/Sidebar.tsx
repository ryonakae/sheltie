import Xmark from '@gravity-ui/icons/Xmark';
import { animate, motion, useReducedMotion } from 'motion/react';
import { type MouseEvent, forwardRef, useCallback, useEffect, useRef } from 'react';
import { twMerge } from 'tailwind-merge';

import { PAGE_CHROME_HEIGHT, STICKY_NOTE_COLORS } from '@/constants';
import { selectActiveProject, useProjectStore } from '@/store/tab-store';
import { type Page, isPageEmpty, isPageMoved, isStickyNote } from '@/types';

interface SidebarProps {
  initialWidth: number;
  selectedPageId: string | null;
  onSelectPage: (pageId: string) => void;
  /** サイドバー選択時にセンタリング完了したら呼ぶ */
  onCentered?: (pageId: string) => void;
}

const pageListItemVariants = {
  rest: {},
  hover: {},
} as const;

const removeButtonVariants = {
  rest: { opacity: 0 },
  hover: { opacity: 1 },
} as const;

type CenterTarget = Pick<Page, 'id' | 'x' | 'y' | 'width' | 'height'>;

type FrameRect = {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
};

/** ページ本体（タイトルバー含む）を基準にセンタリングするため、必要に応じて実 DOM 幾何を取得する */
function getPageFrameRect(siteboard: HTMLElement, pageId: string | undefined): FrameRect | null {
  if (!pageId) return null;
  const frame = siteboard.querySelector<HTMLElement>(`[data-page-id="${pageId}"]`);
  if (!frame) return null;

  const rect = frame.getBoundingClientRect();
  return {
    left: rect.left,
    right: rect.right,
    top: rect.top,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
}

export const Sidebar = forwardRef<HTMLElement, SidebarProps>(function Sidebar(
  { initialWidth, selectedPageId, onSelectPage, onCentered },
  ref,
) {
  const activeProject = useProjectStore(selectActiveProject);
  const activeId = useProjectStore((s) => s.activeId);
  const removePage = useProjectStore((s) => s.removePage);
  const updateViewport = useProjectStore((s) => s.updateViewport);
  const viewport = activeProject?.viewport;
  const centeringAnimationRef = useRef<Array<{ stop: () => void }>>([]);
  const activeIdRef = useRef<string | null>(null);
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  const cancelCentering = useCallback(() => {
    centeringAnimationRef.current.forEach((animation) => animation.stop());
    centeringAnimationRef.current = [];
  }, []);

  const ensureFrameVisible = useCallback(
    (target: CenterTarget, onCentered?: () => void) => {
      const siteboard = document.querySelector<HTMLElement>('[data-siteboard-container]');
      if (!siteboard || !viewport) return;
      const rect = siteboard.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || viewport.zoom <= 0) return;

      const nextPanX = viewport.panX;
      const nextPanY = viewport.panY;
      const frameRect = getPageFrameRect(siteboard, target.id);

      const left = frameRect ? frameRect.left - rect.left : target.x * viewport.zoom + nextPanX;
      const top = frameRect ? frameRect.top - rect.top : target.y * viewport.zoom + nextPanY;
      const right = frameRect ? left + frameRect.width : left + target.width * viewport.zoom;
      const bottom = frameRect
        ? top + frameRect.height
        : top + (target.height + PAGE_CHROME_HEIGHT) * viewport.zoom;
      const frameWidth = frameRect ? frameRect.width : target.width * viewport.zoom;
      const frameHeight = frameRect
        ? frameRect.height
        : (target.height + PAGE_CHROME_HEIGHT) * viewport.zoom;

      let panX = nextPanX;
      let panY = nextPanY;

      const isFullyVisible = left >= 0 && right <= rect.width && top >= 0 && bottom <= rect.height;

      if (!isFullyVisible) {
        panX = (rect.width - frameWidth) / 2 - (left - nextPanX);
        panY = (rect.height - frameHeight) / 2 - (top - nextPanY);
      }

      if (panX === nextPanX && panY === nextPanY) {
        onCentered?.();
        return;
      }

      cancelCentering();
      if (prefersReducedMotion) {
        const id = activeIdRef.current ?? activeId;
        if (id) {
          updateViewport(id, { panX, panY });
        }
        onCentered?.();
        return;
      }

      let completed = false;
      const currentId = activeIdRef.current ?? activeId;
      const latestPan = { x: nextPanX, y: nextPanY };
      const updatePan = () => {
        if (!currentId) return;
        updateViewport(currentId, { panX: latestPan.x, panY: latestPan.y });
      };
      const handleComplete = () => {
        if (completed) return;
        completed = true;
        if (!currentId) return;
        centeringAnimationRef.current = [];
        updateViewport(currentId, { panX, panY });
        onCentered?.();
      };

      const xControls = animate(nextPanX, panX, {
        duration: 0.26,
        ease: [0.215, 0.61, 0.355, 1],
        onUpdate: (latestPanX: number) => {
          latestPan.x = latestPanX;
          updatePan();
        },
        onComplete: handleComplete,
      });
      const yControls = animate(nextPanY, panY, {
        duration: 0.26,
        ease: [0.215, 0.61, 0.355, 1],
        onUpdate: (latestPanY: number) => {
          latestPan.y = latestPanY;
          updatePan();
        },
        onComplete: handleComplete,
      });

      centeringAnimationRef.current = [xControls, yControls];
    },
    [activeId, updateViewport, viewport, cancelCentering, prefersReducedMotion],
  );

  useEffect(() => cancelCentering, [cancelCentering]);

  const pages = activeProject?.pages ?? [];

  return (
    <aside
      ref={ref}
      className="flex shrink-0 flex-col gap-3 overflow-y-auto bg-default p-3"
      style={{ width: initialWidth }}
    >
      {/* ページ一覧 */}
      {pages.length > 0 && (
        <ul className="flex flex-col gap-1">
          {pages.map((page) => {
            const isSelected = selectedPageId === page.id;
            const sticky = isStickyNote(page);

            return (
              <motion.li
                key={page.id}
                className={twMerge(
                  'flex items-start gap-1.5 rounded-md px-2 py-1.5 text-sm hover:bg-default-hover',
                  isSelected ? 'bg-default-hover/80' : '',
                )}
                variants={pageListItemVariants}
                initial="rest"
                whileHover="hover"
                onClick={() => {
                  onSelectPage(page.id);
                  ensureFrameVisible(page, () => onCentered?.(page.id));
                }}
                aria-current={isSelected ? 'true' : undefined}
              >
                {sticky ? (
                  /* 付箋: カラードット + タイトル + テキストプレビュー */
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1 truncate text-foreground">
                      <span
                        className={twMerge(
                          'inline-block size-2.5 shrink-0 rounded-full border',
                          STICKY_NOTE_COLORS[page.colorIndex ?? 0].bgClass,
                          STICKY_NOTE_COLORS[page.colorIndex ?? 0].borderClass,
                        )}
                      />
                      {page.title}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {page.content ? page.content.slice(0, 40) : 'テキストなし'}
                    </p>
                  </div>
                ) : (
                  /* Webページ: タイトル + URL */
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-foreground" title={page.title || page.url}>
                      {page.title || '新規ページ'}
                      {isPageMoved(page) && <span className="ml-1 text-muted">(Moved)</span>}
                    </p>
                    <p className="truncate text-xs text-muted" title={page.addedUrl ?? page.url}>
                      {isPageEmpty(page)
                        ? 'URL 未設定'
                        : (page.addedUrl ?? page.url)
                            .replace(/^https?:\/\//, '')
                            .replace(/\/$/, '')}
                    </p>
                  </div>
                )}
                <motion.button
                  variants={removeButtonVariants}
                  initial="rest"
                  className="shrink-0 rounded-sm p-0.5 text-muted hover:bg-background-tertiary hover:text-foreground"
                  onClick={(event: MouseEvent<HTMLButtonElement>) => {
                    event.stopPropagation();
                    removePage(activeId, page.id);
                  }}
                  aria-label="ページを削除"
                >
                  <Xmark className="size-3.5" />
                </motion.button>
              </motion.li>
            );
          })}
        </ul>
      )}
    </aside>
  );
});
