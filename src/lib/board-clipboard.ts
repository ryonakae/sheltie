import {
  boardEdgeToDocumentEdge,
  boardNodeToDocumentNode,
  documentEdgeToBoardEdge,
  documentNodeToBoardNode,
  parseDocumentEdge,
  parseDocumentNode,
} from '@/lib/project-document';
import type {
  BoardEdge,
  BoardNode,
  Project,
  SheltieDocumentEdge,
  SheltieDocumentNode,
} from '@/types';
import { extractTiptapText } from '@/types';

export const BOARD_CLIPBOARD_PAYLOAD_TYPE = 'application/x-sheltie-board-nodes';

export interface BoardClipboardPayload {
  type: typeof BOARD_CLIPBOARD_PAYLOAD_TYPE;
  version: 1;
  sourceProjectId: string;
  nodes: SheltieDocumentNode[];
  edges: SheltieDocumentEdge[];
}

export interface MaterializedClipboardContent {
  nodes: BoardNode[];
  edges: BoardEdge[];
  sourceIdByNewId: Record<string, string>;
}

export function buildBoardClipboardPayload(
  project: Pick<Project, 'id' | 'nodes' | 'edges'>,
  selectedNodeIds: readonly string[],
): BoardClipboardPayload | null {
  const selectedIdSet = new Set(selectedNodeIds);
  const nodes = project.nodes.filter((node) => selectedIdSet.has(node.id));
  if (nodes.length === 0) return null;

  const edges = project.edges.filter(
    (edge) => selectedIdSet.has(edge.source) && selectedIdSet.has(edge.target),
  );

  return {
    type: BOARD_CLIPBOARD_PAYLOAD_TYPE,
    version: 1,
    sourceProjectId: project.id,
    nodes: nodes.map(boardNodeToDocumentNode),
    edges: edges.map(boardEdgeToDocumentEdge),
  };
}

export function buildBoardClipboardPlainText(payload: BoardClipboardPayload): string {
  return payload.nodes
    .map((node) => {
      if (node.type === 'webpage') return node.url;
      if (node.type === 'stickynote') return node.content;
      return extractTiptapText(node.tiptapContent).trim();
    })
    .filter((part) => part !== '')
    .join('\n');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function parseBoardClipboardPayload(json: string): BoardClipboardPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new Error(`failed to parse clipboard JSON: ${error}`);
  }
  if (!isRecord(parsed)) throw new Error('clipboard root must be an object');
  if (parsed.type !== BOARD_CLIPBOARD_PAYLOAD_TYPE) {
    throw new Error('clipboard payload type mismatch');
  }
  if (parsed.version !== 1) throw new Error('clipboard payload version must be 1');
  if (typeof parsed.sourceProjectId !== 'string') {
    throw new Error('sourceProjectId must be a string');
  }
  if (!Array.isArray(parsed.nodes) || parsed.nodes.length === 0) {
    throw new Error('nodes must be a non-empty array');
  }

  const nodes = parsed.nodes.map((node, index) => parseDocumentNode(node, index));
  const edges = Array.isArray(parsed.edges)
    ? parsed.edges.map((edge, index) => parseDocumentEdge(edge, index))
    : [];

  return {
    type: BOARD_CLIPBOARD_PAYLOAD_TYPE,
    version: 1,
    sourceProjectId: parsed.sourceProjectId,
    nodes,
    edges,
  };
}

export function materializeBoardClipboardPayload(
  payload: BoardClipboardPayload,
  createId: () => string = () => crypto.randomUUID(),
): MaterializedClipboardContent {
  const newIdBySourceId = new Map<string, string>();
  const sourceIdByNewId: Record<string, string> = {};

  const nodes = payload.nodes.map((documentNode) => {
    const newId = createId();
    newIdBySourceId.set(documentNode.id, newId);
    sourceIdByNewId[newId] = documentNode.id;
    return { ...documentNodeToBoardNode(documentNode), id: newId };
  });

  const edges = payload.edges.flatMap((documentEdge) => {
    const source = newIdBySourceId.get(documentEdge.source);
    const target = newIdBySourceId.get(documentEdge.target);
    // 貼り付け対象外のノードを参照する edge は黙って捨てる（不正 payload 耐性）
    if (!source || !target) return [];
    return [{ ...documentEdgeToBoardEdge(documentEdge), id: createId(), source, target }];
  });

  return { nodes, edges, sourceIdByNewId };
}
