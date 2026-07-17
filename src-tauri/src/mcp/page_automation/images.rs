use image::codecs::png::PngEncoder;
use image::imageops::{self, FilterType};
use image::{ColorType, ImageEncoder, ImageFormat, ImageReader, Rgba, RgbaImage};
use std::io::Cursor;

use super::protocol::{
    invalid_argument, screenshot_failed, screenshot_target_not_visible, screenshot_too_large,
    CssRect, PAGE_AUTOMATION_MAX_SCREENSHOT_EDGE_PX, PAGE_AUTOMATION_MAX_SCREENSHOT_PIXELS,
    PAGE_AUTOMATION_MAX_SCREENSHOT_PNG_BYTES,
};
use crate::mcp::types::ToolError;

const ANNOTATION_BORDER_PX: u32 = 2;
const ENCODE_REDUCTION_FACTOR: f64 = 0.85;

#[derive(Debug)]
pub struct EncodedPng {
    pub bytes: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub scale_applied: f64,
}

pub fn decode_png(bytes: &[u8]) -> Result<RgbaImage, ToolError> {
    let reader = ImageReader::with_format(Cursor::new(bytes), ImageFormat::Png);
    let (width, height) = reader.into_dimensions().map_err(|_| screenshot_failed())?;
    validate_pixel_dimensions(width, height)?;
    image::load_from_memory_with_format(bytes, ImageFormat::Png)
        .map(|image| image.to_rgba8())
        .map_err(|_| screenshot_failed())
}

pub struct FullPageComposer {
    canvas: RgbaImage,
    native_tile_dimensions: (u32, u32),
    viewport_width: f64,
    viewport_height: f64,
    css_scale_x: f64,
    css_scale_y: f64,
}

impl FullPageComposer {
    pub fn new(
        first_tile: &RgbaImage,
        viewport_width: f64,
        viewport_height: f64,
        document_width: f64,
        document_height: f64,
    ) -> Result<Self, ToolError> {
        if viewport_width <= 0.0
            || viewport_height <= 0.0
            || document_width < viewport_width
            || document_height < viewport_height
        {
            return Err(screenshot_too_large());
        }
        validate_pixel_dimensions(first_tile.width(), first_tile.height())?;
        let native_scale_x = f64::from(first_tile.width()) / viewport_width;
        let native_scale_y = f64::from(first_tile.height()) / viewport_height;
        if !native_scale_x.is_finite()
            || !native_scale_y.is_finite()
            || native_scale_x <= 0.0
            || native_scale_y <= 0.0
        {
            return Err(screenshot_too_large());
        }
        let native_document_width = checked_pixel_dimension(document_width * native_scale_x)?;
        let native_document_height = checked_pixel_dimension(document_height * native_scale_y)?;
        let (width, height) = dimensions_within_limits(
            native_document_width,
            native_document_height,
            PAGE_AUTOMATION_MAX_SCREENSHOT_EDGE_PX,
            PAGE_AUTOMATION_MAX_SCREENSHOT_PIXELS,
        )?;
        Ok(Self {
            canvas: RgbaImage::new(width, height),
            native_tile_dimensions: first_tile.dimensions(),
            viewport_width,
            viewport_height,
            css_scale_x: f64::from(width) / document_width,
            css_scale_y: f64::from(height) / document_height,
        })
    }

    pub fn add_tile(&mut self, tile: &RgbaImage, css_x: f64, css_y: f64) -> Result<(), ToolError> {
        if tile.dimensions() != self.native_tile_dimensions
            || !css_x.is_finite()
            || !css_y.is_finite()
            || css_x < 0.0
            || css_y < 0.0
        {
            return Err(screenshot_too_large());
        }
        let target_width = checked_pixel_dimension(self.viewport_width * self.css_scale_x)?;
        let target_height = checked_pixel_dimension(self.viewport_height * self.css_scale_y)?;
        let resized = if tile.dimensions() == (target_width, target_height) {
            tile.clone()
        } else {
            imageops::resize(tile, target_width, target_height, FilterType::Lanczos3)
        };
        let offset_x = scaled_coordinate(css_x, self.css_scale_x)?;
        let offset_y = scaled_coordinate(css_y, self.css_scale_y)?;
        for y in 0..resized
            .height()
            .min(self.canvas.height().saturating_sub(offset_y))
        {
            for x in 0..resized
                .width()
                .min(self.canvas.width().saturating_sub(offset_x))
            {
                self.canvas
                    .put_pixel(offset_x + x, offset_y + y, *resized.get_pixel(x, y));
            }
        }
        Ok(())
    }

