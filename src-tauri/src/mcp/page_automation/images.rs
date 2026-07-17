use image::codecs::png::PngEncoder;
use image::imageops::{self, FilterType};
use image::{ColorType, ImageEncoder, ImageFormat, Rgba, RgbaImage};

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
    image::load_from_memory_with_format(bytes, ImageFormat::Png)
        .map(|image| image.to_rgba8())
        .map_err(|_| screenshot_failed())
}

pub fn crop_css_rect(image: &RgbaImage, rect: CssRect, scale: f64) -> Result<RgbaImage, ToolError> {
    let (x, y, width, height) = css_rect_to_pixels(image, rect, scale)?;
    Ok(imageops::crop_imm(image, x, y, width, height).to_image())
}

pub fn stitch_vertical_tiles(tiles: &[RgbaImage], overlap_px: u32) -> Result<RgbaImage, ToolError> {
    let Some(first) = tiles.first() else {
        return Err(invalid_argument(
            "At least one screenshot tile is required.",
        ));
    };
    if first.width() == 0 || first.height() == 0 {
        return Err(invalid_argument(
            "Screenshot tiles must have nonzero dimensions.",
        ));
    }

    let width = first.width();
    let mut output_height = u64::from(first.height());
    for tile in &tiles[1..] {
        if tile.width() != width || tile.height() == 0 || overlap_px >= tile.height() {
            return Err(invalid_argument(
                "Screenshot tiles must have matching widths and a valid overlap.",
            ));
        }
        output_height = output_height
            .checked_add(u64::from(tile.height() - overlap_px))
            .ok_or_else(screenshot_too_large)?;
    }
    let output_height = u32::try_from(output_height).map_err(|_| screenshot_too_large())?;

    let mut stitched = RgbaImage::new(width, output_height);
    let mut output_y = 0;
    for (index, tile) in tiles.iter().enumerate() {
        let source_y = if index == 0 { 0 } else { overlap_px };
        for y in source_y..tile.height() {
            for x in 0..width {
                stitched.put_pixel(x, output_y, *tile.get_pixel(x, y));
            }
            output_y += 1;
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

    use super::{annotate_css_rect, crop_css_rect, encode_capped_png, stitch_vertical_tiles};
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
