const $ = (selector) => document.querySelector(selector);
const dropZone = $("#dropZone");
const fileInput = $("#fileInput");
const workspace = $("#workspace");
const fileList = $("#fileList");
const resultPanel = $("#resultPanel");
const progress = $("#progress");
let files = [];
let results = [];
let ghostscriptPromise;
let pdfJsPromise;

const supported = /\.(pdf|hwp|hwpx|xlsx|xls|jpe?g|png|webp|bmp)$/i;
const formatSize = (bytes) => bytes < 1024 * 1024
  ? `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`
  : `${(bytes / 1024 / 1024).toFixed(2)} MB`;
const extension = (name) => name.split(".").pop().toLowerCase();
const baseName = (name) => name.replace(/\.[^.]+$/, "");

function toast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.remove("hidden");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $("#toast").classList.add("hidden"), 3200);
}

function addFiles(incoming) {
  const valid = [...incoming].filter((file) => {
    if (!supported.test(file.name)) { toast(`${file.name}: 지원하지 않는 형식이에요.`); return false; }
    if (file.size > 100 * 1024 * 1024) { toast(`${file.name}: 100MB를 넘어요.`); return false; }
    return !files.some((item) => item.name === file.name && item.size === file.size);
  });
  files.push(...valid);
  renderFiles();
}

function renderFiles() {
  dropZone.classList.toggle("hidden", files.length > 0);
  workspace.classList.toggle("hidden", files.length === 0);
  fileList.innerHTML = "";
  files.forEach((file, index) => {
    const ext = extension(file.name).toUpperCase();
    const li = document.createElement("li");
    li.className = "file-item";
    li.innerHTML = `<span class="file-icon">${ext.slice(0,4)}</span><span class="file-name"><strong></strong><small>${formatSize(file.size)}</small></span><span class="file-status">${["HWP","XLS"].includes(ext) ? "안전 압축 제한" : "압축 가능"}</span><button class="remove" type="button" aria-label="파일 삭제">×</button>`;
    li.querySelector("strong").textContent = file.name;
    li.querySelector(".remove").addEventListener("click", () => { files.splice(index, 1); renderFiles(); });
    fileList.appendChild(li);
  });
}

function setProgress(percent, message) {
  progress.classList.remove("hidden");
  $("#progressBar").style.width = `${percent}%`;
  $("#progressPercent").textContent = `${Math.round(percent)}%`;
  $("#progressText").textContent = message;
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("이미지를 만들 수 없습니다.")), type, quality));
}

async function imageToCanvas(blob, maxDimension = 2400) {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d", { alpha: true });
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}

function reducePngColors(canvas, step) {
  const context = canvas.getContext("2d", { alpha: true });
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = image.data;
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = Math.min(255, Math.round(pixels[index] / step) * step);
    pixels[index + 1] = Math.min(255, Math.round(pixels[index + 1] / step) * step);
    pixels[index + 2] = Math.min(255, Math.round(pixels[index + 2] / step) * step);
  }
  context.putImageData(image, 0, 0);
}

function canvasToBmpBlob(canvas) {
  const width = canvas.width;
  const height = canvas.height;
  const rowSize = Math.ceil(width * 3 / 4) * 4;
  const pixelSize = rowSize * height;
  const buffer = new ArrayBuffer(54 + pixelSize);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const rgba = canvas.getContext("2d").getImageData(0, 0, width, height).data;

  view.setUint16(0, 0x4d42, true);
  view.setUint32(2, buffer.byteLength, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, pixelSize, true);

  for (let y = 0; y < height; y += 1) {
    const sourceY = height - 1 - y;
    const targetRow = 54 + y * rowSize;
    for (let x = 0; x < width; x += 1) {
      const source = (sourceY * width + x) * 4;
      const target = targetRow + x * 3;
      bytes[target] = rgba[source + 2];
      bytes[target + 1] = rgba[source + 1];
      bytes[target + 2] = rgba[source];
    }
  }
  return new Blob([buffer], { type: "image/bmp" });
}

