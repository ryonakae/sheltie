import Plus from '@gravity-ui/icons/Plus';
import Sticker from '@gravity-ui/icons/Sticker';
import { Button, Surface, Tooltip } from '@heroui/react';

interface FloatingToolbarProps {
  onAddPage: () => void;
  onAddStickyNote: () => void;
}

export function FloatingToolbar({ onAddPage, onAddStickyNote }: FloatingToolbarProps) {
  return (
    /* ツールバー全体の配置レイヤー: pointer-events-none で Artboard の操作を妨げない */
    <div
      className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center"
      style={{ zIndex: 40 }}
    >
      <div className="pointer-events-auto">
        <Surface
          variant="default"
          className="flex items-center rounded-xl border border-border p-1 shadow-md"
        >
          <Tooltip delay={300}>
            <Button
              isIconOnly
              variant="ghost"
              size="sm"
              onPress={onAddPage}
              aria-label="Webページを追加"
            >
              <Plus />
            </Button>
            <Tooltip.Content placement="top">
              <p>Webページを追加</p>
            </Tooltip.Content>
          </Tooltip>

          <Tooltip delay={300}>
            <Button
              isIconOnly
              variant="ghost"
              size="sm"
              onPress={onAddStickyNote}
              aria-label="付箋を追加"
            >
              <Sticker />
            </Button>
            <Tooltip.Content placement="top">
              <p>付箋を追加</p>
            </Tooltip.Content>
          </Tooltip>
        </Surface>
      </div>
    </div>
  );
}
