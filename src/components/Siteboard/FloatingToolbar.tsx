import { Globe } from '@gravity-ui/icons';
import Sticker from '@gravity-ui/icons/Sticker';
import Text from '@gravity-ui/icons/Text';
import { Surface } from '@heroui/react';

import { AppButton } from '@/components/Common/AppButton';
import {
  FLOATING_CONTROL_BUTTON_CLASSNAME,
  FLOATING_CONTROL_PANEL_CLASSNAME,
} from '@/components/Siteboard/floatingControlStyles';

interface FloatingToolbarProps {
  onAddWebNode: () => void;
  onAddStickyNote: () => void;
  onAddTextNode: () => void;
}

export function FloatingToolbar({
  onAddWebNode,
  onAddStickyNote,
  onAddTextNode,
}: FloatingToolbarProps) {
  return (
    /* ツールバー全体の配置レイヤー: pointer-events-none で Siteboard の操作を妨げない */
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-40 flex justify-center">
      <div className="pointer-events-auto">
        <Surface
          variant="default"
          className={`flex items-center rounded-full p-1 ${FLOATING_CONTROL_PANEL_CLASSNAME}`}
        >
          <AppButton
            size="lg"
            tooltipMessage="Webページを追加"
            onPress={onAddWebNode}
            aria-label="Webページを追加"
            className={FLOATING_CONTROL_BUTTON_CLASSNAME}
          >
            <Globe className="size-5" />
          </AppButton>
          <AppButton
            size="lg"
            tooltipMessage="付箋を追加"
            onPress={onAddStickyNote}
            aria-label="付箋を追加"
            className={FLOATING_CONTROL_BUTTON_CLASSNAME}
          >
            <Sticker className="size-5" />
          </AppButton>
          <AppButton
            size="lg"
            tooltipMessage="テキストを追加"
            onPress={onAddTextNode}
            aria-label="テキストを追加"
            className={FLOATING_CONTROL_BUTTON_CLASSNAME}
          >
            <Text className="size-5" />
          </AppButton>
        </Surface>
      </div>
    </div>
  );
}
