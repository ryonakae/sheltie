import { describe, expect, it } from 'vitest';

import {
  applyDisplayModeDemotions,
  isFullyInsideNativeSafeArea,
  isOutsideExpandedViewport,
  isOutsideViewport,
  isToolbarOccluded,
  rectsOverlap,
  resolveViewportDisplayMode,
  shouldUseOpacityReveal,
} from './mode';

// 関数群は left/right/top/bottom/width/height のみ参照するため、テストでは plain object を DOMRect として扱う
function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON() {
      return this;
    },
  } as DOMRect;
}

const CONTAINER = rect(0, 0, 1000, 600);

describe('isOutsideViewport', () => {
  it('コンテナ内に収まるノードは内側', () => {
    expect(isOutsideViewport(rect(100, 100, 200, 100), CONTAINER)).toBe(false);
  });

  it('右辺がコンテナ左辺に触れるノードは外側（半開区間）', () => {
    expect(isOutsideViewport(rect(-100, 100, 100, 100), CONTAINER)).toBe(true);
  });

  it('左辺がコンテナ右辺に触れるノードは外側', () => {
    expect(isOutsideViewport(rect(1000, 100, 100, 100), CONTAINER)).toBe(true);
  });

  it('部分的に重なるノードは内側扱い', () => {
    expect(isOutsideViewport(rect(-50, 100, 100, 100), CONTAINER)).toBe(false);
  });

  it('上下方向にもはみ出しを検知する', () => {
    expect(isOutsideViewport(rect(100, -200, 100, 100), CONTAINER)).toBe(true);
    expect(isOutsideViewport(rect(100, 600, 100, 100), CONTAINER)).toBe(true);
  });
});

describe('rectsOverlap', () => {
  it('完全に分離した矩形は重ならない', () => {
    expect(rectsOverlap(rect(0, 0, 50, 50), rect(100, 100, 50, 50))).toBe(false);
  });

  it('辺で接するだけの矩形は重ならない（strict <）', () => {
    expect(rectsOverlap(rect(0, 0, 50, 50), rect(50, 0, 50, 50))).toBe(false);
  });

  it('内包する矩形は重なる', () => {
    expect(rectsOverlap(rect(0, 0, 100, 100), rect(20, 20, 30, 30))).toBe(true);
  });

  it('部分的に重なる矩形は重なる', () => {
    expect(rectsOverlap(rect(0, 0, 60, 60), rect(40, 40, 60, 60))).toBe(true);
  });
});

describe('isFullyInsideNativeSafeArea', () => {
  // NATIVE_SAFE_MARGIN_PX = 25, NATIVE_SAFE_MARGIN_BOTTOM_PX = 96, HYSTERESIS_PX = 4
  // → 有効な内側境界: left>=21, right<=979, top>=21, bottom<=508

  it('中央に十分小さいノードは安全領域内', () => {
    expect(isFullyInsideNativeSafeArea(rect(100, 100, 200, 200), CONTAINER)).toBe(true);
  });

  it('左マージンを 1px 超えた時点で安全領域外（境界 left=21）', () => {
    expect(isFullyInsideNativeSafeArea(rect(20, 100, 200, 200), CONTAINER)).toBe(false);
  });

  it('左マージン境界ちょうどは hysteresis で内側に含む', () => {
    expect(isFullyInsideNativeSafeArea(rect(21, 100, 200, 200), CONTAINER)).toBe(true);
  });

  it('下マージンが厚い（96px）のは hysteresis 込みで bottom<=508', () => {
    expect(isFullyInsideNativeSafeArea(rect(100, 100, 200, 408), CONTAINER)).toBe(true);
    expect(isFullyInsideNativeSafeArea(rect(100, 100, 200, 409), CONTAINER)).toBe(false);
  });

  it('右辺が右マージンを超えると外側', () => {
    expect(isFullyInsideNativeSafeArea(rect(900, 100, 100, 100), CONTAINER)).toBe(false);
  });
});

describe('isOutsideExpandedViewport', () => {
  // PRE_DISPLAY_MARGIN_PX = 50 → viewport を 50px 各方向に拡張

  it('通常の viewport 内にあるノードは expanded viewport 内', () => {
    expect(isOutsideExpandedViewport(rect(100, 100, 200, 100), CONTAINER)).toBe(false);
  });

  it('左に 49px はみ出していても expanded viewport 内', () => {
    expect(isOutsideExpandedViewport(rect(-149, 100, 100, 100), CONTAINER)).toBe(false);
  });

  it('左に 51px はみ出すと expanded viewport の外', () => {
    expect(isOutsideExpandedViewport(rect(-151, 100, 100, 100), CONTAINER)).toBe(true);
  });

  it('下方向も expanded で判定する', () => {
    expect(isOutsideExpandedViewport(rect(100, 651, 100, 100), CONTAINER)).toBe(true);
    expect(isOutsideExpandedViewport(rect(100, 649, 100, 100), CONTAINER)).toBe(false);
  });
});