    pub fn finish(self) -> RgbaImage {
        self.canvas
    }
}

fn validate_pixel_dimensions(width: u32, height: u32) -> Result<(), ToolError> {
    if width == 0
        || height == 0
        || width > PAGE_AUTOMATION_MAX_SCREENSHOT_EDGE_PX
        || height > PAGE_AUTOMATION_MAX_SCREENSHOT_EDGE_PX
        || u64::from(width)
            .checked_mul(u64::from(height))
            .is_none_or(|pixels| pixels > PAGE_AUTOMATION_MAX_SCREENSHOT_PIXELS)
    {
        return Err(screenshot_too_large());
    }
    Ok(())
}

fn checked_pixel_dimension(value: f64) -> Result<u32, ToolError> {
    if !value.is_finite() || value <= 0.0 || value > f64::from(u32::MAX) {
        return Err(screenshot_too_large());
    }
    Ok((value.round() as u32).max(1))
}

fn dimensions_within_limits(
    width: u32,
    height: u32,
    max_edge_px: u32,
    max_pixels: u64,
) -> Result<(u32, u32), ToolError> {
    if width == 0 || height == 0 || max_edge_px == 0 || max_pixels == 0 {
        return Err(screenshot_too_large());
    }
    let edge_scale = f64::from(max_edge_px) / f64::from(width.max(height));
    let pixel_scale = (max_pixels as f64 / (u64::from(width) * u64::from(height)) as f64).sqrt();
    let scale = edge_scale.min(pixel_scale).min(1.0);
    if scale >= 1.0 {
        Ok((width, height))
    } else {
        Ok(scaled_dimensions(width, height, scale))
    }
}

pub fn crop_css_rect(image: &RgbaImage, rect: CssRect, scale: f64) -> Result<RgbaImage, ToolError> {
    let (x, y, width, height) = css_rect_to_pixels(image, rect, scale)?;
    Ok(imageops::crop_imm(image, x, y, width, height).to_image())
}

#[cfg_attr(not(test), allow(dead_code))]
pub fn stitch_vertical_tiles(tiles: &[RgbaImage], overlap_px: u32) -> Result<RgbaImage, ToolError> {
    let Some(first) = tiles.first() else {
        return Err(invalid_argument(
            "At least one screenshot tile is required.",
        ));
    };
    if first.height() <= overlap_px {
        return Err(invalid_argument(
            "Screenshot tiles must have a valid overlap.",
        ));
    }

    let step = first.height() - overlap_px;
    let positioned = tiles
        .iter()
        .enumerate()
        .map(|(index, tile)| {
            let offset = u32::try_from(index)
                .ok()
                .and_then(|index| index.checked_mul(step))
                .ok_or_else(screenshot_too_large)?;
            Ok((tile.clone(), offset))
        })
        .collect::<Result<Vec<_>, ToolError>>()?;
    stitch_vertical_tiles_at_offsets(&positioned)
}

/// Stitches visible viewport captures at their actual top pixel offsets.
///
/// The final scroll position is commonly clamped by the document height, so
/// its overlap differs from the regular one-CSS-pixel overlap. Offsets retain
/// that geometry instead of assuming every tile has the same stride.
pub fn stitch_vertical_tiles_at_offsets(
    tiles: &[(RgbaImage, u32)],
) -> Result<RgbaImage, ToolError> {
    let positioned = tiles
        .iter()
        .map(|(tile, y)| (tile.clone(), 0, *y))
        .collect::<Vec<_>>();
    stitch_tiles_at_offsets(&positioned)
}

