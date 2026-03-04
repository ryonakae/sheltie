import EllipsisVertical from '@gravity-ui/icons/EllipsisVertical';
import Pencil from '@gravity-ui/icons/Pencil';
import TrashBin from '@gravity-ui/icons/TrashBin';
import { Card, Dropdown, Label, Separator } from '@heroui/react';
import { motion } from 'motion/react';
import { useState } from 'react';

import { AppButton } from '@/components/Common/AppButton';
import { DeleteDialog } from '@/components/Home/DeleteDialog';
import { RenameModal } from '@/components/Home/RenameModal';
import type { Project } from '@/types';

interface ProjectCardProps {
  project: Project;
  onOpen: () => void;
}

export function ProjectCard({ project, onOpen }: ProjectCardProps) {
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  return (
    <>
      <motion.div
        whileHover={{ y: -1, scale: 1.01 }}
        whileTap={{ scale: 0.99 }}
        transition={{ duration: 0.15 }}
        onClick={onOpen}
      >
        <Card className="relative min-h-[120px] cursor-pointer">
          <Card.Header className="flex items-start justify-between pr-2">
            <Card.Title className="text-sm">{project.title}</Card.Title>

            {/* コンテキストメニューのクリックがカードのクリックに伝播しないように stopPropagation */}
            <div onClick={(e) => e.stopPropagation()}>
              <Dropdown>
                <AppButton aria-label="プロジェクトメニュー" className="size-6 shrink-0">
                  <EllipsisVertical className="size-3.5" />
                </AppButton>
                <Dropdown.Popover>
                  <Dropdown.Menu
                    onAction={(key) => {
                      if (key === 'rename') setIsRenameOpen(true);
                      if (key === 'delete') setIsDeleteOpen(true);
                    }}
                  >
                    <Dropdown.Item id="rename" textValue="名前を変更">
                      <Pencil className="size-4 shrink-0 text-muted" />
                      <Label>名前を変更</Label>
                    </Dropdown.Item>
                    <Separator />
                    <Dropdown.Item id="delete" textValue="削除" variant="danger">
                      <TrashBin className="size-4 shrink-0 text-danger" />
                      <Label>削除</Label>
                    </Dropdown.Item>
                  </Dropdown.Menu>
                </Dropdown.Popover>
              </Dropdown>
            </div>
          </Card.Header>
        </Card>
      </motion.div>

      <RenameModal project={project} isOpen={isRenameOpen} onOpenChange={setIsRenameOpen} />
      <DeleteDialog project={project} isOpen={isDeleteOpen} onOpenChange={setIsDeleteOpen} />
    </>
  );
}
