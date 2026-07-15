import type { InteractionType } from '../types';

// useSheltieDisplayEngine が暗黙に持っていた per-node / mode / dialog 系の ref を 1 箇所に集約した state。
// reducer は純関数で、複合更新（INTERACTION_END で関連フラグも一括クリア等）も内部で完結させる。
export interface DisplayEngineState {
  activeInteractions: ReadonlySet<InteractionType>;
  contextMenuNodeId: string | null;
  unsavedDialogOpen: boolean;
  resizingNodeId: string | null;
  settlingIds: ReadonlySet<string>;
  toolbarOccludedIds: ReadonlySet<string>;
  forceHiddenIds: ReadonlySet<string>;
  nativeHiddenByCaptureIds: ReadonlySet<string>;
  captureRetryIds: ReadonlySet<string>;
}

export const INITIAL_DISPLAY_ENGINE_STATE: DisplayEngineState = {
  activeInteractions: new Set(),
  contextMenuNodeId: null,
  unsavedDialogOpen: false,
  resizingNodeId: null,
  settlingIds: new Set(),
  toolbarOccludedIds: new Set(),
  forceHiddenIds: new Set(),
  nativeHiddenByCaptureIds: new Set(),
  captureRetryIds: new Set(),
};

export type DisplayEngineAction =
  | { type: 'INTERACTION_START'; interactionType: InteractionType }
  | { type: 'INTERACTION_END'; interactionType: InteractionType }
  | { type: 'INTERACTION_CLEAR_ALL' }
  | { type: 'CONTEXT_MENU_OPEN'; nodeId: string }
  | { type: 'CONTEXT_MENU_CLOSE' }
  | { type: 'UNSAVED_DIALOG_OPEN' }
  | { type: 'UNSAVED_DIALOG_CLOSE' }
  | { type: 'RESIZE_START'; nodeId: string }
  | { type: 'RESIZE_END'; nodeId: string }
  | { type: 'SETTLE_NODE'; nodeId: string }
  | { type: 'RELEASE_NODE'; nodeId: string }
  | { type: 'TOOLBAR_OCCLUDED_IDS_SET'; ids: ReadonlySet<string> }
  | { type: 'FORCE_HIDDEN_ADD'; nodeId: string }
  | { type: 'FORCE_HIDDEN_REMOVE'; nodeId: string }
  | { type: 'NATIVE_HIDDEN_BY_CAPTURE_ADD'; nodeId: string }
  | { type: 'CAPTURE_RETRY_ADD'; nodeId: string }
  | { type: 'CAPTURE_RETRY_REMOVE'; nodeId: string }
  | { type: 'CAPTURE_RETRY_CLEAR_ALL' }
  | { type: 'CLEANUP_NODE'; nodeId: string };

function setWithAdd<T>(set: ReadonlySet<T>, value: T): ReadonlySet<T> {
  if (set.has(value)) return set;
  const next = new Set(set);
  next.add(value);
  return next;
}

function setWithDelete<T>(set: ReadonlySet<T>, value: T): ReadonlySet<T> {
  if (!set.has(value)) return set;
  const next = new Set(set);
  next.delete(value);
  return next;
}

const EMPTY_STRING_SET: ReadonlySet<string> = new Set<string>();
const EMPTY_INTERACTION_SET: ReadonlySet<InteractionType> = new Set<InteractionType>();