/// Stitches viewport captures at their actual document pixel offsets.
///
/// Tiles may overlap because browsers clamp the final horizontal and vertical
/// scroll positions. Later row-major tiles replace only those overlap pixels.
pub fn stitch_tiles_at_offsets(tiles: &[(RgbaImage, u32, u32)]) -> Result<RgbaImage, ToolError> {
    let Some((first, first_x, first_y)) = tiles.first() else {
        return Err(invalid_argument(
            "At least one screenshot tile is required.",
        ));
    };
    if *first_x != 0 || *first_y != 0 || first.width() == 0 || first.height() == 0 {
        return Err(invalid_argument(
            "Screenshot tiles must start at offset zero and have nonzero dimensions.",
        ));
    }

    let tile_width = first.width();
    let tile_height = first.height();
    let mut output_width = 0_u64;
    let mut output_height = 0_u64;
    let mut offsets = std::collections::HashSet::new();
    for (tile, x, y) in tiles {
        if tile.width() != tile_width || tile.height() != tile_height || !offsets.insert((*x, *y)) {
            return Err(invalid_argument(
                "Screenshot tiles must have matching dimensions and unique offsets.",
            ));
        }
        output_width = output_width.max(
            u64::from(*x)
                .checked_add(u64::from(tile.width()))
                .ok_or_else(screenshot_too_large)?,
        );
        output_height = output_height.max(
            u64::from(*y)
                .checked_add(u64::from(tile.height()))
                .ok_or_else(screenshot_too_large)?,
        );
    }
    let output_width = u32::try_from(output_width).map_err(|_| screenshot_too_large())?;
    let output_height = u32::try_from(output_height).map_err(|_| screenshot_too_large())?;

    let mut stitched = RgbaImage::new(output_width, output_height);
    for (tile, offset_x, offset_y) in tiles {
        for y in 0..tile.height() {
            for x in 0..tile.width() {
                stitched.put_pixel(offset_x + x, offset_y + y, *tile.get_pixel(x, y));
            }
        }
    }

    Ok(stitched)
}

pub fn annotate_css_rect(
    image: &mut RgbaImage,
    rect: CssRect,
    scale: f64,
) -> Result<(), ToolError> {
    let (x, y, width, height) = css_rect_to_pixels(image, rect, scale)?;
    let right = x + width;
    let bottom = y + height;

    for pixel_y in y..bottom {
        for pixel_x in x..right {
            let is_border = pixel_x - x < ANNOTATION_BORDER_PX
                || right - pixel_x <= ANNOTATION_BORDER_PX
                || pixel_y - y < ANNOTATION_BORDER_PX
                || bottom - pixel_y <= ANNOTATION_BORDER_PX;
            let color = if is_border {
                Rgba([99, 102, 241, 255])
            } else {
                Rgba([99, 102, 241, 36])
            };
            let destination = image.get_pixel_mut(pixel_x, pixel_y);
            *destination = alpha_blend(*destination, color);
        }
    }

    Ok(())
}

pub fn encode_capped_png(image: &RgbaImage) -> Result<EncodedPng, ToolError> {
    encode_capped_png_with_limits(
        image,
        PAGE_AUTOMATION_MAX_SCREENSHOT_EDGE_PX,
        PAGE_AUTOMATION_MAX_SCREENSHOT_PIXELS,
        PAGE_AUTOMATION_MAX_SCREENSHOT_PNG_BYTES,
    )
}

fn encode_capped_png_with_limits(
    image: &RgbaImage,
    max_edge_px: u32,
    max_pixels: u64,
    max_png_bytes: usize,
) -> Result<EncodedPng, ToolError> {
    if image.width() == 0 || image.height() == 0 || max_edge_px == 0 || max_pixels == 0 {
        return Err(screenshot_too_large());
    }

    let original_width = image.width();
    let original_height = image.height();
    let mut scaled = resize_to_limits(image, max_edge_px, max_pixels)?;

    loop {
        let bytes = encode_png(&scaled)?;
        if bytes.len() <= max_png_bytes {
            return Ok(EncodedPng {
                bytes,
                width: scaled.width(),
                height: scaled.height(),
                scale_applied: scale_applied(original_width, original_height, &scaled),
            });
        }
        if scaled.width() == 1 && scaled.height() == 1 {
            return Err(screenshot_too_large());
        }
        scaled = reduce_image(&scaled);
    }
}

