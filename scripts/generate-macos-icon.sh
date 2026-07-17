#!/bin/sh
set -eu

repo_root=$(git rev-parse --show-toplevel)
icon_rel=src-tauri/icons/icon.icon
assets_rel=src-tauri/icons/Assets.car
mode=
output_path=
temp_dir=$(mktemp -d)
trap 'rm -rf "$temp_dir"' 0 HUP INT TERM

while [ "$#" -gt 0 ]; do
  case "$1" in
    --staged)
      mode=--staged
      ;;
    --output)
      shift
      if [ "$#" -eq 0 ]; then
        echo "Usage: $0 [--staged] [--output PATH]" >&2
        exit 2
      fi
      output_path=$1
      ;;
    *)
      echo "Usage: $0 [--staged] [--output PATH]" >&2
      exit 2
      ;;
  esac
  shift
done

if [ "$mode" = "--staged" ]; then
  staged_root="$temp_dir/staged"
  mkdir -p "$staged_root"
  tree=$(git -C "$repo_root" write-tree)
  git -C "$repo_root" archive "$tree" "$icon_rel" | tar -x -C "$staged_root"
  icon_path="$staged_root/$icon_rel"
else
  icon_path="$repo_root/$icon_rel"
fi

if [ -z "$output_path" ]; then
  output_path="$repo_root/$assets_rel"
fi

if [ ! -d "$icon_path" ]; then
  echo "Icon Composer asset not found: $icon_path" >&2
  exit 1
fi

output_dir="$temp_dir/output"
mkdir -p "$output_dir"
icon_name=$(basename "$icon_path" .icon)

xcrun actool "$icon_path" \
  --compile "$output_dir" \
  --output-format human-readable-text \
  --notices \
  --warnings \
  --output-partial-info-plist "$output_dir/assetcatalog_generated_info.plist" \
  --app-icon "$icon_name" \
  --include-all-app-icons \
  --enable-on-demand-resources NO \
  --development-region en \
  --target-device mac \
  --minimum-deployment-target 26.0 \
  --platform macosx

if [ ! -f "$output_dir/Assets.car" ]; then
  echo "actool did not generate Assets.car" >&2
  exit 1
fi

cp "$output_dir/Assets.car" "$output_path"
echo "Generated Assets.car from $icon_rel${mode:+ ($mode)}"
