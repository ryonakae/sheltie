import { AppButton } from '@/components/Common/AppButton';
import { FLOATING_CONTROL_SOLID_BUTTON_CLASSNAME } from '@/components/Sheltie/floatingControlStyles';

interface ZoomIndicatorProps {
  zoom: number;
  onResetViewport: () => void;
}

export function ZoomIndicator({ zoom, onResetViewport }: ZoomIndicatorProps) {
  const zoomPercent = Math.round(zoom * 100);

  return (
    <AppButton
      size="sm"
      isIconOnly={false}
      tooltipMessage="Zoom to 100%"
      onPress={onResetViewport}
      aria-label="Zoom to 100%"
      className={`w-14 justify-center px-3 text-xs tabular-nums ${FLOATING_CONTROL_SOLID_BUTTON_CLASSNAME}`}
    >
      {zoomPercent}%
    </AppButton>
  );
}
