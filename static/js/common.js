// Shared helpers: tabs, drop zones, sortable grid, viewer, API calls.
"use strict";

const $ = (id) => document.getElementById(id);

const fmtSize = (b) => {
  if (b < 1024) return b + " B";
  if (b < 1024 ** 2) return (b / 1024).toFixed(1) + " KB";
  return (b / 1024 ** 2).toFixed(2) + " MB";
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const ICONS = {
  left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>',
  right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>',
  view: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  rotate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>',
  remove: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>',
};

let nextId = 1;
const newId = () => nextId++;

/* ---------- Tabs (hash routing) ---------- */
const TABS = ["compress", "maker", "merge"];
function showTab(name) {
  if (!TABS.includes(name)) name = "compress";
  document.querySelectorAll("[data-panel]").forEach((p) => { p.hidden = p.dataset.panel !== name; });
  document.querySelectorAll(".nav a").forEach((a) => {
    if (a.dataset.tab === name) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
}
window.addEventListener("hashchange", () => showTab(location.hash.slice(1)));
showTab(location.hash.slice(1));
function goToTab(name) {
  if (location.hash !== "#" + name) location.hash = name;
  else showTab(name);
  window.scrollTo({ top: 0 });
}

/* ---------- Drop zones ---------- */
// Stop the browser from opening files dropped outside a zone.
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());

const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes("Files");

// zone: the visible drop box; area: larger element that also accepts drops.
function setupDrop(zone, input, onFiles, area = zone) {
  zone.addEventListener("click", () => input.click());
  zone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); }
  });
  input.addEventListener("change", () => {
    if (input.files.length) onFiles(Array.from(input.files));
    input.value = ""; // allow picking the same file again
  });
  let depth = 0;
  area.addEventListener("dragenter", (e) => {
    if (!hasFiles(e)) return;
    depth++;
    zone.classList.add("over");
  });
  area.addEventListener("dragleave", (e) => {
    if (!hasFiles(e)) return;
    if (--depth <= 0) { depth = 0; zone.classList.remove("over"); }
  });
  area.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    zone.classList.remove("over");
    if (e.dataTransfer.files.length) onFiles(Array.from(e.dataTransfer.files));
  });
}

/* ---------- Messages & buttons ---------- */
function showError(el, msg) {
  el.textContent = msg || "";
  el.hidden = !msg;
}

function setBusy(btn, busy, label) {
  btn.disabled = busy;
  if (busy) {
    btn.dataset.label = btn.textContent;
    btn.innerHTML = `<span class="spinner"></span>${esc(label)}`;
  } else if (btn.dataset.label) {
    btn.textContent = btn.dataset.label;
  }
}