fn css_rect_to_pixels(
    image: &RgbaImage,
    rect: CssRect,
    scale: f64,
) -> Result<(u32, u32, u32, u32), ToolError> {
    if !scale.is_finite() || scale <= 0.0 || rect.width <= 0.0 || rect.height <= 0.0 {
        return Err(screenshot_target_not_visible());
    }

    let x = scaled_coordinate(rect.x, scale)?;
    let y = scaled_coordinate(rect.y, scale)?;
    let width = scaled_dimension(rect.width, scale)?;
    let height = scaled_dimension(rect.height, scale)?;
    let right = x
        .checked_add(width)
        .ok_or_else(screenshot_target_not_visible)?;
    let bottom = y
        .checked_add(height)
        .ok_or_else(screenshot_target_not_visible)?;

    if right > image.width() || bottom > image.height() {
        return Err(screenshot_target_not_visible());
    }
    Ok((x, y, width, height))
}

fn scaled_coordinate(value: f64, scale: f64) -> Result<u32, ToolError> {
    if !value.is_finite() || value < 0.0 {
        return Err(screenshot_target_not_visible());
    }
    let value = (value * scale).round();
    if value > f64::from(u32::MAX) {
        return Err(screenshot_target_not_visible());
    }
    Ok(value as u32)
}

fn scaled_dimension(value: f64, scale: f64) -> Result<u32, ToolError> {
    if !value.is_finite() || value <= 0.0 {
        return Err(screenshot_target_not_visible());
    }
    let value = (value * scale).round();
    if !(1.0..=f64::from(u32::MAX)).contains(&value) {
        return Err(screenshot_target_not_visible());
    }
    Ok(value as u32)
}

fn resize_to_limits(
    image: &RgbaImage,
    max_edge_px: u32,
    max_pixels: u64,
) -> Result<RgbaImage, ToolError> {
    let width = image.width();
    let height = image.height();
    let max_dimension = width.max(height);
    let edge_scale = f64::from(max_edge_px) / f64::from(max_dimension);
    let pixel_scale = (max_pixels as f64 / (u64::from(width) * u64::from(height)) as f64).sqrt();
    let scale = edge_scale.min(pixel_scale).min(1.0);

    if scale >= 1.0 {
        return Ok(image.clone());
    }

    let (new_width, new_height) = scaled_dimensions(width, height, scale);
    Ok(imageops::resize(
        image,
        new_width,
        new_height,
        FilterType::Lanczos3,
    ))
}

fn reduce_image(image: &RgbaImage) -> RgbaImage {
    let (width, height) = scaled_dimensions(image.width(), image.height(), ENCODE_REDUCTION_FACTOR);
    imageops::resize(image, width, height, FilterType::Lanczos3)
}

fn scaled_dimensions(width: u32, height: u32, scale: f64) -> (u32, u32) {
    let scaled_width = ((f64::from(width) * scale).floor() as u32).max(1);
    let scaled_height = ((f64::from(height) * scale).floor() as u32).max(1);
    (
        scaled_width.min(width.saturating_sub(1).max(1)),
        scaled_height.min(height.saturating_sub(1).max(1)),
    )
}

fn encode_png(image: &RgbaImage) -> Result<Vec<u8>, ToolError> {
    let mut bytes = Vec::new();
    PngEncoder::new(&mut bytes)
        .write_image(
            image.as_raw(),
            image.width(),
            image.height(),
            ColorType::Rgba8.into(),
        )
        .map_err(|_| screenshot_failed())?;
    Ok(bytes)
}

fn scale_applied(original_width: u32, original_height: u32, image: &RgbaImage) -> f64 {
    (f64::from(image.width()) / f64::from(original_width))
        .min(f64::from(image.height()) / f64::from(original_height))
}

fn alpha_blend(destination: Rgba<u8>, source: Rgba<u8>) -> Rgba<u8> {
    let source_alpha = f64::from(source[3]) / 255.0;
    let destination_alpha = f64::from(destination[3]) / 255.0;
    let output_alpha = source_alpha + destination_alpha * (1.0 - source_alpha);
    if output_alpha == 0.0 {
        return Rgba([0, 0, 0, 0]);
    }

    let mut channels = [0_u8; 4];
    for channel in 0..3 {
        let source_component = f64::from(source[channel]) * source_alpha;
        let destination_component = f64::from(destination[channel]) * destination_alpha;
        channels[channel] = ((source_component + destination_component * (1.0 - source_alpha))
            / output_alpha)
            .round() as u8;
    }
    channels[3] = (output_alpha * 255.0).round() as u8;
    Rgba(channels)
}

