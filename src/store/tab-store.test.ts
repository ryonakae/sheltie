import { beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_EDGE_STYLE } from '@/constants';
import type { BoardEdge, BoardNode, ScreenshotCacheEntry } from '@/types';

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

function screenshotEntry(
  nodeId: string,
  overrides: Partial<ScreenshotCacheEntry> = {},
): ScreenshotCacheEntry {
  return {
    assetUrl: `asset://${nodeId}.png`,
    filePath: `/tmp/${nodeId}.png`,
    capturedAt: '2026-07-17T12:00:00Z',
    capturedUrl: `https://${nodeId}.example`,
    ...overrides,
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

describe('screenshot cache provenance', () => {
  it('does not overwrite a newer in-memory entry during hydration', () => {
    const newer = screenshotEntry('a', { capturedAt: '2026-07-17T13:00:00Z' });
    const older = screenshotEntry('a', {
      assetUrl: 'asset://old.png',
      filePath: '/tmp/old.png',
      capturedAt: '2026-07-17T12:00:00Z',
    });
    useProjectStore.getState().setProjectScreenshotCacheEntry('a', newer);

    useProjectStore.getState().hydrateProjectScreenshotCache({ a: older });

    expect(useProjectStore.getState().webviewRuntime.screenshotCacheByNodeId.a).toEqual(newer);
  });

  it('replaces all provenance fields atomically after capture', () => {
    useProjectStore
      .getState()
      .setProjectScreenshotCacheEntry('a', screenshotEntry('a', { capturedUrl: null }));
    const fresh = screenshotEntry('fresh', {
      capturedAt: '2026-07-17T14:00:00Z',
      capturedUrl: 'https://fresh.example/path',
    });

    useProjectStore.getState().setProjectScreenshotCacheEntry('a', fresh);

    expect(useProjectStore.getState().webviewRuntime.screenshotCacheByNodeId.a).toEqual(fresh);
  });

  it('accepts restored legacy metadata with a null captured URL', () => {
    const legacy = screenshotEntry('a', { capturedUrl: null });

    useProjectStore.getState().hydrateProjectScreenshotCache({ a: legacy });

    expect(useProjectStore.getState().webviewRuntime.screenshotCacheByNodeId.a).toEqual(legacy);
  });

  it('removes cache provenance when its node is deleted', () => {
    useProjectStore.getState().initializeProject({
      untitledIndex: 1,
      document: { schemaVersion: 2, nodes: [documentWebpage('a')], edges: [] },
    });
    useProjectStore.getState().setProjectScreenshotCacheEntry('a', screenshotEntry('a'));

    useProjectStore.getState().removeNode('a');

    expect(useProjectStore.getState().webviewRuntime.screenshotCacheByNodeId).toEqual({});
  });
});

describe('applyMcpBoardBatch', () => {
  it('leaves project, history, and runtime deeply unchanged after validation failure', () => {
    useProjectStore.getState().initializeProject({
      untitledIndex: 1,
      document: { schemaVersion: 2, nodes: [documentWebpage('a')], edges: [] },
    });
    useProjectStore.getState().setWebNodeWebviewLabel('a', 'page-document-1-a');
    useProjectStore.getState().setProjectScreenshotCacheEntry('a', screenshotEntry('a'));
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
    useProjectStore.getState().setProjectScreenshotCacheEntry('a', screenshotEntry('a'));

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
      screenshotCacheByNodeId: {},
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
    useProjectStore.getState().setProjectScreenshotCacheEntry('a', screenshotEntry('a'));
    useProjectStore.getState().setWebNodeWebviewLabel('b', 'page-document-1-b');
    useProjectStore.getState().setProjectScreenshotCacheEntry('b', screenshotEntry('b'));

    const result = useProjectStore
      .getState()
      .applyMcpBoardBatch([{ op: 'delete_node', nodeId: 'a' }]);

    expect(result.ok).toBe(true);
    expect(useProjectStore.getState().webviewRuntime).toEqual({
      labelsByNodeId: { b: 'page-document-1-b' },
      screenshotCacheByNodeId: { b: screenshotEntry('b') },
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

describe('style / content actions の no-op 契約', () => {
  beforeEach(() => {
    useProjectStore.getState().initializeProject({
      untitledIndex: 1,
      document: {
        schemaVersion: 2,
        nodes: [
          {
            id: 's1',
            type: 'stickynote',
            title: 'S1',
            content: '',
            colorIndex: 0,
            fontSizePreset: 1,
            x: 0,
            y: 0,
            width: 200,
            height: 200,
          },
          {
            id: 't1',
            type: 'text',
            title: 'T1',
            tiptapContent: { type: 'doc', content: [] },
            fontSizePreset: 1,
            fontWeight: 'normal',
            italic: false,
            strikethrough: false,
            textColorIndex: 0,
            widthMode: 'auto',
            x: 0,
            y: 300,
            width: 100,
            height: 40,
          },
        ],
        edges: [],
      },
    });
  });

  it('同じ付箋スタイルの再適用では履歴を積まない', () => {
    useProjectStore.getState().updateStickyNoteStyle('s1', { colorIndex: 2 });
    expect(useProjectStore.getState().history.past).toHaveLength(1);

    useProjectStore.getState().updateStickyNoteStyle('s1', { colorIndex: 2 });
    expect(useProjectStore.getState().history.past).toHaveLength(1);
  });

  it('同じテキストスタイルの再適用では履歴を積まない', () => {
    useProjectStore.getState().updateTextNodeStyle('t1', { fontWeight: 'bold' });
    expect(useProjectStore.getState().history.past).toHaveLength(1);

    useProjectStore.getState().updateTextNodeStyle('t1', { fontWeight: 'bold' });
    expect(useProjectStore.getState().history.past).toHaveLength(1);
  });

  it('同じ tiptapContent の再適用では履歴を積まない', () => {
    const next = { type: 'doc', content: [{ type: 'paragraph' }] };

    useProjectStore.getState().updateTextNodeContent('t1', next);
    expect(useProjectStore.getState().history.past).toHaveLength(1);

    useProjectStore.getState().updateTextNodeContent('t1', { ...next });
    expect(useProjectStore.getState().history.past).toHaveLength(1);
  });

  it('値が変わる場合は履歴を積む', () => {
    useProjectStore.getState().updateStickyNoteStyle('s1', { colorIndex: 1 });
    useProjectStore.getState().updateStickyNoteStyle('s1', { colorIndex: 3 });

    expect(useProjectStore.getState().history.past).toHaveLength(2);
  });
});

describe('insertBoardContent', () => {
  beforeEach(() => {
    useProjectStore.getState().initializeProject({
      untitledIndex: 1,
      document: {
        schemaVersion: 2,
        nodes: [documentWebpage('a'), documentWebpage('b', 500)],
        edges: [edge()],
      },
    });
  });

  it('ノードとエッジを末尾に追加する（新規ノードが最前面）', () => {
    useProjectStore.getState().insertBoardContent({
      nodes: [sticky('n1', 100), sticky('n2', 200)],
      edges: [edge({ id: 'edge-n1-n2', source: 'n1', target: 'n2' })],
    });

    const project = useProjectStore.getState().project;
    expect(project?.nodes.map((node) => node.id)).toEqual(['a', 'b', 'n1', 'n2']);
    expect(project?.edges.map((item) => item.id)).toEqual(['edge-a-b', 'edge-n1-n2']);
  });

  it('Undo 1 回で追加した全ノード・エッジが消え、Redo で戻る', () => {
    useProjectStore.getState().insertBoardContent({
      nodes: [sticky('n1'), sticky('n2')],
      edges: [edge({ id: 'edge-n1-n2', source: 'n1', target: 'n2' })],
    });
    expect(useProjectStore.getState().history.past).toHaveLength(1);

    useProjectStore.getState().undoProject();
    expect(useProjectStore.getState().project?.nodes.map((node) => node.id)).toEqual(['a', 'b']);
    expect(useProjectStore.getState().project?.edges.map((item) => item.id)).toEqual(['edge-a-b']);

    useProjectStore.getState().redoProject();
    expect(useProjectStore.getState().project?.nodes.map((node) => node.id)).toEqual([
      'a',
      'b',
      'n1',
      'n2',
    ]);
    expect(useProjectStore.getState().project?.edges).toHaveLength(2);
  });

  it('スクリーンショットシードを runtime キャッシュへ反映し、既存エントリを壊さない', () => {
    useProjectStore.getState().setProjectScreenshotCacheEntry('a', screenshotEntry('a'));

    const seed = screenshotEntry('n1');
    useProjectStore.getState().insertBoardContent({
      nodes: [sticky('n1')],
      edges: [],
      screenshotSeedsByNodeId: { n1: seed },
    });

    expect(useProjectStore.getState().webviewRuntime.screenshotCacheByNodeId).toEqual({
      a: screenshotEntry('a'),
      n1: seed,
    });
  });

  it('ノードが空なら no-op（履歴を積まない）', () => {
    useProjectStore.getState().insertBoardContent({ nodes: [], edges: [] });

    expect(useProjectStore.getState().project?.nodes).toHaveLength(2);
    expect(useProjectStore.getState().history.past).toHaveLength(0);
  });

  it('既存 ID と衝突するノードは no-op にする', () => {
    useProjectStore.getState().insertBoardContent({ nodes: [sticky('a')], edges: [] });

    expect(useProjectStore.getState().project?.nodes).toHaveLength(2);
    expect(useProjectStore.getState().history.past).toHaveLength(0);
  });
});
