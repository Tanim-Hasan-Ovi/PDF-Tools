"""Flask server: serves the UI and the PDF tool APIs."""

import json
import os
import re
from pathlib import Path
from urllib.parse import quote

from flask import Flask, jsonify, request, send_from_directory

from compressor import DEFAULT_LEVEL, DEFAULT_TARGET_MB, LEVELS, PDFError, compress_pdf
from tools import MAX_IMAGES, MAX_MERGE, images_to_pdf, merge_pdfs, pdf_info

MAX_UPLOAD_MB = 200   # per PDF for the compressor
MAX_REQUEST_MB = 500  # whole request (merge / images can carry many files)

app = Flask(__name__, static_folder="static", static_url_path="")
app.config["MAX_CONTENT_LENGTH"] = MAX_REQUEST_MB * 1024 * 1024


def clean_name(name: str | None, default: str) -> str:
    stem = Path(name or "").stem
    stem = re.sub(r'[\\/:*?"<>|\x00-\x1f]+', "_", stem).strip(" ._")
    return (stem or default)[:120] + ".pdf"


def pdf_response(data: bytes, filename: str):
    response = app.response_class(data, mimetype="application/pdf")
    # ASCII fallback + UTF-8 name, so non-English filenames work.
    ascii_stem = Path(filename).stem.encode("ascii", "ignore").decode().strip(" ._-")
    ascii_name = (ascii_stem or "document") + ".pdf"
    response.headers["Content-Disposition"] = (
        f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(filename)}"
    )
    return response


def is_pdf(data: bytes) -> bool:
    return b"%PDF" in data[:1024]


@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.post("/api/compress")
def compress():
    upload = request.files.get("file")
    if upload is None or not upload.filename:
        return jsonify(error="No file uploaded."), 400

    level = request.form.get("level", DEFAULT_LEVEL)
    if level not in LEVELS:
        return jsonify(error=f"Level must be one of: {', '.join(LEVELS)}."), 400
    try:
        target_mb = float(request.form.get("target_mb", DEFAULT_TARGET_MB))
    except ValueError:
        target_mb = 0
    if not 0.05 <= target_mb <= MAX_UPLOAD_MB:
        return jsonify(error="Target size must be a number of MB, e.g. 5."), 400

    data = upload.read()
    if len(data) > MAX_UPLOAD_MB * 1024 * 1024:
        return jsonify(error=f"File exceeds the {MAX_UPLOAD_MB} MB limit."), 413
    if not is_pdf(data):
        return jsonify(error="That file doesn't look like a PDF."), 400

    try:
        result = compress_pdf(data, level, target_mb)
    except PDFError as exc:
        return jsonify(error=str(exc)), 422

    stem = Path(upload.filename).stem
    response = pdf_response(result.data, clean_name(f"{stem}-compressed", "compressed"))
    response.headers["X-Original-Size"] = str(result.original_size)
    response.headers["X-Compressed-Size"] = str(result.compressed_size)
    response.headers["X-Percent-Saved"] = str(result.percent_saved)
    response.headers["X-Used-Original"] = "1" if result.used_original else "0"
    response.headers["X-Goal-Met"] = "1" if result.goal_met else "0"
    if result.goal_size is not None:
        response.headers["X-Goal-Size"] = str(result.goal_size)
    if result.image_dpi:
        response.headers["X-Image-DPI"] = str(result.image_dpi)
    return response


@app.post("/api/images-to-pdf")
def images_endpoint():
    uploads = request.files.getlist("files")
    if not uploads:
        return jsonify(error="Add at least one image."), 400
    if len(uploads) > MAX_IMAGES:
        return jsonify(error=f"You can add up to {MAX_IMAGES} images."), 400
    try:
        rotations = [int(r) for r in json.loads(request.form.get("rotations", "[]"))]
    except (ValueError, TypeError):
        return jsonify(error="Invalid rotations."), 400
    rotations += [0] * (len(uploads) - len(rotations))

    images = [(u.filename or f"image {i + 1}", u.read(), rotations[i])
              for i, u in enumerate(uploads)]
    try:
        data = images_to_pdf(
            images,
            page_size=request.form.get("page_size", "a4"),
            orientation=request.form.get("orientation", "auto"),
            margin=request.form.get("margin", "none"),
        )
    except PDFError as exc:
        return jsonify(error=str(exc)), 422

    response = pdf_response(data, clean_name(request.form.get("filename"), "images"))
    response.headers["X-Page-Count"] = str(len(images))
    return response


@app.post("/api/merge")
def merge_endpoint():
    uploads = request.files.getlist("files")
    if len(uploads) < 2:
        return jsonify(error="Add at least two PDFs to merge."), 400
    if len(uploads) > MAX_MERGE:
        return jsonify(error=f"You can merge up to {MAX_MERGE} PDFs at once."), 400

    pdfs = []
    for i, u in enumerate(uploads):
        name, data = u.filename or f"file {i + 1}.pdf", u.read()
        if not is_pdf(data):
            return jsonify(error=f'"{name}" is not a PDF.'), 400
        pdfs.append((name, data))
    try:
        data, pages = merge_pdfs(pdfs)
    except PDFError as exc:
        return jsonify(error=str(exc)), 422

    response = pdf_response(data, clean_name(request.form.get("filename"), "merged"))
    response.headers["X-Page-Count"] = str(pages)
    return response


@app.post("/api/pdf-info")
def pdf_info_endpoint():
    upload = request.files.get("file")
    if upload is None:
        return jsonify(error="No file uploaded."), 400
    data = upload.read()
    if not is_pdf(data):
        return jsonify(error="Not a PDF."), 400
    try:
        return jsonify(pdf_info(data))
    except PDFError as exc:
        return jsonify(error=str(exc)), 422


@app.errorhandler(413)
def too_large(_):
    return jsonify(error=f"Upload is too large (limit {MAX_REQUEST_MB} MB per request)."), 413


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8765))
    print(f"PDF Tools running at http://127.0.0.1:{port}")
    app.run(host="127.0.0.1", port=port, debug=False, threaded=True)
