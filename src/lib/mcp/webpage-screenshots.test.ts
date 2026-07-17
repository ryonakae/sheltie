import { describe, expect, it } from 'vitest';

import { resolveScreenshotOutputSize } from '@/lib/mcp/webpage-screenshots';

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
