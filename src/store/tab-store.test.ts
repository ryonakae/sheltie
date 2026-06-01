import { describe, expect, it } from 'vitest';

import type { BoardNode } from '@/types';

import { omitKeys, patchNode } from './tab-store';

function sticky(id: string, x = 0): BoardNode {
  return { id, type: 'stickynote', x, y: 0, width: 100, height: 100 } as BoardNode;
}

describe('patchNode', () => {
  it('対象ノードだけ patch を適用した新配列を返す', () => {
    const nodes = [sticky('a', 0), sticky('b', 10)];
    const next = patchNode(nodes, 'b', (node) => ({ ...node, x: 99 }));
    expect(next).not.toBeNull();
    expect(next?.find((n) => n.id === 'b')?.x).toBe(99);
    // 非対象は同一参照を維持する
    expect(next?.find((n) => n.id === 'a')).toBe(nodes[0]);
  });

  it('patch が null を返したら全体で null（no-op）になる', () => {
    const nodes = [sticky('a')];
    expect(patchNode(nodes, 'a', () => null)).toBeNull();
  });

  it('対象 id が存在しなければ null を返す', () => {
    const nodes = [sticky('a')];
    expect(patchNode(nodes, 'missing', (node) => ({ ...node, x: 1 }))).toBeNull();
  });

  it('patch が同一参照を返したら no-op（null）になる', () => {
    const nodes = [sticky('a')];
    expect(patchNode(nodes, 'a', (node) => node)).toBeNull();
  });
});

describe('omitKeys', () => {
  it('単一 id を取り除く', () => {
    expect(omitKeys({ a: 1, b: 2, c: 3 }, 'b')).toEqual({ a: 1, c: 3 });
  });

  it('id 集合をまとめて取り除く', () => {
    expect(omitKeys({ a: 1, b: 2, c: 3 }, new Set(['a', 'c']))).toEqual({ b: 2 });
  });

  it('該当キーが無ければ内容を保持する', () => {
    expect(omitKeys({ a: 1 }, 'x')).toEqual({ a: 1 });
  });
});
