import {
  EDGE_COLOR_PRESETS,
  STICKY_NOTE_COLORS,
  TEXT_NODE_COLORS,
  TEXT_NODE_FONT_SIZE_PRESETS,
} from '@/constants';
import { isAllowedPageUrl } from '@/lib/url-utils';
import {
  isStickyNoteNode,
  isTextNode,
  type BoardEdge,
  type BoardNode,
  type EdgeColorPreset,
  type EdgeLineStyle,
  type EdgeStrokeWidth,
  type Project,
  type SheltieDocument,
  type SheltieDocumentEdge,
  type SheltieDocumentNode,
  type SheltieDocumentV2,
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

function parseFiniteNumber(value: unknown, field: string): number {
  const parsed = parseNumber(value, field);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${field} must be a finite number`);
  }
  return parsed;
}

/**
 * プリセット配列の添字として使う値を検証する。範囲外だと描画時に
 * `undefined` を参照して render が throw するため、読み込み時に弾く。
 */
function parsePresetIndex(value: unknown, field: string, presetCount: number): number {
  const parsed = parseNumber(value, field);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed >= presetCount) {
    throw new Error(`${field} must be an integer from 0 to ${presetCount - 1}`);
  }
  return parsed;
}

function parseString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${field} must be a string`);
  }
  return value;
}

function parsePageUrl(value: unknown, field: string): string {
  const parsed = parseString(value, field);
  if (!isAllowedPageUrl(parsed)) {
    throw new Error(`${field} must be an http or https URL`);
  }
  return parsed;
}

function parseNode(rawNode: unknown, index: number): SheltieDocumentNode {
  if (!isRecord(rawNode)) {
    throw new Error(`nodes[${index}] must be an object`);
  }

  const type = parseString(rawNode.type, `nodes[${index}].type`);
  const id = parseString(rawNode.id, `nodes[${index}].id`);
  const title = parseString(rawNode.title, `nodes[${index}].title`);
  const x = parseFiniteNumber(rawNode.x, `nodes[${index}].x`);
  const y = parseFiniteNumber(rawNode.y, `nodes[${index}].y`);
  const width = parseFiniteNumber(rawNode.width, `nodes[${index}].width`);
  const height = parseFiniteNumber(rawNode.height, `nodes[${index}].height`);

  if (type === 'webpage') {
    const url = parsePageUrl(rawNode.url, `nodes[${index}].url`);
    const addedUrl =
      rawNode.addedUrl === undefined
        ? undefined
        : parsePageUrl(rawNode.addedUrl, `nodes[${index}].addedUrl`);

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
    const colorIndex = parsePresetIndex(
      rawNode.colorIndex ?? 0,
      `nodes[${index}].colorIndex`,
      STICKY_NOTE_COLORS.length,
    );
    const fontSizePreset = parsePresetIndex(
      rawNode.fontSizePreset ?? 1,
      `nodes[${index}].fontSizePreset`,
      TEXT_NODE_FONT_SIZE_PRESETS.length,
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
    const fontSizePreset = parsePresetIndex(
      rawNode.fontSizePreset ?? 1,
      `nodes[${index}].fontSizePreset`,
      TEXT_NODE_FONT_SIZE_PRESETS.length,
    );
    const fontWeight = parseString(rawNode.fontWeight ?? 'normal', `nodes[${index}].fontWeight`) as
      | 'normal'
      | 'bold';
    const italic = rawNode.italic === true;
    const strikethrough = rawNode.strikethrough === true;
    const textColorIndex = parsePresetIndex(
      rawNode.textColorIndex ?? 0,
      `nodes[${index}].textColorIndex`,
      TEXT_NODE_COLORS.length,
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

function parseEdgeStrokeWidth(value: unknown, field: string): EdgeStrokeWidth {
  if (value !== 3 && value !== 6) {
    throw new Error(`${field} must be 3 or 6`);
  }
  return value;
}

function parseEdgeLineStyle(value: unknown, field: string): EdgeLineStyle {
  if (value !== 'solid' && value !== 'dashed') {
    throw new Error(`${field} must be solid or dashed`);
  }
  return value;
}

function parseEdgeColorPreset(value: unknown, field: string): EdgeColorPreset {
  if (!EDGE_COLOR_PRESETS.some((preset) => preset.key === value)) {
    throw new Error(`${field} is not supported`);
  }
  return value as EdgeColorPreset;
}

function parseEdge(rawEdge: unknown, index: number): SheltieDocumentEdge {
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
    strokeWidth: parseEdgeStrokeWidth(rawEdge.strokeWidth, `edges[${index}].strokeWidth`),
    lineStyle: parseEdgeLineStyle(rawEdge.lineStyle, `edges[${index}].lineStyle`),
    colorPreset: parseEdgeColorPreset(rawEdge.colorPreset, `edges[${index}].colorPreset`),
  };
}

function parseProjectDocumentValue(value: unknown): SheltieDocumentV2 {
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

export function boardNodeToDocumentNode(node: BoardNode): SheltieDocumentNode {
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

export function boardEdgeToDocumentEdge(edge: BoardEdge): SheltieDocumentEdge {
  return {
    id: edge.id,
    source: edge.source,
    sourceHandle: edge.sourceHandle,
    target: edge.target,
    targetHandle: edge.targetHandle,
    strokeWidth: edge.strokeWidth,
    lineStyle: edge.lineStyle,
    colorPreset: edge.colorPreset,
  };
}

export function documentEdgeToBoardEdge(edge: SheltieDocumentEdge): BoardEdge {
  return {
    id: edge.id,
    source: edge.source,
    sourceHandle: edge.sourceHandle,
    target: edge.target,
    targetHandle: edge.targetHandle,
    strokeWidth: edge.strokeWidth,
    lineStyle: edge.lineStyle,
    colorPreset: edge.colorPreset,
  };
}

export function documentNodeToBoardNode(node: SheltieDocumentNode): BoardNode {
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
): SheltieDocumentV2 {
  return {
    schemaVersion: 2,
    nodes: project.nodes.map(boardNodeToDocumentNode),
    edges: project.edges.map(boardEdgeToDocumentEdge),
  };
}

export function serializeProjectDocument(document: SheltieDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

export function parseProjectDocument(contents: string): SheltieDocumentV2 {
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
): SheltieDocumentV2 {
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
