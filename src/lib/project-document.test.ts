import { describe, expect, it } from 'vitest';

import type {
  BoardEdge,
  BoardNode,
  Project,
  SiteboardDocumentNode,
  SiteboardDocumentV2,
} from '@/types';

import {
  boardEdgeToDocumentEdge,
  boardNodeToDocumentNode,
  createProjectDocument,
  documentEdgeToBoardEdge,
  documentNodeToBoardNode,
  isProjectDirty,
  parseProjectDocument,
  sanitizeProjectDocument,
  serializeProjectDocument,
} from './project-document';

function webpageNode(overrides: Partial<BoardNode> = {}): BoardNode {
  return {
    id: 'w1',
    type: 'webpage',
    title: 'Example',
    url: 'https://example.com',
    x: 0,
    y: 0,
    width: 800,
    height: 600,
    ...overrides,
  } as BoardNode;
}

function stickyNode(overrides: Partial<BoardNode> = {}): BoardNode {
  return {
    id: 's1',
    type: 'stickynote',
    title: 'note',
    url: '',
    content: 'hello',
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
    tiptapContent: { type: 'doc', content: [] },
    fontSizePreset: 1,
    fontWeight: 'normal',
    italic: false,
    strikethrough: false,
    textColorIndex: 0,
    widthMode: 'auto',
    x: 200,
    y: 200,
    width: 150,
    height: 50,
    ...overrides,
  } as BoardNode;
}

function emptyDocument(): SiteboardDocumentV2 {
  return { schemaVersion: 2, nodes: [], edges: [] };
}

describe('boardNodeToDocumentNode', () => {
  it('webpage は url / addedUrl を保持する', () => {
    const doc = boardNodeToDocumentNode(webpageNode({ addedUrl: 'https://orig.example' }));
    expect(doc).toEqual({
      id: 'w1',
      type: 'webpage',
      title: 'Example',
      url: 'https://example.com',
      addedUrl: 'https://orig.example',
      x: 0,
      y: 0,
      width: 800,
      height: 600,
    });
  });

  it('stickynote の content / colorIndex / fontSizePreset が無い場合はデフォルトを埋める', () => {
    const minimal: BoardNode = {
      id: 's2',
      type: 'stickynote',
      title: '',
      url: '',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    } as BoardNode;
    const doc = boardNodeToDocumentNode(minimal);
    expect(doc).toMatchObject({ content: '', colorIndex: 0, fontSizePreset: 1 });
  });

  it('text ノードのデフォルトは fontWeight=normal / italic=false / widthMode=auto', () => {
    const minimal: BoardNode = {
      id: 't2',
      type: 'text',
      title: '',
      url: '',
      x: 0,
      y: 0,
      width: 100,
      height: 50,
    } as BoardNode;
    const doc = boardNodeToDocumentNode(minimal);
    expect(doc).toMatchObject({
      type: 'text',
      fontWeight: 'normal',
      italic: false,
      strikethrough: false,
      widthMode: 'auto',
      textColorIndex: 0,
      fontSizePreset: 1,
    });
  });
});

describe('documentNodeToBoardNode (round-trip)', () => {
  it('webpage は board → document → board で同一', () => {
    const original = webpageNode({ addedUrl: 'https://orig.example' });
    const round = documentNodeToBoardNode(boardNodeToDocumentNode(original));
    expect(round).toMatchObject(original);
  });

  it('stickynote は board → document → board で同一（url は空文字に正規化）', () => {
    const original = stickyNode();
    const round = documentNodeToBoardNode(boardNodeToDocumentNode(original));
    expect(round).toMatchObject({ ...original, url: '' });
  });

  it('text は board → document → board で同一', () => {
    const original = textNode();
    const round = documentNodeToBoardNode(boardNodeToDocumentNode(original));
    expect(round).toMatchObject({ ...original, url: '' });
  });
});

describe('boardEdgeToDocumentEdge', () => {
  it('スタイルを含む全フィールドを board/document 間で往復する', () => {
    const edge: BoardEdge = {
      id: 'e1',
      source: 's',
      sourceHandle: 'sh',
      target: 't',
      targetHandle: null,
      strokeWidth: 6,
      lineStyle: 'dashed',
      colorPreset: 'danger',
    };
    const documentEdge = boardEdgeToDocumentEdge(edge);
    expect(documentEdge).toEqual(edge);
    expect(documentEdgeToBoardEdge(documentEdge)).toEqual(edge);
  });
});

describe('createProjectDocument', () => {
  it('schemaVersion 2 を返し nodes / edges を写像する', () => {
    const project = {
      nodes: [webpageNode(), stickyNode()],
      edges: [
        {
          id: 'e1',
          source: 'w1',
          sourceHandle: null,
          target: 's1',
          targetHandle: null,
          strokeWidth: 3,
          lineStyle: 'solid',
          colorPreset: 'default',
        },
      ] as BoardEdge[],
    };
    const doc = createProjectDocument(project);
    expect(doc.schemaVersion).toBe(2);
    expect(doc.nodes).toHaveLength(2);
    expect(doc.edges).toHaveLength(1);
  });
});

