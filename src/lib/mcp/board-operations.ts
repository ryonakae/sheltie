import {
  DEFAULT_PAGE_HEIGHT,
  DEFAULT_PAGE_WIDTH,
  DEFAULT_EDGE_STYLE,
  DEFAULT_STICKY_NOTE_HEIGHT,
  DEFAULT_STICKY_NOTE_WIDTH,
  DEFAULT_TEXT_NODE_HEIGHT,
  DEFAULT_TEXT_NODE_WIDTH,
  PAGE_MIN_HEIGHT,
  PAGE_MIN_WIDTH,
  STICKY_NOTE_MIN_HEIGHT,
  STICKY_NOTE_MIN_WIDTH,
  TEXT_NODE_MIN_WIDTH,
} from '@/constants';
import type {
  BatchEditBoardFailure,
  BatchEditBoardResult,
  BatchEditBoardSuccess,
  BoardOperation,
  CreateEdgeInput,
  CreateNodeInput,
  UpdateNodePatch,
} from '@/lib/mcp/types';
import {
  addOrReplaceBoardEdge,
  hasSameUnorderedEndpoints,
  reverseBoardEdge,
  updateBoardEdgeStyle,
} from '@/lib/sheltie-edge';
import { findNonOverlappingPosition } from '@/lib/sheltie-placement';
import type { BoardEdge, BoardEdgeStyle, BoardNode, TextNodeFontSizePreset } from '@/types';
import { isWebPageNode } from '@/types';

export class BoardOperationError extends Error {
  constructor(
    readonly operationIndex: number,
    readonly code: 'validation_failed',
    message: string,
  ) {
    super(message);
    this.name = 'BoardOperationError';
  }
}

function fail(operationIndex: number, message: string): never {
  throw new BoardOperationError(operationIndex, 'validation_failed', message);
}

function requireString(value: unknown, name: string, operationIndex: number): string {
  if (typeof value !== 'string') fail(operationIndex, `${name} must be a string`);
  return value;
}

function optionalFiniteNumber(
  value: unknown,
  fallback: number,
  name: string,
  operationIndex: number,
): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(operationIndex, `${name} must be a finite number`);
  }
  return value;
}

function requireMinimum(
  value: number,
  minimum: number,
  name: string,
  operationIndex: number,
): number {
  if (value < minimum) fail(operationIndex, `${name} must be at least ${minimum}`);
  return value;
}

function resolveWebTitle(url: string, explicitTitle: unknown, operationIndex: number): string {
  if (explicitTitle !== undefined)
    return requireString(explicitTitle, 'node.title', operationIndex);
  if (!url) return 'Untitled';
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function textToTiptapDoc(text: string): object {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        ...(text === '' ? {} : { content: [{ type: 'text', text }] }),
      },
    ],
  };
}

function resolveFontSizePreset(
  value: unknown,
  fallback: TextNodeFontSizePreset,
  operationIndex: number,
): TextNodeFontSizePreset {
  if (value === undefined) return fallback;
  if (value === 0 || value === 1 || value === 2 || value === 3) return value;
  fail(operationIndex, 'fontSizePreset must be 0, 1, 2, or 3');
}

