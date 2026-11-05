#!/bin/sh
# Regenerates the PWA icons from the brand mark. Needs ImageMagick. Run from frontend/.
set -e
SRC=public/logo_short_med_light.png
BG='#1D2B53' # fridge ink (--f-ink), so the white mark reads
OUT=public/icons
mkdir -p "$OUT"
# icon SIZE MARK_PERCENT FILE: the mark centred on a flat square, MARK_PERCENT of the side
icon() {
  m=$(( $1 * $2 / 100 ))
  convert -size "$1x$1" "xc:$BG" \( "$SRC" -resize "${m}x${m}" \) -gravity center -composite \
    -depth 8 -strip -define png:exclude-chunk=all "$OUT/$3"
}
icon 192 80 icon-192.png
icon 512 80 icon-512.png
icon 512 60 icon-maskable-512.png # maskable: mark stays inside the 80% safe zone
icon 180 80 apple-touch-icon.png
