import { AlertDialog } from '@heroui/react';
import { useState } from 'react';

import { AppButton } from '@/components/Common/AppButton';
import { useProjectStore } from '@/store/tab-store';
import type { Project } from '@/types';

interface DeleteDialogProps {
  project: Project;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}

export function DeleteDialog({ project, isOpen, onOpenChange }: DeleteDialogProps) {
  const deleteProject = useProjectStore((s) => s.deleteProject);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = () => {
    setIsDeleting(true);
    deleteProject(project.id);
    setIsDeleting(false);
    onOpenChange(false);
  };

  return (
    <AlertDialog.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <AlertDialog.Container>
        <AlertDialog.Dialog className="sm:max-w-[400px]">
          <AlertDialog.CloseTrigger />
          <AlertDialog.Header>
            <AlertDialog.Icon status="danger" />
            <AlertDialog.Heading>プロジェクトを削除しますか？</AlertDialog.Heading>
          </AlertDialog.Header>
          <AlertDialog.Body>
            <p>
              <strong>{project.title}</strong> を完全に削除します。この操作は取り消せません。
            </p>
          </AlertDialog.Body>
          <AlertDialog.Footer>
            <AppButton slot="close" isIconOnly={false} variant="tertiary">
              キャンセル
            </AppButton>
            <AppButton
              variant="danger"
              isIconOnly={false}
              isDisabled={isDeleting}
              onPress={handleDelete}
            >
              削除
            </AppButton>
          </AlertDialog.Footer>
        </AlertDialog.Dialog>
      </AlertDialog.Container>
    </AlertDialog.Backdrop>
  );
}
