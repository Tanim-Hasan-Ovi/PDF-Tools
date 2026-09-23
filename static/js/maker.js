// Image to PDF tab.
"use strict";

(() => {
  const MAX_IMAGES = 100;
  const OK_TYPES = /^image\/(jpeg|png|webp|gif|bmp|tiff)$/;
  const OK_EXT = /\.(jpe?g|png|webp|gif|bmp|tiff?)$/i;
  const btn = $("mBtn"), err = $("mError"), resultBox = $("mResult");
  let resultUrl = null;

  const grid = new SortableGrid($("mGrid"), {
    thumb: (it) => `<img src="${it.url}" alt="" class="rot-${it.rotation}">`,
    meta: (it) => `<div class="name" title="${esc(it.file.name)}">${esc(it.file.name)}</div>
      <div class="info">${fmtSize(it.file.size)}${it.w ? ` · ${it.w}×${it.h}` : ""}</div>`,
    extraButtons: () => `<button class="icon-btn" data-act="rotate" aria-label="Rotate 90°" title="Rotate 90°">${ICONS.rotate}</button>`,
    onView: (i) => Viewer.open(grid.items.map((it, n) => ({
      kind: "image", url: it.url, rotation: it.rotation, title: `${n + 1}. ${it.file.name}`,
    })), i),
    onAction: (act, i) => {
      if (act === "rotate") {
        const it = grid.items[i];
        it.rotation = (it.rotation + 90) % 360;
        grid.changed();
      }
    },
    onChange: update,
  });

  function clearResult() {
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = null;
    resultBox.hidden = true;
    resultBox.innerHTML = "";
  }

  function update() {
    clearResult();
    const n = grid.items.length;
    $("mWork").hidden = n === 0;
    $("mDrop").classList.toggle("compact", n > 0);
    $("mCount").innerHTML = `${n} image${n === 1 ? "" : "s"}<span class="hint">Drag to reorder</span>`;
    $("mAddMore").disabled = n >= MAX_IMAGES;
  }

  function addFiles(files) {
    showError(err, "");
    const skipped = [];
    let room = MAX_IMAGES - grid.items.length;
    for (const file of files) {
      if (!OK_TYPES.test(file.type) && !OK_EXT.test(file.name)) {
        skipped.push(file.name);
        continue;
      }
      if (room-- <= 0) {
        showError(err, `Only ${MAX_IMAGES} images can be added. Extra files were skipped.`);
        break;
      }
      const item = { id: newId(), file, url: URL.createObjectURL(file), rotation: 0 };
      const probe = new Image();
      probe.onload = () => { item.w = probe.naturalWidth; item.h = probe.naturalHeight; grid.render(); };
      probe.src = item.url;
      grid.items.push(item);
    }
    if (skipped.length) {
      showError(err, `Skipped (not a supported image): ${skipped.join(", ")}. HEIC photos must be converted to JPG first.`);
    }
    grid.changed();
  }

  setupDrop($("mDrop"), $("mInput"), addFiles, $("mDrop").closest(".card"));
  $("mAddMore").onclick = () => $("mInput").click();
  $("mClear").onclick = () => {
    grid.items.forEach((it) => URL.revokeObjectURL(it.url));
    grid.items = [];
    showError(err, "");
    grid.changed();
  };
  $("mSortName").onclick = () => {
    grid.items.sort((a, b) => a.file.name.localeCompare(b.file.name, undefined, { numeric: true }));
    grid.changed();
  };
  ["mPageSize", "mOrientation", "mMargin", "mName"].forEach((id) => $(id).addEventListener("input", clearResult));

  btn.addEventListener("click", async () => {
    if (!grid.items.length) return;
    showError(err, "");
    clearResult();
    const name = safeFileName($("mName").value, "images");
    const form = new FormData();
    grid.items.forEach((it) => form.append("files", it.file, it.file.name));
    form.append("rotations", JSON.stringify(grid.items.map((it) => it.rotation)));
    form.append("page_size", $("mPageSize").value);
    form.append("orientation", $("mOrientation").value);
    form.append("margin", $("mMargin").value);
    form.append("filename", name);

    setBusy(btn, true, "Creating PDF…");
    try {
      const res = await postForm("/api/images-to-pdf", form);
      const blob = await res.blob();
      resultUrl = URL.createObjectURL(blob);
      renderResult(resultBox, { url: resultUrl, name, pages: +res.headers.get("X-Page-Count"), size: blob.size });
    } catch (e) {
      showError(err, e.message || "Something went wrong.");
    } finally {
      setBusy(btn, false);
    }
  });
})();
