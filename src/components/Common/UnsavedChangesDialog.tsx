import { AlertDialog } from '@heroui/react';
import { useEffect, useRef, useState } from 'react';

import { AppButton } from '@/components/Common/AppButton';
import {
  enterUnsavedChangesDialogDisplay,
  exitUnsavedChangesDialogDisplay,
} from '@/lib/unsaved-changes-dialog-display';

export type UnsavedChangesDecision = 'save' | 'discard' | 'cancel';
export type UnsavedChangesReason = 'tab-close' | 'app-close';

interface UnsavedChangesDialogOptions {
  projectTitle: string;
  reason: UnsavedChangesReason;
}

interface PendingUnsavedChangesDialogRequest extends UnsavedChangesDialogOptions {
  resolve: (decision: UnsavedChangesDecision) => void;
}

let showUnsavedChangesDialog: ((request: PendingUnsavedChangesDialogRequest) => void) | null = null;

export async function promptUnsavedChangesDialog(
  options: UnsavedChangesDialogOptions,
): Promise<UnsavedChangesDecision> {
  if (!showUnsavedChangesDialog) {
    return 'cancel';
  }

  await enterUnsavedChangesDialogDisplay();

  const presentDialog = showUnsavedChangesDialog;
  if (!presentDialog) {
    exitUnsavedChangesDialogDisplay();
    return 'cancel';
  }

  return new Promise((resolve) => {
    presentDialog({
      ...options,
      resolve: (decision) => {
        resolve(decision);
        exitUnsavedChangesDialogDisplay();
      },
    });
  });
}

export function UnsavedChangesDialog() {
  const [request, setRequest] = useState<PendingUnsavedChangesDialogRequest | null>(null);
  const requestRef = useRef<PendingUnsavedChangesDialogRequest | null>(null);

  useEffect(() => {
    showUnsavedChangesDialog = (nextRequest) => {
      requestRef.current = nextRequest;
      setRequest(nextRequest);
    };

    return () => {
      showUnsavedChangesDialog = null;
      requestRef.current?.resolve('cancel');
      requestRef.current = null;
    };
  }, []);

  const resolveRequest = (decision: UnsavedChangesDecision) => {
    const currentRequest = requestRef.current;
    if (!currentRequest) return;

    requestRef.current = null;
    currentRequest.resolve(decision);
    setRequest(null);
  };

  const isAppClose = request?.reason === 'app-close';
  const discardLabel = isAppClose ? '保存せず終了' : '保存せず閉じる';
  const bodyText = isAppClose
    ? `「${request?.projectTitle ?? ''}」には未保存の変更があります。保存してからアプリを終了しますか？`
    : `「${request?.projectTitle ?? ''}」には未保存の変更があります。保存してからタブを閉じますか？`;

  return (
    <AlertDialog.Backdrop
      isOpen={request !== null}
      isDismissable
      isKeyboardDismissDisabled={false}
      onOpenChange={(open) => {
        if (!open) resolveRequest('cancel');
      }}
    >
      <AlertDialog.Container>
        <AlertDialog.Dialog className="sm:max-w-[440px]">
          <AlertDialog.CloseTrigger />
          <AlertDialog.Header>
            <AlertDialog.Icon status="warning" />
            <AlertDialog.Heading>未保存の変更があります</AlertDialog.Heading>
          </AlertDialog.Header>
          <AlertDialog.Body>
            <p>{bodyText}</p>
          </AlertDialog.Body>
          <AlertDialog.Footer>
            <AppButton
              isIconOnly={false}
              variant="tertiary"
              onPress={() => resolveRequest('cancel')}
            >
              キャンセル
            </AppButton>
            <AppButton
              isIconOnly={false}
              variant="danger"
              onPress={() => resolveRequest('discard')}
            >
              {discardLabel}
            </AppButton>
            <AppButton isIconOnly={false} variant="primary" onPress={() => resolveRequest('save')}>
              保存
            </AppButton>
          </AlertDialog.Footer>
        </AlertDialog.Dialog>
      </AlertDialog.Container>
    </AlertDialog.Backdrop>
  );
}
