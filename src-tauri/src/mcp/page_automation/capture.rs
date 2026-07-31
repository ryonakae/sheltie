//! スクリーンショット撮影（要素 / フルページのタイル合成 / スクロール復帰）。
//! actor.rs はリクエスト直列化と navigation epoch 管理に専念させ、撮影系はここに置く。

use std::{collections::HashSet, future::Future, sync::Arc};

use super::actor::{PageActor, PageAutomationState, RequestOutcome};
use super::images::{
    annotate_css_rect, crop_css_rect, decode_png, encode_capped_png, EncodedPng, FullPageComposer,
};
use super::protocol::{
    bridge_rejected, invalid_argument, page_changed_during_capture, screenshot_target_not_visible,
    screenshot_too_large, CssRect, PageAutomationActionResult, PageAutomationBridgeRequest,
    PageAutomationOperation, PageKey, PageViewportGeometry, PAGE_AUTOMATION_MAX_FULL_PAGE_TILES,
};
use crate::mcp::types::ToolError;

impl PageAutomationState {
    #[allow(clippy::too_many_arguments)]
    pub async fn capture_element_with<Dispatch, Capture, CaptureFuture>(
        &self,
        key: PageKey,
        window_label: String,
        webview_label: String,
        snapshot_id: String,
        element_ref: String,
        annotate: bool,
        mut dispatch: Dispatch,
        mut capture: Capture,
    ) -> Result<EncodedPng, ToolError>
    where
        Dispatch: FnMut(PageAutomationBridgeRequest) -> Result<(), ToolError>,
        Capture: FnMut() -> CaptureFuture,
        CaptureFuture: Future<Output = Result<Vec<u8>, ToolError>>,
    {
        let actor = self.actor(&key)?;
        let _execution = actor.execution.lock().await;
        self.ensure_actor_current(&key, &actor)?;
        let capture_epoch = actor.navigation.borrow().epoch;
        let action = self
            .execute_raw_locked_with(
                &key,
                &actor,
                &window_label,
                &webview_label,
                PageAutomationOperation::ScreenshotElement {
                    snapshot_id,
                    element_ref,
                    annotate,
                },
                &mut dispatch,
            )
            .await
            .map_err(|error| self.capture_error_for_epoch(&actor, capture_epoch, error))?;
        self.ensure_capture_epoch(&actor, capture_epoch)?;
        let (rect, viewport) = action.screenshot_element_geometry()?;
        if viewport.viewport_width <= 0.0
            || viewport.viewport_height <= 0.0
            || rect.x < 0.0
            || rect.y < 0.0
            || rect.x + rect.width > viewport.viewport_width
            || rect.y + rect.height > viewport.viewport_height
        {
            return Err(screenshot_target_not_visible());
        }
        let bytes = capture()
            .await
            .map_err(|error| self.capture_error_for_epoch(&actor, capture_epoch, error))?;
        self.ensure_capture_epoch(&actor, capture_epoch)?;
        let mut image = decode_png(&bytes)?;
        let scale = f64::from(image.width()) / viewport.viewport_width;
        if !scale.is_finite() || scale <= 0.0 {
            return Err(screenshot_too_large());
        }
        image = crop_css_rect(&image, rect, scale)?;
        if annotate {
            annotate_css_rect(
                &mut image,
                CssRect {
                    x: 0.0,
                    y: 0.0,
                    width: rect.width,
                    height: rect.height,
                },
                scale,
            )?;
        }
        encode_capped_png(&image)
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn capture_full_page_with<Dispatch, Capture, CaptureFuture>(
        &self,
        key: PageKey,
        window_label: String,
        webview_label: String,
        annotate: bool,
        mut dispatch: Dispatch,
        mut capture: Capture,
    ) -> Result<EncodedPng, ToolError>
    where
        Dispatch: FnMut(PageAutomationBridgeRequest) -> Result<(), ToolError>,
        Capture: FnMut() -> CaptureFuture,
        CaptureFuture: Future<Output = Result<Vec<u8>, ToolError>>,
    {
        let actor = self.actor(&key)?;
        let _execution = actor.execution.lock().await;
        self.ensure_actor_current(&key, &actor)?;
        let capture_epoch = actor.navigation.borrow().epoch;
        let geometry = self
            .execute_raw_locked_with(
                &key,
                &actor,
                &window_label,
                &webview_label,
                PageAutomationOperation::ScreenshotFullPage { annotate },
                &mut dispatch,
            )
            .await
            .map_err(|error| self.capture_error_for_epoch(&actor, capture_epoch, error))?
            .screenshot_full_page_geometry()?;
        self.ensure_capture_epoch(&actor, capture_epoch)?;
        let original_scroll = (geometry.scroll_x, geometry.scroll_y);
        let result = self
            .capture_full_page_tiles_locked_with(
                &key,
                &actor,
                &window_label,
                &webview_label,
                capture_epoch,
                geometry,
                &mut dispatch,
                &mut capture,
            )
            .await;
        let restore = self
            .restore_scroll_locked_with(
                &key,
                &actor,
                &window_label,
                &webview_label,
                original_scroll,
                &mut dispatch,
            )
            .await
            .map_err(|error| self.capture_error_for_epoch(&actor, capture_epoch, error));
        self.ensure_capture_epoch(&actor, capture_epoch)?;
        match result {
            Ok(image) => {
                restore?;
                Ok(image)
            }
            Err(error) => {
                let _ = restore;
                Err(error)
            }
        }
    }

    pub(super) async fn execute_raw_locked_with<Dispatch>(
        &self,
        key: &PageKey,
        actor: &Arc<PageActor>,
        window_label: &str,
        webview_label: &str,
        operation: PageAutomationOperation,
        dispatch: &mut Dispatch,
    ) -> Result<PageAutomationActionResult, ToolError>
    where
        Dispatch: FnMut(PageAutomationBridgeRequest) -> Result<(), ToolError>,
    {
        operation.validate()?;
        let expected_action_kind = operation.raw_action_kind().ok_or_else(|| {
            invalid_argument("The operation does not return a raw page automation result.")
        })?;
        self.ensure_actor_current(key, actor)?;
        let mut navigation = actor.navigation.subscribe();
        let initial_epoch = navigation.borrow().epoch;
        let request = PageAutomationBridgeRequest {
            request_id: self.allocate_request_id()?,
            document_id: key.document_id.clone(),
            page_node_id: key.page_node_id.clone(),
            navigation_epoch: initial_epoch,
            operation,
        };
        let (receiver, _pending) = self.register_and_dispatch(
            key,
            actor,
            window_label,
            webview_label,
            &request,
            dispatch,
        )?;
        let deadline = tokio::time::Instant::now() + self.timeout;
        let outcome = self
            .await_result_or_navigation(receiver, &mut navigation, initial_epoch, deadline)
            .await?;
        let RequestOutcome::Completed(result) = outcome else {
            return Err(bridge_rejected());
        };
        if navigation.borrow().epoch != initial_epoch {
            return Err(bridge_rejected());
        }
        let action = result.raw_action_result()?;
        if action.kind != expected_action_kind {
            return Err(bridge_rejected());
        }
        Ok(action)
    }

    #[allow(clippy::too_many_arguments)]
    async fn capture_full_page_tiles_locked_with<Dispatch, Capture, CaptureFuture>(
        &self,
        key: &PageKey,
        actor: &Arc<PageActor>,
        window_label: &str,
        webview_label: &str,
        capture_epoch: u64,
        geometry: PageViewportGeometry,
        dispatch: &mut Dispatch,
        capture: &mut Capture,
    ) -> Result<EncodedPng, ToolError>
    where
        Dispatch: FnMut(PageAutomationBridgeRequest) -> Result<(), ToolError>,
        Capture: FnMut() -> CaptureFuture,
        CaptureFuture: Future<Output = Result<Vec<u8>, ToolError>>,
    {
        let positions = full_page_tile_positions(geometry)?;
        let mut composer: Option<FullPageComposer> = None;
        let mut captured_offsets = HashSet::new();
        let mut capture_scale: Option<f64> = None;
        for (position_x, position_y) in positions {
            self.ensure_capture_epoch(actor, capture_epoch)?;
            let action = self
                .execute_raw_locked_with(
                    key,
                    actor,
                    window_label,
                    webview_label,
                    PageAutomationOperation::ScreenshotScroll {
                        x: position_x,
                        y: position_y,
                    },
                    dispatch,
                )
                .await
                .map_err(|error| self.capture_error_for_epoch(actor, capture_epoch, error))?;
            self.ensure_capture_epoch(actor, capture_epoch)?;
            let current = action.screenshot_full_page_geometry()?;
            let maximum_scroll_x = (geometry.document_width - geometry.viewport_width).max(0.0);
            let maximum_scroll_y = (geometry.document_height - geometry.viewport_height).max(0.0);
            let expected_scroll_x = position_x.min(maximum_scroll_x);
            let expected_scroll_y = position_y.min(maximum_scroll_y);
            if current.viewport_width != geometry.viewport_width
                || current.viewport_height != geometry.viewport_height
                || current.document_width != geometry.document_width
                || current.document_height != geometry.document_height
                || (current.scroll_x - expected_scroll_x).abs() > 0.5
                || (current.scroll_y - expected_scroll_y).abs() > 0.5
            {
                return Err(page_changed_during_capture());
            }
            let expected_scale = capture_scale.unwrap_or(1.0);
            let expected_offset = (
                css_offset_to_pixels(current.scroll_x, expected_scale)?,
                css_offset_to_pixels(current.scroll_y, expected_scale)?,
            );
            if capture_scale.is_some() && captured_offsets.contains(&expected_offset) {
                continue;
            }
            let bytes = capture()
                .await
                .map_err(|error| self.capture_error_for_epoch(actor, capture_epoch, error))?;
            self.ensure_capture_epoch(actor, capture_epoch)?;
            let image = decode_png(&bytes)?;
            let scale = f64::from(image.width()) / geometry.viewport_width;
            if !scale.is_finite() || scale <= 0.0 {
                return Err(screenshot_too_large());
            }
            if let Some(previous_scale) = capture_scale {
                if (previous_scale - scale).abs() > f64::EPSILON {
                    return Err(screenshot_too_large());
                }
            } else {
                capture_scale = Some(scale);
            }
            let offset = (
                css_offset_to_pixels(current.scroll_x, scale)?,
                css_offset_to_pixels(current.scroll_y, scale)?,
            );
            if !captured_offsets.insert(offset) {
                continue;
            }
            if composer.is_none() {
                composer = Some(FullPageComposer::new(
                    &image,
                    geometry.viewport_width,
                    geometry.viewport_height,
                    geometry.document_width,
                    geometry.document_height,
                )?);
            }
            composer
                .as_mut()
                .expect("composer is initialized from the first tile")
                .add_tile(&image, current.scroll_x, current.scroll_y)?;
        }
        let stitched = composer.ok_or_else(screenshot_too_large)?.finish();
        encode_capped_png(&stitched)
    }

    #[allow(clippy::too_many_arguments)]
    async fn restore_scroll_locked_with<Dispatch>(
        &self,
        key: &PageKey,
        actor: &Arc<PageActor>,
        window_label: &str,
        webview_label: &str,
        original_scroll: (f64, f64),
        dispatch: &mut Dispatch,
    ) -> Result<(), ToolError>
    where
        Dispatch: FnMut(PageAutomationBridgeRequest) -> Result<(), ToolError>,
    {
        let _ = self
            .execute_raw_locked_with(
                key,
                actor,
                window_label,
                webview_label,
                PageAutomationOperation::ScreenshotRestore {
                    x: original_scroll.0,
                    y: original_scroll.1,
                },
                dispatch,
            )
            .await?;
        Ok(())
    }

    fn ensure_capture_epoch(&self, actor: &PageActor, epoch: u64) -> Result<(), ToolError> {
        if actor.navigation.borrow().epoch == epoch {
            Ok(())
        } else {
            Err(page_changed_during_capture())
        }
    }

    fn capture_error_for_epoch(
        &self,
        actor: &PageActor,
        epoch: u64,
        error: ToolError,
    ) -> ToolError {
        if actor.navigation.borrow().epoch == epoch {
            error
        } else {
            page_changed_during_capture()
        }
    }
}

fn full_page_tile_positions(geometry: PageViewportGeometry) -> Result<Vec<(f64, f64)>, ToolError> {
    if geometry.viewport_width <= 1.0
        || geometry.viewport_height <= 1.0
        || geometry.document_width < geometry.viewport_width
        || geometry.document_height < geometry.viewport_height
    {
        return Err(bridge_rejected());
    }
    let horizontal = tile_axis_positions(geometry.document_width, geometry.viewport_width)?;
    let vertical = tile_axis_positions(geometry.document_height, geometry.viewport_height)?;
    let count = horizontal
        .len()
        .checked_mul(vertical.len())
        .ok_or_else(screenshot_too_large)?;
    if count > PAGE_AUTOMATION_MAX_FULL_PAGE_TILES {
        return Err(screenshot_too_large());
    }
    Ok(vertical
        .into_iter()
        .flat_map(|y| horizontal.iter().copied().map(move |x| (x, y)))
        .collect())
}

fn tile_axis_positions(document: f64, viewport: f64) -> Result<Vec<f64>, ToolError> {
    let maximum_scroll = (document - viewport).max(0.0);
    let step = viewport - 1.0;
    let mut positions = vec![0.0];
    while *positions.last().expect("positions starts with zero") < maximum_scroll {
        let previous = *positions.last().expect("positions starts with zero");
        let next = (previous + step).min(maximum_scroll);
        if next <= previous {
            return Err(bridge_rejected());
        }
        if positions.len() == PAGE_AUTOMATION_MAX_FULL_PAGE_TILES {
            return Err(screenshot_too_large());
        }
        positions.push(next);
    }
    Ok(positions)
}

fn css_offset_to_pixels(offset: f64, scale: f64) -> Result<u32, ToolError> {
    if !offset.is_finite() || offset < 0.0 || !scale.is_finite() || scale <= 0.0 {
        return Err(bridge_rejected());
    }
    let pixels = (offset * scale).round();
    if !(0.0..=f64::from(u32::MAX)).contains(&pixels) {
        return Err(screenshot_too_large());
    }
    Ok(pixels as u32)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::page_automation::actor::PageAutomationState;
    use crate::mcp::page_automation::protocol::PageAutomationBridgeResult;
    use image::{codecs::png::PngEncoder, ColorType, ImageEncoder, Rgba, RgbaImage};
    use serde_json::json;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Mutex;
    use std::time::Duration;

    fn key(page_node_id: &str) -> PageKey {
        PageKey {
            document_id: "document-1".to_string(),
            page_node_id: page_node_id.to_string(),
        }
    }

    fn raw_geometry_result(
        request: &PageAutomationBridgeRequest,
        kind: &str,
        geometry: serde_json::Value,
    ) -> PageAutomationBridgeResult {
        serde_json::from_value(json!({
            "requestId": request.request_id,
            "documentId": request.document_id,
            "pageNodeId": request.page_node_id,
            "result": {"action": {"kind": kind, "geometry": geometry}}
        }))
        .unwrap()
    }

    fn png(image: &RgbaImage) -> Vec<u8> {
        let mut bytes = Vec::new();
        PngEncoder::new(&mut bytes)
            .write_image(
                image.as_raw(),
                image.width(),
                image.height(),
                ColorType::Rgba8.into(),
            )
            .unwrap();
        bytes
    }

    fn complete_in_thread(state: Arc<PageAutomationState>, result: PageAutomationBridgeResult) {
        std::thread::spawn(move || {
            state
                .complete("document-1", "page-document-1-page-a", result)
                .unwrap();
        });
    }

    #[tokio::test]
    async fn element_capture_crops_at_the_native_scale_without_a_second_queue() {
        let state = Arc::new(PageAutomationState::with_timeout(Duration::from_secs(1)));
        let page_key = key("page-a");
        state.register_page(page_key.clone()).unwrap();
        let dispatch_state = state.clone();
        let mut source = RgbaImage::new(8, 8);
        for (x, y, pixel) in source.enumerate_pixels_mut() {
            *pixel = Rgba([x as u8, y as u8, 0, 255]);
        }
        let source = png(&source);

        let captured = state
            .capture_element_with(
                page_key,
                "document-1".into(),
                "page-document-1-page-a".into(),
                "s0-1".into(),
                "e1".into(),
                false,
                move |request| {
                    complete_in_thread(
                        dispatch_state.clone(),
                        raw_geometry_result(
                            &request,
                            "screenshot_element",
                            json!({
                                "element": {"x": 1.0, "y": 1.0, "width": 2.0, "height": 2.0},
                                "viewport": {
                                    "viewportWidth": 4.0, "viewportHeight": 4.0,
                                    "documentWidth": 4.0, "documentHeight": 4.0,
                                    "scrollX": 0.0, "scrollY": 0.0
                                }
                            }),
                        ),
                    );
                    Ok(())
                },
                move || std::future::ready(Ok(source.clone())),
            )
            .await
            .unwrap();

        assert_eq!((captured.width, captured.height), (4, 4));
        let cropped = decode_png(&captured.bytes).unwrap();
        assert_eq!(cropped.get_pixel(0, 0), &Rgba([2, 2, 0, 255]));
        assert_eq!(cropped.get_pixel(3, 3), &Rgba([5, 5, 0, 255]));
    }

    #[tokio::test]
    async fn full_page_capture_stitches_actual_offsets_and_restores_scroll() {
        let state = Arc::new(PageAutomationState::with_timeout(Duration::from_secs(1)));
        let page_key = key("page-a");
        state.register_page(page_key.clone()).unwrap();
        let dispatch_state = state.clone();
        let restore_count = Arc::new(AtomicUsize::new(0));
        let restore_count_for_dispatch = restore_count.clone();
        let tiles = Arc::new(Mutex::new(vec![
            png(&RgbaImage::from_pixel(4, 5, Rgba([255, 0, 0, 255]))),
            png(&RgbaImage::from_pixel(4, 5, Rgba([0, 255, 0, 255]))),
            png(&RgbaImage::from_pixel(4, 5, Rgba([0, 0, 255, 255]))),
        ]));
        let tiles_for_capture = tiles.clone();

        let captured = state
            .capture_full_page_with(
                page_key,
                "document-1".into(),
                "page-document-1-page-a".into(),
                false,
                move |request| {
                    let (kind, geometry) = match request.operation {
                        PageAutomationOperation::ScreenshotFullPage { .. } => (
                            "screenshot_full_page",
                            json!({
                                "viewportWidth": 4.0, "viewportHeight": 5.0,
                                "documentWidth": 4.0, "documentHeight": 12.0,
                                "scrollX": 0.0, "scrollY": 3.0
                            }),
                        ),
                        PageAutomationOperation::ScreenshotScroll { y, .. } => (
                            "screenshot_scroll",
                            json!({
                                "viewportWidth": 4.0, "viewportHeight": 5.0,
                                "documentWidth": 4.0, "documentHeight": 12.0,
                                "scrollX": 0.0, "scrollY": y
                            }),
                        ),
                        PageAutomationOperation::ScreenshotRestore { x, y } => {
                            restore_count_for_dispatch.fetch_add(1, Ordering::SeqCst);
                            assert_eq!((x, y), (0.0, 3.0));
                            (
                                "screenshot_restore",
                                json!({
                                    "viewportWidth": 4.0, "viewportHeight": 5.0,
                                    "documentWidth": 4.0, "documentHeight": 12.0,
                                    "scrollX": x, "scrollY": y
                                }),
                            )
                        }
                        _ => panic!("unexpected operation"),
                    };
                    complete_in_thread(
                        dispatch_state.clone(),
                        raw_geometry_result(&request, kind, geometry),
                    );
                    Ok(())
                },
                move || {
                    let bytes = tiles_for_capture.lock().unwrap().remove(0);
                    std::future::ready(Ok(bytes))
                },
            )
            .await
            .unwrap();

        let stitched = decode_png(&captured.bytes).unwrap();
        assert_eq!(stitched.dimensions(), (4, 12));
        assert_eq!(stitched.get_pixel(0, 3), &Rgba([255, 0, 0, 255]));
        assert_eq!(stitched.get_pixel(0, 4), &Rgba([0, 255, 0, 255]));
        assert_eq!(stitched.get_pixel(0, 7), &Rgba([0, 0, 255, 255]));
        assert_eq!(restore_count.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn full_page_capture_attempts_restore_after_navigation_or_capture_failure() {
        let state = Arc::new(PageAutomationState::with_timeout(Duration::from_secs(1)));
        let page_key = key("page-a");
        state.register_page(page_key.clone()).unwrap();
        let dispatch_state = state.clone();
        let dispatch_key = page_key.clone();
        let restores = Arc::new(AtomicUsize::new(0));
        let restores_for_dispatch = restores.clone();

        let error = state
            .capture_full_page_with(
                page_key,
                "document-1".into(),
                "page-document-1-page-a".into(),
                false,
                move |request| {
                    match request.operation {
                        PageAutomationOperation::ScreenshotFullPage { .. } => complete_in_thread(
                            dispatch_state.clone(),
                            raw_geometry_result(
                                &request,
                                "screenshot_full_page",
                                json!({
                                    "viewportWidth": 4.0, "viewportHeight": 5.0,
                                    "documentWidth": 4.0, "documentHeight": 12.0,
                                    "scrollX": 0.0, "scrollY": 2.0
                                }),
                            ),
                        ),
                        PageAutomationOperation::ScreenshotScroll { .. } => {
                            let state = dispatch_state.clone();
                            let key = dispatch_key.clone();
                            std::thread::spawn(move || {
                                state
                                    .note_spa_navigation(
                                        &key,
                                        "https://example.test/changed".into(),
                                    )
                                    .unwrap();
                            });
                        }
                        PageAutomationOperation::ScreenshotRestore { x, y } => {
                            restores_for_dispatch.fetch_add(1, Ordering::SeqCst);
                            complete_in_thread(
                                dispatch_state.clone(),
                                raw_geometry_result(
                                    &request,
                                    "screenshot_restore",
                                    json!({
                                        "viewportWidth": 4.0, "viewportHeight": 5.0,
                                        "documentWidth": 4.0, "documentHeight": 12.0,
                                        "scrollX": x, "scrollY": y
                                    }),
                                ),
                            );
                        }
                        _ => panic!("unexpected operation"),
                    }
                    Ok(())
                },
                || std::future::ready(Err(screenshot_too_large())),
            )
            .await
            .unwrap_err();

        assert_eq!(error.code, "page_changed_during_capture");
        assert_eq!(restores.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn full_page_tile_positions_cover_horizontal_and_vertical_overflow() {
        let positions = full_page_tile_positions(PageViewportGeometry {
            viewport_width: 4.0,
            viewport_height: 5.0,
            document_width: 7.0,
            document_height: 12.0,
            scroll_x: 0.0,
            scroll_y: 0.0,
        })
        .unwrap();

        assert_eq!(
            positions,
            vec![
                (0.0, 0.0),
                (3.0, 0.0),
                (0.0, 4.0),
                (3.0, 4.0),
                (0.0, 7.0),
                (3.0, 7.0)
            ]
        );
    }

    #[test]
    fn full_page_tile_limit_counts_unique_positions() {
        let error = full_page_tile_positions(PageViewportGeometry {
            viewport_width: 100.0,
            viewport_height: 10.0,
            document_width: 100.0,
            document_height: 586.0,
            scroll_x: 0.0,
            scroll_y: 0.0,
        })
        .unwrap_err();
        assert_eq!(error.code, "screenshot_too_large");
    }
}
