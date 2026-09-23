"""Images -> PDF, PDF merging, and PDF thumbnails, built on PyMuPDF + Pillow."""

import base64
import io

import pymupdf
from PIL import Image, ImageOps, UnidentifiedImageError

from compressor import PDFError

MM = 72 / 25.4
PAGE_SIZES = {  # portrait width, height in points
    "a4": (210 * MM, 297 * MM),
    "letter": (612.0, 792.0),
    "legal": (612.0, 1008.0),
}
MARGINS = {"none": 0, "small": 6 * MM, "normal": 12 * MM}
ORIENTATIONS = ("auto", "portrait", "landscape")
MAX_IMAGES = 100
MAX_MERGE = 10

# Allow large scans/photos (Pillow warns above ~89 MP by default).
Image.MAX_IMAGE_PIXELS = 200_000_000


def _load_image(data: bytes, name: str, rotation: int) -> tuple[bytes, int, int]:
    """Return (image bytes PyMuPDF can embed, width, height) upright and rotated
    clockwise by `rotation` degrees. Untouched originals are embedded as-is."""
    try:
        im = Image.open(io.BytesIO(data))
        im.load()
    except (UnidentifiedImageError, OSError) as exc:
        raise PDFError(f'"{name}" is not a supported image (use JPG, PNG, WEBP, GIF, BMP or TIFF).') from exc

    rotation %= 360
    fmt = im.format
    exif_orientation = im.getexif().get(0x0112, 1)
    if rotation == 0 and exif_orientation in (1, None) and fmt in ("JPEG", "PNG") \
            and im.mode in ("RGB", "L", "RGBA", "LA", "P", "CMYK", "1"):
        return data, im.width, im.height

    im = ImageOps.exif_transpose(im)  # phone photos store rotation in EXIF
    if rotation:
        im = im.rotate(-rotation, expand=True)

    out = io.BytesIO()
    has_alpha = im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info)
    if has_alpha or fmt == "PNG" or im.mode in ("1", "P"):
        im.convert("RGBA" if has_alpha else "RGB").save(out, "PNG", optimize=True)
    else:
        im.convert("RGB").save(out, "JPEG", quality=92, optimize=True)
    return out.getvalue(), im.width, im.height


def images_to_pdf(images: list[tuple[str, bytes, int]], page_size: str = "a4",
                  orientation: str = "auto", margin: str = "none") -> bytes:
    """images: [(filename, bytes, clockwise rotation)] in page order."""
    if not images:
        raise PDFError("Add at least one image.")
    if len(images) > MAX_IMAGES:
        raise PDFError(f"You can add up to {MAX_IMAGES} images.")
    if page_size not in (*PAGE_SIZES, "fit"):
        raise PDFError("Unknown page size.")
    if orientation not in ORIENTATIONS:
        raise PDFError("Unknown orientation.")
    if margin not in MARGINS:
        raise PDFError("Unknown margin.")
    pad = MARGINS[margin]

    doc = pymupdf.open()
    try:
        for name, data, rotation in images:
            img, w, h = _load_image(data, name, rotation)
            landscape_img = w > h
            if page_size == "fit":
                # Page takes the image's shape, A4-wide (or A4-tall if landscape).
                long_side = PAGE_SIZES["a4"][1]
                iw, ih = (long_side, long_side * h / w) if landscape_img else (long_side * w / h, long_side)
                pw, ph = iw + 2 * pad, ih + 2 * pad
            else:
                pw, ph = PAGE_SIZES[page_size]
                landscape = orientation == "landscape" or (orientation == "auto" and landscape_img)
                if landscape:
                    pw, ph = ph, pw
            page = doc.new_page(width=pw, height=ph)
            rect = pymupdf.Rect(pad, pad, pw - pad, ph - pad)
            page.insert_image(rect, stream=img, keep_proportion=True)  # centered
        return doc.tobytes(garbage=3, deflate=True)
    finally:
        doc.close()


def merge_pdfs(pdfs: list[tuple[str, bytes]]) -> tuple[bytes, int]:
    """pdfs: [(filename, bytes)] in order -> (merged PDF, page count).
    Adds one bookmark per source file."""
    if len(pdfs) < 2:
        raise PDFError("Add at least two PDFs to merge.")
    if len(pdfs) > MAX_MERGE:
        raise PDFError(f"You can merge up to {MAX_MERGE} PDFs at once.")

    out = pymupdf.open()
    toc = []
    try:
        for name, data in pdfs:
            try:
                src = pymupdf.open(stream=data, filetype="pdf")
            except Exception as exc:
                raise PDFError(f'"{name}" is not a valid PDF.') from exc
            with src:
                if src.needs_pass:
                    raise PDFError(f'"{name}" is password-protected. Unlock it first.')
                start = out.page_count
                toc.append([1, name.rsplit(".", 1)[0], start + 1])
                toc += [[lvl + 1, title, page + start] for lvl, title, page, *_ in src.get_toc()
                        if page > 0]
                out.insert_pdf(src)
        try:
            out.set_toc(toc)
        except Exception:
            pass  # a malformed source outline shouldn't block the merge
        return out.tobytes(garbage=3, deflate=True, use_objstms=1), out.page_count
    finally:
        out.close()


def pdf_info(data: bytes) -> dict:
    """Page count and a first-page thumbnail (PNG data URL) for previews."""
    try:
        doc = pymupdf.open(stream=data, filetype="pdf")
    except Exception as exc:
        raise PDFError("Not a valid PDF.") from exc
    with doc:
        if doc.needs_pass:
            return {"pages": None, "locked": True, "thumb": None}
        thumb = None
        if doc.page_count:
            page = doc[0]
            zoom = 260 / max(page.rect.width, page.rect.height, 1)
            pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False)
            thumb = "data:image/png;base64," + base64.b64encode(pix.tobytes("png")).decode()
        return {"pages": doc.page_count, "locked": False, "thumb": thumb}
