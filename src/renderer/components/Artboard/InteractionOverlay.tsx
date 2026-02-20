/**
 * ドラッグ/パン/リサイズ操作中に表示する透明オーバーレイ。
 * 操作モード時は mainView が最上位に移動してマウスイベントをキャプチャするため、
 * このオーバーレイはカーソル表示の制御を担う。
 */
export function InteractionOverlay({ cursor }: { cursor: string }) {
  return <div className="pointer-events-auto absolute inset-0 z-50" style={{ cursor }} />;
}
