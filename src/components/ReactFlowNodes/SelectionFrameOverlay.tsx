import { memo } from 'react';

import { selectionFrameOverlayStyle } from '@/components/ReactFlowNodes/selectionChromeStyles';

export const SelectionFrameOverlay = memo(function SelectionFrameOverlay() {
  return (
    <div
      aria-hidden
      data-board-capture-exclude="selection-frame"
      className="pointer-events-none absolute inset-0"
      style={selectionFrameOverlayStyle}
    />
  );
});
