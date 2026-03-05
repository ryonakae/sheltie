export type EditCommand = 'undo' | 'redo' | 'delete';

interface EditCommandHandlers {
  undo: () => boolean | void;
  redo: () => boolean | void;
  delete: () => boolean | void;
}

let currentHandlers: EditCommandHandlers | null = null;

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable
  ) {
    return true;
  }
  return target.closest('[contenteditable="true"]') !== null;
}

export function hasEditableFocus(): boolean {
  return isEditableElement(document.activeElement);
}

export function registerEditCommandHandlers(handlers: EditCommandHandlers): () => void {
  currentHandlers = handlers;
  return () => {
    if (currentHandlers === handlers) {
      currentHandlers = null;
    }
  };
}

export function runEditCommand(command: EditCommand): boolean {
  if (!currentHandlers) return false;
  if (hasEditableFocus()) return false;

  if (command === 'undo') {
    return currentHandlers.undo() !== false;
  }
  if (command === 'redo') {
    return currentHandlers.redo() !== false;
  }
  return currentHandlers.delete() !== false;
}
