import { describe, expect, it } from 'vitest';

import {
  INITIAL_DISPLAY_ENGINE_STATE,
  displayEngineReducer,
  hasAnyInteraction,
  hasPendingCaptureRetry,
  isContextMenuTarget,
  isDragOrResizeActive,
  isForceHidden,
  isInOccludedSet,
  isInteractionActive,
  isNativeHiddenByCapture,
  isPanOrZoomActive,
  isSettling,
  type DisplayEngineState,
} from './state-machine';

function withState(overrides: Partial<DisplayEngineState>): DisplayEngineState {
  return { ...INITIAL_DISPLAY_ENGINE_STATE, ...overrides };
}

describe('displayEngineReducer - INTERACTION_START / END / CLEAR_ALL', () => {
  it('INTERACTION_START は activeInteractions に追加する', () => {
    const next = displayEngineReducer(INITIAL_DISPLAY_ENGINE_STATE, {
      type: 'INTERACTION_START',
      interactionType: 'pan',
    });
    expect(Array.from(next.activeInteractions)).toEqual(['pan']);
  });

  it('INTERACTION_START 同じ type は同一 state を返す', () => {
    const base = withState({ activeInteractions: new Set(['pan']) });
    const next = displayEngineReducer(base, { type: 'INTERACTION_START', interactionType: 'pan' });
    expect(next).toBe(base);
  });

  it('INTERACTION_END で他に interaction が残っていれば該当 type のみ削除', () => {
    const base = withState({
      activeInteractions: new Set(['pan', 'drag']),
      resizingNodeId: 'a',
      forceHiddenIds: new Set(['x']),
      nativeHiddenByCaptureIds: new Set(['y']),
    });
    const next = displayEngineReducer(base, { type: 'INTERACTION_END', interactionType: 'pan' });
    expect(Array.from(next.activeInteractions)).toEqual(['drag']);
    expect(next.resizingNodeId).toBe('a');
    expect(next.forceHiddenIds).toBe(base.forceHiddenIds);
    expect(next.nativeHiddenByCaptureIds).toBe(base.nativeHiddenByCaptureIds);
  });

  it('INTERACTION_END で最後の interaction を抜くと clear-if-last 群がクリアされる', () => {
    const base = withState({
      activeInteractions: new Set(['drag']),
      resizingNodeId: 'a',
      forceHiddenIds: new Set(['x', 'y']),
      nativeHiddenByCaptureIds: new Set(['z']),
      settlingIds: new Set(['s']),
      captureRetryIds: new Set(['r']),
    });
    const next = displayEngineReducer(base, { type: 'INTERACTION_END', interactionType: 'drag' });
    expect(next.activeInteractions.size).toBe(0);
    expect(next.resizingNodeId).toBeNull();
    expect(next.forceHiddenIds.size).toBe(0);
    expect(next.nativeHiddenByCaptureIds.size).toBe(0);
    // 仕様: clear-if-last は forceHidden / nativeHiddenByCapture / resizing のみで settling / captureRetry は維持
    expect(Array.from(next.settlingIds)).toEqual(['s']);
    expect(Array.from(next.captureRetryIds)).toEqual(['r']);
  });

  it('INTERACTION_END で該当 type が含まれていなければ同一 state', () => {
    const base = withState({ activeInteractions: new Set(['pan']) });
    const next = displayEngineReducer(base, { type: 'INTERACTION_END', interactionType: 'drag' });
    expect(next).toBe(base);
  });

  it('INTERACTION_CLEAR_ALL は active / resizing / settling / forceHidden / nativeHidden / captureRetry を全クリア', () => {
    const base = withState({
      activeInteractions: new Set(['pan', 'drag']),
      resizingNodeId: 'a',
      settlingIds: new Set(['s']),
      forceHiddenIds: new Set(['x']),
      nativeHiddenByCaptureIds: new Set(['y']),
      captureRetryIds: new Set(['r']),
      contextMenuNodeId: 'cm',
      unsavedDialogOpen: true,
      toolbarOccludedIds: new Set(['t']),
    });
    const next = displayEngineReducer(base, { type: 'INTERACTION_CLEAR_ALL' });
    expect(next.activeInteractions.size).toBe(0);
    expect(next.resizingNodeId).toBeNull();
    expect(next.settlingIds.size).toBe(0);
    expect(next.forceHiddenIds.size).toBe(0);
    expect(next.nativeHiddenByCaptureIds.size).toBe(0);
    expect(next.captureRetryIds.size).toBe(0);
    // contextMenu / unsavedDialog / toolbarOccluded は INTERACTION_CLEAR_ALL の対象外
    expect(next.contextMenuNodeId).toBe('cm');
    expect(next.unsavedDialogOpen).toBe(true);
    expect(Array.from(next.toolbarOccludedIds)).toEqual(['t']);
  });
});

