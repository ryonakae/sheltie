import Globe from '@gravity-ui/icons/Globe';
import { FieldError, Input, TextField } from '@heroui/react';
import { useMemo, useState } from 'react';

import { AppButton } from '@/components/Common/AppButton';
import { zoomPx } from '@/lib/canvas-zoom';
import { normalizeUrl } from '@/lib/url-utils';

interface WebPageNodeUrlFormProps {
  onSubmit: (url: string) => void;
}

export function WebPageNodeUrlForm({ onSubmit }: WebPageNodeUrlFormProps) {
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
    <div
      className="flex size-full items-center justify-center"
      style={{ paddingLeft: zoomPx(24), paddingRight: zoomPx(24) }}
    >
      <form
        onSubmit={handleSubmit}
        className="flex flex-col items-center"
        style={{
          gap: zoomPx(12),
          width: '100%',
          maxWidth: zoomPx(280),
        }}
      >
        <Globe
          style={{
            width: zoomPx(28),
            height: zoomPx(28),
            color: 'var(--color-muted)',
          }}
        />
        <TextField
          value={value}
          onChange={setValue}
          aria-label="URL to Open"
          className="w-full"
          isInvalid={hasValue && !isValid}
        >
          <Input
            autoFocus
            placeholder="https://example.com"
            style={{ fontSize: zoomPx(14) }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
          {hasValue && !isValid && (
            <FieldError style={{ fontSize: zoomPx(12) }}>Please enter a valid URL</FieldError>
          )}
        </TextField>
        <AppButton
          isIconOnly={false}
          type="submit"
          variant="primary"
          isDisabled={!isValid}
          style={{ fontSize: zoomPx(14) }}
        >
          Open
        </AppButton>
      </form>
    </div>
  );
}
