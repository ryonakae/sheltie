import { useState } from 'react';

import Plus from '@gravity-ui/icons/Plus';
import { Button, Input, TextField } from '@heroui/react';

interface AddPageFormProps {
  onAdd: (url: string) => void;
}

/** URL を正規化する（scheme がなければ https:// を補完） */
function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function AddPageForm({ onAdd }: AddPageFormProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [value, setValue] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    onAdd(normalizeUrl(trimmed));
    setValue('');
    setIsOpen(false);
  };

  if (!isOpen) {
    return (
      <button
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted hover:bg-default-hover"
        onClick={() => setIsOpen(true)}
      >
        <Plus className="size-4 shrink-0" />
        ページを追加
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <TextField value={value} onChange={setValue} className="w-full">
        <Input
          autoFocus
          placeholder="https://example.com"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setIsOpen(false);
              setValue('');
            }
          }}
        />
      </TextField>
      <div className="flex gap-1.5">
        <Button type="submit" size="sm" className="flex-1" isDisabled={!value.trim()}>
          追加
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onPress={() => {
            setIsOpen(false);
            setValue('');
          }}
        >
          キャンセル
        </Button>
      </div>
    </form>
  );
}
