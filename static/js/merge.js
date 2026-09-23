// Merge PDF tab.
"use strict";

(() => {
  const MAX_FILES = 10;
  const btn = $("gBtn"), err = $("gError"), resultBox = $("gResult");
  let resultUrl = null;

  const grid = new SortableGrid($("gGrid"), {
    thumb: (it) => {
      if (it.locked) return '<div class="locked">Password-protected</div>';
      if (it.invalid) return '<div class="locked">Not a valid PDF</div>';
      if (!it.thumb) return '<span class="spinner dark"></span>';
      return `<img src="${it.thumb}" alt="">`;
    },
    meta: (it) => `<div class="name" title="${esc(it.file.name)}">${esc(it.file.name)}</div>
      <div class="info">${it.pages != null ? `${it.pages} page${it.pages === 1 ? "" : "s"} · ` : ""}${fmtSize(it.file.size)}</div>`,
    onView: (i) => Viewer.open(grid.items.map((it, n) => ({
      kind: "pdf", url: it.url, title: `${n + 1}. ${it.file.name}`,
    })), i),
    onChange: () => { clearResult(); refresh(); },
  });

  function clearResult() {
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = null;
    resultBox.hidden = true;
    resultBox.innerHTML = "";
  }

  function refresh() {
    const n = grid.items.length;
    $("gWork").hidden = n === 0;
    $("gDrop").classList.toggle("compact", n > 0);
    $("gCount").innerHTML = `${n} / ${MAX_FILES} PDFs<span class="hint">Drag to reorder</span>`;
    $("gAddMore").disabled = n >= MAX_FILES;
    const bad = grid.items.some((it) => it.bad);
    btn.disabled = n < 2 || bad;
    btn.title = bad ? "Remove the files marked in red first" : n < 2 ? "Add at least 2 PDFs" : "";
  }

  async function loadInfo(item) {
    const form = new FormData();
    form.append("file", item.file);
    try {
      const info = await (await postForm("/api/pdf-info", form)).json();
      Object.assign(item, { pages: info.pages, thumb: info.thumb, locked: info.locked, bad: info.locked });
    } catch {
      Object.assign(item, { invalid: true, bad: true });
    }
    if (grid.items.includes(item)) { grid.render(); refresh(); }
  }

  function addFiles(files) {
    showError(err, "");
    const skipped = [];
    for (const file of files) {
      if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
        skipped.push(file.name);
        continue;
      }
      if (grid.items.length >= MAX_FILES) {
        showError(err, `You can merge up to ${MAX_FILES} PDFs. Extra files were skipped.`);
        break;
      }
      const item = { id: newId(), file, url: URL.createObjectURL(file), pages: null, thumb: null };
      grid.items.push(item);
      loadInfo(item);
    }
    if (skipped.length) showError(err, `Skipped (not a PDF): ${skipped.join(", ")}`);
    grid.changed();
  }

  setupDrop($("gDrop"), $("gInput"), addFiles, $("gDrop").closest(".card"));
  $("gAddMore").onclick = () => $("gInput").click();
  $("gClear").onclick = () => {
    grid.items.forEach((it) => URL.revokeObjectURL(it.url));
    grid.items = [];
    showError(err, "");
    grid.changed();
  };
  $("gSortName").onclick = () => {
    grid.items.sort((a, b) => a.file.name.localeCompare(b.file.name, undefined, { numeric: true }));
    grid.changed();
  };
  $("gName").addEventListener("input", clearResult);

  btn.addEventListener("click", async () => {
    if (grid.items.length < 2) return;
    showError(err, "");
    clearResult();
    const name = safeFileName($("gName").value, "merged");
    const form = new FormData();
    grid.items.forEach((it) => form.append("files", it.file, it.file.name));
    form.append("filename", name);

    setBusy(btn, true, "Merging…");
    try {
      const res = await postForm("/api/merge", form);
      const blob = await res.blob();
      resultUrl = URL.createObjectURL(blob);
      renderResult(resultBox, { url: resultUrl, name, pages: +res.headers.get("X-Page-Count"), size: blob.size });
    } catch (e) {
      showError(err, e.message || "Something went wrong.");
    } finally {
      setBusy(btn, false);
      refresh();
    }
  });
})();
