#!/usr/bin/env python3
"""Cut a mascot out of its background and wrap it as a WebP-in-SVG for frontend/public/celebrate/mascots/.

Pipeline: rembg (isnet-general-use, alpha matting) -> drop connected parts smaller than 2% of the
largest (sparkles, stray bits) -> crop to the art -> WebP q88 embedded in an SVG. See README.md.

    python3 scripts/art/cutout.py owner-trex.png frontend/public/celebrate/mascots/trex.svg --label T-Rex
"""

import argparse
import base64
import io
from pathlib import Path

import numpy as np
from PIL import Image
from rembg import new_session, remove
from scipy import ndimage


def cut(img: Image.Image, model: str) -> Image.Image:
    out = remove(img.convert("RGB"), session=new_session(model), alpha_matting=True)
    return out.crop(out.getbbox())


def clean(im: Image.Image, min_part: float, alpha_floor: int = 40) -> Image.Image:
    a = np.array(im.convert("RGBA"))
    lab, n = ndimage.label(a[..., 3] > alpha_floor)
    if n == 0:
        raise SystemExit("nothing left after background removal")
    sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
    keep = [i + 1 for i, s in enumerate(sizes) if s >= min_part * sizes.max()]
    a[..., 3] = np.where(np.isin(lab, keep), a[..., 3], 0)
    out = Image.fromarray(a)
    print(f"{n} parts -> {len(keep)} kept")
    return out.crop(out.getbbox())


def svg(im: Image.Image, quality: int, label: str) -> str:
    buf = io.BytesIO()
    im.save(buf, "WEBP", quality=quality, method=6)
    w, h = im.size
    b64 = base64.b64encode(buf.getvalue()).decode()
    print(f"{w}x{h}, {len(buf.getvalue()) // 1024} KB webp")
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" role="img" '
        f'aria-label="{label}"><image href="data:image/webp;base64,{b64}" width="{w}" height="{h}"/></svg>'
    )


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument(
        "src",
        type=Path,
        help="the generated art (plain white background, whole character in frame)",
    )
    p.add_argument("out", type=Path, help="the .svg to write")
    p.add_argument("--label", default="Mascot", help="aria-label for the SVG")
    p.add_argument("--model", default="isnet-general-use", help="rembg model")
    p.add_argument(
        "--min-part",
        type=float,
        default=0.02,
        help="drop parts smaller than this share of the largest",
    )
    p.add_argument("--quality", type=int, default=88, help="WebP quality")
    p.add_argument("--png", type=Path, help="also save the cleaned cut-out as PNG (for checking)")
    a = p.parse_args()
    im = clean(cut(Image.open(a.src), a.model), a.min_part)
    if a.png:
        im.save(a.png, optimize=True)
    a.out.write_text(svg(im, a.quality, a.label))
    print(a.out)


if __name__ == "__main__":
    main()
