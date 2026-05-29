import {
  isStickyNoteNode,
  isTextNode,
  type BoardEdge,
  type BoardNode,
  type Project,
  type SiteboardDocument,
  type SiteboardDocumentEdge,
  type SiteboardDocumentNode,
  type SiteboardDocumentV2,
  type TextNodeFontSizePreset,
} from '@/types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new Error(`${field} must be a number`);
  }
  return value;
}

function parseString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${field} must be a string`);
  }
  return value;
}

function parseNode(rawNode: unknown, index: number): SiteboardDocumentNode {
  if (!isRecord(rawNode)) {
    throw new Error(`nodes[${index}] must be an object`);
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
    const fontSizePreset = parseNumber(
      rawNode.fontSizePreset ?? 1,
      `nodes[${index}].fontSizePreset`,
    );

    return {
      id,
      type: 'stickynote',
      title,
      content,
      colorIndex,
      fontSizePreset,
      x,
      y,
      width,
      height,
    };
  }

  if (type === 'text') {
    const tiptapContent = rawNode.tiptapContent as object | undefined;
    const fontSizePreset = parseNumber(
      rawNode.fontSizePreset ?? 1,
      `nodes[${index}].fontSizePreset`,
    );
    const fontWeight = parseString(rawNode.fontWeight ?? 'normal', `nodes[${index}].fontWeight`) as
      | 'normal'
      | 'bold';
    const italic = rawNode.italic === true;
    const strikethrough = rawNode.strikethrough === true;
    const textColorIndex = parseNumber(
      rawNode.textColorIndex ?? 0,
      `nodes[${index}].textColorIndex`,
    );
    const widthMode = parseString(rawNode.widthMode ?? 'auto', `nodes[${index}].widthMode`) as
      | 'auto'
      | 'fixed';

    return {
      id,
      type: 'text',
      title,
      tiptapContent,
      fontSizePreset,
      fontWeight,
      italic,
      strikethrough,
      textColorIndex,
      widthMode,
      x,
      y,
      width,
      height,
    };
  }

  throw new Error(`nodes[${index}].type is not supported: ${type}`);
}

function parseEdge(rawEdge: unknown, index: number): SiteboardDocumentEdge {
  if (!isRecord(rawEdge)) {
    throw new Error(`edges[${index}] must be an object`);
  }

  return {
    id: parseString(rawEdge.id, `edges[${index}].id`),
    source: parseString(rawEdge.source, `edges[${index}].source`),
    sourceHandle:
      rawEdge.sourceHandle === null || rawEdge.sourceHandle === undefined
        ? null
        : parseString(rawEdge.sourceHandle, `edges[${index}].sourceHandle`),
    target: parseString(rawEdge.target, `edges[${index}].target`),
    targetHandle:
      rawEdge.targetHandle === null || rawEdge.targetHandle === undefined
        ? null
        : parseString(rawEdge.targetHandle, `edges[${index}].targetHandle`),
  };
}

function parseProjectDocumentValue(value: unknown): SiteboardDocumentV2 {
  if (!isRecord(value)) {
    throw new Error('root must be an object');
  }

  if (value.schemaVersion === 1) {
    const title = parseString(value.title, 'title').trim() || 'Untitled';
    const rawNodes = value.nodes;
    if (!Array.isArray(rawNodes)) {
      throw new Error('nodes must be an array');
    }

    void title;
    return {
      schemaVersion: 2,
      nodes: rawNodes.map((node, index) => parseNode(node, index)),
      edges: [],
    };
  }

  if (value.schemaVersion !== 2) {
    throw new Error('schemaVersion must be 1 or 2');
  }

  const rawNodes = value.nodes;
  if (!Array.isArray(rawNodes)) {
    throw new Error('nodes must be an array');
  }

  const rawEdges = value.edges;
  const edges = Array.isArray(rawEdges)
    ? rawEdges.map((edge, index) => parseEdge(edge, index))
    : [];

  return {
    schemaVersion: 2,
    nodes: rawNodes.map((node, index) => parseNode(node, index)),
    edges,
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
      fontSizePreset: node.fontSizePreset ?? 1,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
    };
  }

  if (isTextNode(node)) {
    return {
      id: node.id,
      type: 'text',
      title: node.title,
      tiptapContent: node.tiptapContent,
      fontSizePreset: node.fontSizePreset ?? 1,
      fontWeight: node.fontWeight ?? 'normal',
      italic: node.italic ?? false,
      strikethrough: node.strikethrough ?? false,
      textColorIndex: node.textColorIndex ?? 0,
      widthMode: node.widthMode ?? 'auto',
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
    sourceHandle: edge.sourceHandle,
    target: edge.target,
    targetHandle: edge.targetHandle,
  };
}

export function documentEdgeToBoardEdge(edge: SiteboardDocumentEdge): BoardEdge {
  return {
    id: edge.id,
    source: edge.source,
    sourceHandle: edge.sourceHandle,
    target: edge.target,
    targetHandle: edge.targetHandle,
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
      fontSizePreset: node.fontSizePreset as TextNodeFontSizePreset,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
    };
  }

  if (node.type === 'text') {
    return {
      id: node.id,
      type: 'text',
      title: node.title,
      url: '',
      tiptapContent: node.tiptapContent,
      fontSizePreset: node.fontSizePreset as TextNodeFontSizePreset,
      fontWeight: node.fontWeight,
      italic: node.italic,
      strikethrough: node.strikethrough,
      textColorIndex: node.textColorIndex,
      widthMode: node.widthMode,
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
  project: Pick<Project, 'nodes' | 'edges'>,
): SiteboardDocumentV2 {
  return {
    schemaVersion: 2,
    nodes: project.nodes.map(boardNodeToDocumentNode),
    edges: project.edges.map(boardEdgeToDocumentEdge),
  };
}

export function serializeProjectDocument(document: SiteboardDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

export function parseProjectDocument(contents: string): SiteboardDocumentV2 {
  let parsed: unknown;

  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    throw new Error(`failed to parse JSON: ${error}`);
  }

  return parseProjectDocumentValue(parsed);
}

export function sanitizeProjectDocument(
  rawDocument: unknown,
  fallbackProject: Pick<Project, 'nodes' | 'edges'>,
): SiteboardDocumentV2 {
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
  project: Pick<Project, 'nodes' | 'edges' | 'lastSavedDocument'>,
): boolean {
  return (
    serializeProjectDocument(createProjectDocument(project)) !==
    serializeProjectDocument(project.lastSavedDocument)
  );
}
