import { forwardRef } from 'react';

interface SidebarProps {
  initialWidth: number;
}

export const Sidebar = forwardRef<HTMLElement, SidebarProps>(function Sidebar(
  { initialWidth },
  ref,
) {
  return (
    <aside
      ref={ref}
      className="flex shrink-0 flex-col items-center justify-center bg-gray-100"
      style={{ width: initialWidth }}
    >
      <span className="text-sm text-gray-500">side</span>
    </aside>
  );
});
