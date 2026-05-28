import { motion } from 'motion/react';
import { useEffect, useState } from 'react';

import { AppButton } from '@/components/Common/AppButton';
import { FLOATING_CONTROL_SOLID_BUTTON_CLASSNAME } from '@/components/Siteboard/floatingControlStyles';

interface ZoomIndicatorProps {
  zoom: number;
  onResetViewport: () => void;
}

export function ZoomIndicator({ zoom, onResetViewport }: ZoomIndicatorProps) {
  const zoomPercent = Math.round(zoom * 100);
  // ズーム操作が止まった時だけ pop アニメーションを再生するためのフラグ
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(true), 200);
    return () => {
      clearTimeout(timer);
      setSettled(false);
    };
  }, [zoomPercent]);

  return (
    <AppButton
      size="sm"
      isIconOnly={false}
      tooltipMessage="100%で中央表示"
      onPress={onResetViewport}
      aria-label="100%で中央表示"
      className={`w-14 justify-center px-3 tabular-nums ${FLOATING_CONTROL_SOLID_BUTTON_CLASSNAME}`}
    >
      <motion.span
        animate={settled ? { scale: [1.08, 1] } : undefined}
        transition={{ duration: 0.15 }}
      >
        {zoomPercent}%
      </motion.span>
    </AppButton>
  );
}