describe('displayEngineReducer - context menu', () => {
  it('CONTEXT_MENU_OPEN は id をセット', () => {
    const next = displayEngineReducer(INITIAL_DISPLAY_ENGINE_STATE, {
      type: 'CONTEXT_MENU_OPEN',
      nodeId: 'n1',
    });
    expect(next.contextMenuNodeId).toBe('n1');
  });

  it('CONTEXT_MENU_OPEN 同じ id は同一 state', () => {
    const base = withState({ contextMenuNodeId: 'n1' });
    const next = displayEngineReducer(base, { type: 'CONTEXT_MENU_OPEN', nodeId: 'n1' });
    expect(next).toBe(base);
  });

  it('CONTEXT_MENU_CLOSE は null に', () => {
    const base = withState({ contextMenuNodeId: 'n1' });
    const next = displayEngineReducer(base, { type: 'CONTEXT_MENU_CLOSE' });
    expect(next.contextMenuNodeId).toBeNull();
  });

  it('CONTEXT_MENU_CLOSE 既に null なら同一 state', () => {
    const next = displayEngineReducer(INITIAL_DISPLAY_ENGINE_STATE, { type: 'CONTEXT_MENU_CLOSE' });
    expect(next).toBe(INITIAL_DISPLAY_ENGINE_STATE);
  });
});

describe('displayEngineReducer - unsaved dialog', () => {
  it('UNSAVED_DIALOG_OPEN / CLOSE が反映される', () => {
    const opened = displayEngineReducer(INITIAL_DISPLAY_ENGINE_STATE, {
      type: 'UNSAVED_DIALOG_OPEN',
    });
    expect(opened.unsavedDialogOpen).toBe(true);
    const closed = displayEngineReducer(opened, { type: 'UNSAVED_DIALOG_CLOSE' });
    expect(closed.unsavedDialogOpen).toBe(false);
  });

  it('UNSAVED_DIALOG_OPEN 二度目は同一 state', () => {
    const base = withState({ unsavedDialogOpen: true });
    expect(displayEngineReducer(base, { type: 'UNSAVED_DIALOG_OPEN' })).toBe(base);
  });
});

describe('displayEngineReducer - resize', () => {
  it('RESIZE_START は id を保持', () => {
    const next = displayEngineReducer(INITIAL_DISPLAY_ENGINE_STATE, {
      type: 'RESIZE_START',
      nodeId: 'r1',
    });
    expect(next.resizingNodeId).toBe('r1');
  });

  it('RESIZE_END は一致する場合のみ null', () => {
    const base = withState({ resizingNodeId: 'r1' });
    const matched = displayEngineReducer(base, { type: 'RESIZE_END', nodeId: 'r1' });
    expect(matched.resizingNodeId).toBeNull();
    const mismatched = displayEngineReducer(base, { type: 'RESIZE_END', nodeId: 'other' });
    expect(mismatched).toBe(base);
  });
});

