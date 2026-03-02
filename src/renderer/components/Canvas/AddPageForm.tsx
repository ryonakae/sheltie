import { useMemo, useState } from 'react';

import Plus from '@gravity-ui/icons/Plus';
import { Button, FieldError, Input, TextField } from '@heroui/react';

interface AddPageFormProps {
  onAdd: (url: string) => void;
}

/** URL を正規化する（scheme がなければ https:// を補完） */
function normalizeUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const parsed = new URL(normalized);

    if (!/^https?:$/.test(parsed.protocol)) return null;
    if (!parsed.hostname) return null;

    // ドットを含まない単純文字列（例: "aaaaa"）は無効。ただし localhost と IP アドレスは許可
    const hostname = parsed.hostname;
    if (hostname !== 'localhost' && !hostname.includes('.')) return null;

    return parsed.toString();
  } catch {
    return null;
  }
}

export function AddPageForm({ onAdd }: AddPageFormProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [value, setValue] = useState('');
  const normalizedUrl = useMemo(() => normalizeUrl(value), [value]);
  const isValid = normalizedUrl !== null;
  const hasValue = value.trim().length > 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!normalizedUrl) return;
    onAdd(normalizedUrl);
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
        Webページを追加
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <TextField
        value={value}
        onChange={setValue}
        className="w-full"
        isInvalid={hasValue && !isValid}
      >
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
        {hasValue && !isValid && <FieldError>有効なURLを入力してください</FieldError>}
      </TextField>
      <div className="flex gap-1.5">
        <Button type="submit" size="sm" className="flex-1" isDisabled={!isValid}>
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
