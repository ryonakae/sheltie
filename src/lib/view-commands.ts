import { hasEditableFocus } from '@/lib/edit-commands';
import type { ViewCommand } from '@/lib/tauri-bridge/types';

export type { ViewCommand };

interface ViewCommandHandlers {
  fitView: () => void;
  resetZoom: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
}

let currentHandlers: ViewCommandHandlers | null = null;

export function registerViewCommandHandlers(handlers: ViewCommandHandlers): () => void {
  currentHandlers = handlers;
  return () => {
    if (currentHandlers === handlers) {
      currentHandlers = null;
    }
  };
}

export function runViewCommand(command: ViewCommand): void {
  if (!currentHandlers) return;

  switch (command) {
    case 'fit-view':
      // Shift+1 はテキスト編集中に「!」を入力するため、editable フォーカス時はスキップ
      if (hasEditableFocus()) return;
      currentHandlers.fitView();
      break;
    case 'reset-zoom':
      currentHandlers.resetZoom();
      break;
    case 'zoom-in':
      currentHandlers.zoomIn();
      break;
    case 'zoom-out':
      currentHandlers.zoomOut();
      break;
  }
}