describe('displayEngineReducer - settle', () => {
  it('SETTLE_NODE / RELEASE_NODE は settlingIds を add/delete', () => {
    const added = displayEngineReducer(INITIAL_DISPLAY_ENGINE_STATE, {
      type: 'SETTLE_NODE',
      nodeId: 'n1',
    });
    expect(Array.from(added.settlingIds)).toEqual(['n1']);
    const removed = displayEngineReducer(added, { type: 'RELEASE_NODE', nodeId: 'n1' });
    expect(removed.settlingIds.size).toBe(0);
  });

  it('RELEASE_NODE 存在しない id は同一 state', () => {
    expect(
      displayEngineReducer(INITIAL_DISPLAY_ENGINE_STATE, { type: 'RELEASE_NODE', nodeId: 'x' }),
    ).toBe(INITIAL_DISPLAY_ENGINE_STATE);
  });
});

describe('displayEngineReducer - toolbar occluded', () => {
  it('TOOLBAR_OCCLUDED_IDS_SET は丸ごと差し替え', () => {
    const ids = new Set(['a', 'b']);
    const next = displayEngineReducer(INITIAL_DISPLAY_ENGINE_STATE, {
      type: 'TOOLBAR_OCCLUDED_IDS_SET',
      ids,
    });
    expect(next.toolbarOccludedIds).toBe(ids);
  });
});

describe('displayEngineReducer - forceHidden / nativeHiddenByCapture', () => {
  it('FORCE_HIDDEN_ADD / REMOVE', () => {
    const added = displayEngineReducer(INITIAL_DISPLAY_ENGINE_STATE, {
      type: 'FORCE_HIDDEN_ADD',
      nodeId: 'n',
    });
    expect(Array.from(added.forceHiddenIds)).toEqual(['n']);
    const removed = displayEngineReducer(added, { type: 'FORCE_HIDDEN_REMOVE', nodeId: 'n' });
    expect(removed.forceHiddenIds.size).toBe(0);
  });

  it('NATIVE_HIDDEN_BY_CAPTURE_ADD', () => {
    const next = displayEngineReducer(INITIAL_DISPLAY_ENGINE_STATE, {
      type: 'NATIVE_HIDDEN_BY_CAPTURE_ADD',
      nodeId: 'n',
    });
    expect(Array.from(next.nativeHiddenByCaptureIds)).toEqual(['n']);
  });
});

describe('displayEngineReducer - capture retry', () => {
  it('CAPTURE_RETRY_ADD / REMOVE / CLEAR_ALL', () => {
    let s = displayEngineReducer(INITIAL_DISPLAY_ENGINE_STATE, {
      type: 'CAPTURE_RETRY_ADD',
      nodeId: 'a',
    });
    s = displayEngineReducer(s, { type: 'CAPTURE_RETRY_ADD', nodeId: 'b' });
    expect(s.captureRetryIds.size).toBe(2);
    s = displayEngineReducer(s, { type: 'CAPTURE_RETRY_REMOVE', nodeId: 'a' });
    expect(Array.from(s.captureRetryIds)).toEqual(['b']);
    s = displayEngineReducer(s, { type: 'CAPTURE_RETRY_CLEAR_ALL' });
    expect(s.captureRetryIds.size).toBe(0);
  });

  it('CAPTURE_RETRY_CLEAR_ALL 既に空なら同一 state', () => {
    expect(
      displayEngineReducer(INITIAL_DISPLAY_ENGINE_STATE, { type: 'CAPTURE_RETRY_CLEAR_ALL' }),
    ).toBe(INITIAL_DISPLAY_ENGINE_STATE);
  });
});