#[cfg(test)]
mod tests {
    use image::{Rgba, RgbaImage};

    use super::{
        annotate_css_rect, crop_css_rect, decode_png, encode_capped_png, stitch_tiles_at_offsets,
        stitch_vertical_tiles, stitch_vertical_tiles_at_offsets, FullPageComposer,
    };
    use crate::mcp::page_automation::protocol::CssRect;

    #[test]
    fn crops_css_coordinates_at_the_capture_scale() {
        let mut source = RgbaImage::new(8, 8);
        for (x, y, pixel) in source.enumerate_pixels_mut() {
            *pixel = Rgba([x as u8, y as u8, 0, 255]);
        }

        let cropped = crop_css_rect(
            &source,
            CssRect {
                x: 1.0,
                y: 1.0,
                width: 2.0,
                height: 2.0,
            },
            2.0,
        )
        .expect("fully visible CSS rectangle must crop");

        assert_eq!(cropped.dimensions(), (4, 4));
        assert_eq!(cropped.get_pixel(0, 0), &Rgba([2, 2, 0, 255]));
        assert_eq!(cropped.get_pixel(3, 3), &Rgba([5, 5, 0, 255]));
    }

    #[test]
    fn rejects_crops_that_are_not_completely_visible() {
        let source = RgbaImage::new(8, 8);
        let error = crop_css_rect(
            &source,
            CssRect {
                x: 3.0,
                y: 3.0,
                width: 2.0,
                height: 2.0,
            },
            2.0,
        )
        .expect_err("partial crop must not be returned");

        assert_eq!(error.code, "screenshot_target_not_visible");
    }

    #[test]
    fn stitches_vertical_tiles_without_duplicate_overlap() {
        let mut first = RgbaImage::new(2, 3);
        let mut second = RgbaImage::new(2, 3);
        for x in 0..2 {
            first.put_pixel(x, 0, Rgba([255, 0, 0, 255]));
            first.put_pixel(x, 1, Rgba([0, 255, 0, 255]));
            first.put_pixel(x, 2, Rgba([0, 0, 255, 255]));
            second.put_pixel(x, 0, Rgba([0, 0, 255, 255]));
            second.put_pixel(x, 1, Rgba([255, 255, 0, 255]));
            second.put_pixel(x, 2, Rgba([255, 0, 255, 255]));
        }

        let stitched = stitch_vertical_tiles(&[first, second], 1).expect("tiles must stitch");

        assert_eq!(stitched.dimensions(), (2, 5));
        assert_eq!(stitched.get_pixel(0, 0), &Rgba([255, 0, 0, 255]));
        assert_eq!(stitched.get_pixel(0, 1), &Rgba([0, 255, 0, 255]));
        assert_eq!(stitched.get_pixel(0, 2), &Rgba([0, 0, 255, 255]));
        assert_eq!(stitched.get_pixel(0, 3), &Rgba([255, 255, 0, 255]));
        assert_eq!(stitched.get_pixel(0, 4), &Rgba([255, 0, 255, 255]));
    }

    #[test]
    fn stitches_tiles_using_actual_offsets_when_the_last_scroll_is_clamped() {
        let first = RgbaImage::from_pixel(2, 5, Rgba([255, 0, 0, 255]));
        let second = RgbaImage::from_pixel(2, 5, Rgba([0, 255, 0, 255]));
        let third = RgbaImage::from_pixel(2, 5, Rgba([0, 0, 255, 255]));

        let stitched = stitch_vertical_tiles_at_offsets(&[(first, 0), (second, 4), (third, 7)])
            .expect("clamped final tile must use its actual offset");

        assert_eq!(stitched.dimensions(), (2, 12));
        assert_eq!(stitched.get_pixel(0, 3), &Rgba([255, 0, 0, 255]));
        assert_eq!(stitched.get_pixel(0, 4), &Rgba([0, 255, 0, 255]));
        assert_eq!(stitched.get_pixel(0, 7), &Rgba([0, 0, 255, 255]));
        assert_eq!(stitched.get_pixel(0, 11), &Rgba([0, 0, 255, 255]));
    }

