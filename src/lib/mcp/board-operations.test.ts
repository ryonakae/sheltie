import { describe, expect, it } from 'vitest';

import { DEFAULT_EDGE_STYLE } from '@/constants';
import { applyBoardOperations } from '@/lib/mcp/board-operations';
import type { BoardEdge, BoardNode } from '@/types';

function webpage(id: string, x = 0): BoardNode {
  return {
    id,
    type: 'webpage',
    title: 'Untitled',
    url: '',
    x,
    y: 0,
    width: 393,
    height: 852,
  };
}

function edge(id: string, source = 'a', target = 'b'): BoardEdge {
  return {
    id,
    source,
    sourceHandle: 'right',
    target,
    targetHandle: 'left',
    ...DEFAULT_EDGE_STYLE,
  };
}

function sticky(id: string): BoardNode {
  return {
    id,
    type: 'stickynote',
    title: 'Sticky Note',
    url: '',
    content: '',
    colorIndex: 0,
    fontSizePreset: 1,
    x: 0,
    y: 0,
    width: 200,
    height: 200,
  };
}

describe('applyBoardOperations', () => {
  it('treats prototype-like temp IDs as ordinary unique strings', () => {
    const ids = ['node-a', 'node-b', 'edge-id'];
    const result = applyBoardOperations(
      { nodes: [], edges: [] },
      [
        { op: 'create_node', tempId: '__proto__', node: { type: 'webpage' } },
        { op: 'create_node', tempId: 'other', node: { type: 'webpage', x: 1000 } },
        {
          op: 'create_edge',
          tempId: 'edge',
          edge: {
            source: '__proto__',
            sourceHandle: 'right',
            target: 'other',
            targetHandle: 'left',
          },
        },
      ],
      () => ids.shift()!,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.hasOwn(result.tempIdMap, '__proto__')).toBe(true);
    expect(result.tempIdMap['__proto__']).toBe('node-a');
    expect(result.edges[0].source).toBe('node-a');
  });

  it('rejects explicit nulls and array edge patches from raw JSON', () => {
    const invalidNull = applyBoardOperations(
      { nodes: [], edges: [] },
      [
        {
          op: 'create_node',
          tempId: 'text',
          node: { type: 'text', fontWeight: null as unknown as 'bold' },
        },
      ],
      () => 'text-id',
    );
    expect(invalidNull.ok).toBe(false);

    const invalidArray = applyBoardOperations(
      {
        nodes: [webpage('a'), webpage('b', 1000)],
        edges: [edge('edge-a-b')],
      },
      [
        {
          op: 'update_edge',
          edgeId: 'edge-a-b',
          patch: [] as unknown as { strokeWidth: 6 },
        },
      ],
      () => 'unused',
    );
    expect(invalidArray.ok).toBe(false);
  });

  it('rejects invalid runtime scalar values before mutating local state', () => {
    const invalidGeometry = applyBoardOperations(
      { nodes: [], edges: [] },
      [
        {
          op: 'create_node',
          tempId: 'bad',
          node: { type: 'webpage', x: Number.NaN },
        },
      ],
      () => 'node-id',
    );
    expect(invalidGeometry.ok).toBe(false);

    const invalidTextStyle = applyBoardOperations(
      { nodes: [], edges: [] },
      [
        {
          op: 'create_node',
          tempId: 'bad',
          node: {
            type: 'text',
            fontWeight: 'heavy' as 'bold',
            italic: 'yes' as unknown as boolean,
          },
        },
      ],
      () => 'node-id',
    );
    expect(invalidTextStyle.ok).toBe(false);
  });

  it('rolls back local work and preserves the input snapshot on a later validation failure', () => {
    const snapshot = {
      nodes: [sticky('existing')],
      edges: [] as BoardEdge[],
    };
    const before = structuredClone(snapshot);
    const ids = ['created-1', 'created-2'];
    const result = applyBoardOperations(
      snapshot,
      [
        { op: 'create_node', tempId: 'duplicate', node: { type: 'text', text: 'One' } },
        { op: 'create_node', tempId: 'duplicate', node: { type: 'text', text: 'Two' } },
      ],
      () => ids.shift()!,
    );

    expect(result).toMatchObject({
      ok: false,
      changed: false,
      error: { operationIndex: 1, code: 'validation_failed' },
    });
    expect(snapshot).toEqual(before);
  });

  it('rejects type-incompatible patches and missing IDs', () => {
    const incompatible = applyBoardOperations(
      { nodes: [sticky('sticky-1')], edges: [] },
      [
        {
          op: 'update_node',
          nodeId: 'sticky-1',
          patch: { type: 'webpage', url: 'https://example.com' },
        },
      ],
      () => 'unused',
    );
    expect(incompatible).toMatchObject({
      ok: false,
      error: { operationIndex: 0, code: 'validation_failed' },
    });

    const missing = applyBoardOperations(
      { nodes: [], edges: [] },
      [{ op: 'delete_edge', edgeId: 'missing' }],
      () => 'unused',
    );
    expect(missing).toMatchObject({
      ok: false,
      error: { operationIndex: 0, code: 'validation_failed' },
    });
  });

  it('rejects edges involving non-webpage nodes or invalid handles', () => {
    const nonWebpage = applyBoardOperations(
      { nodes: [webpage('a'), sticky('sticky')], edges: [] },
      [
        {
          op: 'create_edge',
          tempId: 'edge',
          edge: {
            source: 'a',
            sourceHandle: 'right',
            target: 'sticky',
            targetHandle: 'left',
          },
        },
      ],
      () => 'edge-id',
    );
    expect(nonWebpage.ok).toBe(false);

    const invalidHandle = applyBoardOperations(
      { nodes: [webpage('a'), webpage('b', 1000)], edges: [] },
      [
        {
          op: 'create_edge',
          tempId: 'edge',
          edge: {
            source: 'a',
            sourceHandle: 'center' as 'right',
            target: 'b',
            targetHandle: 'left',
          },
        },
      ],
      () => 'edge-id',
    );
    expect(invalidHandle.ok).toBe(false);
  });

  it('replaces duplicate endpoint edges while preserving the existing style', () => {
    const existing = {
      ...edge('old-edge'),
      strokeWidth: 6 as const,
      lineStyle: 'dashed' as const,
      colorPreset: 'danger' as const,
    };
    const result = applyBoardOperations(
      {
        nodes: [webpage('a'), webpage('b', 1000)],
        edges: [existing],
      },
      [
        {
          op: 'create_edge',
          tempId: 'replacement',
          edge: {
            source: 'b',
            sourceHandle: 'left',
            target: 'a',
            targetHandle: 'right',
            style: { colorPreset: 'success' },
          },
        },
      ],
      () => 'new-edge',
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.edges).toEqual([
      {
        ...existing,
        id: 'new-edge',
        source: 'b',
        sourceHandle: 'left',
        target: 'a',
        targetHandle: 'right',
      },
    ]);
    expect(result.createdEdgeIds).toEqual(['new-edge']);
    expect(result.deletedEdgeIds).toEqual(['old-edge']);
  });

  it('creates an empty Tiptap paragraph for empty text', () => {
    const result = applyBoardOperations(
      { nodes: [], edges: [] },
      [{ op: 'create_node', tempId: 'text', node: { type: 'text', text: '' } }],
      () => 'text-id',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.nodes[0].tiptapContent).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph' }],
    });
  });

  it('reports changed false when valid operations are no-ops', () => {
    const original = sticky('sticky-1');
    const result = applyBoardOperations(
      { nodes: [original], edges: [] },
      [
        {
          op: 'update_node',
          nodeId: 'sticky-1',
          patch: { type: 'stickynote', content: '' },
        },
        { op: 'reorder_node', nodeId: 'sticky-1', position: 'front' },
      ],
      () => 'unused',
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changed).toBe(false);
    expect(result.updatedNodeIds).toEqual([]);
    expect(result.nodes).toEqual([original]);
  });

  it('deletes an existing edge', () => {
    const result = applyBoardOperations(
      {
        nodes: [webpage('a'), webpage('b', 1000)],
        edges: [edge('edge-a-b')],
      },
      [{ op: 'delete_edge', edgeId: 'edge-a-b' }],
      () => 'unused',
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.edges).toEqual([]);
    expect(result.deletedEdgeIds).toEqual(['edge-a-b']);
  });

  it('reorders non-webpage nodes while skipping webpage layers', () => {
    const result = applyBoardOperations(
      {
        nodes: [sticky('a'), webpage('web'), sticky('b'), { ...sticky('c'), type: 'text' }],
        edges: [],
      },
      [{ op: 'reorder_node', nodeId: 'a', position: 'forward' }],
      () => 'unused',
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.nodes.map((node) => node.id)).toEqual(['web', 'b', 'a', 'c']);
    expect(result.updatedNodeIds).toEqual(['a']);
  });

  it('updates and reverses an existing edge', () => {
    const result = applyBoardOperations(
      {
        nodes: [webpage('a'), webpage('b', 1000)],
        edges: [edge('edge-a-b')],
      },
      [
        { op: 'update_edge', edgeId: 'edge-a-b', patch: { strokeWidth: 6 } },
        { op: 'reverse_edge', edgeId: 'edge-a-b' },
      ],
      () => 'unused',
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.edges[0]).toMatchObject({
      source: 'b',
      sourceHandle: 'left',
      target: 'a',
      targetHandle: 'right',
      strokeWidth: 6,
    });
    expect(result.updatedEdgeIds).toEqual(['edge-a-b']);
  });

  it('deletes a node, cascades incident edges, and reports every deleted ID', () => {
    const result = applyBoardOperations(
      {
        nodes: [webpage('a'), webpage('b', 1000)],
        edges: [edge('edge-a-b')],
      },
      [{ op: 'delete_node', nodeId: 'a' }],
      () => 'unused',
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.nodes.map((node) => node.id)).toEqual(['b']);
    expect(result.edges).toEqual([]);
    expect(result.deletedNodeIds).toEqual(['a']);
    expect(result.deletedEdgeIds).toEqual(['edge-a-b']);
  });

  it('updates a node through its type-discriminated patch', () => {
    const result = applyBoardOperations(
      { nodes: [sticky('sticky-1')], edges: [] },
      [
        {
          op: 'update_node',
          nodeId: 'sticky-1',
          patch: { type: 'stickynote', content: 'Updated', colorIndex: 2 },
        },
      ],
      () => 'unused',
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.updatedNodeIds).toEqual(['sticky-1']);
    expect(result.nodes[0]).toMatchObject({ content: 'Updated', colorIndex: 2 });
  });
  it('resolves same-batch node temp IDs when creating an edge', () => {
    const ids = ['node-a', 'node-b', 'edge-a-b'];
    const result = applyBoardOperations(
      { nodes: [], edges: [] },
      [
        {
          op: 'create_node',
          tempId: 'a',
          node: { type: 'webpage', x: 0, y: 0 },
        },
        {
          op: 'create_node',
          tempId: 'b',
          node: { type: 'webpage', x: 1000, y: 0 },
        },
        {
          op: 'create_edge',
          tempId: 'edge',
          edge: {
            source: 'a',
            sourceHandle: 'right',
            target: 'b',
            targetHandle: 'left',
          },
        },
      ],
      () => ids.shift()!,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.edges).toEqual([
      {
        id: 'edge-a-b',
        source: 'node-a',
        sourceHandle: 'right',
        target: 'node-b',
        targetHandle: 'left',
        strokeWidth: 3,
        lineStyle: 'solid',
        colorPreset: 'default',
      },
    ]);
    expect(result.createdEdgeIds).toEqual(['edge-a-b']);
    expect(result.tempIdMap).toEqual({
      a: 'node-a',
      b: 'node-b',
      edge: 'edge-a-b',
    });
  });

  it('creates webpage, sticky note, and text nodes with deterministic IDs and defaults', () => {
    const ids = ['web-id', 'sticky-id', 'text-id'];
    const result = applyBoardOperations(
      { nodes: [], edges: [] },
      [
        {
          op: 'create_node',
          tempId: 'web',
          node: { type: 'webpage', url: 'https://example.com', x: 0, y: 0 },
        },
        {
          op: 'create_node',
          tempId: 'sticky',
          node: { type: 'stickynote', content: 'Finding', x: 1000, y: 0 },
        },
        {
          op: 'create_node',
          tempId: 'text',
          node: { type: 'text', text: 'Summary', x: 2000, y: 0 },
        },
      ],
      () => ids.shift()!,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.createdNodeIds).toEqual(['web-id', 'sticky-id', 'text-id']);
    expect(result.tempIdMap).toEqual({ web: 'web-id', sticky: 'sticky-id', text: 'text-id' });
    expect(result.nodes).toEqual([
      expect.objectContaining({
        id: 'web-id',
        type: 'webpage',
        title: 'example.com',
        url: 'https://example.com',
        addedUrl: 'https://example.com',
        width: 393,
        height: 852,
      }),
      expect.objectContaining({
        id: 'sticky-id',
        type: 'stickynote',
        title: 'Sticky Note',
        content: 'Finding',
        colorIndex: 0,
        fontSizePreset: 1,
        width: 200,
        height: 200,
      }),
      expect.objectContaining({
        id: 'text-id',
        type: 'text',
        title: 'Text',
        width: 200,
        height: 32,
        tiptapContent: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Summary' }] }],
        },
      }),
    ]);
  });
});
