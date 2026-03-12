# フェーズ 2A: setUiZoom の rAF スロットリング

## 目的

`onViewportChange` が毎フレーム `setUiZoom()` を呼ぶことで React re-render が連続発生し、後続のフェーズ（Display Engine 接続）を入れたときにレンダリングと DOM 操作が衝突する。このサブフェーズでフレームレートあたり1回に制限し、パフォーマンスのベースラインを作る。

**変更ファイル**: `src/components/Siteboard/Siteboard.tsx` のみ。Display Engine のコアロジックは変更しない。

## 背景

`handleViewportChange` は pan/zoom 中に毎フレーム呼ばれる。現状の実装:

```ts
const handleViewportChange = useCallback((viewport: FlowViewport) => {
  zoomRef.current = viewport.zoom;
  // ... panXRef, panYRef, CSS 変数更新 ...
  setUiZoom(viewport.zoom);  // ← 毎フレーム React state 更新 → re-render
  // ... debounce 永続化 ...
}, [...]);
```

`setUiZoom` により `Siteboard` コンポーネントが毎フレーム再レンダリングされる。`flowNodes` useMemo の依存に `uiZoom` が間接的に含まれているため、全ノードの data オブジェクトが再生成されることがある。

## 作業内容

### 1. uiZoomRafRef の追加

`Siteboard.tsx` に新規 ref を追加:

```ts
const uiZoomRafRef = useRef<number | null>(null);
```

### 2. handleViewportChange の修正

```ts
const handleViewportChange = useCallback(
  (viewport: FlowViewport) => {
    zoomRef.current = viewport.zoom;
    panXRef.current = viewport.x;
    panYRef.current = viewport.y;

    if (containerRef.current) {
      containerRef.current.style.setProperty('--canvas-zoom', String(viewport.zoom));
    }

    // setUiZoom は rAF で1フレームに1回に制限（毎フレームの re-render を防ぐ）
    if (uiZoomRafRef.current === null) {
      uiZoomRafRef.current = requestAnimationFrame(() => {
        uiZoomRafRef.current = null;
        setUiZoom(zoomRef.current);
      });
    }

    if (viewportUpdateTimerRef.current) clearTimeout(viewportUpdateTimerRef.current);
    viewportUpdateTimerRef.current = setTimeout(() => {
      viewportUpdateTimerRef.current = null;
      updateViewport(activeId, { zoom: viewport.zoom, panX: viewport.x, panY: viewport.y });
    }, ZOOM_END_DEBOUNCE_MS);
  },
  [activeId, containerRef, panXRef, updateViewport, zoomRef],
);
```

### 3. クリーンアップ effect の追加

既存のビューポート debounce クリーンアップ effect に追記:

```ts
useEffect(() => {
  return () => {
    if (viewportUpdateTimerRef.current) clearTimeout(viewportUpdateTimerRef.current);
    if (uiZoomRafRef.current !== null) cancelAnimationFrame(uiZoomRafRef.current);
  };
}, []);
```

## 検証

- [x] pan/zoom 中の ZoomIndicator 表示がスムーズに更新される（1フレーム程度の遅延は許容）
- [x] `hideCompactControls`（ズーム 30% 閾値）の切り替えが 1-2 フレーム以内に反映される
- [x] Chrome DevTools Performance タブで pan/zoom 中の `Siteboard` re-render 回数が削減されていること
- [x] zoom リセットボタン後の ZoomIndicator 更新が正常

## 実装完了（2026-03-12）

- `src/components/Siteboard/Siteboard.tsx` に `uiZoomRafRef` を追加
- `handleViewportChange` で毎フレーム `setUiZoom()` をガード（1フレームに1回に制限）
- クリーンアップ effect に `cancelAnimationFrame()` を追加
- 型チェック、lint、format いずれもパス

## 次フェーズへの依存

フェーズ 2B 以降で `computeInteractionModes` による DOM 操作が加わるため、このフェーズで re-render を抑制しておくことで衝突リスクを下げる。
