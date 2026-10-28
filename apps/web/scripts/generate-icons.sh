#!/bin/bash
# Regenerates the app icons and the social preview image from public/logo.svg.
# Needs rsvg-convert (librsvg) and ImageMagick: brew install librsvg imagemagick
#
#   apps/web/scripts/generate-icons.sh
set -euo pipefail
cd "$(dirname "$0")/.."

LOGO=public/logo.svg
BG='#1e293b'
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# Rounded app icon, as used by the sign-in page, the manifest and the favicon.
rsvg-convert -w 512 -h 512 "$LOGO" -o public/icon.png
rsvg-convert -w 192 -h 192 "$LOGO" -o public/icon-192.png

# Full-bleed variants for platforms that apply their own mask: the logo sits in
# the middle 70 percent so no mask can cut into it.
rsvg-convert -w 360 -h 360 "$LOGO" -o "$TMP/logo-360.png"
magick -size 512x512 "xc:$BG" "$TMP/logo-360.png" -gravity center -composite -depth 8 public/icon-maskable-512.png
magick public/icon-maskable-512.png -resize 180x180 -depth 8 public/apple-touch-icon.png

# Favicon with three sizes in one file.
for size in 16 32 48; do rsvg-convert -w "$size" -h "$size" "$LOGO" -o "$TMP/fav-$size.png"; done
magick "$TMP/fav-16.png" "$TMP/fav-32.png" "$TMP/fav-48.png" public/favicon.ico

# Social preview (1200x630) for link previews.
mkdir -p public/images
# The logo is embedded as a data URI: rsvg-convert refuses to load linked files.
LOGO_DATA=$(base64 < "$LOGO" | tr -d '\n')
cat > "$TMP/og.svg" <<SVG
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0f172a"/>
      <stop offset="1" stop-color="#020617"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <image xlink:href="data:image/svg+xml;base64,$LOGO_DATA" x="110" y="159" width="312" height="312"/>
  <g font-family="Helvetica Neue, Helvetica, Arial, sans-serif" fill="#f6f1e3">
    <text x="470" y="290" font-size="92" font-weight="700">Cognoscimus</text>
    <text x="474" y="360" font-size="40" fill="#cbd5e1">Your private e-book reader</text>
    <text x="474" y="430" font-size="28" fill="#94a3b8">EPUB · PDF · MOBI · Comics · Open source</text>
  </g>
</svg>
SVG
rsvg-convert "$TMP/og.svg" -o public/images/open_graph_preview_read_now.png

echo "Icons and preview image written to apps/web/public"
