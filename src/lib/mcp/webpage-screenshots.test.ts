import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  encodePageScreenshotSource,
  resolvePageScreenshotSourceDescriptor,
  resolveScreenshotOutputSize,
} from '@/lib/mcp/webpage-screenshots';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveScreenshotOutputSize', () => {
  it('preserves images within the longest-side limit', () => {
    expect(resolveScreenshotOutputSize(800, 600, 1024)).toEqual({ width: 800, height: 600 });
  });

  it('scales landscape and portrait images proportionally', () => {
    expect(resolveScreenshotOutputSize(2048, 1024, 1024)).toEqual({ width: 1024, height: 512 });
    expect(resolveScreenshotOutputSize(600, 1200, 1024)).toEqual({ width: 512, height: 1024 });
  });

  it('rejects invalid image dimensions', () => {
    expect(() => resolveScreenshotOutputSize(0, 100, 1024)).toThrow(
      expect.objectContaining({ code: 'screenshot_failed' }),
    );
  });
});

describe('page screenshot source', () => {
  it('returns raw cached PNG bytes and decoded dimensions', async () => {
    const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Blob([pngBytes], { type: 'image/png' }))),
    );
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:cached-png'),
      revokeObjectURL: vi.fn(),
    });
    vi.stubGlobal(
      'Image',
      class {
        src = '';
        naturalWidth = 321;
        naturalHeight = 123;
        async decode() {}
      },
    );

    await expect(
      encodePageScreenshotSource('screenshot', 720, 500, {
        assetUrl: 'asset://cached.png',
        filePath: '/not-returned/cached.png',
        capturedAt: '2026-07-17T00:00:00.000Z',
        capturedUrl: 'https://example.com/',
      }),
    ).resolves.toEqual({
      displayMode: 'screenshot',
      cssViewportWidth: 720,
      cssViewportHeight: 500,
      cached: {
        base64: 'iVBORw0KGgo=',
        width: 321,
        height: 123,
        capturedAt: '2026-07-17T00:00:00.000Z',
        capturedUrl: 'https://example.com/',
      },
    });
  });

  it('preserves hidden mode and rejects unknown page IDs', () => {
    expect(resolvePageScreenshotSourceDescriptor('page-1', ['page-1'], {}, {})).toEqual({
      displayMode: 'hidden',
    });
    expect(() => resolvePageScreenshotSourceDescriptor('missing', ['page-1'], {}, {})).toThrow(
      expect.objectContaining({ code: 'page_not_found' }),
    );
  });
});
