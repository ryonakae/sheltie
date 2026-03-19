import type { StickyNoteNodeProps } from '@/components/Node/StickyNoteNode';
import type { WebPageNodeProps } from '@/components/Node/WebPageNode';

/** WebPageFlowNode の data 型 */
export type WebPageFlowNodeData = {
  nodeProps: WebPageNodeProps;
  /** レイアウト計算に使う現在のキャンバスズーム */
  layoutZoom: number;
  /** リサイズ開始コールバック（fire-and-forget で DisplayEngine を起動） */
  onResizeStart: (nodeId: string) => void;
  /** リサイズ中の毎フレームコールバック（リアルタイム追従用） */
  onResize: (
    nodeId: string,
    params: { x: number; y: number; width: number; height: number },
  ) => void;
  /** リサイズ完了コールバック（ストア更新 + DisplayEngine 復帰） */
  onResizeEnd: (
    nodeId: string,
    params: { x: number; y: number; width: number; height: number },
  ) => void;
  /** runtime / imperative 用の現在ズーム取得 */
  getZoom: () => number;
};

/** StickyNoteFlowNode の data 型 */
export type StickyNoteFlowNodeData = {
  nodeProps: StickyNoteNodeProps;
  /** ツールバー幅計算に使う現在の表示幅（リサイズ中は中間 width に追従） */
  displayWidth: number;
  /** 横幅リサイズ中の毎フレームコールバック（リアルタイム追従用。height は現在の本文高さを維持） */
  onResize: (
    nodeId: string,
    params: { x: number; y: number; width: number; height: number },
  ) => void;
  /** リサイズ完了時のコールバック（React Flow NodeResizeControl から呼ばれる） */
  onResizeEnd: (nodeId: string, width: number, height: number) => void;
  /** 付箋の色変更コールバック（NodeToolbar の色ボタンから呼ばれる） */
  onColorCycle: (nodeId: string) => void;
  /** 現在の色インデックス（NodeToolbar のスタイリング用） */
  colorIndex: number;
};