async function compressImage(file, quality) {
  const ext = extension(file.name);
  const preset = quality >= .78
    ? { maxSide: 2400, encodeQuality: .78, pngStep: 8 }
    : quality >= .6
      ? { maxSide: 1700, encodeQuality: .58, pngStep: 16 }
      : { maxSide: 1200, encodeQuality: .4, pngStep: 32 };
  const mimeByExtension = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    bmp: "image/bmp",
  };
  const canvas = await imageToCanvas(file, preset.maxSide);
  const expectedMime = mimeByExtension[ext];
  if (ext === "png") reducePngColors(canvas, preset.pngStep);
  const blob = ext === "bmp"
    ? canvasToBmpBlob(canvas)
    : await canvasBlob(canvas, expectedMime, preset.encodeQuality);
  if (blob.type !== expectedMime) {
    return { blob: file, name: file.name, note: `${ext.toUpperCase()} 형식 유지를 위해 원본을 보존했어요` };
  }
  if (blob.size >= file.size) return { blob: file, name: file.name, note: "원본이 이미 충분히 작아요" };
  const saved = Math.round((1 - blob.size / file.size) * 100);
  return { blob, name: `${baseName(file.name)}_용량줄임.${ext}`, note: `${ext.toUpperCase()} 형식 유지 · ${saved}% 절약` };
}

async function loadGhostscript() {
  if (!ghostscriptPromise) {
    const createGhostscript = globalThis.createGhostscriptModule;
    if (typeof createGhostscript !== "function") {
      throw new Error("PDF 전용 엔진을 불러오지 못했습니다.");
    }
    const wasmUrl = location.protocol === "file:"
      ? "https://cdn.jsdelivr.net/npm/@jspawn/ghostscript-wasm@0.0.2/gs.wasm"
      : new URL("./vendor/ghostscript/gs.wasm", location.href).href;
    ghostscriptPromise = createGhostscript({
      locateFile: (name) => name.endsWith(".wasm") ? wasmUrl : name,
      noInitialRun: true,
      noExitRuntime: true,
    });
  }
  return ghostscriptPromise;
}

async function compressPdfWithGhostscript(file, quality, update) {
  update(.04, "PDF 전용 압축 엔진을 준비하고 있어요...");
  const gs = await loadGhostscript();
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const inputName = `/input-${token}.pdf`;
  const outputName = `/output-${token}.pdf`;
  const inputBytes = new Uint8Array(await file.arrayBuffer());
  const preset = quality >= .78
    ? { profile: "/printer", dpi: 170, monoDpi: 300 }
    : quality >= .6
      ? { profile: "/ebook", dpi: 125, monoDpi: 240 }
      : { profile: "/screen", dpi: 85, monoDpi: 180 };

  gs.FS.writeFile(inputName, inputBytes);
  update(.13, "PDF 구조와 이미지를 분석하고 있어요...");
  await new Promise((resolve) => setTimeout(resolve, 40));

  try {
    gs.callMain([
      "-sDEVICE=pdfwrite",
      "-dCompatibilityLevel=1.4",
      `-dPDFSETTINGS=${preset.profile}`,
      "-dNOPAUSE",
      "-dQUIET",
      "-dBATCH",
      "-dSAFER",
      "-dDetectDuplicateImages=true",
      "-dCompressFonts=true",
      "-dSubsetFonts=true",
      "-dDownsampleColorImages=true",
      "-dDownsampleGrayImages=true",
      "-dDownsampleMonoImages=true",
      "-dColorImageDownsampleType=/Bicubic",
      "-dGrayImageDownsampleType=/Bicubic",
      "-dMonoImageDownsampleType=/Subsample",
      `-dColorImageResolution=${preset.dpi}`,
      `-dGrayImageResolution=${preset.dpi}`,
      `-dMonoImageResolution=${preset.monoDpi}`,
      "-dAutoRotatePages=/None",
      `-sOutputFile=${outputName}`,
      inputName,
    ]);

    update(.94, "압축 결과를 확인하고 있어요...");
    const outputBytes = gs.FS.readFile(outputName);
    const stableBytes = new Uint8Array(outputBytes);
    if (stableBytes.length < 5 || String.fromCharCode(...stableBytes.slice(0, 5)) !== "%PDF-") {
      throw new Error("올바른 PDF 결과를 만들지 못했습니다.");
    }
    const blob = new Blob([stableBytes], { type: "application/pdf" });
    if (blob.size >= file.size) {
      return { blob: file, name: file.name, note: "이미 최적화된 PDF라 원본이 가장 작아요" };
    }
    const saved = Math.round((1 - blob.size / file.size) * 100);
    return { blob, name: `${baseName(file.name)}_용량줄임.pdf`, note: `PDF 형식 유지 · 글자·벡터 유지 · ${saved}% 절약` };
  } finally {
    try { gs.FS.unlink(inputName); } catch (_) {}
    try { gs.FS.unlink(outputName); } catch (_) {}
  }
}

