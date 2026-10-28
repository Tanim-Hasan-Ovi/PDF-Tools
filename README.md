# Local PDF Tools

A lightweight, privacy-focused local web application for processing PDFs and images entirely on your machine. No cloud uploads, no data leaks—100% private and secure.

---

## Why Use This?
Using online PDF converters often carries the risk of leaking sensitive personal or professional information. **PDF Tools** runs locally on your PC, ensuring your private documents, scanned papers, and personal images never leave your device.

---

## Features

- **Compress PDF:** Shrink PDF file sizes while keeping text as real, selectable vector text.
  - **Levels:** *Low*, *Balanced*, *High*, and *Target size* (binary search for optimal compression).
  - Preserves original files if compression doesn't beat the original size.
- **Image to PDF:** Convert up to 100 images (`JPG`, `PNG`, `WEBP`, `GIF`, `BMP`, `TIFF`) into a single PDF.
  - Drag-and-drop or use arrow keys to reorder.
  - Rotate, preview, remove, and sort by name.
  - Supports page sizes: *A4* (default), *Letter*, *Legal*, or *fit-to-image*.
  - Configurable orientation (*auto/portrait/landscape*) and margins (*none/small/normal*).
  - Respects phone-photo EXIF rotation and embeds images as-is (lossless when possible).
- **Merge PDF:** Combine 2–10 PDFs seamlessly.
  - Drag-and-drop ordering, first-page thumbnails, page counts, and full preview.
  - Automatically retains original bookmarks (adds one bookmark per source file).
- **Quick Actions:** Results from *Image to PDF* and *Merge* can be previewed, downloaded, or sent straight to the compressor instantly using **"Compress it"**.

---

## How Compression Works

Pages are never rasterized into plain images. Size reduction is achieved through:
- **Images:** Downsampled above a DPI threshold and re-encoded as JPEG (1-bit scanned/line-art images are untouched).
- **Fonts:** Subset to only include glyphs used by the document.
- **Metadata:** Document info and XMP metadata are stripped.
- **Structure:** Unused objects dropped, duplicates merged, streams deflated, and packed into object streams.

---

## Run Locally

Clone the repository and start the app with a single script:

```bash
./run.sh
