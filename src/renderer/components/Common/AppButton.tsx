import { Button, Tooltip, type ButtonProps } from '@heroui/react';
import { type ComponentProps, type ReactNode } from 'react';
import { twMerge } from 'tailwind-merge';

import { DEFAULT_TOOLTIP_DELAY, XS_ICON_BUTTON_CLASS } from '@/renderer/constants';

type AppButtonSize = 'sm' | 'md' | 'lg' | 'xs';
type TooltipPlacement = ComponentProps<typeof Tooltip.Content>['placement'];

export interface AppButtonProps extends Omit<ButtonProps, 'size'> {
  size?: AppButtonSize;
  tooltipMessage?: string;
  tooltipPlacement?: TooltipPlacement;
  tooltipDelay?: number;
  children: ReactNode;
}

export function AppButton({
  size = 'sm',
  tooltipMessage,
  tooltipPlacement = 'top',
  tooltipDelay = DEFAULT_TOOLTIP_DELAY,
  isIconOnly = true,
  variant = 'ghost',
  className,
  children,
  ...props
}: AppButtonProps) {
  const isXs = size === 'xs';
  const buttonSize: ButtonProps['size'] = isXs ? 'sm' : size;
  const mergedClassName =
    typeof className === 'string'
      ? twMerge(isXs ? XS_ICON_BUTTON_CLASS : '', className)
      : className;

  const tooltipContent = tooltipMessage ? (
    <Tooltip.Content placement={tooltipPlacement}>{tooltipMessage}</Tooltip.Content>
  ) : null;

  const button = (
    <Button
      {...props}
      size={buttonSize}
      isIconOnly={isIconOnly}
      variant={variant}
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
