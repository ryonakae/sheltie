import { describe, expect, it, vi } from 'vitest';

import {
  collectWebpageScreenshotCache,
  isCurrentScreenshotTarget,
} from '@/hooks/sheltie/useScreenshotCaptureQueue';
import { useProjectStore } from '@/store/tab-store';
import type { ScreenshotCacheEntry, WebPageNode } from '@/types';

function page(id: string): WebPageNode {
  return {
    id,
    type: 'webpage',
    title: id,
    url: `https://${id}.example`,
    x: 0,
    y: 0,
    width: 393,
    height: 852,
  };
}

function entry(id: string): ScreenshotCacheEntry {
  return {
    assetUrl: `asset://${id}.png`,
    filePath: `/tmp/${id}.png`,
    capturedAt: '2026-07-17T12:00:00Z',
    capturedUrl: `https://${id}.example`,
  };
}

describe('isCurrentScreenshotTarget', () => {
  it('rejects captures after the URL changes or node is removed', () => {
    useProjectStore.getState().initializeProject({
      untitledIndex: 1,
      document: {
        schemaVersion: 2,
        nodes: [{ ...page('a'), type: 'webpage' as const }],
        edges: [],
      },
    });
    const projectId = useProjectStore.getState().project?.id ?? '';

    expect(isCurrentScreenshotTarget(projectId, 'a', 'https://a.example')).toBe(true);
    useProjectStore.getState().changeWebNodeUrl('a', 'https://changed.example');
    expect(isCurrentScreenshotTarget(projectId, 'a', 'https://a.example')).toBe(false);
    useProjectStore.getState().removeNode('a');
    expect(isCurrentScreenshotTarget(projectId, 'a', 'https://changed.example')).toBe(false);
  });
});

describe('collectWebpageScreenshotCache', () => {
  it('returns requested pages in board order', async () => {
    const cache = { a: entry('a'), c: entry('c') };

    await expect(
      collectWebpageScreenshotCache({
        webPageNodes: [page('a'), page('b'), page('c')],
        pageNodeIds: ['c', 'a'],
        displayModes: {},
        captureScreenshot: vi.fn(),
        getCacheEntry: (id) => cache[id as keyof typeof cache] ?? null,
      }),
    ).resolves.toEqual([
      { pageNodeId: 'a', entry: cache.a },
      { pageNodeId: 'c', entry: cache.c },
    ]);
  });

  it('captures native pages only and tolerates capture failure', async () => {
    const captureScreenshot = vi.fn(async (id: string) => {
      if (id === 'a') throw new Error('capture failed');
      return true;
    });

    const result = await collectWebpageScreenshotCache({
      webPageNodes: [page('a'), page('b'), page('c')],
      displayModes: { a: 'native', b: 'screenshot', c: 'hidden' },
      captureScreenshot,
      getCacheEntry: (id) => (id === 'a' ? entry('a') : null),
    });

    expect(captureScreenshot).toHaveBeenCalledTimes(1);
    expect(captureScreenshot).toHaveBeenCalledWith('a');
    expect(result).toEqual([
      { pageNodeId: 'a', entry: entry('a') },
      { pageNodeId: 'b', entry: null },
      { pageNodeId: 'c', entry: null },
    ]);
  });

  it('rejects duplicates and unknown IDs', async () => {
    const base = {
      webPageNodes: [page('a')],
      displayModes: {},
      captureScreenshot: vi.fn(),
      getCacheEntry: () => null,
    };

    await expect(
      collectWebpageScreenshotCache({ ...base, pageNodeIds: ['a', 'a'] }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      collectWebpageScreenshotCache({ ...base, pageNodeIds: ['missing'] }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });
});