describe('displayEngineReducer - CLEANUP_NODE', () => {
  it('一致する per-node フィールドを全削除する', () => {
    const base = withState({
      contextMenuNodeId: 'n',
      resizingNodeId: 'n',
      settlingIds: new Set(['n', 'other']),
      toolbarOccludedIds: new Set(['n']),
      forceHiddenIds: new Set(['n']),
      nativeHiddenByCaptureIds: new Set(['n']),
      captureRetryIds: new Set(['n']),
    });
    const next = displayEngineReducer(base, { type: 'CLEANUP_NODE', nodeId: 'n' });
    expect(next.contextMenuNodeId).toBeNull();
    expect(next.resizingNodeId).toBeNull();
    expect(Array.from(next.settlingIds)).toEqual(['other']);
    expect(next.toolbarOccludedIds.size).toBe(0);
    expect(next.forceHiddenIds.size).toBe(0);
    expect(next.nativeHiddenByCaptureIds.size).toBe(0);
    expect(next.captureRetryIds.size).toBe(0);
  });

  it('CLEANUP_NODE で contextMenu/resizing が他 id なら維持', () => {
    const base = withState({
      contextMenuNodeId: 'other',
      resizingNodeId: 'other',
    });
    const next = displayEngineReducer(base, { type: 'CLEANUP_NODE', nodeId: 'n' });
    expect(next.contextMenuNodeId).toBe('other');
    expect(next.resizingNodeId).toBe('other');
  });

  it('CLEANUP_NODE で対象が無ければ同一 state', () => {
    expect(
      displayEngineReducer(INITIAL_DISPLAY_ENGINE_STATE, { type: 'CLEANUP_NODE', nodeId: 'x' }),
    ).toBe(INITIAL_DISPLAY_ENGINE_STATE);
  });
});

describe('selectors', () => {
  it('hasAnyInteraction / isInteractionActive', () => {
    const empty = INITIAL_DISPLAY_ENGINE_STATE;
    expect(hasAnyInteraction(empty)).toBe(false);
    expect(isInteractionActive(empty, 'pan')).toBe(false);
    const s = withState({ activeInteractions: new Set(['pan']) });
    expect(hasAnyInteraction(s)).toBe(true);
    expect(isInteractionActive(s, 'pan')).toBe(true);
    expect(isInteractionActive(s, 'drag')).toBe(false);
  });

  it('isPanOrZoomActive / isDragOrResizeActive', () => {
    expect(isPanOrZoomActive(withState({ activeInteractions: new Set(['pan']) }))).toBe(true);
    expect(isPanOrZoomActive(withState({ activeInteractions: new Set(['zoom']) }))).toBe(true);
    expect(isPanOrZoomActive(withState({ activeInteractions: new Set(['drag']) }))).toBe(false);
    expect(isDragOrResizeActive(withState({ activeInteractions: new Set(['drag']) }))).toBe(true);
    expect(isDragOrResizeActive(withState({ activeInteractions: new Set(['resize']) }))).toBe(true);
    expect(isDragOrResizeActive(withState({ activeInteractions: new Set(['pan']) }))).toBe(false);
  });

  it('isContextMenuTarget / isSettling / isInOccludedSet', () => {
    const s = withState({
      contextMenuNodeId: 'n',
      settlingIds: new Set(['s']),
      toolbarOccludedIds: new Set(['t']),
    });
    expect(isContextMenuTarget(s, 'n')).toBe(true);
    expect(isContextMenuTarget(s, 'x')).toBe(false);
    expect(isSettling(s, 's')).toBe(true);
    expect(isSettling(s, 'x')).toBe(false);
    expect(isInOccludedSet(s, 't')).toBe(true);
    expect(isInOccludedSet(s, 'x')).toBe(false);
  });

  it('isForceHidden / isNativeHiddenByCapture / hasPendingCaptureRetry', () => {
    const s = withState({
      forceHiddenIds: new Set(['f']),
      nativeHiddenByCaptureIds: new Set(['c']),
      captureRetryIds: new Set(['r']),
    });
    expect(isForceHidden(s, 'f')).toBe(true);
    expect(isForceHidden(s, 'x')).toBe(false);
    expect(isNativeHiddenByCapture(s, 'c')).toBe(true);
    expect(hasPendingCaptureRetry(s)).toBe(true);
    expect(hasPendingCaptureRetry(INITIAL_DISPLAY_ENGINE_STATE)).toBe(false);
  });
});
