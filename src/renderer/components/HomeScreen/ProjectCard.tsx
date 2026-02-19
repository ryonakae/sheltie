import { useState } from 'react';

import EllipsisVertical from '@gravity-ui/icons/EllipsisVertical';
import Pencil from '@gravity-ui/icons/Pencil';
import TrashBin from '@gravity-ui/icons/TrashBin';
import { Button, Card, Dropdown, Label, Separator } from '@heroui/react';

import type { Project } from '../../types/tab';

import { DeleteDialog } from './DeleteDialog';
import { RenameModal } from './RenameModal';

interface ProjectCardProps {
  project: Project;
  onOpen: () => void;
}

export function ProjectCard({ project, onOpen }: ProjectCardProps) {
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  return (
    <>
      <Card
        className="relative min-h-[120px] cursor-pointer transition-shadow hover:shadow-md"
        onClick={onOpen}
      >
        <Card.Header className="flex items-start justify-between pr-2">
          <Card.Title className="text-sm">{project.title}</Card.Title>

          {/* コンテキストメニューのクリックがカードのクリックに伝播しないように stopPropagation */}
          <div onClick={(e) => e.stopPropagation()}>
            <Dropdown>
              <Button
                isIconOnly
                variant="ghost"
                size="sm"
                aria-label="プロジェクトメニュー"
                className="size-6 shrink-0"
              >
                <EllipsisVertical className="size-3.5" />
              </Button>
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

      <RenameModal project={project} isOpen={isRenameOpen} onOpenChange={setIsRenameOpen} />
      <DeleteDialog project={project} isOpen={isDeleteOpen} onOpenChange={setIsDeleteOpen} />
    </>
  );
}
