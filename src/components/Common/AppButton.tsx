import { Button, Tooltip, type ButtonProps } from '@heroui/react';
import { type ComponentProps, type ReactNode } from 'react';
import { twMerge } from 'tailwind-merge';

import { zoomPx } from '@/lib/canvas-zoom';

type AppButtonSize = 'sm' | 'md' | 'lg' | 'xs';
type TooltipPlacement = ComponentProps<typeof Tooltip.Content>['placement'];

export interface AppButtonProps extends Omit<ButtonProps, 'size'> {
  size?: AppButtonSize;
  scaleWithCanvasZoom?: boolean;
  tooltipMessage?: string;
  tooltipPlacement?: TooltipPlacement;
  tooltipDelay?: number;
  children: ReactNode;
}

export function AppButton({
  size = 'sm',
  scaleWithCanvasZoom = false,
  tooltipMessage,
  tooltipPlacement = 'top',
  tooltipDelay = 300,
  isIconOnly = true,
  variant = 'ghost',
  className,
  children,
  style,
  ...props
}: AppButtonProps) {
  const isXs = size === 'xs';
  const buttonSize: ButtonProps['size'] = isXs ? 'sm' : size;
  const zoomScaledXsStyle =
    isXs && scaleWithCanvasZoom
      ? {
          height: zoomPx(24),
          minHeight: zoomPx(24),
          width: zoomPx(24),
          minWidth: zoomPx(24),
          padding: 0,
        }
      : undefined;
  const mergedStyle = zoomScaledXsStyle ? { ...zoomScaledXsStyle, ...style } : style;
  const mergedClassName =
    typeof className === 'string'
      ? twMerge('cursor-default outline-none focus-visible:outline-none', className)
      : className;

  const tooltipContent = tooltipMessage ? (
    <Tooltip.Content
      placement={tooltipPlacement}
      offset={8}
      className="pointer-events-none bg-background-inverse py-1 text-background"
    >
      {tooltipMessage}
    </Tooltip.Content>
  ) : null;

  const button = (
    <Button
      {...props}
      size={buttonSize}
      isIconOnly={isIconOnly}
      variant={variant}
      style={mergedStyle}
      className={mergedClassName}
    >
      {children}
    </Button>
  );

  if (!tooltipMessage) return button;

  return (
    <Tooltip delay={tooltipDelay}>
      <Tooltip.Trigger>{button}</Tooltip.Trigger>
      {tooltipContent}
    </Tooltip>
  );
}
