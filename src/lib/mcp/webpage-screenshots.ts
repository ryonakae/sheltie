import type { WebpageScreenshotCacheDescriptor } from '@/hooks/sheltie/useScreenshotCaptureQueue';

const MCP_SCREENSHOT_LONGEST_SIDE = 1024;

export type WebpageScreenshotResult =
  | {
      pageNodeId: string;
      freshness: 'cached';
      mimeType: 'image/png';
      base64: string;
      width: number;
      height: number;
      capturedAt: string;
      capturedUrl: string | null;
    }
  | {
      pageNodeId: string;
      freshness: 'missing';
    };

function screenshotFailed(message: string): never {
  throw {
    code: 'screenshot_failed',
    message,
    retry: 'Capture the WebPage again, then retry',
  };
}

export function resolveScreenshotOutputSize(
  width: number,
  height: number,
  longestSide: number,
): { width: number; height: number } {
  if (width <= 0 || height <= 0 || longestSide <= 0) {
    screenshotFailed('Screenshot has invalid dimensions');
  }
  const scale = Math.min(1, longestSide / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

async function loadImage(assetUrl: string): Promise<HTMLImageElement> {
  let response: Response;
  try {
    response = await fetch(assetUrl);
  } catch {
    screenshotFailed('Failed to read cached screenshot');
  }
  if (!response.ok) screenshotFailed('Failed to read cached screenshot');

  const objectUrl = URL.createObjectURL(await response.blob());
  const image = new Image();
  image.src = objectUrl;
  try {
    await image.decode();
    return image;
  } catch {
    screenshotFailed('Failed to decode cached screenshot');
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function encodeCachedScreenshot(
  descriptor: WebpageScreenshotCacheDescriptor & {
    entry: NonNullable<WebpageScreenshotCacheDescriptor['entry']>;
  },
): Promise<WebpageScreenshotResult> {
  const image = await loadImage(descriptor.entry.assetUrl);
  const size = resolveScreenshotOutputSize(
    image.naturalWidth,
    image.naturalHeight,
    MCP_SCREENSHOT_LONGEST_SIDE,
  );
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d');
  if (!context) screenshotFailed('Failed to create screenshot canvas');
  context.drawImage(image, 0, 0, size.width, size.height);
  const dataUrl = canvas.toDataURL('image/png');
  const prefix = 'data:image/png;base64,';
  if (!dataUrl.startsWith(prefix)) screenshotFailed('Failed to encode screenshot as PNG');

  return {
    pageNodeId: descriptor.pageNodeId,
    freshness: 'cached',
    mimeType: 'image/png',
    base64: dataUrl.slice(prefix.length),
    width: size.width,
    height: size.height,
    capturedAt: descriptor.entry.capturedAt,
    capturedUrl: descriptor.entry.capturedUrl,
  };
}

export async function encodeWebpageScreenshots(
  descriptors: WebpageScreenshotCacheDescriptor[],
): Promise<WebpageScreenshotResult[]> {
  return Promise.all(
    descriptors.map((descriptor) =>
      descriptor.entry
        ? encodeCachedScreenshot({ ...descriptor, entry: descriptor.entry })
        : Promise.resolve({
            pageNodeId: descriptor.pageNodeId,
            freshness: 'missing' as const,
          }),
    ),
  );
}
