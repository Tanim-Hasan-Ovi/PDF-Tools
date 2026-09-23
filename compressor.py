"""PDF compression engine built on PyMuPDF.

Text and vector graphics are never rasterized. Size is reduced only by:
  * downsampling / re-encoding embedded raster images,
  * subsetting embedded fonts to the glyphs actually used,
  * stripping document metadata,
  * garbage-collecting, deduplicating and deflating objects on save.

Levels:
  low       one gentle pass; lossless images are left untouched.
  balanced  gentlest image setting that saves at least 50%.
  high      gentlest image setting that saves at least 75%.
  target    gentlest image setting that fits under a given size (e.g. 5 MB).
If a goal can't be reached without rasterizing text, the smallest result is returned.
"""

from dataclasses import dataclass

import pymupdf

mupdf = pymupdf.mupdf

LEVELS = ("low", "balanced", "high", "target")
DEFAULT_LEVEL = "balanced"
DEFAULT_TARGET_MB = 5.0

# Fraction of the original size each level aims for, and the gentlest LADDER
# step it may use (so High is always at least as strong as Balanced).
GOALS = {"balanced": 0.50, "high": 0.25}
FIRST_STEP = {"balanced": 0, "high": 2, "target": 0}

# (image DPI, JPEG quality), from gentlest to strongest.
LADDER = [
    (150, 75),
    (130, 68),
    (110, 60),
    (96, 52),
    (84, 45),
    (72, 38),
    (60, 32),
    (50, 26),
    (40, 20),
]
LOW_STEP = (200, 85)


class PDFError(ValueError):
    pass


@dataclass
class Result:
    data: bytes
    original_size: int
    compressed_size: int
    used_original: bool  # True if compression couldn't beat the input
    goal_size: int | None = None  # byte goal the level aimed for, if any
    image_dpi: int | None = None
    image_quality: int | None = None

    @property
    def percent_saved(self) -> float:
        if not self.original_size:
            return 0.0
        return round(100 * (1 - self.compressed_size / self.original_size), 1)

    @property
    def goal_met(self) -> bool:
        return self.goal_size is None or self.compressed_size <= self.goal_size


def _image_options(dpi: int, quality: int, lossless: bool) -> "mupdf.PdfImageRewriterOptions":
    opts = mupdf.PdfImageRewriterOptions()
    kinds = ["color_lossy", "gray_lossy"]
    if lossless:
        kinds += ["color_lossless", "gray_lossless"]
    # Only resample images noticeably above the target, so near-target images
    # are just re-encoded instead of blurred by a tiny resize.
    threshold = int(dpi * 1.1) + 1
    for kind in kinds:
        setattr(opts, f"{kind}_image_recompress_method", mupdf.FZ_RECOMPRESS_JPEG)
        setattr(opts, f"{kind}_image_recompress_quality", str(quality))
        # Bicubic hits the exact target DPI; "average" only does integer factors.
        setattr(opts, f"{kind}_image_subsample_method", mupdf.FZ_SUBSAMPLE_BICUBIC)
        setattr(opts, f"{kind}_image_subsample_threshold", threshold)
        setattr(opts, f"{kind}_image_subsample_to", dpi)
    # Bitonal (1-bit scanned text/line art) images are left untouched:
    # they're already tiny and blur badly.
    opts.recompress_when = mupdf.FZ_RECOMPRESS_WHEN_SMALLER
    return opts


def _open(data: bytes) -> pymupdf.Document:
    try:
        doc = pymupdf.open(stream=data, filetype="pdf")
    except Exception as exc:
        raise PDFError("File is not a valid PDF.") from exc
    if doc.needs_pass:
        doc.close()
        raise PDFError("Password-protected PDFs are not supported.")
    return doc


def _save(doc: pymupdf.Document) -> bytes:
    return doc.tobytes(
        garbage=4,          # drop unused objects, merge duplicates
        deflate=True,
        deflate_images=True,
        deflate_fonts=True,
        clean=True,         # sanitize/compact content streams
        use_objstms=1,      # pack objects into compressed object streams
    )


def _prepare(data: bytes) -> bytes:
    """Image-independent work, done once: font subsetting and metadata removal."""
    doc = _open(data)
    try:
        try:
            doc.subset_fonts(fallback=True)
        except Exception:
            pass  # some exotic fonts can't be subset; keep them as-is
        doc.set_metadata({})
        doc.del_xml_metadata()
        return _save(doc)
    finally:
        doc.close()


def _with_images(base: bytes, dpi: int, quality: int, lossless: bool = True) -> bytes:
    doc = _open(base)
    try:
        doc.rewrite_images(options=_image_options(dpi, quality, lossless))
        return _save(doc)
    finally:
        doc.close()


def _search(base: bytes, goal: int, first: int = 0) -> tuple[bytes, tuple[int, int]]:
    """Gentlest LADDER step (from `first` on) whose output fits in `goal` bytes,
    else the strongest."""
    cache: dict[int, bytes] = {}

    def at(i: int) -> bytes:
        if i not in cache:
            cache[i] = _with_images(base, *LADDER[i])
        return cache[i]

    last = len(LADDER) - 1
    if len(at(last)) > goal:
        return at(last), LADDER[last]
    lo, hi = first, last  # binary search: output size shrinks as steps get stronger
    while lo < hi:
        mid = (lo + hi) // 2
        if len(at(mid)) <= goal:
            hi = mid
        else:
            lo = mid + 1
    return at(lo), LADDER[lo]


def compress_pdf(data: bytes, level: str = DEFAULT_LEVEL,
                 target_mb: float = DEFAULT_TARGET_MB) -> Result:
    if level not in LEVELS:
        raise PDFError(f"Unknown compression level: {level!r}")
    original = len(data)
    base = _prepare(data)

    goal = None
    if level == "low":
        out, step = _with_images(base, *LOW_STEP, lossless=False), LOW_STEP
    else:
        goal = int(target_mb * 1024 * 1024) if level == "target" else int(original * GOALS[level])
        first = FIRST_STEP[level]
        if len(base) <= goal:
            # Fonts/metadata alone met the goal; still apply the level's gentlest image pass.
            out, step = _with_images(base, *LADDER[first]), LADDER[first]
        else:
            out, step = _search(base, goal, first)

    if len(out) >= original:
        return Result(data, original, original, used_original=True, goal_size=goal)
    return Result(out, original, len(out), used_original=False, goal_size=goal,
                  image_dpi=step[0], image_quality=step[1])
