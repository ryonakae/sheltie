import { getBezierPath, Position } from '@xyflow/react';
import { describe, expect, it } from 'vitest';

import {
  EDGE_SELECTION_ENDPOINT_COLOR,
  EDGE_SELECTION_ENDPOINT_RADIUS_PX,
  EDGE_SELECTION_ENDPOINT_STROKE_WIDTH_PX,
  EDGE_TOOLBAR_OFFSET_PX,
  getArrowGeometry,
  getBezierPathBounds,
  getEdgeColor,
  getEdgeDashArray,
  getEdgeToolbarAnchor,
  getSelectionEndpointGeometry,
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

describe('getBezierPathBounds', () => {
  it('三次ベジェの端点間より内側にある実際の上端を求める', () => {
    expect(getBezierPathBounds('M0,100 C0,0 100,0 100,100')).toEqual({
      minX: 0,
      maxX: 100,
      minY: 25,
      maxY: 100,
    });
  });

  it('左右方向へ張り出す曲線の実境界を求める', () => {
    expect(getBezierPathBounds('M100,100 C0,100 0,300 100,300')).toEqual({
      minX: 25,
      maxX: 100,
      minY: 100,
      maxY: 300,
    });
  });

  it('React Flowが生成した上下ハンドルのpathを解釈する', () => {
    const [path] = getBezierPath({
      sourceX: 100,
      sourceY: 100,
      sourcePosition: Position.Top,
      targetX: 400,
      targetY: 300,
      targetPosition: Position.Bottom,
    });

    const bounds = getBezierPathBounds(path);
    expect(bounds?.minX).toBe(100);
    expect(bounds?.maxX).toBe(400);
    expect(bounds?.minY).toBeLessThan(100);
    expect(bounds?.maxY).toBeGreaterThan(300);
  });

  it('解釈できないpathはnullを返す', () => {
    expect(getBezierPathBounds('M0,0 L100,100')).toBeNull();
  });
});

describe('getEdgeToolbarAnchor', () => {
  it('実境界の左右中央と上端を返す', () => {
    expect(getEdgeToolbarAnchor('M0,100 C0,0 100,0 100,100', { x: -1, y: -1 })).toEqual({
      x: 50,
      y: 25,
    });
  });

  it('pathを解釈できなければfallbackを返す', () => {
    expect(getEdgeToolbarAnchor('invalid', { x: 10, y: 20 })).toEqual({ x: 10, y: 20 });
  });
});

describe('getSelectionEndpointGeometry', () => {
  it('ズームを相殺して画面上の半径7px・線幅2pxを維持する', () => {
    expect(getSelectionEndpointGeometry(1)).toEqual({ radius: 7, strokeWidth: 2 });
    expect(getSelectionEndpointGeometry(0.5)).toEqual({ radius: 14, strokeWidth: 4 });
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
  it('テーマ色と選択端点リング・ツールバーoffsetを返す', () => {
    expect(getEdgeColor('default')).toBe('var(--color-separator-tertiary)');
    expect(getEdgeColor('danger')).toBe('var(--danger)');
    expect(EDGE_SELECTION_ENDPOINT_COLOR).toBe('#3b82f6');
    expect(EDGE_SELECTION_ENDPOINT_RADIUS_PX).toBe(7);
    expect(EDGE_SELECTION_ENDPOINT_STROKE_WIDTH_PX).toBe(2);
    expect(EDGE_TOOLBAR_OFFSET_PX).toBe(8);
  });
});
