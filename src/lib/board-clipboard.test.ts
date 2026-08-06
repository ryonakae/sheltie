import { describe, expect, it } from 'vitest';

import type { BoardEdge, BoardNode, Project } from '@/types';

import {
  BOARD_CLIPBOARD_PAYLOAD_TYPE,
  buildBoardClipboardPayload,
  buildBoardClipboardPlainText,
  materializeBoardClipboardPayload,
  parseBoardClipboardPayload,
} from './board-clipboard';

function webpageNode(overrides: Partial<BoardNode> = {}): BoardNode {
  return {
    id: 'w1',
    type: 'webpage',
    title: 'Example',
    url: 'https://example.com/',
    addedUrl: 'https://example.com/',
    x: 0,
    y: 0,
    width: 393,
    height: 852,
    ...overrides,
  } as BoardNode;
}

function stickyNode(overrides: Partial<BoardNode> = {}): BoardNode {
  return {
    id: 's1',
    type: 'stickynote',
    title: 'note',
    url: '',
    content: 'hello sticky',
    colorIndex: 2,
    fontSizePreset: 1,
    x: 100,
    y: 100,
    width: 200,
    height: 200,
    ...overrides,
  } as BoardNode;
}

function textNode(overrides: Partial<BoardNode> = {}): BoardNode {
  return {
    id: 't1',
    type: 'text',
    title: 'text',
    url: '',
    tiptapContent: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello text' }] }],
    },
    fontSizePreset: 1,
    fontWeight: 'normal',
    italic: false,
    strikethrough: false,
    textColorIndex: 0,
    widthMode: 'auto',
    x: 300,
    y: 300,
    width: 200,
    height: 32,
    ...overrides,
  } as BoardNode;
}

function edge(overrides: Partial<BoardEdge> = {}): BoardEdge {
  return {
    id: 'e1',
    source: 'w1',
    sourceHandle: 'right',
    target: 'w2',
    targetHandle: 'left',
    strokeWidth: 6,
    lineStyle: 'dashed',
    colorPreset: 'accent',
    ...overrides,
  };
}

function project(
  overrides: Partial<Pick<Project, 'id' | 'nodes' | 'edges'>> = {},
): Pick<Project, 'id' | 'nodes' | 'edges'> {
  return {
    id: 'project-1',
    nodes: [],
    edges: [],
    ...overrides,
  };
}

function sequentialIds(): () => string {
  let counter = 0;
  return () => {
    counter += 1;
    return `new-${counter}`;
  };
}

describe('buildBoardClipboardPayload', () => {
  it('選択 ID がプロジェクトに存在しないときは null を返す', () => {
    expect(buildBoardClipboardPayload(project({ nodes: [webpageNode()] }), ['missing'])).toBeNull();
    expect(buildBoardClipboardPayload(project({ nodes: [webpageNode()] }), [])).toBeNull();
  });

  it('選択ノードだけを nodes 配列順（= 重なり順）で含める', () => {
    const nodes = [webpageNode({ id: 'a' }), stickyNode({ id: 'b' }), textNode({ id: 'c' })];
    const payload = buildBoardClipboardPayload(project({ nodes }), ['c', 'a']);
    expect(payload?.nodes.map((node) => node.id)).toEqual(['a', 'c']);
    expect(payload?.type).toBe(BOARD_CLIPBOARD_PAYLOAD_TYPE);
    expect(payload?.version).toBe(1);
    expect(payload?.sourceProjectId).toBe('project-1');
  });

  it('両端が選択に含まれるエッジだけを含める', () => {
    const nodes = [webpageNode({ id: 'w1' }), webpageNode({ id: 'w2' }), webpageNode({ id: 'w3' })];
    const edges = [edge({ id: 'inside' }), edge({ id: 'outside', source: 'w1', target: 'w3' })];
    const payload = buildBoardClipboardPayload(project({ nodes, edges }), ['w1', 'w2']);
    expect(payload?.edges.map((item) => item.id)).toEqual(['inside']);
  });

  it('[Moved] な webpage の url と addedUrl を両方保持する', () => {
    const moved = webpageNode({
      url: 'https://example.com/deep',
      addedUrl: 'https://example.com/',
    });
    const payload = buildBoardClipboardPayload(project({ nodes: [moved] }), ['w1']);
    const node = payload?.nodes[0];
    expect(node?.type).toBe('webpage');
    expect(node).toMatchObject({
      url: 'https://example.com/deep',
      addedUrl: 'https://example.com/',
      title: 'Example',
    });
  });
});

describe('buildBoardClipboardPlainText', () => {
  it('webpage は URL、付箋は本文、テキストは抽出テキストを改行で連結する', () => {
    const nodes = [webpageNode(), stickyNode(), textNode()];
    const payload = buildBoardClipboardPayload(project({ nodes }), ['w1', 's1', 't1']);
    expect(buildBoardClipboardPlainText(payload!)).toBe(
      'https://example.com/\nhello sticky\nhello text',
    );
  });

  it('空の表現はスキップする', () => {
    const nodes = [webpageNode({ url: '', addedUrl: undefined }), stickyNode({ content: '' })];
    const payload = buildBoardClipboardPayload(project({ nodes }), ['w1', 's1']);
    expect(buildBoardClipboardPlainText(payload!)).toBe('');
  });
});

