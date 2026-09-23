// Compress PDF tab.
"use strict";

const Compress = (() => {
  const btn = $("cBtn"), err = $("cError");
  let file = null, resultUrl = null, resultName = "compressed.pdf";

  const levelValue = () => document.querySelector("input[name=level]:checked").value;

  function clearResult() {
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = null;
    $("cResults").hidden = true;
    $("cBar").style.width = "0";
  }

  function setFile(f) {
    showError(err, "");
    clearResult();
    if (!f) return;
    if (f.type !== "application/pdf" && !f.name.toLowerCase().endsWith(".pdf")) {
      showError(err, "Please choose a PDF file.");
      return;
    }
    file = f;
    $("cFileName").textContent = `${f.name} (${fmtSize(f.size)})`;
    btn.disabled = false;
  }

  setupDrop($("cDrop"), $("cInput"), (files) => setFile(files[0]));

  // Changing settings after a run invalidates the shown result.
  document.querySelectorAll("input[name=level]").forEach((r) =>
    r.addEventListener("change", () => {
      clearResult();
      $("cTargetRow").classList.toggle("show", levelValue() === "target");
    }));
  $("cTargetMb").addEventListener("input", clearResult);

  btn.addEventListener("click", async () => {
    if (!file) return;
    showError(err, "");
    clearResult();

    const level = levelValue();
    const targetMb = parseFloat($("cTargetMb").value);
    if (level === "target" && !(targetMb >= 0.1)) {
      showError(err, "Enter a target size of at least 0.1 MB.");
      return;
    }
    const form = new FormData();
    form.append("file", file);
    form.append("level", level);
    if (level === "target") form.append("target_mb", targetMb);

    setBusy(btn, true, "Compressing…");
    try {
      const res = await postForm("/api/compress", form);
      const blob = await res.blob();
      const orig = +res.headers.get("X-Original-Size");
      const comp = +res.headers.get("X-Compressed-Size");
      const pct = +res.headers.get("X-Percent-Saved");
      const usedOriginal = res.headers.get("X-Used-Original") === "1";
      const goalMet = res.headers.get("X-Goal-Met") !== "0";
      const goalSize = +res.headers.get("X-Goal-Size");

      resultUrl = URL.createObjectURL(blob);
      resultName = file.name.replace(/\.pdf$/i, "") + "-compressed.pdf";

      $("cOrig").textContent = fmtSize(orig);
      $("cComp").textContent = fmtSize(comp);
      $("cSaved").textContent = pct.toFixed(1) + "%";
      let note;
      if (goalMet && usedOriginal) {
        note = "This PDF is already well optimized, so the original file is returned unchanged.";
      } else if (!goalMet) {
        note = level === "target"
          ? `Couldn't get under ${fmtSize(goalSize)} without turning text into images. This is the smallest it can go.`
          : "Couldn't reach the usual saving: most of this PDF is text/vector content, which is kept sharp. This is the smallest it can go.";
      } else {
        note = `Reduced by ${fmtSize(orig - comp)}.`;
      }
      $("cNote").textContent = note;
      $("cNote").classList.toggle("warn", !goalMet);
      $("cResults").hidden = false;
      requestAnimationFrame(() => { $("cBar").style.width = Math.max(0, pct) + "%"; });
    } catch (e) {
      showError(err, e.message || "Something went wrong.");
    } finally {
      setBusy(btn, false);
    }
  });

  $("cView").addEventListener("click", () => {
    if (resultUrl) Viewer.open([{ kind: "pdf", url: resultUrl, title: resultName }], 0);
  });
  $("cDownload").addEventListener("click", () => {
    if (resultUrl) downloadUrl(resultUrl, resultName);
  });
  $("cReset").addEventListener("click", () => {
    clearResult();
    file = null;
    $("cFileName").textContent = "";
    btn.disabled = true;
  });

  return { setFile };
})();
