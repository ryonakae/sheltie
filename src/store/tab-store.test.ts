import { beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_EDGE_STYLE } from '@/constants';
import type { BoardEdge, BoardNode } from '@/types';

import { omitKeys, patchNode, useProjectStore } from './tab-store';

function sticky(id: string, x = 0): BoardNode {
  return { id, type: 'stickynote', x, y: 0, width: 100, height: 100 } as BoardNode;
}

function documentWebpage(id: string, x = 0) {
  return {
    id,
    type: 'webpage' as const,
    title: id.toUpperCase(),
    url: '',
    x,
    y: 0,
    width: 393,
    height: 852,
  };
}

function edge(overrides: Partial<BoardEdge> = {}): BoardEdge {
  return {
    ...DEFAULT_EDGE_STYLE,
    id: 'edge-a-b',
    source: 'a',
    sourceHandle: 'right',
    target: 'b',
    targetHandle: 'left',
    ...overrides,
  };
}

beforeEach(() => {
  useProjectStore.getState().initializeProject({
    untitledIndex: 1,
    document: { schemaVersion: 2, nodes: [], edges: [edge()] },
  });
});

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

describe('edge actions', () => {
  it('スタイル変更を1履歴に記録しUndoで戻す', () => {
    const store = useProjectStore.getState();

    store.updateEdgeStyle('edge-a-b', { strokeWidth: 6 });

    expect(useProjectStore.getState().project?.edges[0].strokeWidth).toBe(6);
    expect(useProjectStore.getState().history.past).toHaveLength(1);

    useProjectStore.getState().undoProject();
    expect(useProjectStore.getState().project?.edges[0].strokeWidth).toBe(3);
  });

  it('逆向きの同一接続点を1履歴で置換しUndoで元の向きへ戻す', () => {
    const original = edge({
      id: 'old',
      strokeWidth: 6,
      lineStyle: 'dashed',
      colorPreset: 'danger',
    });
    useProjectStore.getState().initializeProject({
      untitledIndex: 1,
      document: { schemaVersion: 2, nodes: [], edges: [original] },
    });

    const incoming = edge({
      id: 'new',
      source: 'b',
      sourceHandle: 'left',
      target: 'a',
      targetHandle: 'right',
    });
    useProjectStore.getState().addEdge(incoming);

    expect(useProjectStore.getState().project?.edges).toEqual([
      { ...incoming, strokeWidth: 6, lineStyle: 'dashed', colorPreset: 'danger' },
    ]);
    expect(useProjectStore.getState().history.past).toHaveLength(1);

    useProjectStore.getState().undoProject();
    expect(useProjectStore.getState().project?.edges).toEqual([original]);
  });

  it('同じスタイルへの更新は履歴を追加しない', () => {
    useProjectStore.getState().updateEdgeStyle('edge-a-b', { strokeWidth: 3 });

    expect(useProjectStore.getState().history.past).toHaveLength(0);
  });

  it('方向反転を1履歴に記録しスタイルを維持してUndoする', () => {
    useProjectStore.getState().initializeProject({
      untitledIndex: 1,
      document: {
        schemaVersion: 2,
        nodes: [],
        edges: [edge({ strokeWidth: 6, lineStyle: 'dashed', colorPreset: 'warning' })],
      },
    });

    useProjectStore.getState().reverseEdge('edge-a-b');

    expect(useProjectStore.getState().project?.edges[0]).toMatchObject({
      source: 'b',
      sourceHandle: 'left',
      target: 'a',
      targetHandle: 'right',
      strokeWidth: 6,
      lineStyle: 'dashed',
      colorPreset: 'warning',
    });
    expect(useProjectStore.getState().history.past).toHaveLength(1);

    useProjectStore.getState().undoProject();
    expect(useProjectStore.getState().project?.edges[0]).toMatchObject({
      source: 'a',
      sourceHandle: 'right',
      target: 'b',
      targetHandle: 'left',
      strokeWidth: 6,
      lineStyle: 'dashed',
      colorPreset: 'warning',
    });
  });
});

