interface ResizeHandleProps {
  onMouseDown: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
}

export function ResizeHandle({ onMouseDown, onDoubleClick }: ResizeHandleProps) {
  return (
    <div
      className="w-1 shrink-0 cursor-col-resize bg-gray-200 hover:bg-blue-400"
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
    />
  );
}