function createNode(
  input: CreateNodeInput,
  nodeId: string,
  nodes: BoardNode[],
  operationIndex: number,
): BoardNode {
  if (!input || typeof input !== 'object') fail(operationIndex, 'node must be an object');
  const x = optionalFiniteNumber(input.x, 0, 'node.x', operationIndex);
  const y = optionalFiniteNumber(input.y, 0, 'node.y', operationIndex);

  let node: BoardNode;
  if (input.type === 'webpage') {
    const url = input.url === undefined ? '' : requireString(input.url, 'node.url', operationIndex);
    const width = requireMinimum(
      optionalFiniteNumber(input.width, DEFAULT_PAGE_WIDTH, 'node.width', operationIndex),
      PAGE_MIN_WIDTH,
      'node.width',
      operationIndex,
    );
    const height = requireMinimum(
      optionalFiniteNumber(input.height, DEFAULT_PAGE_HEIGHT, 'node.height', operationIndex),
      PAGE_MIN_HEIGHT,
      'node.height',
      operationIndex,
    );
    node = {
      id: nodeId,
      type: 'webpage',
      url,
      title: resolveWebTitle(url, input.title, operationIndex),
      addedUrl: url || undefined,
      x,
      y,
      width,
      height,
    };
  } else if (input.type === 'stickynote') {
    const width = requireMinimum(
      optionalFiniteNumber(input.width, DEFAULT_STICKY_NOTE_WIDTH, 'node.width', operationIndex),
      STICKY_NOTE_MIN_WIDTH,
      'node.width',
      operationIndex,
    );
    const height = requireMinimum(
      optionalFiniteNumber(input.height, DEFAULT_STICKY_NOTE_HEIGHT, 'node.height', operationIndex),
      STICKY_NOTE_MIN_HEIGHT,
      'node.height',
      operationIndex,
    );
    const content =
      input.content === undefined
        ? ''
        : requireString(input.content, 'node.content', operationIndex);
    const colorIndex = optionalFiniteNumber(input.colorIndex, 0, 'node.colorIndex', operationIndex);
    if (!Number.isInteger(colorIndex) || colorIndex < 0 || colorIndex > 3) {
      fail(operationIndex, 'node.colorIndex must be an integer from 0 to 3');
    }
    node = {
      id: nodeId,
      type: 'stickynote',
      url: '',
      title:
        input.title === undefined
          ? 'Sticky Note'
          : requireString(input.title, 'node.title', operationIndex),
      content,
      colorIndex,
      fontSizePreset: resolveFontSizePreset(input.fontSizePreset, 1, operationIndex),
      x,
      y,
      width,
      height,
    };
  } else if (input.type === 'text') {
    const width = requireMinimum(
      optionalFiniteNumber(input.width, DEFAULT_TEXT_NODE_WIDTH, 'node.width', operationIndex),
      TEXT_NODE_MIN_WIDTH,
      'node.width',
      operationIndex,
    );
    const height = requireMinimum(
      optionalFiniteNumber(input.height, DEFAULT_TEXT_NODE_HEIGHT, 'node.height', operationIndex),
      Number.EPSILON,
      'node.height',
      operationIndex,
    );
    const text =
      input.text === undefined ? '' : requireString(input.text, 'node.text', operationIndex);
    const fontWeight = input.fontWeight === undefined ? 'normal' : input.fontWeight;
    if (fontWeight !== 'normal' && fontWeight !== 'bold') {
      fail(operationIndex, 'node.fontWeight must be normal or bold');
    }
    const italic = input.italic === undefined ? false : input.italic;
    const strikethrough = input.strikethrough === undefined ? false : input.strikethrough;
    if (typeof italic !== 'boolean') fail(operationIndex, 'node.italic must be boolean');
    if (typeof strikethrough !== 'boolean') {
      fail(operationIndex, 'node.strikethrough must be boolean');
    }
    const textColorIndex = optionalFiniteNumber(
      input.textColorIndex,
      0,
      'node.textColorIndex',
      operationIndex,
    );
    if (!Number.isInteger(textColorIndex) || textColorIndex < 0 || textColorIndex > 5) {
      fail(operationIndex, 'node.textColorIndex must be an integer from 0 to 5');
    }
    const widthMode = input.widthMode === undefined ? 'auto' : input.widthMode;
    if (widthMode !== 'auto' && widthMode !== 'fixed') {
      fail(operationIndex, 'node.widthMode must be auto or fixed');
    }
    node = {
      id: nodeId,
      type: 'text',
      url: '',
      title:
        input.title === undefined
          ? 'Text'
          : requireString(input.title, 'node.title', operationIndex),
      tiptapContent: textToTiptapDoc(text),
      fontSizePreset: resolveFontSizePreset(input.fontSizePreset, 1, operationIndex),
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
  } else {
    fail(operationIndex, 'node.type must be webpage, stickynote, or text');
  }

  const positioned = findNonOverlappingPosition(
    nodes,
    node.type,
    node.x,
    node.y,
    node.width,
    node.height,
    input.type === 'webpage' ? { keepY: true } : undefined,
  );
  return { ...node, ...positioned };
}

function effectiveNodeType(node: BoardNode): 'webpage' | 'stickynote' | 'text' {
  return node.type === 'stickynote' || node.type === 'text' ? node.type : 'webpage';
}

function updateNode(
  current: BoardNode,
  patch: UpdateNodePatch,
  operationIndex: number,
): BoardNode | null {
  if (!patch || typeof patch !== 'object') fail(operationIndex, 'patch must be an object');
  const nodeType = effectiveNodeType(current);
  if (patch.type !== nodeType) {
    fail(operationIndex, `patch type ${String(patch.type)} is incompatible with ${nodeType}`);
  }

  const updated: BoardNode = { ...current };
  if (patch.title !== undefined) {
    updated.title = requireString(patch.title, 'patch.title', operationIndex);
  }
  if (patch.x !== undefined) {
    updated.x = optionalFiniteNumber(patch.x, current.x, 'patch.x', operationIndex);
  }
  if (patch.y !== undefined) {
    updated.y = optionalFiniteNumber(patch.y, current.y, 'patch.y', operationIndex);
  }
  if (patch.width !== undefined) {
    const minimum =
      nodeType === 'webpage'
        ? PAGE_MIN_WIDTH
        : nodeType === 'stickynote'
          ? STICKY_NOTE_MIN_WIDTH
          : TEXT_NODE_MIN_WIDTH;
    updated.width = requireMinimum(
      optionalFiniteNumber(patch.width, current.width, 'patch.width', operationIndex),
      minimum,
      'patch.width',
      operationIndex,
    );
  }
  if (patch.height !== undefined) {
    const minimum =
      nodeType === 'webpage'
        ? PAGE_MIN_HEIGHT
        : nodeType === 'stickynote'
          ? STICKY_NOTE_MIN_HEIGHT
          : Number.EPSILON;
    updated.height = requireMinimum(
      optionalFiniteNumber(patch.height, current.height, 'patch.height', operationIndex),
      minimum,
      'patch.height',
      operationIndex,
    );
  }

  if (patch.type === 'webpage') {
    if (patch.url !== undefined) {
      const url = requireString(patch.url, 'patch.url', operationIndex);
      updated.url = url;
      updated.addedUrl = url || undefined;
      if (patch.title === undefined)
        updated.title = resolveWebTitle(url, undefined, operationIndex);
    }
  } else if (patch.type === 'stickynote') {
    if (patch.content !== undefined) {
      updated.content = requireString(patch.content, 'patch.content', operationIndex);
    }
    if (patch.colorIndex !== undefined) {
      const colorIndex = optionalFiniteNumber(
        patch.colorIndex,
        current.colorIndex ?? 0,
        'patch.colorIndex',
        operationIndex,
      );
      if (!Number.isInteger(colorIndex) || colorIndex < 0 || colorIndex > 3) {
        fail(operationIndex, 'patch.colorIndex must be an integer from 0 to 3');
      }
      updated.colorIndex = colorIndex;
    }
    if (patch.fontSizePreset !== undefined) {
      updated.fontSizePreset = resolveFontSizePreset(
        patch.fontSizePreset,
        current.fontSizePreset ?? 1,
        operationIndex,
      );
    }
  } else {
    if (patch.text !== undefined) {
      updated.tiptapContent = textToTiptapDoc(
        requireString(patch.text, 'patch.text', operationIndex),
      );
    }
    if (patch.fontSizePreset !== undefined) {
      updated.fontSizePreset = resolveFontSizePreset(
        patch.fontSizePreset,
        current.fontSizePreset ?? 1,
        operationIndex,
      );
    }
    if (patch.fontWeight !== undefined) {
      if (patch.fontWeight !== 'normal' && patch.fontWeight !== 'bold') {
        fail(operationIndex, 'patch.fontWeight must be normal or bold');
      }
      updated.fontWeight = patch.fontWeight;
    }
    for (const key of ['italic', 'strikethrough'] as const) {
      if (patch[key] !== undefined) {
        if (typeof patch[key] !== 'boolean') fail(operationIndex, `patch.${key} must be boolean`);
        updated[key] = patch[key];
      }
    }
    if (patch.textColorIndex !== undefined) {
      const colorIndex = optionalFiniteNumber(
        patch.textColorIndex,
        current.textColorIndex ?? 0,
        'patch.textColorIndex',
        operationIndex,
      );
      if (!Number.isInteger(colorIndex) || colorIndex < 0 || colorIndex > 5) {
        fail(operationIndex, 'patch.textColorIndex must be an integer from 0 to 5');
      }
      updated.textColorIndex = colorIndex;
    }
    if (patch.widthMode !== undefined) {
      if (patch.widthMode !== 'auto' && patch.widthMode !== 'fixed') {
        fail(operationIndex, 'patch.widthMode must be auto or fixed');
      }
      updated.widthMode = patch.widthMode;
    }
  }

  return JSON.stringify(updated) === JSON.stringify(current) ? null : updated;
}

function reorderNode(
  nodes: BoardNode[],
  nodeId: string,
  position: 'front' | 'forward' | 'backward' | 'back',
  operationIndex: number,
): BoardNode[] | null {
  const index = nodes.findIndex((node) => node.id === nodeId);
  if (index === -1) fail(operationIndex, `Node not found: ${nodeId}`);
  const node = nodes[index];
  if (isWebPageNode(node)) fail(operationIndex, 'webpage nodes cannot be reordered');

  if (position === 'front') {
    if (index === nodes.length - 1) return null;
    return [...nodes.filter((current) => current.id !== nodeId), node];
  }
  if (position === 'back') {
    if (index === 0) return null;
    return [node, ...nodes.filter((current) => current.id !== nodeId)];
  }

  const step = position === 'forward' ? 1 : position === 'backward' ? -1 : 0;
  if (step === 0) fail(operationIndex, `Invalid reorder position: ${String(position)}`);
  let targetIndex = index + step;
  while (targetIndex >= 0 && targetIndex < nodes.length) {
    if (!isWebPageNode(nodes[targetIndex])) break;
    targetIndex += step;
  }
  if (targetIndex < 0 || targetIndex >= nodes.length) return null;

  const reordered = [...nodes];
  reordered.splice(index, 1);
  reordered.splice(targetIndex, 0, node);
  return reordered;
}

function resolveReference(
  value: unknown,
  tempIdMap: Map<string, string>,
  operationIndex: number,
): string {
  const reference = requireString(value, 'reference', operationIndex);
  return tempIdMap.get(reference) ?? reference;
}

function validateEdgeStylePatch(
  style: Partial<BoardEdgeStyle> | undefined,
  operationIndex: number,
): Partial<BoardEdgeStyle> {
  if (style === undefined) return {};
  if (!style || typeof style !== 'object' || Array.isArray(style)) {
    fail(operationIndex, 'edge style must be an object');
  }
  const resolved = style;
  if (
    resolved.strokeWidth !== undefined &&
    resolved.strokeWidth !== 3 &&
    resolved.strokeWidth !== 6
  ) {
    fail(operationIndex, 'edge.strokeWidth must be 3 or 6');
  }
  if (
    resolved.lineStyle !== undefined &&
    resolved.lineStyle !== 'solid' &&
    resolved.lineStyle !== 'dashed'
  ) {
    fail(operationIndex, 'edge.lineStyle must be solid or dashed');
  }
  if (
    resolved.colorPreset !== undefined &&
    !['default', 'foreground', 'muted', 'accent', 'success', 'warning', 'danger'].includes(
      resolved.colorPreset,
    )
  ) {
    fail(operationIndex, 'edge.colorPreset is invalid');
  }
  return {
    ...(resolved.strokeWidth === undefined ? {} : { strokeWidth: resolved.strokeWidth }),
    ...(resolved.lineStyle === undefined ? {} : { lineStyle: resolved.lineStyle }),
    ...(resolved.colorPreset === undefined ? {} : { colorPreset: resolved.colorPreset }),
  };
}

function resolveEdgeStyle(
  style: Partial<BoardEdgeStyle> | undefined,
  operationIndex: number,
): BoardEdgeStyle {
  return {
    ...DEFAULT_EDGE_STYLE,
    ...validateEdgeStylePatch(style, operationIndex),
  };
}

function createEdge(
  input: CreateEdgeInput,
  edgeId: string,
  nodes: BoardNode[],
  tempIdMap: Map<string, string>,
  operationIndex: number,
): BoardEdge {
  if (!input || typeof input !== 'object') fail(operationIndex, 'edge must be an object');
  const source = resolveReference(input.source, tempIdMap, operationIndex);
  const target = resolveReference(input.target, tempIdMap, operationIndex);
  if (source === target) fail(operationIndex, 'edge must connect two different nodes');
  const sourceNode = nodes.find((node) => node.id === source);
  const targetNode = nodes.find((node) => node.id === target);
  if (!sourceNode || !targetNode)
    fail(operationIndex, 'edge endpoints must reference existing nodes');
  if (!isWebPageNode(sourceNode) || !isWebPageNode(targetNode)) {
    fail(operationIndex, 'edges can connect only webpage nodes');
  }
  const validHandles = ['top', 'right', 'bottom', 'left'];
  if (!validHandles.includes(input.sourceHandle))
    fail(operationIndex, 'edge.sourceHandle is invalid');
  if (!validHandles.includes(input.targetHandle))
    fail(operationIndex, 'edge.targetHandle is invalid');
  return {
    id: edgeId,
    source,
    sourceHandle: input.sourceHandle,
    target,
    targetHandle: input.targetHandle,
    ...resolveEdgeStyle(input.style, operationIndex),
  };
}

function failure(error: BoardOperationError): BatchEditBoardFailure {
  return {
    ok: false,
    changed: false,
    error: {
      operationIndex: error.operationIndex,
      code: error.code,
      message: error.message,
    },
  };
}

export function applyBoardOperations(
  snapshot: Readonly<{ nodes: BoardNode[]; edges: BoardEdge[] }>,
  operations: readonly BoardOperation[],
  createId: () => string,
): BatchEditBoardResult {
  let nextNodes = snapshot.nodes.map((node) => ({ ...node }));
  let nextEdges = snapshot.edges.map((edge) => ({ ...edge }));
  const createdNodeIds: string[] = [];
  const updatedNodeIds: string[] = [];
  const deletedNodeIds: string[] = [];
  const createdEdgeIds: string[] = [];
  const updatedEdgeIds: string[] = [];
  const deletedEdgeIds: string[] = [];
  const tempIdMap = new Map<string, string>();

  try {
    operations.forEach((operation, operationIndex) => {
      if (!operation || typeof operation !== 'object') {
        fail(operationIndex, 'operation must be an object');
      }
      if (operation.op === 'create_node' || operation.op === 'create_edge') {
        const tempId = requireString(operation.tempId, 'tempId', operationIndex);
        if (!tempId) fail(operationIndex, 'tempId must not be empty');
        if (tempIdMap.has(tempId)) {
          fail(operationIndex, `Duplicate tempId: ${tempId}`);
        }
        const createdId = createId();
        if (!createdId) fail(operationIndex, 'createId returned an empty ID');
        if (
          nextNodes.some((node) => node.id === createdId) ||
          nextEdges.some((edge) => edge.id === createdId) ||
          Array.from(tempIdMap.values()).includes(createdId)
        ) {
          fail(operationIndex, `createId returned a duplicate ID: ${createdId}`);
        }

        if (operation.op === 'create_node') {
          const node = createNode(operation.node, createdId, nextNodes, operationIndex);
          tempIdMap.set(tempId, createdId);
          createdNodeIds.push(createdId);
          nextNodes.push(node);
          return;
        }

        const edge = createEdge(operation.edge, createdId, nextNodes, tempIdMap, operationIndex);
        const replaced = nextEdges.find((current) => hasSameUnorderedEndpoints(current, edge));
        const updatedEdges = addOrReplaceBoardEdge(nextEdges, edge);
        if (!updatedEdges) fail(operationIndex, 'create_edge did not change the board');
        nextEdges = updatedEdges;
        tempIdMap.set(tempId, createdId);
        createdEdgeIds.push(createdId);
        if (replaced) deletedEdgeIds.push(replaced.id);
        return;
      }

      if (operation.op === 'delete_edge') {
        const edgeId = resolveReference(operation.edgeId, tempIdMap, operationIndex);
        if (!nextEdges.some((edge) => edge.id === edgeId)) {
          fail(operationIndex, `Edge not found: ${edgeId}`);
        }
        nextEdges = nextEdges.filter((edge) => edge.id !== edgeId);
        if (!deletedEdgeIds.includes(edgeId)) deletedEdgeIds.push(edgeId);
        return;
      }

      if (operation.op === 'reorder_node') {
        const nodeId = resolveReference(operation.nodeId, tempIdMap, operationIndex);
        const reordered = reorderNode(nextNodes, nodeId, operation.position, operationIndex);
        if (reordered) {
          nextNodes = reordered;
          if (!updatedNodeIds.includes(nodeId)) updatedNodeIds.push(nodeId);
        }
        return;
      }

      if (operation.op === 'update_edge' || operation.op === 'reverse_edge') {
        const edgeId = resolveReference(operation.edgeId, tempIdMap, operationIndex);
        if (!nextEdges.some((edge) => edge.id === edgeId)) {
          fail(operationIndex, `Edge not found: ${edgeId}`);
        }
        const updatedEdges =
          operation.op === 'update_edge'
            ? updateBoardEdgeStyle(
                nextEdges,
                edgeId,
                validateEdgeStylePatch(operation.patch, operationIndex),
              )
            : reverseBoardEdge(nextEdges, edgeId);
        if (updatedEdges) {
          nextEdges = updatedEdges;
          if (!updatedEdgeIds.includes(edgeId)) updatedEdgeIds.push(edgeId);
        }
        return;
      }

      if (operation.op === 'delete_node') {
        const nodeId = resolveReference(operation.nodeId, tempIdMap, operationIndex);
        if (!nextNodes.some((node) => node.id === nodeId)) {
          fail(operationIndex, `Node not found: ${nodeId}`);
        }
        nextNodes = nextNodes.filter((node) => node.id !== nodeId);
        const incidentEdgeIds = nextEdges
          .filter((edge) => edge.source === nodeId || edge.target === nodeId)
          .map((edge) => edge.id);
        nextEdges = nextEdges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId);
        deletedNodeIds.push(nodeId);
        for (const edgeId of incidentEdgeIds) {
          if (!deletedEdgeIds.includes(edgeId)) deletedEdgeIds.push(edgeId);
        }
        return;
      }

      if (operation.op === 'update_node') {
        const nodeId = resolveReference(operation.nodeId, tempIdMap, operationIndex);
        const nodeIndex = nextNodes.findIndex((node) => node.id === nodeId);
        if (nodeIndex === -1) fail(operationIndex, `Node not found: ${nodeId}`);
        const updated = updateNode(nextNodes[nodeIndex], operation.patch, operationIndex);
        if (updated) {
          nextNodes[nodeIndex] = updated;
          if (!updatedNodeIds.includes(nodeId)) updatedNodeIds.push(nodeId);
        }
        return;
      }

      fail(
        operationIndex,
        `Unsupported board operation: ${String((operation as { op?: unknown }).op)}`,
      );
    });
  } catch (error) {
    if (error instanceof BoardOperationError) return failure(error);
    throw error;
  }

  const changed =
    JSON.stringify(nextNodes) !== JSON.stringify(snapshot.nodes) ||
    JSON.stringify(nextEdges) !== JSON.stringify(snapshot.edges);
  const result: BatchEditBoardSuccess = {
    ok: true,
    changed,
    nodes: nextNodes,
    edges: nextEdges,
    createdNodeIds,
    updatedNodeIds,
    deletedNodeIds,
    createdEdgeIds,
    updatedEdgeIds,
    deletedEdgeIds,
    tempIdMap: Object.fromEntries(tempIdMap),
  };
  return result;
}
