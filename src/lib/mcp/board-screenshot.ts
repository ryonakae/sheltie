import { TEXT_NODE_FONT_SIZE_PRESETS, WEB_PAGE_FRAME_PADDING } from '@/constants';
import { getNodeFrameRect } from '@/lib/sheltie-node-frame';
import type { BoardEdge, BoardNode } from '@/types';
import { isWebPageNode } from '@/types';

const BOARD_CAPTURE_PADDING = 64;
const BOARD_CAPTURE_MAXIMUM_SIDE = 2048;
const PNG_DATA_URL_PREFIX = 'data:image/png;base64,';
const IMAGE_LOAD_TIMEOUT_MS = 2_000;

const STICKY_NOTE_PALETTE = [
  { background: '#fef9c3', border: '#fde047', text: '#713f12' },
  { background: '#fce7f3', border: '#f9a8d4', text: '#831843' },
  { background: '#cffafe', border: '#67e8f9', text: '#164e63' },
  { background: '#d1fae5', border: '#6ee7b7', text: '#064e3b' },
] as const;

const TEXT_COLOR_PALETTE = ['#18181b', '#71717a', '#2563eb', '#16a34a', '#ca8a04', '#dc2626'];
const EDGE_COLOR_PALETTE: Record<BoardEdge['colorPreset'], string> = {
  default: '#a1a1aa',
  foreground: '#18181b',
  muted: '#71717a',
  accent: '#2563eb',
  success: '#16a34a',
  warning: '#ca8a04',
  danger: '#dc2626',
};

export interface BoardCaptureBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BoardCaptureSelection {
  nodes: BoardNode[];
  edges: BoardEdge[];
  includedNodeIds: string[];
}

export interface BoardScreenshotResult {
  mimeType: 'image/png';
  base64: string;
  width: number;
  height: number;
  worldBounds: BoardCaptureBounds;
  includedNodeIds: string[];
  missingScreenshotNodeIds: string[];
}

interface Point {
  x: number;
  y: number;
}

interface LoadedImage {
  image: HTMLImageElement;
  release: () => void;
}

function validationFailed(message: string): never {
  throw { code: 'validation_failed', message };
}

function screenshotFailed(message: string): never {
  throw {
    code: 'screenshot_failed',
    message,
    retry: 'Wait for the board renderer to finish loading, then retry',
  };
}

export function resolveBoardCaptureSelection(
  nodes: readonly BoardNode[],
  edges: readonly BoardEdge[],
  nodeIds?: readonly string[],
): BoardCaptureSelection {
  if (nodeIds && new Set(nodeIds).size !== nodeIds.length) {
    validationFailed('nodeIds must not contain duplicate IDs');
  }
  const liveIds = new Set(nodes.map((node) => node.id));
  const unknownIds = nodeIds?.filter((nodeId) => !liveIds.has(nodeId)) ?? [];
  if (unknownIds.length > 0) {
    validationFailed(`Unknown node IDs: ${unknownIds.join(', ')}`);
  }

  const requestedIds = nodeIds ? new Set(nodeIds) : null;
  const selectedNodes = requestedIds
    ? nodes.filter((node) => requestedIds.has(node.id))
    : [...nodes];
  if (selectedNodes.length === 0) validationFailed('Board screenshot requires at least one node');

  const selectedIds = new Set(selectedNodes.map((node) => node.id));
  return {
    nodes: selectedNodes,
    edges: edges.filter((edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target)),
    includedNodeIds: selectedNodes.map((node) => node.id),
  };
}

export function resolveBoardCaptureBounds(
  nodes: readonly Pick<BoardNode, 'type' | 'x' | 'y' | 'width' | 'height'>[],
  padding: number,
): BoardCaptureBounds {
  if (nodes.length === 0) validationFailed('Board screenshot requires at least one node');
  if (!Number.isFinite(padding) || padding < 0)
    validationFailed('Capture padding must be non-negative');

  const frames = nodes.map((node) => {
    if (![node.x, node.y, node.width, node.height].every(Number.isFinite)) {
      validationFailed('Board contains non-finite node geometry');
    }
    if (node.width <= 0 || node.height <= 0) {
      validationFailed('Board contains invalid node dimensions');
    }
    return getNodeFrameRect(node);
  });
  const left = Math.min(...frames.map((frame) => frame.left));
  const top = Math.min(...frames.map((frame) => frame.top));
  const right = Math.max(...frames.map((frame) => frame.right));
  const bottom = Math.max(...frames.map((frame) => frame.bottom));
  return {
    x: left - padding,
    y: top - padding,
    width: right - left + padding * 2,
    height: bottom - top + padding * 2,
  };
}