describe('parseProjectDocument', () => {
  it('schemaVersion 2 の edge style を読み込む', () => {
    const edge = {
      id: 'e1',
      source: 'w1',
      sourceHandle: 'right',
      target: 'w2',
      targetHandle: 'left',
      strokeWidth: 6,
      lineStyle: 'dashed',
      colorPreset: 'danger',
    };
    const json = JSON.stringify({ schemaVersion: 2, nodes: [], edges: [edge] });
    expect(parseProjectDocument(json).edges).toEqual([edge]);
  });

  it.each([
    ['strokeWidth', 4],
    ['lineStyle', 'dotted'],
    ['colorPreset', 'purple'],
  ])('不正な edge %s を拒否する', (field, value) => {
    const edge = {
      id: 'e1',
      source: 'w1',
      sourceHandle: 'right',
      target: 'w2',
      targetHandle: 'left',
      strokeWidth: 3,
      lineStyle: 'solid',
      colorPreset: 'default',
      [field]: value,
    };
    const json = JSON.stringify({ schemaVersion: 2, nodes: [], edges: [edge] });
    expect(() => parseProjectDocument(json)).toThrow(new RegExp(`edges\\[0\\]\\.${field}`));
  });

  it('edge style が欠落した schemaVersion 2 を拒否する', () => {
    const json = JSON.stringify({
      schemaVersion: 2,
      nodes: [],
      edges: [
        {
          id: 'e1',
          source: 'w1',
          sourceHandle: 'right',
          target: 'w2',
          targetHandle: 'left',
        },
      ],
    });
    expect(() => parseProjectDocument(json)).toThrow(/edges\[0\]\.strokeWidth/);
  });

  it('schemaVersion 2 のドキュメントを読み込める', () => {
    const json = JSON.stringify({
      schemaVersion: 2,
      nodes: [boardNodeToDocumentNode(webpageNode())],
      edges: [],
    });
    expect(parseProjectDocument(json).schemaVersion).toBe(2);
  });

  it('schemaVersion 1 は v2 に移行し、edges は空配列', () => {
    const json = JSON.stringify({
      schemaVersion: 1,
      title: 'Untitled',
      nodes: [boardNodeToDocumentNode(webpageNode())],
    });
    const doc = parseProjectDocument(json);
    expect(doc.schemaVersion).toBe(2);
    expect(doc.edges).toEqual([]);
    expect(doc.nodes).toHaveLength(1);
  });

  it('無効な JSON は例外を投げる', () => {
    expect(() => parseProjectDocument('not-json')).toThrow();
  });

  it('schemaVersion が 1/2 以外なら例外', () => {
    const json = JSON.stringify({ schemaVersion: 99, nodes: [] });
    expect(() => parseProjectDocument(json)).toThrow(/schemaVersion/);
  });

  it('nodes が配列でなければ例外', () => {
    const json = JSON.stringify({ schemaVersion: 2, nodes: 'not-array' });
    expect(() => parseProjectDocument(json)).toThrow(/nodes/);
  });

  it('未サポートのノード type は例外', () => {
    const json = JSON.stringify({
      schemaVersion: 2,
      nodes: [{ id: 'x', type: 'image', title: '', x: 0, y: 0, width: 1, height: 1 }],
      edges: [],
    });
    expect(() => parseProjectDocument(json)).toThrow(/not supported/);
  });
});

describe('sanitizeProjectDocument', () => {
  const fallback = { nodes: [webpageNode()], edges: [] as BoardEdge[] };

  it('undefined なら fallback project から生成', () => {
    const result = sanitizeProjectDocument(undefined, fallback);
    expect(result.nodes).toHaveLength(1);
  });

  it('不正な値なら fallback project から生成', () => {
    const result = sanitizeProjectDocument({ schemaVersion: 'bogus' }, fallback);
    expect(result.nodes).toHaveLength(1);
  });

  it('正しい値ならパース結果を返す', () => {
    const valid = {
      schemaVersion: 2,
      nodes: [
        boardNodeToDocumentNode(stickyNode()) as SiteboardDocumentNode,
        boardNodeToDocumentNode(textNode()) as SiteboardDocumentNode,
      ],
      edges: [],
    };
    const result = sanitizeProjectDocument(valid, fallback);
    expect(result.nodes).toHaveLength(2);
  });
});

describe('isProjectDirty', () => {
  it('lastSavedDocument と内容が一致すれば dirty=false', () => {
    const nodes = [webpageNode()];
    const project: Pick<Project, 'nodes' | 'edges' | 'lastSavedDocument'> = {
      nodes,
      edges: [],
      lastSavedDocument: createProjectDocument({ nodes, edges: [] }),
    };
    expect(isProjectDirty(project)).toBe(false);
  });

  it('ノードが追加されていれば dirty=true', () => {
    const initialNodes = [webpageNode()];
    const project: Pick<Project, 'nodes' | 'edges' | 'lastSavedDocument'> = {
      nodes: [...initialNodes, stickyNode()],
      edges: [],
      lastSavedDocument: createProjectDocument({ nodes: initialNodes, edges: [] }),
    };
    expect(isProjectDirty(project)).toBe(true);
  });

  it('ノード位置だけ変わっても dirty=true', () => {
    const initialNodes = [webpageNode({ x: 0 })];
    const project: Pick<Project, 'nodes' | 'edges' | 'lastSavedDocument'> = {
      nodes: [webpageNode({ x: 100 })],
      edges: [],
      lastSavedDocument: createProjectDocument({ nodes: initialNodes, edges: [] }),
    };
    expect(isProjectDirty(project)).toBe(true);
  });

  it('空プロジェクトは dirty=false', () => {
    expect(
      isProjectDirty({
        nodes: [],
        edges: [],
        lastSavedDocument: emptyDocument(),
      }),
    ).toBe(false);
  });
});

describe('serializeProjectDocument', () => {
  it('末尾に改行が付き、2 スペースインデントの JSON を返す', () => {
    const doc = emptyDocument();
    const text = serializeProjectDocument(doc);
    expect(text.endsWith('\n')).toBe(true);
    expect(text).toContain('  "schemaVersion": 2');
  });
});
