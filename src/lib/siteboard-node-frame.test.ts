import { describe, expect, it } from 'vitest';

import type { BoardNode } from '@/types';

import {
  getNodeChromeHeight,
  getNodeChromeWidth,
  getNodeFrameHeight,
  getNodeFrameRect,
  getNodeFrameWidth,
} from './siteboard-node-frame';

// WEB_PAGE_FRAME_PADDING = 16 → webpage は左右上下 16px ずつ chrome を持つ
const WEBPAGE_CHROME = 32;

function webpage(x: number, y: number, width: number, height: number): BoardNode {
  return { type: 'webpage', x, y, width, height } as BoardNode;
}

function text(x: number, y: number, width: number, height: number): BoardNode {
  return { type: 'text', x, y, width, height } as BoardNode;
}

function sticky(x: number, y: number, width: number, height: number): BoardNode {
  return { type: 'stickynote', x, y, width, height } as BoardNode;
}

describe('getNodeChromeWidth / getNodeChromeHeight', () => {
  it('webpage は左右 / 上下それぞれ 32px の chrome を持つ', () => {
    const node = webpage(0, 0, 100, 100);
    expect(getNodeChromeWidth(node)).toBe(WEBPAGE_CHROME);
    expect(getNodeChromeHeight(node)).toBe(WEBPAGE_CHROME);
  });

  it('text / stickynote は chrome を持たない', () => {
    expect(getNodeChromeWidth(text(0, 0, 100, 100))).toBe(0);
    expect(getNodeChromeHeight(text(0, 0, 100, 100))).toBe(0);
    expect(getNodeChromeWidth(sticky(0, 0, 100, 100))).toBe(0);
    expect(getNodeChromeHeight(sticky(0, 0, 100, 100))).toBe(0);
  });
});

describe('getNodeFrameWidth / getNodeFrameHeight', () => {
  it('webpage は content + chrome', () => {
    const node = webpage(0, 0, 800, 600);
    expect(getNodeFrameWidth(node)).toBe(832);
    expect(getNodeFrameHeight(node)).toBe(632);
  });

  it('text / stickynote は content と一致', () => {
    expect(getNodeFrameWidth(text(0, 0, 200, 150))).toBe(200);
    expect(getNodeFrameHeight(text(0, 0, 200, 150))).toBe(150);
    expect(getNodeFrameWidth(sticky(0, 0, 200, 150))).toBe(200);
    expect(getNodeFrameHeight(sticky(0, 0, 200, 150))).toBe(150);
  });
});

describe('getNodeFrameRect', () => {
  it('webpage は x/y を原点として右下に chrome 込みのサイズを伸ばす', () => {
    const rect = getNodeFrameRect(webpage(10, 20, 100, 50));
    expect(rect).toEqual({
      x: 10,
      y: 20,
      width: 132,
      height: 82,
      left: 10,
      top: 20,
      right: 142,
      bottom: 102,
    });
  });

  it('text は chrome を持たないので content と一致', () => {
    const rect = getNodeFrameRect(text(0, 0, 100, 50));
    expect(rect).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      left: 0,
      top: 0,
      right: 100,
      bottom: 50,
    });
  });
});
