import { Placeholder } from '@tiptap/extension-placeholder';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { memo, useCallback, useEffect, useRef } from 'react';
import { twMerge } from 'tailwind-merge';

import { TEXT_NODE_COLORS, TEXT_NODE_FONT_SIZE_PRESETS, TEXT_NODE_MIN_WIDTH } from '@/constants';
import type { TextNode as TextNodeModel } from '@/types';

export interface TextNodeProps {
  node: TextNodeModel;
  isActive: boolean;
  isEditing: boolean;
  onActivate: (nodeId: string, addToSelection: boolean) => void;
  onContextMenu: (e: React.MouseEvent, nodeId: string) => void;
  onStartEditing: (nodeId: string) => void;
  onStopEditing: (nodeId: string, tiptapContent: object) => void;
  onAutoHeightChange: (nodeId: string, height: number) => void;
  onAutoWidthChange: (nodeId: string, width: number) => void;
}

export const TextNode = memo(function TextNode({
  node,
  isActive: _isActive,
  isEditing,
  onActivate,
  onContextMenu,
  onStartEditing,
  onStopEditing,
  onAutoHeightChange,
  onAutoWidthChange,
}: TextNodeProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const snapshotContentRef = useRef<object | undefined>(node.tiptapContent);

  const fontSize = TEXT_NODE_FONT_SIZE_PRESETS[node.fontSizePreset ?? 1];
  const color = TEXT_NODE_COLORS[node.textColorIndex ?? 0];
  const widthMode = node.widthMode ?? 'auto';

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        blockquote: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        codeBlock: false,
        code: false,
        horizontalRule: false,
        heading: false,
        dropcursor: false,
        gapcursor: false,
      }),
      Placeholder.configure({
        placeholder: 'Type anything',
        showOnlyWhenEditable: false,
        showOnlyCurrent: false,
      }),
    ],
    content: node.tiptapContent ?? '',
    editable: isEditing,
    editorProps: {
      attributes: {
        class: 'outline-none bg-transparent siteboard-text-node-editor',
      },
    },
  });

  // editable の動的切り替え
  useEffect(() => {
    if (!editor) return;
    if (editor.isEditable !== isEditing) {
      editor.setEditable(isEditing);
    }
    if (isEditing) {
      // 編集開始時のスナップショット（Undo/Redo 用）
      snapshotContentRef.current = editor.getJSON();
      requestAnimationFrame(() => {
        editor.commands.focus('end');
      });
    }
  }, [editor, isEditing]);

  // コンテンツ変更 / widthMode 切り替え / フォント変更時の高さ・幅自動調整
  useEffect(() => {
    if (!editor) return;
    const el = contentRef.current;
    if (!el) return;

    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const currentEl = contentRef.current;
        if (!currentEl) return;
        const height = Math.ceil(currentEl.scrollHeight);
        if (height > 0 && height !== node.height) {
          onAutoHeightChange(node.id, height);
        }
        if (widthMode === 'auto') {
          const width = Math.ceil(currentEl.offsetWidth);
          if (width > 0 && width !== node.width) {
            onAutoWidthChange(node.id, width);
          }
        }
      });
    };

    // ResizeObserver はフォント変更や widthMode 切り替えに伴う box サイズ変化を拾う。
    // 高さ追従は scrollHeight 比較が要るので editor.on('update') と併用する。
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    editor.on('update', measure);
    // 初回測定
    measure();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      editor.off('update', measure);
    };
  }, [editor, node.id, node.height, node.width, widthMode, onAutoHeightChange, onAutoWidthChange]);

  // 外部からの tiptapContent 変更（Undo/Redo）を反映
  useEffect(() => {
    if (!editor || isEditing) return;
    const currentJson = JSON.stringify(editor.getJSON());
    const storeJson = JSON.stringify(node.tiptapContent ?? '');
    if (currentJson !== storeJson) {
      editor.commands.setContent(node.tiptapContent ?? '');
    }
  }, [editor, isEditing, node.tiptapContent]);

  const handleDoubleClick = useCallback(() => {
    if (!isEditing) {
      onStartEditing(node.id);
    }
  }, [isEditing, node.id, onStartEditing]);

  const handleBlur = useCallback(() => {
    if (!editor || !isEditing) return;
    const content = editor.getJSON();
    onStopEditing(node.id, content);
  }, [editor, isEditing, node.id, onStopEditing]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape' && isEditing && editor) {
        e.stopPropagation();
        const content = editor.getJSON();
        onStopEditing(node.id, content);
      }
    },
    [editor, isEditing, node.id, onStopEditing],
  );

  const textStyle: React.CSSProperties = {
    fontSize: `${fontSize}px`,
    lineHeight: 1.5,
    fontWeight: node.fontWeight ?? 'normal',
    fontStyle: node.italic ? 'italic' : 'normal',
    textDecoration: node.strikethrough ? 'line-through' : 'none',
    color: color.value,
  };

  return (
    <div
      className={twMerge('relative size-full', isEditing ? 'nodrag cursor-text' : 'cursor-default')}
      data-node-id={node.id}
      onMouseDown={(e) => onActivate(node.id, e.shiftKey)}
      onDoubleClick={handleDoubleClick}
      onContextMenu={(e) => onContextMenu(e, node.id)}
      onKeyDown={handleKeyDown}
    >
      <div
        ref={contentRef}
        className={twMerge(widthMode === 'auto' ? 'inline-block align-top' : 'size-full')}
        style={{
          ...textStyle,
          ...(widthMode === 'auto' ? { minWidth: TEXT_NODE_MIN_WIDTH, width: 'max-content' } : {}),
        }}
      >
        <EditorContent editor={editor} onBlur={handleBlur} />
      </div>
    </div>
  );
});