async function postForm(url, form) {
  let res;
  try {
    res = await fetch(url, { method: "POST", body: form });
  } catch {
    throw new Error("Can't reach the server. Is it still running?");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Server error (${res.status})`);
  }
  return res;
}

function downloadUrl(url, name) {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function safeFileName(value, fallback) {
  const stem = (value || "").trim().replace(/\.pdf$/i, "").replace(/[\\/:*?"<>|]+/g, "_");
  return (stem || fallback) + ".pdf";
}

// Result box for Maker/Merge: "PDF ready" + View / Download / Compress it.
function renderResult(box, { url, name, pages, size, title }) {
  box.innerHTML = `
    <div class="result-card">
      <div class="txt"><b>PDF ready</b><span>${pages} page${pages === 1 ? "" : "s"} · ${fmtSize(size)} · ${esc(name)}</span></div>
      <div class="btn-group">
        <button class="btn outline small" data-r="view">View</button>
        <button class="btn outline small" data-r="compress">Compress it</button>
        <button class="btn good small" data-r="download">Download</button>
      </div>
    </div>`;
  box.hidden = false;
  box.querySelector('[data-r="view"]').onclick = () => Viewer.open([{ kind: "pdf", url, title: title || name }], 0);
  box.querySelector('[data-r="download"]').onclick = () => downloadUrl(url, name);
  box.querySelector('[data-r="compress"]').onclick = async () => {
    const blob = await fetch(url).then((r) => r.blob());
    Compress.setFile(new File([blob], name, { type: "application/pdf" }));
    goToTab("compress");
  };
  box.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/* ---------- Sortable grid ---------- */
// Cards with a serial badge; reorder by drag or ←/→ buttons.
class SortableGrid {
  constructor(el, { thumb, meta, extraButtons = () => "", onView, onChange, onAction }) {
    Object.assign(this, { el, thumb, meta, extraButtons, onView, onChange, onAction });
    this.items = [];
    this.dragFrom = null;
    this.bind();
  }

  render() {
    const n = this.items.length;
    this.el.innerHTML = this.items.map((it, i) => `
      <div class="item${it.bad ? " bad" : ""}" draggable="true" data-i="${i}">
        <div class="thumb" data-act="view" title="Preview">${this.thumb(it)}</div>
        <span class="badge">${i + 1}</span>
        <div class="meta">${this.meta(it)}</div>
        <div class="actions">
          <button class="icon-btn" data-act="left" ${i === 0 ? "disabled" : ""} aria-label="Move earlier" title="Move earlier">${ICONS.left}</button>
          ${this.extraButtons(it)}
          <button class="icon-btn" data-act="view" aria-label="Preview" title="Preview">${ICONS.view}</button>
          <button class="icon-btn danger" data-act="remove" aria-label="Remove" title="Remove">${ICONS.remove}</button>
          <button class="icon-btn" data-act="right" ${i === n - 1 ? "disabled" : ""} aria-label="Move later" title="Move later">${ICONS.right}</button>
        </div>
      </div>`).join("");
  }

  move(from, to) {
    if (from === to || to < 0 || to >= this.items.length) return;
    const [it] = this.items.splice(from, 1);
    this.items.splice(to, 0, it);
    this.changed();
  }

  changed() {
    this.render();
    this.onChange?.();
  }

  clearMarks() {
    this.el.querySelectorAll(".drop-before, .drop-after").forEach((c) =>
      c.classList.remove("drop-before", "drop-after"));
  }

  bind() {
    this.el.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-act]");
      const card = e.target.closest(".item");
      if (!btn || !card) return;
      const i = +card.dataset.i;
      const act = btn.dataset.act;
      if (act === "left") this.move(i, i - 1);
      else if (act === "right") this.move(i, i + 1);
      else if (act === "view") this.onView?.(i);
      else if (act === "remove") {
        const [it] = this.items.splice(i, 1);
        if (it.url) URL.revokeObjectURL(it.url);
        this.changed();
      } else this.onAction?.(act, i);
      // Keep keyboard focus on the moved card's same button.
      if (act === "left" || act === "right") {
        const to = act === "left" ? i - 1 : i + 1;
        this.el.querySelector(`.item[data-i="${to}"] [data-act="${act}"]:not(:disabled)`)?.focus();
      }
    });

    this.el.addEventListener("dragstart", (e) => {
      const card = e.target.closest(".item");
      if (!card) return;
      this.dragFrom = +card.dataset.i;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(this.dragFrom));
      requestAnimationFrame(() => card.classList.add("dragging"));
    });
    this.el.addEventListener("dragend", () => {
      this.dragFrom = null;
      this.clearMarks();
      this.el.querySelector(".dragging")?.classList.remove("dragging");
    });
    this.el.addEventListener("dragover", (e) => {
      if (this.dragFrom === null) return;
      const card = e.target.closest(".item");
      if (!card) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const r = card.getBoundingClientRect();
      const after = e.clientX > r.left + r.width / 2;
      this.clearMarks();
      if (+card.dataset.i !== this.dragFrom) card.classList.add(after ? "drop-after" : "drop-before");
    });
    this.el.addEventListener("drop", (e) => {
      if (this.dragFrom === null) return;
      e.preventDefault();
      e.stopPropagation();
      const card = e.target.closest(".item");
      const from = this.dragFrom;
      this.dragFrom = null;
      this.clearMarks();
      if (!card) return;
      const r = card.getBoundingClientRect();
      let to = +card.dataset.i + (e.clientX > r.left + r.width / 2 ? 1 : 0);
      if (from < to) to--;
      this.move(from, to);
    });
  }
}

/* ---------- Viewer ---------- */
// items: [{ kind: "image" | "pdf", url, title, rotation? }]
const Viewer = {
  dlg: $("viewer"),
  items: [],
  i: 0,

  open(items, i) {
    this.items = items;
    this.i = i;
    this.show();
    if (!this.dlg.open) this.dlg.showModal();
  },

  show() {
    const it = this.items[this.i];
    $("vTitle").textContent = it.title;
    const body = $("vBody");
    if (it.kind === "image") {
      body.innerHTML = `<img src="${it.url}" alt="${esc(it.title)}" class="rot-${it.rotation || 0}">`;
    } else {
      body.innerHTML = `<iframe src="${it.url}#view=FitH" title="${esc(it.title)}"></iframe>`;
    }
    const many = this.items.length > 1;
    $("vFoot").hidden = !many;
    $("vCounter").textContent = `${this.i + 1} / ${this.items.length}`;
    $("vPrev").disabled = this.i === 0;
    $("vNext").disabled = this.i === this.items.length - 1;
  },

  step(d) {
    const j = this.i + d;
    if (j < 0 || j >= this.items.length) return;
    this.i = j;
    this.show();
  },
};
$("vClose").onclick = () => Viewer.dlg.close();
$("vPrev").onclick = () => Viewer.step(-1);
$("vNext").onclick = () => Viewer.step(1);
Viewer.dlg.addEventListener("close", () => { $("vBody").innerHTML = ""; });
Viewer.dlg.addEventListener("click", (e) => { if (e.target === Viewer.dlg) Viewer.dlg.close(); });
Viewer.dlg.addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft") Viewer.step(-1);
  if (e.key === "ArrowRight") Viewer.step(1);
});
