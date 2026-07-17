import { describe, expect, it } from 'vitest';

import {
  resolveBoardCaptureBounds,
  resolveBoardCaptureScale,
  resolveBoardCaptureSelection,
  resolveMissingScreenshotNodeIds,
} from '@/lib/mcp/board-screenshot';
import type { BoardEdge, BoardNode } from '@/types';

function node(id: string, overrides: Partial<BoardNode> = {}): BoardNode {
  return {
    id,
    type: 'text',
    title: id,
    url: '',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    fontSizePreset: 1,
    fontWeight: 'normal',
    italic: false,
    strikethrough: false,
    textColorIndex: 0,
    widthMode: 'fixed',
    ...overrides,
  } as BoardNode;
}

function edge(id: string, source: string, target: string): BoardEdge {
  return {
    id,
    source,
    sourceHandle: 'right',
    target,
    targetHandle: 'left',
    strokeWidth: 3,
    lineStyle: 'solid',
    colorPreset: 'default',
  };
}

describe('resolveBoardCaptureBounds', () => {
  it('includes padding around the world bounds', () => {
    expect(resolveBoardCaptureBounds([node('a', { width: 1000, height: 500 })], 64)).toEqual({
      x: -64,
      y: -64,
      width: 1128,
      height: 628,
    });
  });

  it('includes negative coordinates and WebPage chrome', () => {
    expect(
      resolveBoardCaptureBounds(
        [
          node('a', { x: -100, y: -50, width: 50, height: 40 }),
          node('web', { type: 'webpage', x: 100, y: 80, width: 200, height: 100 }),
        ],
        0,
      ),
    ).toEqual({ x: -100, y: -50, width: 432, height: 262 });
  });

  it('rejects an empty board', () => {
    expect(() => resolveBoardCaptureBounds([], 64)).toThrow(
      expect.objectContaining({ code: 'validation_failed' }),
    );
  });
});

describe('resolveBoardCaptureScale', () => {
  it('caps the longest side without upscaling', () => {
    expect(resolveBoardCaptureScale({ width: 4096, height: 1024 }, 2048)).toBe(0.5);
    expect(resolveBoardCaptureScale({ width: 800, height: 600 }, 2048)).toBe(1);
  });
});

describe('resolveBoardCaptureSelection', () => {
  const nodes = [node('a'), node('b'), node('c')];
  const edges = [edge('a-b', 'a', 'b'), edge('b-c', 'b', 'c')];

  it('preserves board order and includes edges only when both endpoints are selected', () => {
    const selection = resolveBoardCaptureSelection(nodes, edges, ['c', 'b']);

    expect(selection.includedNodeIds).toEqual(['b', 'c']);
    expect(selection.edges.map((candidate) => candidate.id)).toEqual(['b-c']);
  });

  it('selects the whole board when IDs are omitted', () => {
    expect(resolveBoardCaptureSelection(nodes, edges).includedNodeIds).toEqual(['a', 'b', 'c']);
  });

  it('rejects duplicates, unknown IDs, and an empty selected subset', () => {
    expect(() => resolveBoardCaptureSelection(nodes, edges, ['a', 'a'])).toThrow(
      expect.objectContaining({ code: 'validation_failed' }),
    );
    expect(() => resolveBoardCaptureSelection(nodes, edges, ['missing'])).toThrow(
      expect.objectContaining({ code: 'validation_failed' }),
    );
    expect(() => resolveBoardCaptureSelection(nodes, edges, [])).toThrow(
      expect.objectContaining({ code: 'validation_failed' }),
    );
  });
});

describe('resolveMissingScreenshotNodeIds', () => {
  it('reports included WebPages without cached screenshot images in board order', () => {
    const nodes = [node('a', { type: 'webpage' }), node('note'), node('b', { type: 'webpage' })];

    expect(resolveMissingScreenshotNodeIds(nodes, { b: 'asset://b.png' })).toEqual(['a']);
  });
});