describe('parseBoardClipboardPayload', () => {
  it('build した payload の JSON を往復できる', () => {
    const nodes = [webpageNode({ id: 'w1' }), webpageNode({ id: 'w2' }), stickyNode()];
    const payload = buildBoardClipboardPayload(project({ nodes, edges: [edge()] }), [
      'w1',
      'w2',
      's1',
    ]);
    const parsed = parseBoardClipboardPayload(JSON.stringify(payload));
    expect(parsed).toEqual(payload);
  });

  it('JSON でない入力を拒否する', () => {
    expect(() => parseBoardClipboardPayload('not json')).toThrow();
  });

  it('type マーカーが違う payload を拒否する', () => {
    expect(() =>
      parseBoardClipboardPayload(
        JSON.stringify({ type: 'text/plain', version: 1, sourceProjectId: 'p', nodes: [] }),
      ),
    ).toThrow(/type mismatch/);
  });

  it('version が 1 以外の payload を拒否する', () => {
    const nodes = [webpageNode()];
    const payload = buildBoardClipboardPayload(project({ nodes }), ['w1']);
    expect(() => parseBoardClipboardPayload(JSON.stringify({ ...payload, version: 2 }))).toThrow(
      /version must be 1/,
    );
  });

  it('sourceProjectId が無い payload を拒否する', () => {
    const nodes = [webpageNode()];
    const payload = buildBoardClipboardPayload(project({ nodes }), ['w1'])!;
    const { sourceProjectId: _omitted, ...rest } = payload;
    expect(() => parseBoardClipboardPayload(JSON.stringify(rest))).toThrow(/sourceProjectId/);
  });

  it('nodes が空配列の payload を拒否する', () => {
    expect(() =>
      parseBoardClipboardPayload(
        JSON.stringify({
          type: BOARD_CLIPBOARD_PAYLOAD_TYPE,
          version: 1,
          sourceProjectId: 'p',
          nodes: [],
        }),
      ),
    ).toThrow(/non-empty/);
  });

  it('許可されない URL scheme のノードを拒否する', () => {
    const payload = buildBoardClipboardPayload(project({ nodes: [webpageNode()] }), ['w1'])!;
    const tampered = {
      ...payload,
      nodes: [{ ...payload.nodes[0], url: 'javascript:alert(1)' }],
    };
    expect(() => parseBoardClipboardPayload(JSON.stringify(tampered))).toThrow(/http or https/);
  });

  it('不正な strokeWidth のエッジを拒否する', () => {
    const nodes = [webpageNode({ id: 'w1' }), webpageNode({ id: 'w2' })];
    const payload = buildBoardClipboardPayload(project({ nodes, edges: [edge()] }), ['w1', 'w2'])!;
    const tampered = { ...payload, edges: [{ ...payload.edges[0], strokeWidth: 4 }] };
    expect(() => parseBoardClipboardPayload(JSON.stringify(tampered))).toThrow(/must be 3 or 6/);
  });
});

describe('materializeBoardClipboardPayload', () => {
  it('ノードとエッジの ID を再生成し、エッジ参照をリマップする', () => {
    const nodes = [webpageNode({ id: 'w1' }), webpageNode({ id: 'w2' })];
    const payload = buildBoardClipboardPayload(project({ nodes, edges: [edge()] }), ['w1', 'w2'])!;

    const result = materializeBoardClipboardPayload(payload, sequentialIds());

    expect(result.nodes.map((node) => node.id)).toEqual(['new-1', 'new-2']);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toMatchObject({
      id: 'new-3',
      source: 'new-1',
      target: 'new-2',
      sourceHandle: 'right',
      targetHandle: 'left',
      strokeWidth: 6,
      lineStyle: 'dashed',
      colorPreset: 'accent',
    });
  });

  it('sourceIdByNewId で新旧 ID の対応を返す', () => {
    const nodes = [webpageNode({ id: 'w1' }), stickyNode({ id: 's1' })];
    const payload = buildBoardClipboardPayload(project({ nodes }), ['w1', 's1'])!;

    const result = materializeBoardClipboardPayload(payload, sequentialIds());

    expect(result.sourceIdByNewId).toEqual({ 'new-1': 'w1', 'new-2': 's1' });
  });

  it('座標は元のまま保持する（配置は後段で決める）', () => {
    const payload = buildBoardClipboardPayload(project({ nodes: [stickyNode()] }), ['s1'])!;

    const result = materializeBoardClipboardPayload(payload, sequentialIds());

    expect(result.nodes[0]).toMatchObject({ x: 100, y: 100, width: 200, height: 200 });
    expect(result.nodes[0]).toMatchObject({ content: 'hello sticky', colorIndex: 2 });
  });
});
