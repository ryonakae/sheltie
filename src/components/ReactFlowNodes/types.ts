import type { StickyNoteNodeProps } from '@/components/Node/StickyNoteNode';
import type { WebPageNodeProps } from '@/components/Node/WebPageNode';

/** WebPageFlowNode の data 型 */
export type WebPageFlowNodeData = { nodeProps: WebPageNodeProps };

/** StickyNoteFlowNode の data 型 */
export type StickyNoteFlowNodeData = {
  nodeProps: StickyNoteNodeProps;
  /** リサイズ中の毎フレームコールバック（リアルタイム追従用。height は全体高さ） */
  onResize: (
    nodeId: string,
    params: { x: number; y: number; width: number; height: number },
  ) => void;
  /** リサイズ完了時のコールバック（React Flow NodeResizer から呼ばれる。height はボディ高さ） */
  onResizeEnd: (nodeId: string, width: number, height: number) => void;
  /** 現在のキャンバスズームを取得（minHeight 計算と高さ変換に使用） */
  getZoom: () => number;
  /** 付箋の色変更コールバック（NodeToolbar の色ボタンから呼ばれる） */
  onColorCycle: (nodeId: string) => void;
  /** 現在の色インデックス（NodeToolbar のスタイリング用） */
  colorIndex: number;
};
