import {
  isStickyNoteNode,
  type BoardEdge,
  type BoardNode,
  type Project,
  type SiteboardDocument,
  type SiteboardDocumentEdge,
  type SiteboardDocumentNode,
  type SiteboardDocumentV2,
} from '@/types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new Error(`${field} は数値である必要があります`);
  }
  return value;
}

function parseString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${field} は文字列である必要があります`);
  }
  return value;
}

function parseNode(rawNode: unknown, index: number): SiteboardDocumentNode {
  if (!isRecord(rawNode)) {
    throw new Error(`nodes[${index}] はオブジェクトである必要があります`);
  }

  const type = parseString(rawNode.type, `nodes[${index}].type`);
  const id = parseString(rawNode.id, `nodes[${index}].id`);
  const title = parseString(rawNode.title, `nodes[${index}].title`);
  const x = parseNumber(rawNode.x, `nodes[${index}].x`);
  const y = parseNumber(rawNode.y, `nodes[${index}].y`);
  const width = parseNumber(rawNode.width, `nodes[${index}].width`);
  const height = parseNumber(rawNode.height, `nodes[${index}].height`);

  if (type === 'webpage') {
    const url = parseString(rawNode.url, `nodes[${index}].url`);
    const addedUrl =
      rawNode.addedUrl === undefined
        ? undefined
        : parseString(rawNode.addedUrl, `nodes[${index}].addedUrl`);

    return {
      id,
      type: 'webpage',
      title,
      url,
      addedUrl,
      x,
      y,
      width,
      height,
    };
  }

  if (type === 'stickynote') {
    const content = parseString(rawNode.content ?? '', `nodes[${index}].content`);
    const colorIndex = parseNumber(rawNode.colorIndex ?? 0, `nodes[${index}].colorIndex`);

    return {
      id,
      type: 'stickynote',
      title,
      content,
      colorIndex,
      x,
      y,
      width,
      height,
    };
  }

  throw new Error(`nodes[${index}].type が未対応です: ${type}`);
}

function parseEdge(rawEdge: unknown, index: number): SiteboardDocumentEdge {
  if (!isRecord(rawEdge)) {
    throw new Error(`edges[${index}] はオブジェクトである必要があります`);
  }

  return {
    id: parseString(rawEdge.id, `edges[${index}].id`),
    source: parseString(rawEdge.source, `edges[${index}].source`),
    target: parseString(rawEdge.target, `edges[${index}].target`),
    sourceHandle:
      rawEdge.sourceHandle === undefined
        ? undefined
        : parseString(rawEdge.sourceHandle, `edges[${index}].sourceHandle`),
    targetHandle:
      rawEdge.targetHandle === undefined
        ? undefined
        : parseString(rawEdge.targetHandle, `edges[${index}].targetHandle`),
    type:
      rawEdge.type === undefined ? undefined : parseString(rawEdge.type, `edges[${index}].type`),
    label:
      rawEdge.label === undefined ? undefined : parseString(rawEdge.label, `edges[${index}].label`),
  };
}

function parseProjectDocumentValue(value: unknown): SiteboardDocument {
  if (!isRecord(value)) {
    throw new Error('ルートはオブジェクトである必要があります');
  }

  const title = parseString(value.title, 'title').trim() || 'Untitled';
  const rawNodes = value.nodes;
  if (!Array.isArray(rawNodes)) {
    throw new Error('nodes は配列である必要があります');
  }

  if (value.schemaVersion === 1) {
    return {
      schemaVersion: 1,
      title,
      nodes: rawNodes.map((node, index) => parseNode(node, index)),
    };
  }

  if (value.schemaVersion === 2) {
    const rawEdges = value.edges;
    if (!Array.isArray(rawEdges)) {
      throw new Error('edges は配列である必要があります');
    }

    return {
      schemaVersion: 2,
      title,
      nodes: rawNodes.map((node, index) => parseNode(node, index)),
      edges: rawEdges.map((edge, index) => parseEdge(edge, index)),
    };
  }

  throw new Error('schemaVersion は 1 または 2 のみ対応しています');
}

export function boardNodeToDocumentNode(node: BoardNode): SiteboardDocumentNode {
  if (isStickyNoteNode(node)) {
    return {
      id: node.id,
      type: 'stickynote',
      title: node.title,
      content: node.content ?? '',
      colorIndex: node.colorIndex ?? 0,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
    };
  }

  return {
    id: node.id,
    type: 'webpage',
    title: node.title,
    url: node.url,
    addedUrl: node.addedUrl,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
  };
}

export function boardEdgeToDocumentEdge(edge: BoardEdge): SiteboardDocumentEdge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
    type: edge.type,
    label: edge.label,
  };
}

export function documentNodeToBoardNode(node: SiteboardDocumentNode): BoardNode {
  if (node.type === 'stickynote') {
    return {
      id: node.id,
      type: 'stickynote',
      title: node.title,
      url: '',
      content: node.content,
      colorIndex: node.colorIndex,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
    };
  }

  return {
    id: node.id,
    type: 'webpage',
    title: node.title,
    url: node.url,
    addedUrl: node.addedUrl,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
  };
}

export function documentEdgeToBoardEdge(edge: SiteboardDocumentEdge): BoardEdge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
    type: edge.type,
    label: edge.label,
  };
}

export function createProjectDocument(
  project: Pick<Project, 'title' | 'nodes' | 'edges'>,
): SiteboardDocumentV2 {
  return {
    schemaVersion: 2,
    title: project.title,
    nodes: project.nodes.map(boardNodeToDocumentNode),
    edges: project.edges.map(boardEdgeToDocumentEdge),
  };
}

export function serializeProjectDocument(document: SiteboardDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

export function parseProjectDocument(contents: string): SiteboardDocument {
  let parsed: unknown;

  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    throw new Error(`JSON の解析に失敗しました: ${error}`);
  }

  return parseProjectDocumentValue(parsed);
}

export function sanitizeProjectDocument(
  rawDocument: unknown,
  fallbackProject: Pick<Project, 'title' | 'nodes' | 'edges'>,
): SiteboardDocumentV2 {
  if (rawDocument === undefined) {
    return createProjectDocument(fallbackProject);
  }

  try {
    const parsed = parseProjectDocumentValue(rawDocument);
    if (parsed.schemaVersion === 2) {
      return parsed;
    }
    return {
      schemaVersion: 2,
      title: parsed.title,
      nodes: parsed.nodes,
      edges: [],
    };
  } catch {
    return createProjectDocument(fallbackProject);
  }
}

export function isProjectDirty(
  project: Pick<Project, 'title' | 'nodes' | 'edges' | 'lastSavedDocument'>,
): boolean {
  return (
    serializeProjectDocument(createProjectDocument(project)) !==
    serializeProjectDocument(
      project.lastSavedDocument.schemaVersion === 2
        ? project.lastSavedDocument
        : {
            schemaVersion: 2,
            title: project.lastSavedDocument.title,
            nodes: project.lastSavedDocument.nodes,
            edges: [],
          },
    )
  );
}