export function displayEngineReducer(
  state: DisplayEngineState,
  action: DisplayEngineAction,
): DisplayEngineState {
  switch (action.type) {
    case 'INTERACTION_START': {
      const activeInteractions = setWithAdd(state.activeInteractions, action.interactionType);
      if (activeInteractions === state.activeInteractions) return state;
      return { ...state, activeInteractions };
    }
    case 'INTERACTION_END': {
      const activeInteractions = setWithDelete(state.activeInteractions, action.interactionType);
      if (activeInteractions === state.activeInteractions) return state;
      // clear-if-last: 全 interaction が終わったときに関連フラグも一括でクリアする。
      // 元コードの handleInteractionChange の `if (activeInteractionsRef.current.size === 0)` ブロックを再現。
      if (activeInteractions.size === 0) {
        return {
          ...state,
          activeInteractions,
          resizingNodeId: null,
          forceHiddenIds: EMPTY_STRING_SET,
          nativeHiddenByCaptureIds: EMPTY_STRING_SET,
        };
      }
      return { ...state, activeInteractions };
    }
    case 'INTERACTION_CLEAR_ALL': {
      return {
        ...state,
        activeInteractions: EMPTY_INTERACTION_SET,
        resizingNodeId: null,
        settlingIds: EMPTY_STRING_SET,
        forceHiddenIds: EMPTY_STRING_SET,
        nativeHiddenByCaptureIds: EMPTY_STRING_SET,
        captureRetryIds: EMPTY_STRING_SET,
      };
    }
    case 'CONTEXT_MENU_OPEN': {
      if (state.contextMenuNodeId === action.nodeId) return state;
      return { ...state, contextMenuNodeId: action.nodeId };
    }
    case 'CONTEXT_MENU_CLOSE': {
      if (state.contextMenuNodeId === null) return state;
      return { ...state, contextMenuNodeId: null };
    }
    case 'UNSAVED_DIALOG_OPEN': {
      if (state.unsavedDialogOpen) return state;
      return { ...state, unsavedDialogOpen: true };
    }
    case 'UNSAVED_DIALOG_CLOSE': {
      if (!state.unsavedDialogOpen) return state;
      return { ...state, unsavedDialogOpen: false };
    }
    case 'RESIZE_START': {
      if (state.resizingNodeId === action.nodeId) return state;
      return { ...state, resizingNodeId: action.nodeId };
    }
    case 'RESIZE_END': {
      if (state.resizingNodeId !== action.nodeId) return state;
      return { ...state, resizingNodeId: null };
    }
    case 'SETTLE_NODE': {
      const settlingIds = setWithAdd(state.settlingIds, action.nodeId);
      if (settlingIds === state.settlingIds) return state;
      return { ...state, settlingIds };
    }
    case 'RELEASE_NODE': {
      const settlingIds = setWithDelete(state.settlingIds, action.nodeId);
      if (settlingIds === state.settlingIds) return state;
      return { ...state, settlingIds };
    }
    case 'TOOLBAR_OCCLUDED_IDS_SET': {
      return { ...state, toolbarOccludedIds: action.ids };
    }
    case 'FORCE_HIDDEN_ADD': {
      const forceHiddenIds = setWithAdd(state.forceHiddenIds, action.nodeId);
      if (forceHiddenIds === state.forceHiddenIds) return state;
      return { ...state, forceHiddenIds };
    }
    case 'FORCE_HIDDEN_REMOVE': {
      const forceHiddenIds = setWithDelete(state.forceHiddenIds, action.nodeId);
      if (forceHiddenIds === state.forceHiddenIds) return state;
      return { ...state, forceHiddenIds };
    }
    case 'NATIVE_HIDDEN_BY_CAPTURE_ADD': {
      const nativeHiddenByCaptureIds = setWithAdd(state.nativeHiddenByCaptureIds, action.nodeId);
      if (nativeHiddenByCaptureIds === state.nativeHiddenByCaptureIds) return state;
      return { ...state, nativeHiddenByCaptureIds };
    }
    case 'CAPTURE_RETRY_ADD': {
      const captureRetryIds = setWithAdd(state.captureRetryIds, action.nodeId);
      if (captureRetryIds === state.captureRetryIds) return state;
      return { ...state, captureRetryIds };
    }
    case 'CAPTURE_RETRY_REMOVE': {
      const captureRetryIds = setWithDelete(state.captureRetryIds, action.nodeId);
      if (captureRetryIds === state.captureRetryIds) return state;
      return { ...state, captureRetryIds };
    }
    case 'CAPTURE_RETRY_CLEAR_ALL': {
      if (state.captureRetryIds.size === 0) return state;
      return { ...state, captureRetryIds: EMPTY_STRING_SET };
    }
    case 'CLEANUP_NODE': {
      const { nodeId } = action;
      const next: DisplayEngineState = { ...state };
      let changed = false;

      if (state.contextMenuNodeId === nodeId) {
        next.contextMenuNodeId = null;
        changed = true;
      }
      if (state.resizingNodeId === nodeId) {
        next.resizingNodeId = null;
        changed = true;
      }
      const settlingIds = setWithDelete(state.settlingIds, nodeId);
      if (settlingIds !== state.settlingIds) {
        next.settlingIds = settlingIds;
        changed = true;
      }
      const toolbarOccludedIds = setWithDelete(state.toolbarOccludedIds, nodeId);
      if (toolbarOccludedIds !== state.toolbarOccludedIds) {
        next.toolbarOccludedIds = toolbarOccludedIds;
        changed = true;
      }
      const forceHiddenIds = setWithDelete(state.forceHiddenIds, nodeId);
      if (forceHiddenIds !== state.forceHiddenIds) {
        next.forceHiddenIds = forceHiddenIds;
        changed = true;
      }
      const nativeHiddenByCaptureIds = setWithDelete(state.nativeHiddenByCaptureIds, nodeId);
      if (nativeHiddenByCaptureIds !== state.nativeHiddenByCaptureIds) {
        next.nativeHiddenByCaptureIds = nativeHiddenByCaptureIds;
        changed = true;
      }
      const captureRetryIds = setWithDelete(state.captureRetryIds, nodeId);
      if (captureRetryIds !== state.captureRetryIds) {
        next.captureRetryIds = captureRetryIds;
        changed = true;
      }

      return changed ? next : state;
    }
    default: {
      const _exhaustive: never = action;
      void _exhaustive;
      return state;
    }
  }
}

// Selectors（mode.ts の isToolbarOccluded(nodeId, nodeRect, toolbarRects) と
// 衝突しないよう、こちらは isInOccludedSet を使う）
export function hasAnyInteraction(s: DisplayEngineState): boolean {
  return s.activeInteractions.size > 0;
}

export function isInteractionActive(s: DisplayEngineState, type: InteractionType): boolean {
  return s.activeInteractions.has(type);
}

export function isPanOrZoomActive(s: DisplayEngineState): boolean {
  return s.activeInteractions.has('pan') || s.activeInteractions.has('zoom');
}

export function isDragOrResizeActive(s: DisplayEngineState): boolean {
  return s.activeInteractions.has('drag') || s.activeInteractions.has('resize');
}

export function isContextMenuTarget(s: DisplayEngineState, nodeId: string): boolean {
  return s.contextMenuNodeId === nodeId;
}

export function isSettling(s: DisplayEngineState, nodeId: string): boolean {
  return s.settlingIds.has(nodeId);
}

export function isInOccludedSet(s: DisplayEngineState, nodeId: string): boolean {
  return s.toolbarOccludedIds.has(nodeId);
}

export function isForceHidden(s: DisplayEngineState, nodeId: string): boolean {
  return s.forceHiddenIds.has(nodeId);
}

export function isNativeHiddenByCapture(s: DisplayEngineState, nodeId: string): boolean {
  return s.nativeHiddenByCaptureIds.has(nodeId);
}

export function hasPendingCaptureRetry(s: DisplayEngineState): boolean {
  return s.captureRetryIds.size > 0;
}
