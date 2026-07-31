import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  enterUnsavedChangesDialogDisplay,
  exitUnsavedChangesDialogDisplay,
  registerUnsavedChangesDialogDisplayController,
} from '@/lib/unsaved-changes-dialog-display';

describe('unsaved changes dialog display', () => {
  let unregister: (() => void) | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    unregister?.();
    unregister = null;
    vi.useRealTimers();
  });

  it('登録済み controller の enter は 1 回だけ呼ぶ', async () => {
    const enter = vi.fn();
    const exit = vi.fn();
    unregister = registerUnsavedChangesDialogDisplayController({ enter, exit });

    await enterUnsavedChangesDialogDisplay();
    await enterUnsavedChangesDialogDisplay();

    expect(enter).toHaveBeenCalledTimes(1);
    expect(exit).not.toHaveBeenCalled();
  });

  it('controller が未登録なら何もしない', async () => {
    await expect(enterUnsavedChangesDialogDisplay()).resolves.toBeUndefined();
  });

  it('exit は遅延するため、同じ tick の enter で打ち消される', async () => {
    const enter = vi.fn();
    const exit = vi.fn();
    unregister = registerUnsavedChangesDialogDisplayController({ enter, exit });

    await enterUnsavedChangesDialogDisplay();
    exitUnsavedChangesDialogDisplay();
    await enterUnsavedChangesDialogDisplay();
    vi.runAllTimers();

    expect(exit).not.toHaveBeenCalled();
    // 打ち消されたので enter は最初の 1 回だけ
    expect(enter).toHaveBeenCalledTimes(1);
  });

  it('後続の enter が無ければ遅延後に exit する', async () => {
    const enter = vi.fn();
    const exit = vi.fn();
    unregister = registerUnsavedChangesDialogDisplayController({ enter, exit });

    await enterUnsavedChangesDialogDisplay();
    exitUnsavedChangesDialogDisplay();
    vi.runAllTimers();

    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('enter していない状態の exit は無視する', () => {
    const enter = vi.fn();
    const exit = vi.fn();
    unregister = registerUnsavedChangesDialogDisplayController({ enter, exit });

    exitUnsavedChangesDialogDisplay();
    vi.runAllTimers();

    expect(exit).not.toHaveBeenCalled();
  });

  it('enter 済みで unregister すると exit する', async () => {
    const enter = vi.fn();
    const exit = vi.fn();
    const release = registerUnsavedChangesDialogDisplayController({ enter, exit });

    await enterUnsavedChangesDialogDisplay();
    release();

    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('controller の enter が throw しても entered 扱いにしない', async () => {
    const enter = vi.fn(() => {
      throw new Error('enter failed');
    });
    const exit = vi.fn();
    unregister = registerUnsavedChangesDialogDisplayController({ enter, exit });

    await expect(enterUnsavedChangesDialogDisplay()).resolves.toBeUndefined();

    exitUnsavedChangesDialogDisplay();
    vi.runAllTimers();
    expect(exit).not.toHaveBeenCalled();
  });
});
