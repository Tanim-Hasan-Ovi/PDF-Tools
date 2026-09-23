# PDF Tools

Local web app with three tools (tabs in the header):

- **Compress PDF** – shrink PDFs while keeping text as real, selectable vector text.
- **Image to PDF** – turn up to 100 images (JPG/PNG/WEBP/GIF/BMP/TIFF) into one PDF.
  Drag or ←/→ to reorder, rotate, preview, remove, sort by name. A4 (default), Letter, Legal
  or fit-to-image pages; auto/portrait/landscape; no/small/normal margin. Phone-photo EXIF
  rotation is respected. Images are embedded as-is (no quality loss) when possible.
- **Merge PDF** – combine 2–10 PDFs. Drag or ←/→ to reorder, first-page thumbnails, page
  counts, full preview. The merged file gets one bookmark per source file (original bookmarks kept).

Results from Image to PDF and Merge can be previewed, downloaded, or sent straight to the
compressor with **Compress it**.

## Run

```bash
./run.sh
```

Then open http://127.0.0.1:8765. Set `PORT=xxxx` to use a different port.

## How compression works

Pages are never rasterized. Size comes from:

- **Images** – downsampled above a DPI threshold and re-encoded as JPEG. 1-bit scanned/line-art images are left alone.
- **Fonts** – subset to only the glyphs the document uses.
- **Metadata** – document info and XMP metadata removed.
- **Structure** – unused objects dropped, duplicates merged, streams deflated, objects packed into object streams.

| Level       | What it does |
|-------------|--------------|
| Low         | One gentle pass: images above 220 DPI → 200 DPI, JPEG quality 85; lossless images untouched. |
| Balanced    | Gentlest setting that saves **≥ 50%** (starts at 150 DPI / q75). |
| High        | Gentlest setting that saves **≥ 75%** (starts at 110 DPI / q60). |
| Target size | Gentlest setting that makes the file **≤ N MB** (default 5 MB). |

Balanced, High and Target size step through image settings from 150 DPI/q75 down to 40 DPI/q20
(binary search, so only ~4 passes). Because text is never turned into images, a mostly-text PDF may
not reach the goal; the smallest possible result is returned and the UI says so.

If compression can't beat the original size, the original file is returned unchanged.
Presets live in `compressor.py`.

## API

- `POST /api/images-to-pdf` (multipart: `files` in page order, `rotations` JSON list of clockwise degrees,
  `page_size` = `a4|letter|legal|fit`, `orientation` = `auto|portrait|landscape`, `margin` = `none|small|normal`, `filename`)
- `POST /api/merge` (multipart: `files` in order, 2–10 PDFs, `filename`)
- `POST /api/pdf-info` (multipart: `file`) → `{pages, locked, thumb}`

`POST /api/compress` (multipart: `file`, optional `level` = `low|balanced|high|target`, optional `target_mb`, default 5) returns the PDF, with
`X-Original-Size`, `X-Compressed-Size`, `X-Percent-Saved`, `X-Used-Original`, `X-Goal-Size`, `X-Goal-Met` and `X-Image-DPI` headers.
