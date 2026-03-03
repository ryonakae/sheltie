import Globe from '@gravity-ui/icons/Globe';
import { FieldError, Input, TextField } from '@heroui/react';
import { useMemo, useState } from 'react';

import { AppButton } from '@/renderer/components/Common/AppButton';
import { normalizeUrl } from '@/renderer/lib/url-utils';

interface PageUrlFormProps {
  onSubmit: (url: string) => void;
}

export function PageUrlForm({ onSubmit }: PageUrlFormProps) {
  const [value, setValue] = useState('');
  const normalizedUrl = useMemo(() => normalizeUrl(value), [value]);
  const isValid = normalizedUrl !== null;
  const hasValue = value.trim().length > 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!normalizedUrl) return;
    onSubmit(normalizedUrl);
  };

  return (
    <div className="flex size-full items-center justify-center">
      <form
        onSubmit={handleSubmit}
        className="flex flex-col items-center"
        style={{
          gap: 'calc(12px / var(--canvas-zoom, 1))',
          width: 'calc(280px / var(--canvas-zoom, 1))',
        }}
      >
        <Globe
          style={{
            width: 'calc(28px / var(--canvas-zoom, 1))',
            height: 'calc(28px / var(--canvas-zoom, 1))',
            color: 'var(--color-muted)',
          }}
        />
        <TextField
          value={value}
          onChange={setValue}
          className="w-full"
          isInvalid={hasValue && !isValid}
        >
          <Input
            autoFocus
            placeholder="https://example.com"
            style={{ fontSize: 'calc(14px / var(--canvas-zoom, 1))' }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
          {hasValue && !isValid && (
            <FieldError style={{ fontSize: 'calc(12px / var(--canvas-zoom, 1))' }}>
              有効なURLを入力してください
            </FieldError>
          )}
        </TextField>
        <AppButton
          isIconOnly={false}
          type="submit"
          variant="primary"
          isDisabled={!isValid}
          style={{ fontSize: 'calc(14px / var(--canvas-zoom, 1))' }}
        >
          開く
        </AppButton>
      </form>
    </div>
  );
}
