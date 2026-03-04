import { Input, Label, Modal, TextField } from '@heroui/react';
import { useState } from 'react';

import { AppButton } from '@/components/Common/AppButton';
import { useProjectStore } from '@/store/tab-store';
import type { Project } from '@/types';

interface RenameModalProps {
  project: Project;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}

export function RenameModal({ project, isOpen, onOpenChange }: RenameModalProps) {
  const renameProject = useProjectStore((s) => s.renameProject);
  const [name, setName] = useState(project.title);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    renameProject(project.id, trimmed);
    onOpenChange(false);
  };

  // モーダルが開くたびに現在のプロジェクト名でリセット
  const handleOpenChange = (open: boolean) => {
    if (open) setName(project.title);
    onOpenChange(open);
  };

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={handleOpenChange}>
      <Modal.Container>
        <Modal.Dialog className="sm:max-w-[360px]">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>プロジェクト名を変更</Modal.Heading>
          </Modal.Header>
          <form onSubmit={handleSubmit}>
            <Modal.Body>
              <TextField className="w-full" value={name} onChange={setName}>
                <Label>プロジェクト名</Label>
                <Input placeholder="プロジェクト名を入力" />
              </TextField>
            </Modal.Body>
            <Modal.Footer>
              <AppButton slot="close" isIconOnly={false} variant="tertiary">
                キャンセル
              </AppButton>
              <AppButton
                type="submit"
                isIconOnly={false}
                variant="primary"
                isDisabled={!name.trim()}
              >
                変更
              </AppButton>
            </Modal.Footer>
          </form>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
