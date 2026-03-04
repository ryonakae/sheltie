import { motion } from 'motion/react';
import { useEffect, useState } from 'react';

interface ZoomIndicatorProps {
  zoom: number;
  onReset: () => void;
}

export function ZoomIndicator({ zoom, onReset }: ZoomIndicatorProps) {
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
    <motion.button
      type="button"
      className="absolute right-4 bottom-4 z-20 rounded-full border border-border bg-surface px-2 py-1 text-xs text-foreground shadow-md"
      onClick={onReset}
      whileHover={{ y: -1, scale: 1.04 }}
      whileTap={{ scale: 0.96 }}
      aria-label="ズームを100%に戻す"
    >
      <motion.span
        animate={settled ? { scale: [1.08, 1] } : undefined}
        transition={{ duration: 0.15 }}
      >
        {zoomPercent}%
      </motion.span>
    </motion.button>
  );
}