    #[test]
    fn stitches_horizontal_and_vertical_overflow_at_actual_offsets() {
        let top_left = RgbaImage::from_pixel(3, 3, Rgba([255, 0, 0, 255]));
        let top_right = RgbaImage::from_pixel(3, 3, Rgba([0, 255, 0, 255]));
        let bottom_left = RgbaImage::from_pixel(3, 3, Rgba([0, 0, 255, 255]));
        let bottom_right = RgbaImage::from_pixel(3, 3, Rgba([255, 255, 0, 255]));

        let stitched = stitch_tiles_at_offsets(&[
            (top_left, 0, 0),
            (top_right, 2, 0),
            (bottom_left, 0, 2),
            (bottom_right, 2, 2),
        ])
        .expect("two-dimensional tiles must stitch");

        assert_eq!(stitched.dimensions(), (5, 5));
        assert_eq!(stitched.get_pixel(1, 1), &Rgba([255, 0, 0, 255]));
        assert_eq!(stitched.get_pixel(3, 1), &Rgba([0, 255, 0, 255]));
        assert_eq!(stitched.get_pixel(1, 3), &Rgba([0, 0, 255, 255]));
        assert_eq!(stitched.get_pixel(3, 3), &Rgba([255, 255, 0, 255]));
    }

    #[test]
    fn full_page_composer_scales_into_the_bounded_canvas_before_stitching() {
        let tile = RgbaImage::from_pixel(100, 100, Rgba([10, 20, 30, 255]));
        let mut composer = FullPageComposer::new(&tile, 100.0, 100.0, 5_000.0, 100.0)
            .expect("wide document must receive a bounded canvas");
        composer.add_tile(&tile, 0.0, 0.0).unwrap();
        let image = composer.finish();

        assert_eq!(image.width(), 4_096);
        assert!(image.height() < 100);
        assert_eq!(image.get_pixel(0, 0), &Rgba([10, 20, 30, 255]));
    }

    #[test]
    fn rejects_oversized_png_dimensions_before_decoding_pixels() {
        let image = RgbaImage::new(4_097, 1);
        let bytes = super::encode_png(&image).unwrap();

        assert_eq!(decode_png(&bytes).unwrap_err().code, "screenshot_too_large");
    }

    #[test]
    fn annotates_with_translucent_fill_and_two_pixel_border() {
        let mut source = RgbaImage::from_pixel(10, 10, Rgba([255, 255, 255, 255]));

        annotate_css_rect(
            &mut source,
            CssRect {
                x: 1.0,
                y: 1.0,
                width: 3.0,
                height: 3.0,
            },
            2.0,
        )
        .expect("visible annotation rectangle must render");

        assert_eq!(source.get_pixel(2, 2), &Rgba([99, 102, 241, 255]));
        assert_eq!(source.get_pixel(3, 4), &Rgba([99, 102, 241, 255]));
        assert_ne!(source.get_pixel(5, 5), &Rgba([255, 255, 255, 255]));
    }

    #[test]
    fn applies_the_default_edge_cap_before_encoding() {
        let source = RgbaImage::from_pixel(5_000, 1_000, Rgba([1, 2, 3, 255]));

        let encoded = encode_capped_png(&source).expect("image must fit after scaling");

        assert!(encoded.width <= 4_096);
        assert!(encoded.height <= 4_096);
        assert!(encoded.scale_applied < 1.0);
    }

    #[test]
    fn repeatedly_downscales_when_png_encoding_exceeds_the_byte_cap() {
        let mut source = RgbaImage::new(2_048, 2_048);
        let mut random = 0x1234_5678_u32;
        for pixel in source.pixels_mut() {
            random ^= random << 13;
            random ^= random >> 17;
            random ^= random << 5;
            *pixel = Rgba([random as u8, (random >> 8) as u8, (random >> 16) as u8, 255]);
        }
        assert!(
            super::encode_png(&source).unwrap().len()
                > crate::mcp::page_automation::protocol::PAGE_AUTOMATION_MAX_SCREENSHOT_PNG_BYTES
        );

        let encoded = encode_capped_png(&source).expect("reduction must fit the default PNG cap");

        assert!(
            encoded.bytes.len()
                <= crate::mcp::page_automation::protocol::PAGE_AUTOMATION_MAX_SCREENSHOT_PNG_BYTES
        );
        assert!(encoded.scale_applied < 1.0);
    }
}
