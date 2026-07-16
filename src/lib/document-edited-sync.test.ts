import { describe, expect, it, vi } from 'vitest';

import { createDocumentEditedSync } from './document-edited-sync';

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('createDocumentEditedSync', () => {
  it('先行する更新の完了後に次の更新を実行する', async () => {
    const firstUpdate = deferred();
    const update = vi
      .fn<(edited: boolean) => Promise<void>>()
      .mockImplementationOnce(() => firstUpdate.promise)
      .mockResolvedValueOnce();
    const sync = createDocumentEditedSync(update);

    const dirtyUpdate = sync(true);
    const cleanUpdate = sync(false);
    await Promise.resolve();

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenNthCalledWith(1, true);

    firstUpdate.resolve();
    await Promise.all([dirtyUpdate, cleanUpdate]);

    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenNthCalledWith(2, false);
  });

  it('先行する更新が失敗しても次の更新を実行する', async () => {
    const error = new Error('native update failed');
    const update = vi
      .fn<(edited: boolean) => Promise<void>>()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce();
    const sync = createDocumentEditedSync(update);

    const dirtyUpdate = sync(true);
    const cleanUpdate = sync(false);

    await expect(dirtyUpdate).rejects.toBe(error);
    await expect(cleanUpdate).resolves.toBeUndefined();
    expect(update).toHaveBeenNthCalledWith(1, true);
    expect(update).toHaveBeenNthCalledWith(2, false);
  });
});
