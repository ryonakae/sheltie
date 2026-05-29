import type { StickyNoteNodeProps } from '@/components/Node/StickyNoteNode';
import type { TextNodeProps } from '@/components/Node/TextNode';
import type { WebPageNodeProps } from '@/components/Node/WebPageNode';
import type { TextNodeFontSizePreset } from '@/types';

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
  nodeProps: StickyNoteNodeProps & {
    onStyleChange: (
      nodeId: string,
      style: {
        colorIndex?: number;
        fontSizePreset?: TextNodeFontSizePreset;
      },
    ) => void;
  };
  /** 横幅リサイズ中の毎フレームコールバック（リアルタイム追従用。height は現在の本文高さを維持） */
  onResize: (
    nodeId: string,
    params: { x: number; y: number; width: number; height: number },
  ) => void;
  /** リサイズ完了時のコールバック（React Flow NodeResizeControl から呼ばれる） */
  onResizeEnd: (nodeId: string, width: number, height: number) => void;
};

/** TextFlowNode の data 型 */
export type TextFlowNodeData = {
  nodeProps: TextNodeProps & {
    onStyleChange: (
      nodeId: string,
      style: {
        fontSizePreset?: TextNodeFontSizePreset;
        fontWeight?: 'normal' | 'bold';
        italic?: boolean;
        strikethrough?: boolean;
        textColorIndex?: number;
      },
    ) => void;
    /** リサイズハンドルのダブルクリックで widthMode を 'auto' に戻すためのコールバック */
    onWidthModeChange: (nodeId: string, widthMode: 'auto' | 'fixed') => void;
  };
  /** 横幅リサイズ中の毎フレームコールバック */
  onResize: (
    nodeId: string,
    params: { x: number; y: number; width: number; height: number },
  ) => void;
  /** リサイズ完了時のコールバック */
  onResizeEnd: (nodeId: string, width: number, height: number) => void;
};