export function resolveBoardCaptureScale(
  bounds: Pick<BoardCaptureBounds, 'width' | 'height'>,
  maximumSide: number,
): number {
  if (
    !Number.isFinite(bounds.width) ||
    !Number.isFinite(bounds.height) ||
    bounds.width <= 0 ||
    bounds.height <= 0 ||
    !Number.isFinite(maximumSide) ||
    maximumSide <= 0
  ) {
    validationFailed('Board capture dimensions must be positive');
  }
  return Math.min(1, maximumSide / Math.max(bounds.width, bounds.height));
}

export function resolveMissingScreenshotNodeIds(
  nodes: readonly BoardNode[],
  screenshotUrlsByNodeId: Readonly<Record<string, string>>,
): string[] {
  return nodes
    .filter((node) => isWebPageNode(node) && !screenshotUrlsByNodeId[node.id])
    .map((node) => node.id);
}

function appendTiptapText(value: unknown, parts: string[]): void {
  if (!value || typeof value !== 'object') return;
  const node = value as { type?: unknown; text?: unknown; content?: unknown };
  if (node.type === 'text' && typeof node.text === 'string') parts.push(node.text);
  if (Array.isArray(node.content)) {
    for (const child of node.content) appendTiptapText(child, parts);
  }
  if (
    node.type === 'paragraph' ||
    node.type === 'heading' ||
    node.type === 'listItem' ||
    node.type === 'blockquote'
  ) {
    parts.push('\n');
  }
}

export function extractTiptapText(value: unknown): string {
  const parts: string[] = [];
  appendTiptapText(value, parts);
  return parts
    .join('')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function edgePoint(node: BoardNode, handle: string | null, source: boolean): Point {
  const frame = getNodeFrameRect(node);
  const fallback = source ? 'right' : 'left';
  switch (handle ?? fallback) {
    case 'left':
      return { x: frame.left, y: frame.top + frame.height / 2 };
    case 'top':
      return { x: frame.left + frame.width / 2, y: frame.top };
    case 'bottom':
      return { x: frame.left + frame.width / 2, y: frame.bottom };
    default:
      return { x: frame.right, y: frame.top + frame.height / 2 };
  }
}

export function resolveBoardEdgeGeometry(
  nodes: readonly BoardNode[],
  edge: BoardEdge,
): { from: Point; to: Point } | null {
  const source = nodes.find((node) => node.id === edge.source);
  const target = nodes.find((node) => node.id === edge.target);
  if (!source || !target) return null;
  return {
    from: edgePoint(source, edge.sourceHandle, true),
    to: edgePoint(target, edge.targetHandle, false),
  };
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const boundedRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + boundedRadius, y);
  context.arcTo(x + width, y, x + width, y + height, boundedRadius);
  context.arcTo(x + width, y + height, x, y + height, boundedRadius);
  context.arcTo(x, y + height, x, y, boundedRadius);
  context.arcTo(x, y, x + width, y, boundedRadius);
  context.closePath();
}

function drawWrappedText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maximumWidth: number,
  lineHeight: number,
  maximumHeight: number,
): void {
  let cursorY = y;
  const paragraphs = text.split('\n');
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && context.measureText(candidate).width > maximumWidth) {
        if (cursorY + lineHeight > y + maximumHeight) return;
        context.fillText(line, x, cursorY);
        cursorY += lineHeight;
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) {
      if (cursorY + lineHeight > y + maximumHeight) return;
      context.fillText(line, x, cursorY);
      cursorY += lineHeight;
    }
  }
}