async function loadPdfJs() {
  if (!pdfJsPromise) {
    pdfJsPromise = import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";
      return pdfjs;
    });
  }
  return pdfJsPromise;
}

async function compressPdfByRaster(file, quality, onPage) {
  const pdfjsLib = await loadPdfJs();
  const bytes = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  const { jsPDF } = window.jspdf;
  const pdfPreset = quality >= .78
    ? { maxSide: 1500, jpegQuality: .72 }
    : quality >= .6
      ? { maxSide: 1250, jpegQuality: .53 }
      : { maxSide: 950, jpegQuality: .36 };
  let output;
  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
    const page = await pdf.getPage(pageNo);
    const baseViewport = page.getViewport({ scale: 1 });
    const renderScale = Math.min(1.45, pdfPreset.maxSide / Math.max(baseViewport.width, baseViewport.height));
    const viewport = page.getViewport({ scale: renderScale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const context = canvas.getContext("2d", { alpha: false });
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport }).promise;
    const image = canvas.toDataURL("image/jpeg", pdfPreset.jpegQuality);
    const pageWidth = baseViewport.width * 25.4 / 72;
    const pageHeight = baseViewport.height * 25.4 / 72;
    const orientation = pageWidth > pageHeight ? "landscape" : "portrait";
    const pageFormat = [pageWidth, pageHeight];
    if (!output) output = new jsPDF({ orientation, unit: "mm", format: pageFormat, compress: true, precision: 2 });
    else output.addPage(pageFormat, orientation);
    output.addImage(image, "JPEG", 0, 0, pageWidth, pageHeight, undefined, "FAST");
    canvas.width = 1;
    canvas.height = 1;
    page.cleanup();
    onPage(pageNo / pdf.numPages);
  }
  const blob = output.output("blob");
  if (blob.size >= file.size) return { blob: file, name: file.name, note: "원본이 더 작아 원본을 유지했어요" };
  const saved = Math.round((1 - blob.size / file.size) * 100);
  return { blob, name: `${baseName(file.name)}_용량줄임.pdf`, note: `PDF 형식 유지 · 페이지 최적화 · ${saved}% 절약` };
}

async function compressPdf(file, quality, update) {
  try {
    return await compressPdfWithGhostscript(file, quality, (part, message) => {
      update(part);
      if (message) $("#progressText").textContent = message;
    });
  } catch (error) {
    console.warn("PDF 전용 엔진 처리 실패, 호환 모드로 전환합니다.", error);
    $("#progressText").textContent = "호환 모드로 PDF를 다시 읽고 있어요...";
    return compressPdfByRaster(file, quality, update);
  }
}

async function compressArchive(file, quality, onItem) {
  const zip = await window.JSZip.loadAsync(file);
  const imageEntries = Object.values(zip.files).filter((entry) => !entry.dir && /\.(png|jpe?g|bmp)$/i.test(entry.name));
  for (let i = 0; i < imageEntries.length; i += 1) {
    const entry = imageEntries[i];
    try {
      const original = await entry.async("blob");
      const canvas = await imageToCanvas(original, 2200);
      const embeddedExt = extension(entry.name);
      if (embeddedExt === "bmp") { onItem((i + 1) / Math.max(1, imageEntries.length)); continue; }
      const mime = embeddedExt === "png" ? "image/png" : "image/jpeg";
      const blob = await canvasBlob(canvas, mime, Math.min(.9, quality + .12));
      if (blob.size < original.size) zip.file(entry.name, blob, { binary: true });
    } catch (_) { /* unsupported embedded image is left untouched */ }
    onItem((i + 1) / Math.max(1, imageEntries.length));
  }
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 9 } });
  if (blob.size >= file.size) return { blob: file, name: file.name, note: "원본이 이미 최적화되어 있어요" };
  return { blob, name: `${baseName(file.name)}_용량줄임.${extension(file.name)}`, note: imageEntries.length ? `원본 형식 유지 · 문서 속 이미지 ${imageEntries.length}개 최적화` : "원본 형식 유지 · 문서 구조 최적화" };
}

