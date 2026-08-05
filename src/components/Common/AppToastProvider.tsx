import { Toast } from '@heroui/react';

export function AppToastProvider() {
  return <Toast.Provider placement="top end" data-app-toast-region />;
}
