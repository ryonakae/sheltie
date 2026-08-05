#!/bin/sh
set -eu

if [ "$#" -ne 0 ]; then
  echo "Usage: $0" >&2
  exit 2
fi

repo_root=$(git rev-parse --show-toplevel)
icon_composer_path="$repo_root/src-tauri/icons/icon.icon"
icon_png_path="$repo_root/src-tauri/icons/icon.png"
assets_car_path="$repo_root/src-tauri/icons/Assets.car"
icns_path="$repo_root/src-tauri/icons/icon.icns"
temp_dir=$(mktemp -d)
trap 'rm -rf "$temp_dir"' 0 HUP INT TERM

if [ ! -d "$icon_composer_path" ]; then
  echo "Icon Composer asset not found: $icon_composer_path" >&2
  exit 1
fi

if [ ! -f "$icon_png_path" ]; then
  echo "Flattened icon PNG not found: $icon_png_path" >&2
  exit 1
fi

actool_output_dir="$temp_dir/actool"
tauri_output_dir="$temp_dir/tauri"
mkdir -p "$actool_output_dir" "$tauri_output_dir"

xcrun actool "$icon_composer_path" \
  --compile "$actool_output_dir" \
  --output-format human-readable-text \
  --notices \
  --warnings \
  --output-partial-info-plist "$actool_output_dir/assetcatalog_generated_info.plist" \
  --app-icon icon \
  --include-all-app-icons \
  --enable-on-demand-resources NO \
  --development-region en \
  --target-device mac \
  --minimum-deployment-target 26.0 \
  --platform macosx

(
  cd "$repo_root"
  npx --no-install tauri icon "$icon_png_path" --output "$tauri_output_dir"
)

if [ ! -f "$actool_output_dir/Assets.car" ]; then
  echo "actool did not generate Assets.car" >&2
  exit 1
fi

if [ ! -f "$tauri_output_dir/icon.icns" ] || [ ! -f "$tauri_output_dir/icon.png" ]; then
  echo "tauri icon did not generate the expected macOS icons" >&2
  exit 1
fi

cp "$actool_output_dir/Assets.car" "$assets_car_path"
cp "$tauri_output_dir/icon.icns" "$icns_path"
cp "$tauri_output_dir/icon.png" "$icon_png_path"
echo "Generated Assets.car and icon.icns; normalized icon.png to 8-bit RGBA"
