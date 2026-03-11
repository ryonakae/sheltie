import type { StickyNoteNodeProps } from '@/components/Node/StickyNoteNode';
import type { WebPageNodeProps } from '@/components/Node/WebPageNode';

/** WebPageFlowNode の data 型 */
export type WebPageFlowNodeData = { nodeProps: WebPageNodeProps };

/** StickyNoteFlowNode の data 型 */
export type StickyNoteFlowNodeData = { nodeProps: StickyNoteNodeProps };