async function processFile(file, quality, update) {
  const ext = extension(file.name);
  if (/^(jpg|jpeg|png|webp|bmp)$/.test(ext)) return compressImage(file, quality);
  if (ext === "pdf") return compressPdf(file, quality, update);
  if (ext === "xlsx" || ext === "hwpx") return compressArchive(file, quality, update);
  return { blob: file, name: file.name, note: "구형 형식은 손상 방지를 위해 원본을 유지했어요" };
}

function download(result) {
  const url = URL.createObjectURL(result.blob);
  const link = document.createElement("a");
  link.href = url; link.download = result.name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function compressAll() {
  const button = $("#compressButton");
  const quality = Number($('input[name="quality"]:checked').value);
  button.disabled = true;
  results = [];
  try {
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const base = index / files.length * 100;
      const share = 100 / files.length;
      setProgress(base + 2, `${file.name} 처리 중...`);
      const result = await processFile(file, quality, (part) => setProgress(base + share * part, `${file.name} 처리 중...`));
      results.push({ ...result, originalSize: file.size });
    }
    setProgress(100, "모두 완료했어요.");
    showResults();
  } catch (error) {
    console.error(error);
    toast("파일을 처리하지 못했어요. 암호화되었거나 손상된 파일인지 확인해 주세요.");
  } finally {
    button.disabled = false;
  }
}

function showResults() {
  const before = results.reduce((sum, item) => sum + item.originalSize, 0);
  const after = results.reduce((sum, item) => sum + item.blob.size, 0);
  const rate = Math.max(0, Math.round((1 - after / before) * 100));
  workspace.classList.add("hidden");
  resultPanel.classList.remove("hidden");
  $("#beforeSize").textContent = formatSize(before);
  $("#afterSize").textContent = formatSize(after);
  $("#savingRate").textContent = `${rate}%`;
  $("#resultList").innerHTML = "";
  results.forEach((result) => {
    const row = document.createElement("div");
    row.className = "result-file";
    row.innerHTML = `<span><b></b><br><small>${result.note} · ${formatSize(result.blob.size)}</small></span><button type="button">다운로드</button>`;
    row.querySelector("b").textContent = result.name;
    row.querySelector("button").addEventListener("click", () => download(result));
    $("#resultList").appendChild(row);
  });
}

$("#chooseButton").addEventListener("click", (event) => { event.stopPropagation(); fileInput.click(); });
$("#addButton").addEventListener("click", () => fileInput.click());
dropZone.addEventListener("click", () => fileInput.click());
dropZone.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") fileInput.click(); });
fileInput.addEventListener("change", () => { addFiles(fileInput.files); fileInput.value = ""; });
["dragenter","dragover"].forEach((name) => dropZone.addEventListener(name, (event) => { event.preventDefault(); dropZone.classList.add("dragover"); }));
["dragleave","drop"].forEach((name) => dropZone.addEventListener(name, (event) => { event.preventDefault(); dropZone.classList.remove("dragover"); }));
dropZone.addEventListener("drop", (event) => addFiles(event.dataTransfer.files));
$("#compressButton").addEventListener("click", compressAll);
$("#downloadAllButton").addEventListener("click", () => results.forEach((result, index) => setTimeout(() => download(result), index * 250)));
$("#resetButton").addEventListener("click", () => {
  files = []; results = []; resultPanel.classList.add("hidden"); progress.classList.add("hidden");
  $("#progressBar").style.width = "0";
  $("#progressPercent").textContent = "0%";
  $("#progressText").textContent = "준비 중...";
  renderFiles();
});
