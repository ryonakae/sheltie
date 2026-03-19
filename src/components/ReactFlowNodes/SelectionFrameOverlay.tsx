import { memo } from 'react';

import { selectionFrameOverlayStyle } from '@/components/ReactFlowNodes/selectionChromeStyles';

export const SelectionFrameOverlay = memo(function SelectionFrameOverlay() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={selectionFrameOverlayStyle}
    />
  );
});
