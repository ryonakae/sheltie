/**
 * ドラッグ/パン/リサイズ操作中に webview 上に被せる透明オーバーレイ。
 * webview は独立プロセスのためホストのマウスイベントを飲み込んでしまう。
 * 操作中のみこのオーバーレイを表示してイベントをキャプチャする。
 */
export function InteractionOverlay({ cursor }: { cursor: string }) {
  return <div className="pointer-events-auto absolute inset-0 z-50" style={{ cursor }} />;
}