function drawEdge(
  context: CanvasRenderingContext2D,
  nodes: readonly BoardNode[],
  edge: BoardEdge,
): void {
  const geometry = resolveBoardEdgeGeometry(nodes, edge);
  if (!geometry) return;
  const { from, to } = geometry;
  context.save();
  context.strokeStyle = EDGE_COLOR_PALETTE[edge.colorPreset];
  context.fillStyle = EDGE_COLOR_PALETTE[edge.colorPreset];
  context.lineWidth = edge.strokeWidth;
  context.setLineDash(edge.lineStyle === 'dashed' ? [12, 8] : []);
  context.beginPath();
  context.moveTo(from.x, from.y);
  context.lineTo(to.x, to.y);
  context.stroke();

  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const arrowSize = Math.max(10, edge.strokeWidth * 3);
  context.setLineDash([]);
  context.beginPath();
  context.moveTo(to.x, to.y);
  context.lineTo(
    to.x - arrowSize * Math.cos(angle - Math.PI / 6),
    to.y - arrowSize * Math.sin(angle - Math.PI / 6),
  );
  context.lineTo(
    to.x - arrowSize * Math.cos(angle + Math.PI / 6),
    to.y - arrowSize * Math.sin(angle + Math.PI / 6),
  );
  context.closePath();
  context.fill();
  context.restore();
}

function drawWebPage(
  context: CanvasRenderingContext2D,
  node: BoardNode,
  image: HTMLImageElement | undefined,
): void {
  const frame = getNodeFrameRect(node);
  context.save();
  context.shadowColor = 'rgba(0, 0, 0, 0.16)';
  context.shadowBlur = 12;
  context.shadowOffsetY = 4;
  roundedRect(context, frame.x, frame.y, frame.width, frame.height, 12);
  context.fillStyle = '#ffffff';
  context.fill();
  context.restore();

  const contentX = node.x + WEB_PAGE_FRAME_PADDING;
  const contentY = node.y + WEB_PAGE_FRAME_PADDING;
  context.save();
  roundedRect(context, contentX, contentY, node.width, node.height, 8);
  context.clip();
  context.fillStyle = '#f4f4f5';
  context.fillRect(contentX, contentY, node.width, node.height);
  if (image) context.drawImage(image, contentX, contentY, node.width, node.height);
  context.restore();

  context.fillStyle = 'rgba(24, 24, 27, 0.86)';
  context.fillRect(contentX, contentY, node.width, 32);
  context.fillStyle = '#ffffff';
  context.font = '600 14px system-ui, sans-serif';
  context.textBaseline = 'middle';
  const title = node.title || node.url || 'Web page';
  context.fillText(title, contentX + 12, contentY + 16, Math.max(0, node.width - 24));
}

function drawStickyNote(context: CanvasRenderingContext2D, node: BoardNode): void {
  const palette = STICKY_NOTE_PALETTE[node.colorIndex ?? 0] ?? STICKY_NOTE_PALETTE[0];
  context.save();
  context.shadowColor = 'rgba(0, 0, 0, 0.14)';
  context.shadowBlur = 10;
  context.shadowOffsetY = 3;
  roundedRect(context, node.x, node.y, node.width, node.height, 10);
  context.fillStyle = palette.background;
  context.fill();
  context.shadowColor = 'transparent';
  context.strokeStyle = palette.border;
  context.lineWidth = 1;
  context.stroke();
  context.fillStyle = palette.text;
  const fontSize = TEXT_NODE_FONT_SIZE_PRESETS[node.fontSizePreset ?? 1];
  context.font = `500 ${fontSize}px system-ui, sans-serif`;
  context.textBaseline = 'top';
  drawWrappedText(
    context,
    node.content ?? '',
    node.x + 18,
    node.y + 18,
    Math.max(0, node.width - 36),
    Math.round(fontSize * 1.45),
    Math.max(0, node.height - 36),
  );
  context.restore();
}

