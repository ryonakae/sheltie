import Display from '@gravity-ui/icons/Display';
import Moon from '@gravity-ui/icons/Moon';
import Sun from '@gravity-ui/icons/Sun';
import { Dropdown, Label, Separator } from '@heroui/react';

import { AppButton } from '@/renderer/components/Common/AppButton';
import { useThemeStore } from '@/renderer/store/theme-store';
import type { ThemeMode } from '@/shared/types';

export function ThemeToggle() {
  const { isDark, setMode } = useThemeStore();

  const CurrentIcon = isDark ? Moon : Sun;

  return (
    <Dropdown>
      <AppButton aria-label="テーマを変更">
        <CurrentIcon className="size-4" />
      </AppButton>
      <Dropdown.Popover>
        <Dropdown.Menu
          onAction={(key) => {
            if (key === 'light' || key === 'dark' || key === 'system') {
              void setMode(key as ThemeMode);
            }
          }}
        >
          <Dropdown.Item id="light" textValue="ライト">
            <Sun className="size-4 shrink-0 text-muted" />
            <Label>ライト</Label>
          </Dropdown.Item>
          <Separator />
          <Dropdown.Item id="dark" textValue="ダーク">
            <Moon className="size-4 shrink-0 text-muted" />
            <Label>ダーク</Label>
          </Dropdown.Item>
          <Separator />
          <Dropdown.Item id="system" textValue="システム">
            <Display className="size-4 shrink-0 text-muted" />
            <Label>システム</Label>
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}
