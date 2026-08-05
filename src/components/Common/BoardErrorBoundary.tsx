import { Component, type ErrorInfo, type ReactNode } from 'react';

interface BoardErrorBoundaryProps {
  children: ReactNode;
}

interface BoardErrorBoundaryState {
  hasError: boolean;
}

/**
 * ボード描画で例外が出ても document window 全体を白画面にしないための境界。
 * ツリーがアンマウントされると、Zustand 上に残っている未保存ボードへユーザーが
 * 到達できなくなるため、描画エラーは局所化する。
 */
export class BoardErrorBoundary extends Component<
  BoardErrorBoundaryProps,
  BoardErrorBoundaryState
> {
  state: BoardErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): BoardErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (!import.meta.env.DEV) return;
    console.error('[BoardErrorBoundary] board rendering failed', error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex h-full items-center justify-center p-8">
          <p className="text-center text-sm text-muted">
            The board could not be displayed because of an unexpected error.
          </p>
        </div>
      );
    }

    return this.props.children;
  }
}
