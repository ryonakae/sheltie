import { describe, expect, it } from 'vitest';

import {
  EDGE_SELECTION_HALO_EXTRA_WIDTH,
  EDGE_SELECTION_HALO_OPACITY,
  EDGE_TOOLBAR_OFFSET_PX,
  getArrowGeometry,
  getEdgeColor,
  getEdgeDashArray,
} from './arrowGeometry';

describe('getArrowGeometry', () => {
  it('3pxと6pxに対応する端点形状を返す', () => {
    expect(getArrowGeometry(3)).toEqual({
      sourceDotRadius: 6,
      arrowLength: 16,
      arrowHalfWidth: 10,
    });
    expect(getArrowGeometry(6)).toEqual({
      sourceDotRadius: 8,
      arrowLength: 20,
      arrowHalfWidth: 12,
    });
  });
});

describe('getEdgeDashArray', () => {
  it('実線はdash無し、破線は太さ別のパターンを返す', () => {
    expect(getEdgeDashArray(3, 'solid')).toBeUndefined();
    expect(getEdgeDashArray(3, 'dashed')).toBe('8 6');
    expect(getEdgeDashArray(6, 'dashed')).toBe('12 8');
  });
});

describe('edge selection and color constants', () => {
  it('テーマ色と選択halo・ツールバーoffsetを返す', () => {
    expect(getEdgeColor('default')).toBe('var(--color-separator-tertiary)');
    expect(getEdgeColor('danger')).toBe('var(--danger)');
    expect(EDGE_SELECTION_HALO_EXTRA_WIDTH).toBe(6);
    expect(EDGE_SELECTION_HALO_OPACITY).toBe(0.35);
    expect(EDGE_TOOLBAR_OFFSET_PX).toBe(8);
  });
});