function drawTextNode(context: CanvasRenderingContext2D, node: BoardNode): void {
  const fontSize = TEXT_NODE_FONT_SIZE_PRESETS[node.fontSizePreset ?? 1];
  const fontStyle = node.italic ? 'italic' : 'normal';
  const fontWeight = node.fontWeight === 'bold' ? 700 : 400;
  context.save();
  context.fillStyle = TEXT_COLOR_PALETTE[node.textColorIndex ?? 0] ?? TEXT_COLOR_PALETTE[0];
  context.font = `${fontStyle} ${fontWeight} ${fontSize}px system-ui, sans-serif`;
  context.textBaseline = 'top';
  drawWrappedText(
    context,
    extractTiptapText(node.tiptapContent),
    node.x,
    node.y,
    node.width,
    Math.round(fontSize * 1.4),
    node.height,
  );
  context.restore();
}

async function loadImage(url: string): Promise<LoadedImage> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), IMAGE_LOAD_TIMEOUT_MS);
  let objectUrl: string | null = null;
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error('image request failed');
    objectUrl = URL.createObjectURL(await response.blob());
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('image decode failed'));
      image.src = objectUrl as string;
    });
    const releaseUrl = objectUrl;
    objectUrl = null;
    return { image, release: () => URL.revokeObjectURL(releaseUrl) };
  } finally {
    window.clearTimeout(timeoutId);
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

async function loadBoardImages(
  nodes: readonly BoardNode[],
  screenshotUrlsByNodeId: Readonly<Record<string, string>>,
): Promise<{ images: Map<string, LoadedImage>; failedNodeIds: string[] }> {
  const images = new Map<string, LoadedImage>();
  const failedNodeIds: string[] = [];
  await Promise.all(
    nodes.map(async (node) => {
      if (!isWebPageNode(node)) return;
      const url = screenshotUrlsByNodeId[node.id];
      if (!url) return;
      try {
        images.set(node.id, await loadImage(url));
      } catch {
        failedNodeIds.push(node.id);
      }
    }),
  );
  return { images, failedNodeIds };
}

export async function captureBoardScreenshot({
  nodes,
  edges,
  screenshotUrlsByNodeId,
  backgroundColor,
  nodeIds,
}: {
  viewportElement: HTMLElement | null;
  nodes: readonly BoardNode[];
  edges: readonly BoardEdge[];
  screenshotUrlsByNodeId: Readonly<Record<string, string>>;
  backgroundColor: string;
  nodeIds?: readonly string[];
}): Promise<BoardScreenshotResult> {
  const selection = resolveBoardCaptureSelection(nodes, edges, nodeIds);
  const bounds = resolveBoardCaptureBounds(selection.nodes, BOARD_CAPTURE_PADDING);
  const scale = resolveBoardCaptureScale(bounds, BOARD_CAPTURE_MAXIMUM_SIDE);
  const width = Math.max(1, Math.round(bounds.width * scale));
  const height = Math.max(1, Math.round(bounds.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) screenshotFailed('Canvas 2D is not available');

  const { images, failedNodeIds } = await loadBoardImages(selection.nodes, screenshotUrlsByNodeId);
  try {
    context.fillStyle = backgroundColor || '#f9fafb';
    context.fillRect(0, 0, width, height);
    context.save();
    context.scale(scale, scale);
    context.translate(-bounds.x, -bounds.y);
    for (const edge of selection.edges) drawEdge(context, selection.nodes, edge);
    for (const node of selection.nodes) {
      if (isWebPageNode(node)) drawWebPage(context, node, images.get(node.id)?.image);
      else if (node.type === 'stickynote') drawStickyNote(context, node);
      else drawTextNode(context, node);
    }
    context.restore();

    const dataUrl = canvas.toDataURL('image/png');
    if (!dataUrl.startsWith(PNG_DATA_URL_PREFIX)) {
      screenshotFailed('Board capture did not produce a PNG');
    }
    const missingScreenshotNodeIds = [
      ...resolveMissingScreenshotNodeIds(selection.nodes, screenshotUrlsByNodeId),
      ...failedNodeIds,
    ].filter((nodeId, index, values) => values.indexOf(nodeId) === index);
    return {
      mimeType: 'image/png',
      base64: dataUrl.slice(PNG_DATA_URL_PREFIX.length),
      width,
      height,
      worldBounds: bounds,
      includedNodeIds: selection.includedNodeIds,
      missingScreenshotNodeIds,
    };
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error) throw error;
    return screenshotFailed('Failed to render board screenshot');
  } finally {
    for (const loaded of images.values()) loaded.release();
  }
}
