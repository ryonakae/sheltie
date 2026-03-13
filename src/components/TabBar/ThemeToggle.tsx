import Display from '@gravity-ui/icons/Display';
import Moon from '@gravity-ui/icons/Moon';
import Sun from '@gravity-ui/icons/Sun';
import { Dropdown, Label, Separator, toast, type Selection } from '@heroui/react';

import { AppButton } from '@/components/Common/AppButton';
import { useThemeStore } from '@/store/theme-store';
import type { ThemeMode } from '@/types';

function getThemeMode(selection: Selection): ThemeMode | null {
  if (selection === 'all') return null;

  const selectedKey = selection.values().next().value;

  if (selectedKey === 'light' || selectedKey === 'dark' || selectedKey === 'system') {
    return selectedKey;
  }

  return null;
}

export function ThemeToggle() {
  const mode = useThemeStore((state) => state.mode);
  const isDark = useThemeStore((state) => state.isDark);
  const setMode = useThemeStore((state) => state.setMode);

  const CurrentIcon = isDark ? Moon : Sun;

  return (
    <Dropdown>
      <AppButton aria-label="テーマを変更">
        <CurrentIcon className="size-4" />
      </AppButton>
      <Dropdown.Popover>
        <Dropdown.Menu
          aria-label="テーマ"
          disallowEmptySelection
          selectedKeys={[mode]}
          selectionMode="single"
          onSelectionChange={(selection) => {
            const nextMode = getThemeMode(selection);

            if (nextMode) {
              void setMode(nextMode).catch((error: unknown) => {
                console.error('[ThemeToggle] テーマ変更に失敗:', error);
                toast.danger('テーマの変更に失敗しました');
              });
            }
          }}
        >
          <Dropdown.Item id="light" textValue="ライト">
            <Dropdown.ItemIndicator />
            <Sun className="size-4 shrink-0 text-muted" />
            <Label>ライト</Label>
          </Dropdown.Item>
          <Separator />
          <Dropdown.Item id="dark" textValue="ダーク">
            <Dropdown.ItemIndicator />
            <Moon className="size-4 shrink-0 text-muted" />
            <Label>ダーク</Label>
          </Dropdown.Item>
          <Separator />
          <Dropdown.Item id="system" textValue="システム">
            <Dropdown.ItemIndicator />
            <Display className="size-4 shrink-0 text-muted" />
            <Label>システム</Label>
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}
