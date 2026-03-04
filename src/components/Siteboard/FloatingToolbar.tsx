import Plus from '@gravity-ui/icons/Plus';
import Sticker from '@gravity-ui/icons/Sticker';
import { Surface } from '@heroui/react';

import { AppButton } from '@/components/Common/AppButton';

interface FloatingToolbarProps {
  onAddPage: () => void;
  onAddStickyNote: () => void;
}

export function FloatingToolbar({ onAddPage, onAddStickyNote }: FloatingToolbarProps) {
  return (
    /* ツールバー全体の配置レイヤー: pointer-events-none で Siteboard の操作を妨げない */
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-40 flex justify-center">
      <div className="pointer-events-auto">
        <Surface
          variant="default"
          className="flex items-center rounded-xl border border-border p-1 shadow-md"
        >
          <AppButton
            size="lg"
            tooltipMessage="Webページを追加"
            onPress={onAddPage}
            aria-label="Webページを追加"
          >
            <Plus className="size-5" />
          </AppButton>
          <AppButton
            size="lg"
            tooltipMessage="付箋を追加"
            onPress={onAddStickyNote}
            aria-label="付箋を追加"
          >
            <Sticker className="size-5" />
          </AppButton>
        </Surface>
      </div>
    </div>
  );
}