describe('resolveViewportDisplayMode', () => {
  it('viewport 外なら hidden', () => {
    expect(resolveViewportDisplayMode(rect(2000, 2000, 100, 100), CONTAINER, true)).toBe('hidden');
  });

  it('安全領域内なら native（screenshot の有無に関わらず）', () => {
    expect(resolveViewportDisplayMode(rect(100, 100, 200, 200), CONTAINER, true)).toBe('native');
    expect(resolveViewportDisplayMode(rect(100, 100, 200, 200), CONTAINER, false)).toBe('native');
  });

  it('viewport 内だが安全領域外 + screenshot あり → screenshot', () => {
    // 右端ぎりぎりに置くと safe area を超えるが viewport 内に残る
    expect(resolveViewportDisplayMode(rect(900, 100, 100, 100), CONTAINER, true)).toBe(
      'screenshot',
    );
  });

  it('viewport 内だが安全領域外 + screenshot なし → native（フォールバック）', () => {
    expect(resolveViewportDisplayMode(rect(900, 100, 100, 100), CONTAINER, false)).toBe('native');
  });
});

describe('applyDisplayModeDemotions', () => {
  const noFlags = {
    unsavedChangesDialogOpen: false,
    isContextMenuTarget: false,
    isSettling: false,
    isToolbarOccluded: false,
  };

  it('native でなければ降格条件があっても元のモードを返す', () => {
    expect(
      applyDisplayModeDemotions('screenshot', true, { ...noFlags, unsavedChangesDialogOpen: true }),
    ).toBe('screenshot');
    expect(applyDisplayModeDemotions('hidden', false, { ...noFlags, isSettling: true })).toBe(
      'hidden',
    );
  });

  it('native で降格条件が無ければ native のまま', () => {
    expect(applyDisplayModeDemotions('native', true, noFlags)).toBe('native');
    expect(applyDisplayModeDemotions('native', false, noFlags)).toBe('native');
  });

  it('native + 降格条件 + screenshot あり → screenshot', () => {
    expect(
      applyDisplayModeDemotions('native', true, { ...noFlags, unsavedChangesDialogOpen: true }),
    ).toBe('screenshot');
    expect(
      applyDisplayModeDemotions('native', true, { ...noFlags, isContextMenuTarget: true }),
    ).toBe('screenshot');
    expect(applyDisplayModeDemotions('native', true, { ...noFlags, isSettling: true })).toBe(
      'screenshot',
    );
    expect(applyDisplayModeDemotions('native', true, { ...noFlags, isToolbarOccluded: true })).toBe(
      'screenshot',
    );
  });

  it('native + 降格条件 + screenshot なし → hidden', () => {
    expect(
      applyDisplayModeDemotions('native', false, { ...noFlags, unsavedChangesDialogOpen: true }),
    ).toBe('hidden');
    expect(
      applyDisplayModeDemotions('native', false, { ...noFlags, isToolbarOccluded: true }),
    ).toBe('hidden');
  });

  it('複数の降格条件が重なっても結果は同じ（OR）', () => {
    expect(
      applyDisplayModeDemotions('native', true, {
        unsavedChangesDialogOpen: true,
        isContextMenuTarget: true,
        isSettling: true,
        isToolbarOccluded: true,
      }),
    ).toBe('screenshot');
  });
});

describe('isToolbarOccluded', () => {
  const nodeRect = rect(100, 100, 200, 100); // [100,100]-[300,200]

  it('自分自身のツールバーは被り判定に含めない', () => {
    expect(
      isToolbarOccluded('node-a', nodeRect, [
        { ownerId: 'node-a', rect: rect(100, 200, 200, 30) }, // 自分のツールバー（直下）
      ]),
    ).toBe(false);
  });

  it('他ノードのツールバーが重なれば true', () => {
    expect(
      isToolbarOccluded('node-a', nodeRect, [
        { ownerId: 'node-b', rect: rect(150, 150, 100, 30) }, // 重なる
      ]),
    ).toBe(true);
  });

  it('他ノードのツールバーでも重ならなければ false', () => {
    expect(
      isToolbarOccluded('node-a', nodeRect, [
        { ownerId: 'node-b', rect: rect(500, 500, 100, 30) }, // 離れている
      ]),
    ).toBe(false);
  });

  it('複数ツールバーのうち 1 つでも重なれば true', () => {
    expect(
      isToolbarOccluded('node-a', nodeRect, [
        { ownerId: 'node-b', rect: rect(500, 500, 100, 30) },
        { ownerId: 'node-c', rect: rect(150, 150, 50, 30) }, // 重なる
      ]),
    ).toBe(true);
  });

  it('ツールバー配列が空なら false', () => {
    expect(isToolbarOccluded('node-a', nodeRect, [])).toBe(false);
  });
});

describe('shouldUseOpacityReveal', () => {
  it('macOS + screenshot→native の遷移のみ true', () => {
    expect(shouldUseOpacityReveal(true, 'screenshot', 'native')).toBe(true);
  });

  it('macOS でなければ false（hidden→native も含む）', () => {
    expect(shouldUseOpacityReveal(false, 'screenshot', 'native')).toBe(false);
    expect(shouldUseOpacityReveal(false, 'hidden', 'native')).toBe(false);
  });

  it('macOS でも遷移元が screenshot でなければ false', () => {
    expect(shouldUseOpacityReveal(true, 'hidden', 'native')).toBe(false);
    expect(shouldUseOpacityReveal(true, 'native', 'native')).toBe(false);
  });

  it('macOS でも遷移先が native でなければ false', () => {
    expect(shouldUseOpacityReveal(true, 'screenshot', 'screenshot')).toBe(false);
    expect(shouldUseOpacityReveal(true, 'screenshot', 'hidden')).toBe(false);
  });
});
