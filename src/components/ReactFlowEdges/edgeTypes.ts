import { ArrowEdge } from './ArrowEdge';

import type { EdgeTypes } from '@xyflow/react';

/**
 * React Flow の edgeTypes 定数。
 * モジュールスコープで定義しないと毎レンダーで再マウントされるため、ここで一度だけ生成する。
 * React Flow 既定の 'default' を ArrowEdge で上書きする。
 */
export const edgeTypes: EdgeTypes = {
  default: ArrowEdge,
};
