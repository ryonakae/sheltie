import Globe from '@gravity-ui/icons/Globe';
import SquareDashed from '@gravity-ui/icons/SquareDashed';
import Sticker from '@gravity-ui/icons/Sticker';
import { animate, motion, useReducedMotion } from 'motion/react';
import { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import { twMerge } from 'tailwind-merge';

import { ContextMenu } from '@/components/Common/ContextMenu';
import { PAGE_CHROME_HEIGHT, STICKY_NOTE_COLORS } from '@/constants';
import { selectActiveProject, useProjectStore } from '@/store/tab-store';
import { type BoardNode, isNodeEmpty, isNodeMoved, isStickyNoteNode } from '@/types';

interface SidebarProps {
  initialWidth: number;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  onRemoveNode: (nodeId: string) => void;
  /** サイドバー選択時にセンタリング完了したら呼ぶ */
  onCentered?: (nodeId: string) => void;
}

type CenterTarget = Pick<BoardNode, 'id' | 'x' | 'y' | 'width' | 'height'>;

type FrameRect = {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
};

/** ノード本体（タイトルバー含む）を基準にセンタリングするため、必要に応じて実 DOM 幾何を取得する */
function getNodeFrameRect(siteboard: HTMLElement, nodeId: string | undefined): FrameRect | null {
  if (!nodeId) return null;
  const frame = siteboard.querySelector<HTMLElement>(`[data-node-id="${nodeId}"]`);
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
  { initialWidth, selectedNodeId, onSelectNode, onRemoveNode, onCentered },
  ref,
) {
  const activeProject = useProjectStore(selectActiveProject);
  const activeId = useProjectStore((s) => s.activeId);
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

  const [contextMenu, setContextMenu] = useState<{ nodeId: string; x: number; y: number } | null>(
    null,
  );

  const handleItemContextMenu = useCallback((e: React.MouseEvent, nodeId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ nodeId, x: e.clientX, y: e.clientY });
  }, []);

  const handleContextMenuClose = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleContextMenuAction = useCallback(
    (actionId: string) => {
      if (actionId === 'remove' && contextMenu) {
        onRemoveNode(contextMenu.nodeId);
      }
    },
    [contextMenu, onRemoveNode],
  );

  const ensureFrameVisible = useCallback(
    (target: CenterTarget, onCentered?: () => void) => {
      const siteboard = document.querySelector<HTMLElement>('[data-siteboard-container]');
      if (!siteboard || !viewport) return;
      const rect = siteboard.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || viewport.zoom <= 0) return;

      const nextPanX = viewport.panX;
      const nextPanY = viewport.panY;
      const frameRect = getNodeFrameRect(siteboard, target.id);

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

  const nodes = activeProject?.nodes ?? [];

  return (
    <aside
      ref={ref}
      className="flex shrink-0 flex-col gap-3 overflow-y-auto bg-default p-3"
      style={{ width: initialWidth }}
    >
      {nodes.length > 0 && (
        <ul className="flex flex-col gap-1">
          {nodes.map((node) => {
            const isSelected = selectedNodeId === node.id;
            const sticky = isStickyNoteNode(node);

            return (
              <motion.li
                key={node.id}
                className={twMerge(
                  'flex items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-default-hover',
                  isSelected ? 'bg-default-hover/80' : '',
                )}
                onClick={() => {
                  onSelectNode(node.id);
                  ensureFrameVisible(node, () => onCentered?.(node.id));
                }}
                onContextMenu={(e) => handleItemContextMenu(e, node.id)}
                aria-current={isSelected ? 'true' : undefined}
              >
                {sticky ? (
                  <Sticker
                    className={twMerge(
                      'mt-0.5 size-4 shrink-0',
                      STICKY_NOTE_COLORS[node.colorIndex ?? 0].textClass,
                    )}
                  />
                ) : isNodeEmpty(node) ? (
                  <SquareDashed className="mt-0.5 size-4 shrink-0 text-muted/60" />
                ) : (
                  <Globe className="mt-0.5 size-4 shrink-0 text-muted" />
                )}
                {sticky ? (
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-foreground">{node.title}</p>
                    <p className="truncate text-xs text-muted">
                      {node.content ? node.content.slice(0, 40) : 'テキストなし'}
                    </p>
                  </div>
                ) : (
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-foreground" title={node.title || node.url}>
                      {node.title || '新規ページ'}
                      {isNodeMoved(node) && <span className="ml-1 text-muted">(Moved)</span>}
                    </p>
                    <p className="truncate text-xs text-muted" title={node.addedUrl ?? node.url}>
                      {isNodeEmpty(node)
                        ? 'URL 未設定'
                        : (node.addedUrl ?? node.url)
                            .replace(/^https?:\/\//, '')
                            .replace(/\/$/, '')}
                    </p>
                  </div>
                )}
              </motion.li>
            );
          })}
        </ul>
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={[{ id: 'remove', label: 'ノードを削除', variant: 'danger' }]}
          onAction={handleContextMenuAction}
          onClose={handleContextMenuClose}
        />
      )}
    </aside>
  );
});
