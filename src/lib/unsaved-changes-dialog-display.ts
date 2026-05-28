export interface UnsavedChangesDialogDisplayController {
  enter: () => Promise<void> | void;
  exit: () => void;
}

let activeController: UnsavedChangesDialogDisplayController | null = null;
let isDialogDisplayEntered = false;
let pendingExitTimer: ReturnType<typeof setTimeout> | null = null;

export function registerUnsavedChangesDialogDisplayController(
  controller: UnsavedChangesDialogDisplayController,
): () => void {
  activeController = controller;

  return () => {
    if (pendingExitTimer !== null) {
      clearTimeout(pendingExitTimer);
      pendingExitTimer = null;
    }

    if (activeController !== controller) return;

    if (isDialogDisplayEntered) {
      isDialogDisplayEntered = false;
      try {
        controller.exit();
      } catch {
        // no-op
      }
    }

    activeController = null;
  };
}

export async function enterUnsavedChangesDialogDisplay(): Promise<void> {
  if (pendingExitTimer !== null) {
    clearTimeout(pendingExitTimer);
    pendingExitTimer = null;
  }

  if (isDialogDisplayEntered) return;

  const controller = activeController;
  if (!controller) return;

  try {
    await controller.enter();
  } catch {
    return;
  }
  if (activeController !== controller) return;

  isDialogDisplayEntered = true;
}

export function exitUnsavedChangesDialogDisplay(): void {
  if (!isDialogDisplayEntered || pendingExitTimer !== null) return;

  // アプリ終了で dirty project が連続して確認される時、いったん native に戻すと白フラッシュが出る。
  // 次の dialog open が同じ tick で来たら exit を打ち消せるように遅延させる。
  pendingExitTimer = setTimeout(() => {
    pendingExitTimer = null;

    if (!isDialogDisplayEntered) return;

    const controller = activeController;
    isDialogDisplayEntered = false;
    try {
      controller?.exit();
    } catch {
      // no-op
    }
  }, 0);
}
