import {
  isStickyNoteNode,
  type BoardNode,
  type Project,
  type SiteboardDocumentNode,
  type SiteboardDocumentV1,
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

function parseProjectDocumentValue(value: unknown): SiteboardDocumentV1 {
  if (!isRecord(value)) {
    throw new Error('ルートはオブジェクトである必要があります');
  }

  if (value.schemaVersion !== 1) {
    throw new Error('schemaVersion は 1 のみ対応しています');
  }

  const title = parseString(value.title, 'title').trim() || 'Untitled';
  const rawNodes = value.nodes;
  if (!Array.isArray(rawNodes)) {
    throw new Error('nodes は配列である必要があります');
  }

  return {
    schemaVersion: 1,
    title,
    nodes: rawNodes.map((node, index) => parseNode(node, index)),
  };
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

export function createProjectDocument(
  project: Pick<Project, 'title' | 'nodes'>,
): SiteboardDocumentV1 {
  return {
    schemaVersion: 1,
    title: project.title,
    nodes: project.nodes.map(boardNodeToDocumentNode),
  };
}

export function serializeProjectDocument(document: SiteboardDocumentV1): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

export function parseProjectDocument(contents: string): SiteboardDocumentV1 {
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
  fallbackProject: Pick<Project, 'title' | 'nodes'>,
): SiteboardDocumentV1 {
  if (rawDocument === undefined) {
    return createProjectDocument(fallbackProject);
  }

  try {
    return parseProjectDocumentValue(rawDocument);
  } catch {
    return createProjectDocument(fallbackProject);
  }
}

export function isProjectDirty(
  project: Pick<Project, 'title' | 'nodes' | 'lastSavedDocument'>,
): boolean {
  return (
    serializeProjectDocument(createProjectDocument(project)) !==
    serializeProjectDocument(project.lastSavedDocument)
  );
}