describe('applyMcpBoardBatch', () => {
  it('leaves project, history, and runtime deeply unchanged after validation failure', () => {
    useProjectStore.getState().initializeProject({
      untitledIndex: 1,
      document: { schemaVersion: 2, nodes: [documentWebpage('a')], edges: [] },
    });
    useProjectStore.getState().setWebNodeWebviewLabel('a', 'page-document-1-a');
    useProjectStore.getState().setProjectScreenshotUrl('a', 'asset://a.png');
    const before = structuredClone({
      project: useProjectStore.getState().project,
      history: useProjectStore.getState().history,
      webviewRuntime: useProjectStore.getState().webviewRuntime,
    });

    const result = useProjectStore
      .getState()
      .applyMcpBoardBatch([{ op: 'delete_node', nodeId: 'missing' }]);

    expect(result.ok).toBe(false);
    expect({
      project: useProjectStore.getState().project,
      history: useProjectStore.getState().history,
      webviewRuntime: useProjectStore.getState().webviewRuntime,
    }).toEqual(before);
  });

  it('clears stale runtime labels and screenshots when a webpage URL changes', () => {
    useProjectStore.getState().initializeProject({
      untitledIndex: 1,
      document: {
        schemaVersion: 2,
        nodes: [
          { ...documentWebpage('a'), url: 'https://old.example', addedUrl: 'https://old.example' },
        ],
        edges: [],
      },
    });
    useProjectStore.getState().setWebNodeWebviewLabel('a', 'page-document-1-a');
    useProjectStore.getState().setProjectScreenshotUrl('a', 'asset://a.png');

    const result = useProjectStore.getState().applyMcpBoardBatch([
      {
        op: 'update_node',
        nodeId: 'a',
        patch: { type: 'webpage', url: 'https://new.example/path' },
      },
    ]);

    expect(result.ok).toBe(true);
    expect(useProjectStore.getState().webviewRuntime).toEqual({
      labelsByNodeId: {},
      screenshotUrlsByNodeId: {},
    });
    expect(useProjectStore.getState().project?.nodes[0]).toMatchObject({
      url: 'https://new.example/path',
      addedUrl: 'https://new.example/path',
      title: 'new.example',
    });
  });

  it('clears runtime labels and screenshots for deleted webpage nodes', () => {
    useProjectStore.getState().initializeProject({
      untitledIndex: 1,
      document: {
        schemaVersion: 2,
        nodes: [documentWebpage('a'), documentWebpage('b', 1000)],
        edges: [edge()],
      },
    });
    useProjectStore.getState().setWebNodeWebviewLabel('a', 'page-document-1-a');
    useProjectStore.getState().setProjectScreenshotUrl('a', 'asset://a.png');
    useProjectStore.getState().setWebNodeWebviewLabel('b', 'page-document-1-b');
    useProjectStore.getState().setProjectScreenshotUrl('b', 'asset://b.png');

    const result = useProjectStore
      .getState()
      .applyMcpBoardBatch([{ op: 'delete_node', nodeId: 'a' }]);

    expect(result.ok).toBe(true);
    expect(useProjectStore.getState().webviewRuntime).toEqual({
      labelsByNodeId: { b: 'page-document-1-b' },
      screenshotUrlsByNodeId: { b: 'asset://b.png' },
    });
  });

  it('does not add history for empty or no-op batches', () => {
    useProjectStore.getState().initializeProject({
      untitledIndex: 1,
      document: { schemaVersion: 2, nodes: [documentWebpage('a')], edges: [] },
    });

    const empty = useProjectStore.getState().applyMcpBoardBatch([]);
    const noOp = useProjectStore.getState().applyMcpBoardBatch([
      {
        op: 'update_node',
        nodeId: 'a',
        patch: { type: 'webpage', title: 'A' },
      },
    ]);

    expect(empty).toMatchObject({ ok: true, changed: false });
    expect(noOp).toMatchObject({ ok: true, changed: false });
    expect(useProjectStore.getState().history.past).toHaveLength(0);
  });

  it('records a multi-operation node and edge change as one undo entry', () => {
    const documentNodes = [
      {
        id: 'a',
        type: 'webpage' as const,
        title: 'A',
        url: '',
        x: 0,
        y: 0,
        width: 393,
        height: 852,
      },
      {
        id: 'b',
        type: 'webpage' as const,
        title: 'B',
        url: '',
        x: 1000,
        y: 0,
        width: 393,
        height: 852,
      },
    ];
    useProjectStore.getState().initializeProject({
      untitledIndex: 1,
      document: { schemaVersion: 2, nodes: documentNodes, edges: [edge()] },
    });

    const result = useProjectStore.getState().applyMcpBoardBatch([
      {
        op: 'update_node',
        nodeId: 'a',
        patch: { type: 'webpage', title: 'Updated A' },
      },
      {
        op: 'create_node',
        tempId: 'note',
        node: { type: 'stickynote', content: 'Finding', x: 2000, y: 0 },
      },
      { op: 'update_edge', edgeId: 'edge-a-b', patch: { strokeWidth: 6 } },
    ]);

    expect(result.ok).toBe(true);
    expect(useProjectStore.getState().history.past).toHaveLength(1);
    expect(useProjectStore.getState().project?.nodes).toHaveLength(3);
    expect(useProjectStore.getState().project?.edges[0].strokeWidth).toBe(6);

    useProjectStore.getState().undoProject();
    expect(useProjectStore.getState().project?.nodes.map((node) => node.id)).toEqual(['a', 'b']);
    expect(useProjectStore.getState().project?.nodes[0].title).toBe('A');
    expect(useProjectStore.getState().project?.edges[0].strokeWidth).toBe(3);
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
