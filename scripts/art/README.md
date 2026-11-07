# Mascot art

`cutout.py` turns the owner's AI-generated mascot art into the WebP-in-SVG files in
`frontend/public/celebrate/mascots/`.

## Making the art

- Generate the character on a **plain white background**.
- Keep the **whole character in frame**, with nothing cropped at the edges, and leave a little space around it.
- One character per image. Props it holds (a taco, a skateboard) are fine.
- The celebration shows the mascot rising from the bottom of the screen, so the bottom of the art sits just below the edge.

## Running it

```sh
pip install "rembg[cpu]" pillow numpy scipy
python3 scripts/art/cutout.py art/dog.png frontend/public/celebrate/mascots/dog.svg --label Dog --png /tmp/dog.png
```

Steps:

1. **Remove the background.** rembg with the `isnet-general-use` model and alpha matting gives clean edges on cartoon art. The model downloads on first use.
2. **Drop small parts.** Connected pieces smaller than 2% of the largest are removed, such as sparkles, stray specks and leftover background (`--min-part`).
3. **Crop** to the art.
4. **Wrap.** The art is encoded as WebP at quality 88 (`--quality`) and embedded in an SVG as a `data:` image, so it ships as one file with no runtime download.

Check the `--png` output on a light and a dark background before committing. Then add the mascot to
`frontend/src/v2/kid/celebrate/catalog.ts` with `art: 'cutout'`. Keep the total added art under the 3 MB budget.
