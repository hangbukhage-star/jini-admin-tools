const TESSERACT_URL =
  "https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js";
const PDFJS_URL =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js";
const PDFJS_WORKER_URL =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";

let tesseractApi = window.Tesseract || null;
let pdfjsLib = window.pdfjsLib || null;

const elements = {
  startPanel: document.querySelector("#startPanel"),
  dropZone: document.querySelector("#dropZone"),
  fileInput: document.querySelector("#fileInput"),
  chooseButton: document.querySelector("#chooseButton"),
  fileSummary: document.querySelector("#fileSummary"),
  fileCount: document.querySelector("#fileCount"),
  fileNames: document.querySelector("#fileNames"),
  clearFilesButton: document.querySelector("#clearFilesButton"),
  languageSelect: document.querySelector("#languageSelect"),
  precisionOcrInput: document.querySelector("#precisionOcrInput"),
  convertButton: document.querySelector("#convertButton"),
  progressPanel: document.querySelector("#progressPanel"),
  progressTitle: document.querySelector("#progressTitle"),
  progressPercent: document.querySelector("#progressPercent"),
  progressBar: document.querySelector("#progressBar"),
  progressMessage: document.querySelector("#progressMessage"),
  editorPanel: document.querySelector("#editorPanel"),
  pages: document.querySelector("#pages"),
  pageCountLabel: document.querySelector("#pageCountLabel"),
  newDocumentButton: document.querySelector("#newDocumentButton"),
  addMissingTextButton: document.querySelector("#addMissingTextButton"),
  extractTextButton: document.querySelector("#extractTextButton"),
  downloadHtmlButton: document.querySelector("#downloadHtmlButton"),
  printButton: document.querySelector("#printButton"),
  lineEditor: document.querySelector("#lineEditor"),
  lineEditorInput: document.querySelector("#lineEditorInput"),
  lineEditorCancel: document.querySelector("#lineEditorCancel"),
  lineEditorReset: document.querySelector("#lineEditorReset"),
  lineEditorApply: document.querySelector("#lineEditorApply"),
  fontFamilySelect: document.querySelector("#fontFamilySelect"),
  fontSizeInput: document.querySelector("#fontSizeInput"),
  fontSizeDownButton: document.querySelector("#fontSizeDownButton"),
  fontSizeApplyButton: document.querySelector("#fontSizeApplyButton"),
  fontSizeUpButton: document.querySelector("#fontSizeUpButton"),
  originalSizeHint: document.querySelector("#originalSizeHint"),
  fontBoldButton: document.querySelector("#fontBoldButton"),
  fontColorInput: document.querySelector("#fontColorInput"),
  clearFormatButton: document.querySelector("#clearFormatButton"),
  formatApplyStatus: document.querySelector("#formatApplyStatus"),
  errorToast: document.querySelector("#errorToast"),
};

const supportedImageTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/bmp",
  "image/tiff",
]);

let selectedFiles = [];
let ocrWorker = null;
let totalPages = 0;
let completedPages = 0;
let activeEditable = null;
let activeEditables = [];
let editorSelectionRange = null;
let isAddingMissingText = false;
let addTextDrag = null;
const embeddedFontFaces = new Map();

elements.chooseButton.addEventListener("click", (event) => {
  event.stopPropagation();
  elements.fileInput.click();
});
elements.dropZone.addEventListener("click", () => elements.fileInput.click());
elements.dropZone.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    elements.fileInput.click();
  }
});
elements.fileInput.addEventListener("change", () => setFiles([...elements.fileInput.files]));
elements.clearFilesButton.addEventListener("click", resetSelection);
elements.convertButton.addEventListener("click", convertDocuments);
elements.newDocumentButton.addEventListener("click", resetApplication);
elements.addMissingTextButton.addEventListener("click", toggleMissingTextMode);
elements.extractTextButton.addEventListener("click", downloadPlainText);
elements.downloadHtmlButton.addEventListener("click", downloadEditableHtml);
elements.printButton.addEventListener("click", () => window.print());
elements.lineEditorCancel.addEventListener("click", closeLineEditor);
elements.lineEditorReset.addEventListener("click", resetEditedLine);
elements.lineEditorApply.addEventListener("click", applyEditedLine);
elements.lineEditorInput.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    closeLineEditor();
  }
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    applyEditedLine();
  }
});
for (const eventName of ["mouseup", "keyup", "input", "focus"]) {
  elements.lineEditorInput.addEventListener(eventName, rememberEditorSelection);
}
elements.fontFamilySelect.addEventListener("change", () => {
  const family = elements.fontFamilySelect.value;
  if (family) {
    applyStyleToEditorSelection(
      "fontFamily",
      family,
      { fontFamily: family },
      `${family} 글꼴`,
    );
  }
  elements.fontFamilySelect.value = "";
});
elements.fontSizeInput.addEventListener("change", applyNumericFontSize);
elements.fontSizeInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    applyNumericFontSize();
  }
});
for (const button of [
  elements.fontSizeDownButton,
  elements.fontSizeApplyButton,
  elements.fontSizeUpButton,
]) {
  button.addEventListener("mousedown", (event) => event.preventDefault());
}
elements.fontSizeDownButton.addEventListener("click", () => adjustFontSize(-1));
elements.fontSizeApplyButton.addEventListener("click", applyNumericFontSize);
elements.fontSizeUpButton.addEventListener("click", () => adjustFontSize(1));
elements.fontBoldButton.addEventListener("mousedown", (event) => event.preventDefault());
elements.fontBoldButton.addEventListener("click", () =>
  applyStyleToEditorSelection(
    "fontWeight",
    "700",
    { fontWeight: "700" },
    "굵게",
  ),
);
elements.fontColorInput.addEventListener("change", () =>
  applyStyleToEditorSelection(
    "color",
    elements.fontColorInput.value,
    { fontColor: elements.fontColorInput.value },
    `${elements.fontColorInput.value} 색상`,
  ),
);
elements.clearFormatButton.addEventListener("mousedown", (event) => event.preventDefault());
elements.clearFormatButton.addEventListener("click", clearEditorSelectionFormat);
window.addEventListener("resize", () => {
  document.querySelectorAll(".editable-word.modified").forEach(fitLineText);
});
if (document.fonts?.ready) {
  document.fonts.ready.then(() => {
    document.querySelectorAll(".editable-word.modified").forEach(fitLineText);
  });
}

for (const eventName of ["dragenter", "dragover"]) {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.add("dragging");
  });
}
for (const eventName of ["dragleave", "drop"]) {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove("dragging");
  });
}
elements.dropZone.addEventListener("drop", (event) => setFiles([...event.dataTransfer.files]));
elements.pages.addEventListener("pointerdown", beginMissingTextDrag);
window.addEventListener("pointermove", moveMissingTextDrag);
window.addEventListener("pointerup", finishMissingTextDrag);

function isSupported(file) {
  return isPdf(file)
    || supportedImageTypes.has(file.type)
    || /\.(png|jpe?g|webp|bmp|tiff?)$/i.test(file.name);
}

function isPdf(file) {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

function setFiles(files) {
  const validFiles = files.filter(isSupported);
  if (!validFiles.length) {
    showError("PDF 또는 지원되는 이미지 파일을 선택해 주세요.");
    return;
  }
  selectedFiles = validFiles;
  elements.fileInput.value = "";
  elements.fileCount.textContent = `${validFiles.length}개 파일`;
  elements.fileNames.textContent = validFiles.map((file) => file.name).join(", ");
  elements.fileSummary.classList.remove("hidden");
  elements.convertButton.disabled = false;
}

function resetSelection() {
  selectedFiles = [];
  elements.fileInput.value = "";
  elements.fileSummary.classList.add("hidden");
  elements.convertButton.disabled = true;
}

async function resetApplication() {
  setMissingTextMode(false);
  closeLineEditor();
  if (ocrWorker) {
    await ocrWorker.terminate();
    ocrWorker = null;
  }
  elements.pages.replaceChildren();
  embeddedFontFaces.clear();
  document.querySelector("#documentEmbeddedFonts")?.remove();
  elements.editorPanel.classList.add("hidden");
  elements.progressPanel.classList.add("hidden");
  elements.startPanel.classList.remove("hidden");
  resetSelection();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function updateProgress(percent, title, message) {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  elements.progressPercent.textContent = `${value}%`;
  elements.progressBar.style.width = `${value}%`;
  elements.progressTitle.textContent = title;
  elements.progressMessage.textContent = message;
}

function showError(message) {
  elements.errorToast.classList.remove("success");
  elements.errorToast.textContent = message;
  elements.errorToast.classList.remove("hidden");
  window.setTimeout(() => elements.errorToast.classList.add("hidden"), 6500);
}

function showSuccess(message) {
  elements.errorToast.classList.add("success");
  elements.errorToast.textContent = message;
  elements.errorToast.classList.remove("hidden");
  window.setTimeout(() => elements.errorToast.classList.add("hidden"), 3500);
}

function showFormatStatus(message) {
  if (!elements.formatApplyStatus) return;
  elements.formatApplyStatus.textContent = `${message} 적용 예정 · 아래의 ‘수정 적용’을 눌러 완료하세요.`;
  elements.formatApplyStatus.classList.add("applied");
}

function loadScript(source) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-library="${source}"]`);
    if (existing) {
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", reject, { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = source;
    script.dataset.library = source;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`필수 구성요소를 불러오지 못했습니다.`));
    document.head.append(script);
  });
}

async function ensureDependencies(needsPdf) {
  updateProgress(1, "프로그램 준비 중", "문자 인식 구성요소를 불러오고 있어요.");
  if (!window.Tesseract) {
    await loadScript(TESSERACT_URL);
  }
  tesseractApi = window.Tesseract;
  if (!tesseractApi) {
    throw new Error("문자 인식 구성요소를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.");
  }

  if (needsPdf && !window.pdfjsLib) {
    updateProgress(2, "PDF 기능 준비 중", "PDF 페이지 변환 구성요소를 불러오고 있어요.");
    await loadScript(PDFJS_URL);
  }
  pdfjsLib = window.pdfjsLib || null;
  if (needsPdf && !pdfjsLib) {
    throw new Error("PDF 처리 구성요소를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.");
  }
  if (pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
  }
}

async function createOcrWorker() {
  if (!tesseractApi) {
    throw new Error("문자 인식 구성요소를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.");
  }
  updateProgress(2, "문자 인식 준비 중", "처음 한 번은 언어 데이터를 불러오는 데 시간이 걸립니다.");
  return tesseractApi.createWorker(elements.languageSelect.value, 1, {
    logger(info) {
      if (typeof info.progress === "number") {
        const pageShare = totalPages ? 88 / totalPages : 0;
        const percent = 7 + completedPages * pageShare + info.progress * pageShare;
        updateProgress(percent, "글자를 인식하고 있어요", translateStatus(info.status));
      }
    },
  });
}

function translateStatus(status) {
  const messages = {
    "loading tesseract core": "문자 인식 엔진을 준비하고 있어요.",
    "initializing tesseract": "문자 인식 엔진을 시작하고 있어요.",
    "loading language traineddata": "한국어 인식 데이터를 불러오고 있어요.",
    "initializing api": "인식 설정을 적용하고 있어요.",
    "recognizing text": "페이지의 글자 위치를 찾고 있어요.",
  };
  return messages[status] || "문서를 분석하고 있어요.";
}

function setMissingTextMode(enabled) {
  isAddingMissingText = Boolean(enabled);
  elements.pages.classList.toggle("add-text-mode", isAddingMissingText);
  elements.addMissingTextButton.classList.toggle("active", isAddingMissingText);
  elements.addMissingTextButton.textContent = isAddingMissingText
    ? "페이지에서 누락 영역을 드래그하세요"
    : "누락 글자 추가";
  if (!isAddingMissingText && addTextDrag?.preview) {
    addTextDrag.preview.remove();
    addTextDrag = null;
  }
}

function toggleMissingTextMode() {
  setMissingTextMode(!isAddingMissingText);
}

function pointInPage(page, clientX, clientY) {
  const bounds = page.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(bounds.width, clientX - bounds.left)),
    y: Math.max(0, Math.min(bounds.height, clientY - bounds.top)),
    width: bounds.width,
    height: bounds.height,
  };
}

function updateMissingTextPreview(event) {
  if (!addTextDrag) return;
  const point = pointInPage(addTextDrag.page, event.clientX, event.clientY);
  const left = Math.min(addTextDrag.start.x, point.x);
  const top = Math.min(addTextDrag.start.y, point.y);
  const width = Math.abs(point.x - addTextDrag.start.x);
  const height = Math.abs(point.y - addTextDrag.start.y);
  Object.assign(addTextDrag.preview.style, {
    left: `${(left / point.width) * 100}%`,
    top: `${(top / point.height) * 100}%`,
    width: `${(width / point.width) * 100}%`,
    height: `${(height / point.height) * 100}%`,
  });
  addTextDrag.current = point;
}

function beginMissingTextDrag(event) {
  if (!isAddingMissingText || event.button !== 0) return;
  const page = event.target.closest(".document-page");
  if (!page) return;
  event.preventDefault();
  const start = pointInPage(page, event.clientX, event.clientY);
  const preview = document.createElement("div");
  preview.className = "add-region-preview";
  page.append(preview);
  addTextDrag = { page, start, current: start, preview };
  updateMissingTextPreview(event);
}

function moveMissingTextDrag(event) {
  if (!addTextDrag) return;
  event.preventDefault();
  updateMissingTextPreview(event);
}

function finishMissingTextDrag(event) {
  if (!addTextDrag) return;
  event.preventDefault();
  updateMissingTextPreview(event);
  const { page, start, current, preview } = addTextDrag;
  preview.remove();
  addTextDrag = null;
  const minimumWidth = Math.max(80, current.width * 0.1);
  const minimumHeight = Math.max(24, current.height * 0.025);
  const left = Math.min(start.x, current.x);
  const top = Math.min(start.y, current.y);
  const width = Math.max(minimumWidth, Math.abs(current.x - start.x));
  const height = Math.max(minimumHeight, Math.abs(current.y - start.y));
  const editable = createManualEditable(page, {
    left: (left / current.width) * 100,
    top: (top / current.height) * 100,
    width: Math.min(100 - (left / current.width) * 100, (width / current.width) * 100),
    height: Math.min(100 - (top / current.height) * 100, (height / current.height) * 100),
  });
  setMissingTextMode(false);
  openLineEditor(editable);
  if (elements.formatApplyStatus) {
    elements.formatApplyStatus.textContent =
      "누락된 글자를 입력한 뒤 ‘수정 적용’을 누르세요. 필요한 경우 글자를 드래그해 크기도 바꿀 수 있습니다.";
  }
}

function createManualEditable(page, rect) {
  const editable = document.createElement("span");
  const pageNumber = page.dataset.page || "manual";
  const manualIndex = page.querySelectorAll(".editable-word[data-manual='true']").length;
  const ratios = [...page.querySelectorAll(".editable-word")]
    .map((item) => Number(item.dataset.cqwPerPt))
    .filter((value) => Number.isFinite(value) && value > 0);
  const cqwPerPt = medianNumber(ratios, 0.16);
  editable.className = "editable-word manual-text-region";
  editable.tabIndex = 0;
  editable.setAttribute("role", "button");
  editable.setAttribute("aria-label", "직접 추가한 문장 수정");
  editable.dataset.editId = `manual-${pageNumber}-${manualIndex}-${Date.now()}`;
  editable.dataset.original = "";
  editable.dataset.tableCell = "true";
  editable.dataset.manual = "true";
  editable.dataset.fontSizePt = "10.5";
  editable.dataset.cqwPerPt = String(cqwPerPt);
  editable.style.left = `${rect.left}%`;
  editable.style.top = `${rect.top}%`;
  editable.style.width = `${rect.width}%`;
  editable.style.height = `${rect.height}%`;
  editable.style.setProperty("--word-size", `${10.5 * cqwPerPt}cqw`);
  editable.style.setProperty("--word-background", "rgb(255,255,255)");
  editable.style.setProperty("--word-color", "rgb(20,20,20)");
  editable.style.setProperty(
    "--word-family",
    '"Malgun Gothic","Apple SD Gothic Neo",sans-serif',
  );
  editable.style.setProperty("--word-weight", "400");
  editable.style.setProperty("--word-style", "normal");
  const lineText = document.createElement("span");
  lineText.className = "line-text";
  editable.append(lineText);
  editable.addEventListener("click", () => openLineEditor(editable));
  editable.addEventListener("keydown", (keyEvent) => {
    if (keyEvent.key === "Enter" || keyEvent.key === " ") {
      keyEvent.preventDefault();
      openLineEditor(editable);
    }
  });
  page.append(editable);
  return editable;
}

async function convertDocuments() {
  if (!selectedFiles.length) return;
  elements.startPanel.classList.add("hidden");
  elements.editorPanel.classList.add("hidden");
  elements.progressPanel.classList.remove("hidden");
  elements.pages.replaceChildren();
  completedPages = 0;

  try {
    await ensureDependencies(selectedFiles.some(isPdf));
    const pageSources = [];
    for (const file of selectedFiles) {
      if (isPdf(file)) {
        const pages = await renderPdf(file);
        pageSources.push(...pages);
      } else {
        pageSources.push(await renderImage(file));
      }
    }
    totalPages = pageSources.length;
    const preciseRecognition = Boolean(elements.precisionOcrInput?.checked);
    const requiresOcr = preciseRecognition
      || pageSources.some((source) => !hasUsableNativeText(source.nativeWords));
    if (requiresOcr) {
      ocrWorker = await createOcrWorker();
      await ocrWorker.setParameters({
        tessedit_pageseg_mode: tesseractApi.PSM.AUTO,
        preserve_interword_spaces: "1",
        user_defined_dpi: "300",
        tessedit_do_invert: "1",
      });
    }

    for (let index = 0; index < pageSources.length; index += 1) {
      const source = pageSources[index];
      updateProgress(
        7 + (completedPages / totalPages) * 88,
        `${index + 1}/${totalPages}쪽 변환 중`,
        `${source.label}의 글자를 찾고 있어요.`,
      );
      let words;
      const hasNativeText = hasUsableNativeText(source.nativeWords);
      if (hasNativeText && !preciseRecognition) {
        words = source.nativeWords;
        updateProgress(
          7 + ((completedPages + 0.9) / totalPages) * 88,
          `${index + 1}/${totalPages}쪽 변환 중`,
          "PDF 원문 글자를 정확한 위치에 배치하고 있어요.",
        );
      } else {
        const ocrCanvas = createOcrInputCanvas(source.canvas);
        const result = await ocrWorker.recognize(ocrCanvas, {}, { tsv: true });
        const ocrWords = parseTsv(result.data.tsv, source.canvas);
        words = hasNativeText
          ? mergeNativeAndOcrWords(source.nativeWords, ocrWords)
          : ocrWords;
      }
      const pageElement = createEditablePage(source, words, index);
      elements.pages.append(pageElement);
      completedPages += 1;
    }

    if (ocrWorker) {
      await ocrWorker.terminate();
      ocrWorker = null;
    }
    updateProgress(100, "완료", "편집 문서를 만들었습니다.");
    elements.pageCountLabel.textContent = `${totalPages}쪽`;
    elements.progressPanel.classList.add("hidden");
    elements.editorPanel.classList.remove("hidden");
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (error) {
    console.error(error);
    if (ocrWorker) {
      await ocrWorker.terminate();
      ocrWorker = null;
    }
    elements.progressPanel.classList.add("hidden");
    elements.startPanel.classList.remove("hidden");
    showError(`변환 중 문제가 발생했습니다: ${error.message || error}`);
  }
}

async function renderPdf(file) {
  if (!pdfjsLib) {
    throw new Error("PDF 처리 구성요소를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.");
  }
  updateProgress(3, "PDF 페이지 준비 중", file.name);
  const data = new Uint8Array(await file.arrayBuffer());
  const documentTask = pdfjsLib.getDocument({ data, fontExtraProperties: true });
  const pdf = await documentTask.promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const targetWidth = Math.min(2200, Math.max(1500, baseViewport.width * 2));
    const viewport = page.getViewport({ scale: targetWidth / baseViewport.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({
      canvasContext: canvas.getContext("2d", { willReadFrequently: true }),
      viewport,
    }).promise;
    const textContent = await page.getTextContent();
    const fontDetails = new Map();
    for (const item of textContent.items) {
      if (!item.fontName || fontDetails.has(item.fontName)) continue;
      let fontObject = null;
      try {
        fontObject = page.commonObjs.get(item.fontName);
      } catch {
        fontObject = null;
      }
      const textStyle = textContent.styles[item.fontName] || {};
      const originalFontName = fontObject?.name || "";
      const loadedName = fontObject?.loadedName || item.fontName;
      if (fontObject?.data?.length && loadedName && !embeddedFontFaces.has(loadedName)) {
        embeddedFontFaces.set(loadedName, {
          family: loadedName,
          mimeType: fontObject.mimetype || "font/opentype",
          base64: bytesToBase64(fontObject.data),
        });
        refreshEmbeddedFontStyle();
      }
      fontDetails.set(item.fontName, {
        loadedName,
        family:
          normalizePdfFontFamily(originalFontName)
          || normalizePdfFontFamily(textStyle.fontFamily)
          || textStyle.fontFamily
          || "sans-serif",
        weight: inferFontWeight(originalFontName),
        style: /italic|oblique/i.test(originalFontName) ? "italic" : "normal",
      });
    }
    const nativeSegments = textContent.items
      .filter((item) => item.str && item.str.trim())
      .map((item) => {
        const transform = pdfjsLib.Util.transform(viewport.transform, item.transform);
        const height = Math.max(1, Math.hypot(transform[2], transform[3]));
        const fontSizePt = Math.max(1, Math.hypot(item.transform[2], item.transform[3]));
        const font = fontDetails.get(item.fontName) || {};
        return {
          x: Math.max(0, transform[4]),
          y: Math.max(0, transform[5] - height * 0.88),
          width: Math.max(height * 0.5, Math.abs(item.width * viewport.scale)),
          height,
          fontSize: height,
          fontSizePt,
          fontName: font.loadedName || item.fontName || "",
          fontFamily: font.family || "sans-serif",
          fontWeight: font.weight || 400,
          fontStyle: font.style || "normal",
          confidence: 100,
          text: item.str,
        };
      });
    const nativeWords = groupTextSegmentsIntoLines(nativeSegments, canvas);
    pages.push({ canvas, label: `${file.name} · ${pageNumber}쪽`, nativeWords });
  }
  return pages;
}

async function renderImage(file) {
  updateProgress(3, "이미지 준비 중", file.name);
  const bitmap = await createImageBitmap(file);
  const longestSide = Math.max(bitmap.width, bitmap.height);
  const desiredLongestSide = longestSide < 1800 ? 2400 : longestSide;
  const scale = Math.min(3, 3200 / longestSide, desiredLongestSide / longestSide);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d", { willReadFrequently: true }).drawImage(
    bitmap,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  bitmap.close();
  return { canvas, label: file.name };
}

function createOcrInputCanvas(sourceCanvas) {
  const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
  const image = sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
  const pixels = image.data;
  const pixelCount = sourceCanvas.width * sourceCanvas.height;
  const sampleStep = Math.max(1, Math.floor(pixelCount / 50000));
  let coloredSamples = 0;
  let sampled = 0;

  for (let pixel = 0; pixel < pixelCount; pixel += sampleStep) {
    const offset = pixel * 4;
    const red = pixels[offset];
    const green = pixels[offset + 1];
    const blue = pixels[offset + 2];
    const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);
    if (chroma >= 24 && Math.max(red, green, blue) < 245) coloredSamples += 1;
    sampled += 1;
  }

  // 일반 흑백 문서는 원본을 그대로 사용해 불필요한 화질 변화를 피합니다.
  if (!sampled || coloredSamples / sampled < 0.015) return sourceCanvas;

  const luminances = new Uint32Array(256);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const offset = pixel * 4;
    const luminance = Math.round(
      pixels[offset] * 0.2126
      + pixels[offset + 1] * 0.7152
      + pixels[offset + 2] * 0.0722,
    );
    luminances[luminance] += 1;
  }

  const percentile = (ratio) => {
    const target = pixelCount * ratio;
    let total = 0;
    for (let value = 0; value < luminances.length; value += 1) {
      total += luminances[value];
      if (total >= target) return value;
    }
    return 255;
  };
  const darkPoint = percentile(0.005);
  const lightPoint = percentile(0.995);
  const range = Math.max(32, lightPoint - darkPoint);

  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const offset = pixel * 4;
    const luminance =
      pixels[offset] * 0.2126
      + pixels[offset + 1] * 0.7152
      + pixels[offset + 2] * 0.0722;
    const normalized = Math.max(
      0,
      Math.min(255, Math.round(((luminance - darkPoint) * 255) / range)),
    );
    // 대비를 한 번 더 벌려 색 면 위의 밝은 글자와 어두운 글자를 모두 선명하게 합니다.
    const contrasted = Math.max(0, Math.min(255, Math.round((normalized - 128) * 1.22 + 128)));
    pixels[offset] = contrasted;
    pixels[offset + 1] = contrasted;
    pixels[offset + 2] = contrasted;
  }

  const enhancedCanvas = document.createElement("canvas");
  enhancedCanvas.width = sourceCanvas.width;
  enhancedCanvas.height = sourceCanvas.height;
  enhancedCanvas
    .getContext("2d", { willReadFrequently: true })
    .putImageData(image, 0, 0);
  return enhancedCanvas;
}

function hasUsableNativeText(words) {
  if (!Array.isArray(words) || words.length < 3) return false;
  return words.reduce((total, word) => total + word.text.replace(/\s/g, "").length, 0) >= 20;
}

function parseTsv(tsv, canvas) {
  if (!tsv) return [];
  const rows = tsv.trim().split(/\r?\n/);
  const lineGroups = new Map();
  for (let index = 1; index < rows.length; index += 1) {
    const columns = rows[index].split("\t");
    if (columns.length < 12 || Number(columns[0]) !== 5) continue;
    const text = columns.slice(11).join("\t").trim();
    const confidence = Number(columns[10]);
    if (!text || !Number.isFinite(confidence) || confidence < 0) continue;
    const word = {
      x: Number(columns[6]),
      y: Number(columns[7]),
      width: Number(columns[8]),
      height: Number(columns[9]),
      confidence,
      text,
    };
    const lineKey = `${columns[1]}:${columns[2]}:${columns[3]}:${columns[4]}`;
    if (!lineGroups.has(lineKey)) lineGroups.set(lineKey, []);
    lineGroups.get(lineKey).push(word);
  }
  const verticalRules = detectVerticalRules(canvas, [...lineGroups.values()].flat());
  return [...lineGroups.values()].flatMap((items) =>
    splitLineItemsIntoRegions(items, verticalRules),
  );
}

function mergeNativeAndOcrWords(nativeWords, ocrWords) {
  if (!nativeWords?.length) return ocrWords || [];
  if (!ocrWords?.length) return nativeWords;
  const overlapsNativeText = (candidate) => {
    const candidateArea = Math.max(1, candidate.width * candidate.height);
    const candidateCenterX = candidate.x + candidate.width / 2;
    const candidateCenterY = candidate.y + candidate.height / 2;
    return nativeWords.some((native) => {
      const left = Math.max(candidate.x, native.x);
      const top = Math.max(candidate.y, native.y);
      const right = Math.min(candidate.x + candidate.width, native.x + native.width);
      const bottom = Math.min(candidate.y + candidate.height, native.y + native.height);
      const overlapArea = Math.max(0, right - left) * Math.max(0, bottom - top);
      const centerCovered =
        candidateCenterX >= native.x - native.height * 0.3
        && candidateCenterX <= native.x + native.width + native.height * 0.3
        && candidateCenterY >= native.y - native.height * 0.45
        && candidateCenterY <= native.y + native.height * 1.45;
      return centerCovered || overlapArea / candidateArea > 0.32;
    });
  };
  const additions = ocrWords.filter((word) => !overlapsNativeText(word));
  return [...nativeWords, ...additions];
}

function groupTextSegmentsIntoLines(segments, canvas) {
  const sorted = [...segments].sort(
    (left, right) => left.y - right.y || left.x - right.x,
  );
  const lines = [];
  for (const segment of sorted) {
    const currentLine = lines[lines.length - 1];
    if (
      !currentLine
      || Math.abs(segment.y - currentLine.averageY)
        > Math.max(segment.height, currentLine.averageHeight) * 0.58
    ) {
      lines.push({
        items: [segment],
        averageY: segment.y,
        averageHeight: segment.height,
      });
      continue;
    }
    currentLine.items.push(segment);
    currentLine.averageY =
      currentLine.items.reduce((sum, item) => sum + item.y, 0) / currentLine.items.length;
    currentLine.averageHeight =
      currentLine.items.reduce((sum, item) => sum + item.height, 0) / currentLine.items.length;
  }
  const verticalRules = detectVerticalRules(canvas, segments);
  return lines.flatMap((line) =>
    splitLineItemsIntoRegions(line.items, verticalRules),
  );
}

function splitLineItemsIntoRegions(items, verticalRules) {
  if (!items.length) return [];
  const expandedItems = items.flatMap((item) =>
    splitItemAtVerticalRules(item, verticalRules),
  );
  const ordered = [...expandedItems].sort((left, right) => left.x - right.x);
  const averageHeight =
    ordered.reduce((sum, item) => sum + item.height, 0) / ordered.length;
  const lineTop = Math.min(...ordered.map((item) => item.y));
  const lineBottom = Math.max(...ordered.map((item) => item.y + item.height));
  const rulesAcrossLine = verticalRules.filter(
    (rule) => rule.start <= lineBottom && rule.end >= lineTop,
  );
  const isTableRow = rulesAcrossLine.length >= 2;
  const groups = [[ordered[0]]];

  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    const gapStart = previous.x + previous.width;
    const gapEnd = current.x;
    const gap = gapEnd - gapStart;
    const crossesTableRule = verticalRules.some((rule) =>
      rule.x >= gapStart - 2
      && rule.x <= gapEnd + 2
      && rule.start <= lineBottom
      && rule.end >= lineTop,
    );
    const veryLargeGap = gap > Math.max(48, averageHeight * 3.4);
    if (crossesTableRule || veryLargeGap) {
      groups.push([]);
    }
    groups[groups.length - 1].push(current);
  }
  return groups
    .filter((group) => group.length)
    .map((group) => ({
      ...mergeLineItems(group),
      isTableCell: isTableRow,
    }));
}

function splitItemAtVerticalRules(item, verticalRules) {
  const applicableRules = verticalRules.filter((rule) =>
    rule.x > item.x + item.height * 0.4
    && rule.x < item.x + item.width - item.height * 0.4
    && rule.start <= item.y + item.height
    && rule.end >= item.y,
  );
  if (!applicableRules.length || !/\s/.test(item.text)) return [item];

  const whitespaceRuns = [...item.text.matchAll(/\s+/g)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    middle: match.index + match[0].length / 2,
  }));
  const splitIndexes = [];
  for (const rule of applicableRules) {
    const expectedIndex =
      ((rule.x - item.x) / Math.max(1, item.width)) * item.text.length;
    const nearest = whitespaceRuns
      .filter((run) => !splitIndexes.includes(run.end))
      .sort(
        (left, right) =>
          Math.abs(left.middle - expectedIndex) - Math.abs(right.middle - expectedIndex),
      )[0];
    const tolerance = Math.max(2, (item.height / Math.max(1, item.width)) * item.text.length * 2.5);
    if (nearest && Math.abs(nearest.middle - expectedIndex) <= tolerance) {
      splitIndexes.push(nearest.end);
    }
  }
  if (!splitIndexes.length) return [item];

  const boundaries = [0, ...splitIndexes.sort((a, b) => a - b), item.text.length];
  const pieces = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const rawStart = boundaries[index];
    const rawEnd = boundaries[index + 1];
    const rawText = item.text.slice(rawStart, rawEnd);
    const leftWhitespace = rawText.match(/^\s*/)?.[0].length || 0;
    const rightWhitespace = rawText.match(/\s*$/)?.[0].length || 0;
    const textStart = rawStart + leftWhitespace;
    const textEnd = Math.max(textStart, rawEnd - rightWhitespace);
    const text = item.text.slice(textStart, textEnd);
    if (!text) continue;
    pieces.push({
      ...item,
      x: item.x + (textStart / item.text.length) * item.width,
      width: Math.max(
        item.height * 0.5,
        ((textEnd - textStart) / item.text.length) * item.width,
      ),
      text,
    });
  }
  return pieces.length > 1 ? pieces : [item];
}

function detectVerticalRules(canvas, textItems) {
  if (!canvas || !textItems.length) return [];
  const typicalTextHeight = medianNumber(textItems.map((item) => item.height), 18);
  const minimumRun = Math.max(26, Math.round(typicalTextHeight * 1.4));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const candidates = [];

  for (let x = 0; x < canvas.width; x += 1) {
    let runStart = 0;
    let runLength = 0;
    let gapAllowance = 0;
    const saveRun = () => {
      if (runLength >= minimumRun) {
        candidates.push({
          x,
          start: runStart,
          end: runStart + runLength,
          length: runLength,
        });
      }
    };
    for (let y = 0; y < canvas.height; y += 1) {
      const offset = (y * canvas.width + x) * 4;
      const red = pixels[offset];
      const green = pixels[offset + 1];
      const blue = pixels[offset + 2];
      const luminance = red * 0.299 + green * 0.587 + blue * 0.114;
      const neutral = Math.max(red, green, blue) - Math.min(red, green, blue) < 34;
      const isRulePixel = luminance < 218 || (neutral && luminance < 240);
      if (isRulePixel) {
        if (!runLength) runStart = y;
        runLength += gapAllowance + 1;
        gapAllowance = 0;
      } else if (runLength && gapAllowance < 1) {
        gapAllowance += 1;
      } else {
        saveRun();
        runLength = 0;
        gapAllowance = 0;
      }
    }
    saveRun();
  }

  const grouped = [];
  for (const candidate of candidates) {
    const current = grouped.find((group) =>
      candidate.x <= group.lastX + 2
      && candidate.start <= group.end + 2
      && candidate.end >= group.start - 2,
    );
    if (current) {
      current.items.push(candidate);
      current.lastX = Math.max(current.lastX, candidate.x);
      current.start = Math.min(current.start, candidate.start);
      current.end = Math.max(current.end, candidate.end);
    } else {
      grouped.push({
        items: [candidate],
        lastX: candidate.x,
        start: candidate.start,
        end: candidate.end,
      });
    }
  }
  return grouped.map((group) => {
    return {
      x: group.items.reduce((sum, item) => sum + item.x, 0) / group.items.length,
      start: group.start,
      end: group.end,
    };
  });
}

function medianNumber(values, fallback) {
  if (!values.length) return fallback;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function mergeLineItems(items) {
  const ordered = [...items].sort((left, right) => left.x - right.x);
  const left = Math.min(...ordered.map((item) => item.x));
  const top = Math.min(...ordered.map((item) => item.y));
  const right = Math.max(...ordered.map((item) => item.x + item.width));
  const bottom = Math.max(...ordered.map((item) => item.y + item.height));
  let text = "";
  let previous = null;
  for (const item of ordered) {
    if (previous) {
      const gap = item.x - (previous.x + previous.width);
      const needsSpace =
        gap > Math.max(1, Math.min(previous.height, item.height) * 0.08)
        && !/\s$/.test(text)
        && !/^[,.;:!?%)\]}]/.test(item.text);
      if (needsSpace) text += " ";
    }
    text += item.text;
    previous = item;
  }
  const styledItems = ordered.filter((item) => item.fontName || item.fontFamily);
  const dominantStyleItem = [...styledItems].sort(
    (leftItem, rightItem) => rightItem.width - leftItem.width,
  )[0];
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    fontSize: medianNumber(
      ordered.map((item) => item.fontSize || item.height),
      bottom - top,
    ),
    fontSizePt: medianNumber(
      ordered
        .map((item) => item.fontSizePt)
        .filter((value) => Number.isFinite(value)),
      0,
    ),
    fontName: dominantStyleItem?.fontName || "",
    fontFamily: dominantStyleItem?.fontFamily || "",
    fontWeight: dominantStyleItem?.fontWeight || 400,
    fontStyle: dominantStyleItem?.fontStyle || "normal",
    confidence:
      ordered.reduce((sum, item) => sum + (item.confidence || 100), 0) / ordered.length,
    text: text.trim(),
  };
}

function inferFontWeight(fontDescription) {
  if (/thin|hairline|100/i.test(fontDescription)) return 100;
  if (/extra[\s-]?light|ultra[\s-]?light|200/i.test(fontDescription)) return 200;
  if (/light|300/i.test(fontDescription)) return 300;
  if (/medium|500/i.test(fontDescription)) return 500;
  if (/semi[\s-]?bold|demi[\s-]?bold|600/i.test(fontDescription)) return 600;
  if (/extra[\s-]?bold|ultra[\s-]?bold|800/i.test(fontDescription)) return 800;
  if (/black|heavy|900/i.test(fontDescription)) return 900;
  if (/bold|700/i.test(fontDescription)) return 700;
  return 400;
}

function bytesToBase64(bytes) {
  if (typeof bytes.toBase64 === "function") return bytes.toBase64();
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return window.btoa(binary);
}

function buildEmbeddedFontCss() {
  return [...embeddedFontFaces.values()]
    .map(
      (font) =>
        `@font-face{font-family:"${font.family}";src:url(data:${font.mimeType};base64,${font.base64}) format("opentype");font-style:normal;font-weight:400;font-display:block}`,
    )
    .join("\n");
}

function refreshEmbeddedFontStyle() {
  let style = document.querySelector("#documentEmbeddedFonts");
  if (!style) {
    style = document.createElement("style");
    style.id = "documentEmbeddedFonts";
    document.head.append(style);
  }
  style.textContent = buildEmbeddedFontCss();
}

function normalizePdfFontFamily(fontName) {
  const withoutSubset = String(fontName || "").replace(/^[A-Z]{6}\+/, "");
  const withoutStyle = withoutSubset.replace(
    /[-_,]?(Thin|Hairline|ExtraLight|UltraLight|Light|Regular|Medium|SemiBold|DemiBold|Bold|ExtraBold|UltraBold|Black|Heavy|Italic|Oblique)+$/i,
    "",
  );
  const compact = withoutStyle.replace(/[\s_-]+/g, "").toLowerCase();
  const knownFamilies = {
    nanumgothic: "Nanum Gothic",
    nanummyeongjo: "Nanum Myeongjo",
    notosanskr: "Noto Sans KR",
    notoserifkr: "Noto Serif KR",
    malgungothic: "Malgun Gothic",
    applesdgothicneo: "Apple SD Gothic Neo",
  };
  return knownFamilies[compact] || withoutStyle || "";
}

function sampleColors(context, word, canvasWidth, canvasHeight) {
  const padding = Math.max(3, Math.round(word.height * 0.18));
  const x = Math.max(0, Math.floor(word.x - padding));
  const y = Math.max(0, Math.floor(word.y - padding));
  const right = Math.min(canvasWidth, Math.ceil(word.x + word.width + padding));
  const bottom = Math.min(canvasHeight, Math.ceil(word.y + word.height + padding));
  const image = context.getImageData(x, y, Math.max(1, right - x), Math.max(1, bottom - y));
  const lightPixels = [];
  const darkPixels = [];
  for (let offset = 0; offset < image.data.length; offset += 16) {
    const r = image.data[offset];
    const g = image.data[offset + 1];
    const b = image.data[offset + 2];
    const luminance = r * 0.299 + g * 0.587 + b * 0.114;
    (luminance > 145 ? lightPixels : darkPixels).push([r, g, b]);
  }
  return {
    background: medianColor(lightPixels, [255, 255, 255]),
    foreground: medianColor(darkPixels, [20, 20, 20]),
    fontWeight: estimateRasterFontWeight(
      darkPixels.length,
      lightPixels.length,
      word.text.length,
    ),
    rect: { x, y, right, bottom },
  };
}

function estimateRasterFontWeight(darkPixelCount, lightPixelCount, textLength) {
  const sampledPixelCount = Math.max(1, darkPixelCount + lightPixelCount);
  const inkRatio = darkPixelCount / sampledPixelCount;
  const adjustedRatio = inkRatio * Math.max(1, Math.min(2.2, textLength / 4));
  if (adjustedRatio > 0.34) return 700;
  if (adjustedRatio > 0.25) return 600;
  if (adjustedRatio > 0.18) return 500;
  return 400;
}

function medianColor(colors, fallback) {
  if (!colors.length) return `rgb(${fallback.join(",")})`;
  const channels = [0, 1, 2].map((channel) => {
    const values = colors.map((color) => color[channel]).sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)];
  });
  return `rgb(${channels.join(",")})`;
}

function createEditablePage(source, words, index) {
  const workingCanvas = document.createElement("canvas");
  workingCanvas.width = source.canvas.width;
  workingCanvas.height = source.canvas.height;
  const context = workingCanvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(source.canvas, 0, 0);

  const wordStyles = words.map((word) => {
    return sampleColors(context, word, workingCanvas.width, workingCanvas.height);
  });

  const shell = document.createElement("article");
  shell.className = "page-shell";
  const label = document.createElement("div");
  label.className = "page-label no-print";
  label.textContent = source.label;

  const page = document.createElement("div");
  page.className = "document-page";
  page.dataset.page = String(index + 1);
  page.dataset.canvasWidth = String(workingCanvas.width);
  page.dataset.canvasHeight = String(workingCanvas.height);
  page.style.aspectRatio = `${workingCanvas.width} / ${workingCanvas.height}`;

  const background = document.createElement("img");
  background.className = "page-background";
  background.alt = "";
  background.src = workingCanvas.toDataURL("image/jpeg", 0.94);
  page.append(background);

  words.forEach((word, wordIndex) => {
    const editable = document.createElement("span");
    editable.className = "editable-word";
    if (word.isTableCell) editable.classList.add("table-cell-region");
    editable.tabIndex = 0;
    editable.setAttribute("role", "button");
    editable.setAttribute("aria-label", "이 문장 또는 표 칸 수정");
    editable.dataset.word = String(wordIndex);
    editable.dataset.editId = `${index}-${wordIndex}`;
    editable.dataset.original = word.text;
    editable.dataset.tableCell = word.isTableCell ? "true" : "false";
    const renderedFontSize = word.fontSize || word.height * 1.02;
    const originalFontSizePt = word.fontSizePt || (
      (renderedFontSize / workingCanvas.width) * 920 * 0.75
    );
    const fontSizeCqw = (renderedFontSize / workingCanvas.width) * 100;
    editable.dataset.fontSizePt = String(Math.round(originalFontSizePt * 10) / 10);
    editable.dataset.cqwPerPt = String(fontSizeCqw / Math.max(1, originalFontSizePt));
    editable.style.left = `${(word.x / workingCanvas.width) * 100}%`;
    editable.style.top = `${(word.y / workingCanvas.height) * 100}%`;
    editable.style.width = `${(Math.max(word.width, word.height) / workingCanvas.width) * 100}%`;
    editable.style.height = `${(Math.max(word.height, 1) / workingCanvas.height) * 100}%`;
    editable.style.setProperty(
      "--word-size",
      `${fontSizeCqw}cqw`,
    );
    editable.style.setProperty("--word-background", wordStyles[wordIndex].background);
    editable.style.setProperty("--word-color", wordStyles[wordIndex].foreground);
    editable.style.setProperty("--word-family", buildFontFamily(word));
    editable.style.setProperty(
      "--word-weight",
      String(word.fontName ? (word.fontWeight || 400) : wordStyles[wordIndex].fontWeight),
    );
    editable.style.setProperty("--word-style", word.fontStyle || "normal");

    const lineText = document.createElement("span");
    lineText.className = "line-text";
    lineText.textContent = word.text;
    editable.append(lineText);

    editable.addEventListener("click", () => openLineEditor(editable));
    editable.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openLineEditor(editable);
      }
    });
    page.append(editable);
  });

  shell.append(label, page);
  return shell;
}

function buildFontFamily(word) {
  const families = [];
  if (word.fontFamily) families.push(quoteFontFamily(word.fontFamily));
  if (word.fontName) families.push(quoteFontFamily(word.fontName));
  families.push('"Malgun Gothic"', '"Apple SD Gothic Neo"', "sans-serif");
  return [...new Set(families)].join(", ");
}

function quoteFontFamily(fontFamily) {
  const normalized = String(fontFamily).trim();
  if (/^(serif|sans-serif|monospace|cursive|fantasy|system-ui)$/i.test(normalized)) {
    return normalized;
  }
  return `"${normalized.replace(/["\\]/g, "")}"`;
}

function getLineText(editable) {
  return editable?.querySelector(".line-text");
}

function collectEditingGroup(editable) {
  if (editable.dataset.tableCell === "true" || editable.dataset.manual === "true") {
    return [editable];
  }
  const page = editable.closest(".document-page");
  const candidates = [...page.querySelectorAll(".editable-word")]
    .filter((item) => item.dataset.tableCell !== "true")
    .sort((left, right) => left.offsetTop - right.offsetTop || left.offsetLeft - right.offsetLeft);
  const startIndex = candidates.indexOf(editable);
  if (startIndex < 0) return [editable];
  const isCompatible = (upper, lower) => {
    const upperSize = Number(upper.dataset.fontSizePt) || 0;
    const lowerSize = Number(lower.dataset.fontSizePt) || 0;
    const verticalGap =
      lower.offsetTop - (upper.offsetTop + Math.max(1, upper.offsetHeight));
    const maximumGap = Math.max(upper.offsetHeight, lower.offsetHeight) * 0.95;
    const maximumLeftDifference = Math.max(18, page.clientWidth * 0.035);
    return verticalGap >= -Math.max(upper.offsetHeight, lower.offsetHeight) * 0.25
      && verticalGap <= maximumGap
      && Math.abs(upper.offsetLeft - lower.offsetLeft) <= maximumLeftDifference
      && Math.abs(upperSize - lowerSize) <= 0.25
      && upper.style.getPropertyValue("--word-family")
        === lower.style.getPropertyValue("--word-family")
      && upper.style.getPropertyValue("--word-weight")
        === lower.style.getPropertyValue("--word-weight")
      && upper.style.getPropertyValue("--word-color")
        === lower.style.getPropertyValue("--word-color");
  };
  let first = startIndex;
  let last = startIndex;
  while (first > 0 && isCompatible(candidates[first - 1], candidates[first])) first -= 1;
  while (
    last < candidates.length - 1
    && isCompatible(candidates[last], candidates[last + 1])
  ) last += 1;
  return candidates.slice(first, last + 1);
}

function selectedEditorLines(range = editorSelectionRange) {
  if (!range) return [];
  return [...elements.lineEditorInput.querySelectorAll(".editor-source-line")]
    .filter((line) => {
      try {
        return range.intersectsNode(line);
      } catch {
        return false;
      }
    });
}

function updateOriginalSizeHint(range = editorSelectionRange) {
  const lines = selectedEditorLines(range);
  if (!lines.length) return;
  const sizes = [...new Set(lines.map((line) => Number(line.dataset.fontSizePt)))]
    .filter(Number.isFinite)
    .sort((left, right) => right - left);
  if (!sizes.length) return;
  elements.fontSizeInput.value = String(sizes[0]);
  elements.originalSizeHint.textContent = sizes.length === 1
    ? `원본 ${sizes[0]}pt`
    : `원본 ${sizes.map((size) => `${size}pt`).join(" · ")}`;
}

function rememberEditorSelection() {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  const container = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
    ? range.commonAncestorContainer.parentElement
    : range.commonAncestorContainer;
  if (container && elements.lineEditorInput.contains(container)) {
    editorSelectionRange = range.cloneRange();
    updateOriginalSizeHint(range);
  }
}

function selectAllEditorText() {
  const range = document.createRange();
  range.selectNodeContents(elements.lineEditorInput);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  editorSelectionRange = range.cloneRange();
  updateOriginalSizeHint(range);
}

function selectedTextSegments(range) {
  const walker = document.createTreeWalker(
    elements.lineEditorInput,
    NodeFilter.SHOW_TEXT,
  );
  const segments = [];
  let textNode = walker.nextNode();
  while (textNode) {
    if (
      textNode.textContent
      && textNode.parentElement?.closest(".editor-source-line")
      && range.intersectsNode(textNode)
    ) {
      const start = textNode === range.startContainer ? range.startOffset : 0;
      const end = textNode === range.endContainer
        ? range.endOffset
        : textNode.textContent.length;
      if (end > start) segments.push({ textNode, start, end });
    }
    textNode = walker.nextNode();
  }
  return segments;
}

function applyStylesToEditorSelection(styleBuilder, dataBuilder = null) {
  if (!editorSelectionRange || editorSelectionRange.collapsed) {
    showError("편집창에서 서식을 바꿀 글자를 먼저 드래그해 선택해 주세요.");
    return false;
  }
  const range = editorSelectionRange.cloneRange();
  const segments = selectedTextSegments(range);
  if (!segments.length) {
    showError("선택한 부분에 서식을 적용하지 못했습니다. 글자를 다시 선택해 주세요.");
    return false;
  }
  const wrappers = [];
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    const sourceLine = segment.textNode.parentElement.closest(".editor-source-line");
    const part = document.createRange();
    part.setStart(segment.textNode, segment.start);
    part.setEnd(segment.textNode, segment.end);
    const wrapper = document.createElement("span");
    const styles = typeof styleBuilder === "function"
      ? styleBuilder(sourceLine, segment.textNode)
      : styleBuilder;
    Object.assign(wrapper.style, styles);
    const data = typeof dataBuilder === "function"
      ? dataBuilder(sourceLine, segment.textNode)
      : dataBuilder;
    if (data) Object.assign(wrapper.dataset, data);
    wrapper.append(part.extractContents());
    part.insertNode(wrapper);
    wrappers.unshift(wrapper);
  }
  const selection = window.getSelection();
  const updatedRange = document.createRange();
  updatedRange.setStartBefore(wrappers[0]);
  updatedRange.setEndAfter(wrappers[wrappers.length - 1]);
  selection.removeAllRanges();
  selection.addRange(updatedRange);
  editorSelectionRange = updatedRange.cloneRange();
  return true;
}

function applyStyleToEditorSelection(property, value, data = null, label = "서식") {
  if (applyStylesToEditorSelection({ [property]: value }, data)) {
    showFormatStatus(label);
  }
}

function applyNumericFontSize() {
  const fontSizePt = Number(elements.fontSizeInput.value);
  if (!Number.isFinite(fontSizePt) || fontSizePt < 6 || fontSizePt > 72) {
    showError("글자 크기는 6pt에서 72pt 사이로 입력해 주세요.");
    return;
  }
  const applied = applyStylesToEditorSelection(
    { fontSize: `${fontSizePt}pt` },
    { fontSizePt: String(fontSizePt) },
  );
  if (applied) showFormatStatus(`${fontSizePt}pt 크기`);
}

function adjustFontSize(delta) {
  const current = Number(elements.fontSizeInput.value) || 10.5;
  const next = Math.max(6, Math.min(72, Math.round((current + delta) * 2) / 2));
  elements.fontSizeInput.value = String(next);
  applyNumericFontSize();
}

function clearEditorSelectionFormat() {
  applyStylesToEditorSelection({
    fontFamily: "var(--word-family, inherit)",
    fontSize: "var(--word-size, inherit)",
    fontWeight: "var(--word-weight, inherit)",
    fontStyle: "var(--word-style, inherit)",
    color: "var(--word-color, inherit)",
  });
}

function sanitizeEditorHtml(editor, targetEditable) {
  const output = document.createElement("div");
  const allowedStyles = [
    "fontFamily",
    "fontSize",
    "fontWeight",
    "fontStyle",
    "color",
  ];
  const copyNode = (node, parent) => {
    if (node.nodeType === Node.TEXT_NODE) {
      parent.append(document.createTextNode(node.textContent));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.tagName === "BR") {
      parent.append(document.createTextNode(" "));
      return;
    }
    const wrapper = document.createElement("span");
    let hasStyle = false;
    for (const property of allowedStyles) {
      const dataValue = {
        fontFamily: node.dataset?.fontFamily,
        fontWeight: node.dataset?.fontWeight,
        color: node.dataset?.fontColor,
      }[property];
      let value = dataValue || node.style?.[property] || "";
      if (!value || /url\s*\(|expression|[<>]/i.test(value)) continue;
      if (property === "fontSize" && node.dataset?.fontSizePt) {
        const fontSizePt = Number(node.dataset.fontSizePt);
        const cqwPerPt = Number(targetEditable.dataset.cqwPerPt);
        if (Number.isFinite(fontSizePt) && Number.isFinite(cqwPerPt) && cqwPerPt > 0) {
          value = `${fontSizePt * cqwPerPt}cqw`;
        }
      }
      const cssProperty = property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
      wrapper.style.setProperty(cssProperty, value, "important");
      hasStyle = true;
    }
    for (const key of ["fontFamily", "fontSizePt", "fontWeight", "fontColor"]) {
      if (node.dataset?.[key]) wrapper.dataset[key] = node.dataset[key];
    }
    const target = hasStyle ? wrapper : parent;
    for (const child of node.childNodes) copyNode(child, target);
    if (hasStyle && wrapper.textContent) parent.append(wrapper);
    if (/^(DIV|P|LI)$/.test(node.tagName)) {
      parent.append(document.createTextNode(" "));
    }
  };
  for (const child of editor.childNodes) copyNode(child, output);
  return output.innerHTML;
}

function openLineEditor(editable) {
  activeEditable = editable;
  activeEditables = collectEditingGroup(editable);
  if (elements.formatApplyStatus) {
    elements.formatApplyStatus.textContent =
      "한 줄 또는 여러 줄에서 원하는 글자만 드래그한 다음 서식을 선택하세요.";
    elements.formatApplyStatus.classList.remove("applied");
  }
  elements.lineEditorInput.replaceChildren();
  for (const target of activeEditables) {
    const sourceLine = document.createElement("div");
    sourceLine.className = "editor-source-line";
    sourceLine.dataset.editId = target.dataset.editId;
    sourceLine.dataset.fontSizePt = target.dataset.fontSizePt;
    sourceLine.dataset.cqwPerPt = target.dataset.cqwPerPt;
    sourceLine.style.setProperty(
      "--word-family",
      target.style.getPropertyValue("--word-family"),
    );
    sourceLine.style.setProperty("--word-size", `${target.dataset.fontSizePt}pt`);
    sourceLine.style.setProperty(
      "--word-weight",
      target.style.getPropertyValue("--word-weight"),
    );
    sourceLine.style.setProperty(
      "--word-style",
      target.style.getPropertyValue("--word-style"),
    );
    sourceLine.style.setProperty(
      "--word-color",
      target.style.getPropertyValue("--word-color"),
    );
    sourceLine.style.fontFamily = "var(--word-family)";
    sourceLine.style.fontSize = "var(--word-size)";
    sourceLine.style.fontWeight = "var(--word-weight)";
    sourceLine.style.fontStyle = "var(--word-style)";
    sourceLine.style.color = "var(--word-color)";
    sourceLine.innerHTML = getLineText(target)?.innerHTML || "";
    const cqwPerPt = Number(target.dataset.cqwPerPt);
    sourceLine.querySelectorAll("[style]").forEach((element) => {
      const fontSize = element.style.fontSize;
      if (fontSize.endsWith("cqw") && Number.isFinite(cqwPerPt) && cqwPerPt) {
        const fontSizePt = Number.parseFloat(fontSize) / cqwPerPt;
        element.style.setProperty("font-size", `${fontSizePt}pt`, "important");
        element.dataset.fontSizePt = String(fontSizePt);
      }
    });
    elements.lineEditorInput.append(sourceLine);
  }
  elements.lineEditor.classList.remove("hidden");
  window.setTimeout(() => {
    elements.lineEditorInput.focus();
    selectAllEditorText();
  }, 0);
}

function closeLineEditor() {
  if (activeEditable) {
    activeEditable.blur();
  }
  activeEditable = null;
  activeEditables = [];
  editorSelectionRange = null;
  elements.lineEditor.classList.add("hidden");
  elements.lineEditorInput.replaceChildren();
}

function applyEditedLine() {
  if (!activeEditables.length) return;
  let appliedCount = 0;
  for (const sourceLine of elements.lineEditorInput.querySelectorAll(".editor-source-line")) {
    const editable = activeEditables.find(
      (item) => item.dataset.editId === sourceLine.dataset.editId,
    );
    if (!editable) continue;
    const lineText = getLineText(editable);
    if (!lineText) continue;
    const appliedHtml = sanitizeEditorHtml(sourceLine, editable);
    lineText.innerHTML = appliedHtml;
    editable.dataset.appliedHtml = appliedHtml;
    syncModifiedLine(editable);
    fitLineText(editable);
    appliedCount += 1;
  }
  closeLineEditor();
  if (appliedCount) {
    showSuccess(`${appliedCount}개 줄에 글꼴·글자 크기 서식이 적용되었습니다.`);
  }
}

function resetEditedLine() {
  if (!activeEditables.length) return;
  for (const editable of activeEditables) {
    const lineText = getLineText(editable);
    if (!lineText) continue;
    lineText.textContent = editable.dataset.original || "";
    syncModifiedLine(editable);
    fitLineText(editable);
  }
  closeLineEditor();
}

function syncModifiedLine(editable) {
  const current = getLineText(editable)?.textContent.trim() || "";
  const original = (editable.dataset.original || "").trim();
  const hasFormatting = Boolean(getLineText(editable)?.querySelector("[style]"));
  editable.classList.toggle("modified", current !== original || hasFormatting);
}

function fitLineText(editable) {
  const lineText = getLineText(editable);
  if (!lineText) return;
  lineText.style.transform = "scaleX(1)";
  const hasUserFormatting = Boolean(
    lineText.querySelector(
      "[data-font-family],[data-font-size-pt],[data-font-weight],[data-font-color]",
    ),
  );
  if (hasUserFormatting) return;
  window.requestAnimationFrame(() => {
    const availableWidth = Math.max(1, editable.clientWidth);
    const naturalWidth = Math.max(1, lineText.scrollWidth);
    const scale = Math.min(1, availableWidth / naturalWidth);
    lineText.style.transform = `scaleX(${scale})`;
  });
}

function collectPageText(page) {
  const entries = [...page.querySelectorAll(".editable-word")]
    .map((editable) => ({
      left: editable.offsetLeft,
      top: editable.offsetTop,
      height: Math.max(1, editable.offsetHeight),
      text: getLineText(editable)?.textContent.trim() || "",
    }))
    .filter((entry) => entry.text)
    .sort((left, right) => left.top - right.top || left.left - right.left);
  const rows = [];
  for (const entry of entries) {
    const row = rows[rows.length - 1];
    if (
      !row
      || Math.abs(entry.top - row.averageTop)
        > Math.max(entry.height, row.averageHeight) * 0.58
    ) {
      rows.push({
        entries: [entry],
        averageTop: entry.top,
        averageHeight: entry.height,
      });
      continue;
    }
    row.entries.push(entry);
    row.averageTop =
      row.entries.reduce((sum, item) => sum + item.top, 0) / row.entries.length;
    row.averageHeight =
      row.entries.reduce((sum, item) => sum + item.height, 0) / row.entries.length;
  }
  return rows
    .map((row) =>
      row.entries
        .sort((left, right) => left.left - right.left)
        .map((entry) => entry.text)
        .join(row.entries.length > 1 ? "\t" : ""),
    )
    .join("\n");
}

function downloadPlainText() {
  const pages = [...elements.pages.querySelectorAll(".document-page")];
  if (!pages.length) return;
  const text = pages
    .map((page, index) => `[${index + 1}쪽]\n${collectPageText(page)}`)
    .join("\n\n");
  const title = selectedFiles.length === 1
    ? selectedFiles[0].name.replace(/\.[^.]+$/, "")
    : "원본문서";
  const blob = new Blob([`\uFEFF${text}`], { type: "text/plain;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${title}_텍스트.txt`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function downloadEditableHtml() {
  const pageShells = [...elements.pages.querySelectorAll(".page-shell")].map(
    (page) => page.outerHTML,
  );
  if (!pageShells.length) return;
  const title = selectedFiles.length === 1
    ? selectedFiles[0].name.replace(/\.[^.]+$/, "")
    : "원본문서_편집본";
  const html = buildStandaloneHtml(title, pageShells.join("\n"));
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${title}_편집본.html`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function buildStandaloneHtml(title, pagesHtml) {
  const editorStyles = `
${buildEmbeddedFontCss()}
*{box-sizing:border-box}html,body{margin:0;min-height:100%}
body{font-family:"Malgun Gothic",sans-serif;background:#e9ecef;color:#212529}
.toolbar{position:sticky;top:0;z-index:100;display:flex;justify-content:center;gap:9px;padding:12px;background:#fff;border-bottom:1px solid #ddd}
button{padding:10px 15px;border:0;border-radius:9px;color:#fff;background:#ff922b;font:700 14px "Malgun Gothic";cursor:pointer}
button.blue{background:#4c6ef5}.toolbar button.secondary{color:#495057;background:#e9ecef}.help{text-align:center;color:#666;font-size:13px;padding:12px}
.pages{display:grid;gap:30px;justify-items:center;padding:18px}.page-shell{width:min(100%,920px)}
.page-label{margin:0 0 6px;color:#666;font-size:12px}.document-page{position:relative;width:100%;overflow:hidden;container-type:inline-size;background:#fff;box-shadow:0 8px 30px #0003}
.page-background{position:absolute;inset:0;width:100%;height:100%;object-fit:fill;pointer-events:none}
.editable-word{position:absolute;z-index:2;min-width:1.2em;min-height:1.1em;padding:0 .06em;overflow:visible;color:transparent;background:transparent;font-family:var(--word-family,"Malgun Gothic",sans-serif);font-size:var(--word-size);font-style:var(--word-style,normal);font-weight:var(--word-weight,400);font-synthesis:none;line-height:1.08;white-space:nowrap;outline:0}
.line-text{display:inline-block;color:transparent;transform-origin:left center;white-space:nowrap}.editable-word:hover{outline:1px dashed #4c6ef5}.editable-word:focus{z-index:5;outline:2px solid #4c6ef5}.editable-word.modified{z-index:4;background:var(--word-background,#fff)}.editable-word.modified .line-text{color:var(--word-color,#111)}
.line-editor{position:fixed;right:24px;bottom:24px;left:24px;z-index:200;width:min(860px,calc(100% - 48px));margin:auto;padding:16px;background:#fffffff7;border:1px solid #ced4da;border-radius:16px;box-shadow:0 18px 55px #0004}.line-editor strong{display:block;margin-bottom:9px}.format-toolbar{display:flex;align-items:end;flex-wrap:wrap;gap:7px;margin-bottom:8px}.format-toolbar label{display:grid;gap:2px;color:#6b7280;font-size:10px}.format-toolbar select,.format-toolbar input[type=number]{height:34px;min-width:92px;padding:0 8px;border:1px solid #ced4da;border-radius:7px;background:#fff}.format-toolbar small{color:#6b7280;font-size:10px}.format-toolbar button{height:34px;padding:0 10px;color:#364152;background:#f1f3f5;border:1px solid #ced4da}.format-toolbar input[type=color]{width:44px;height:34px;padding:3px;border:1px solid #ced4da;border-radius:7px;background:#fff}.line-editor-input{width:100%;min-height:76px;max-height:220px;overflow:auto;padding:11px 13px;border:2px solid #bac8ff;border-radius:10px;font:16px/1.55 "Malgun Gothic",sans-serif;white-space:pre-wrap;outline:0}.editor-source-line{min-height:1.55em;white-space:pre-wrap}.format-help{margin:5px 1px;color:#6b7280;font-size:11px}.line-editor-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:9px}.line-editor button.secondary{color:#495057;background:#e9ecef}
.hidden{display:none!important}
@media print{@page{margin:0}body,.pages{margin:0;padding:0;background:#fff}.no-print{display:none!important}.page-shell{width:100%;break-after:page;page-break-after:always}.page-shell:last-child{break-after:auto}.page-label{display:none}.document-page{box-shadow:none}.editable-word{outline:0!important}}
`;
  const script = `
let activeLines = [];
let savedRange = null;
const panel = document.querySelector('#standaloneLineEditor');
const input = document.querySelector('#standaloneLineInput');
const family = document.querySelector('#standaloneFontFamily');
const size = document.querySelector('#standaloneFontSize');
const sizeHint = document.querySelector('#standaloneSizeHint');
const sizeDown = document.querySelector('#standaloneSizeDown');
const sizeApply = document.querySelector('#standaloneSizeApply');
const sizeUp = document.querySelector('#standaloneSizeUp');
const bold = document.querySelector('#standaloneBold');
const color = document.querySelector('#standaloneColor');
const clearFormat = document.querySelector('#standaloneClearFormat');
const lineText = el => el && el.querySelector('.line-text');

function fit(el) {
  const text = lineText(el);
  if (!text) return;
  text.style.transform = 'scaleX(1)';
  if (text.querySelector(
    '[data-font-family],[data-font-size-pt],[data-font-weight],[data-font-color]'
  )) return;
  requestAnimationFrame(() => {
    text.style.transform = 'scaleX(' +
      Math.min(1, Math.max(1, el.clientWidth) / Math.max(1, text.scrollWidth)) + ')';
  });
}

function collectGroup(el) {
  if (el.dataset.tableCell === 'true') return [el];
  const page = el.closest('.document-page');
  const items = [...page.querySelectorAll('.editable-word')]
    .filter(item => item.dataset.tableCell !== 'true')
    .sort((a, b) => a.offsetTop - b.offsetTop || a.offsetLeft - b.offsetLeft);
  const start = items.indexOf(el);
  if (start < 0) return [el];
  const compatible = (a, b) => {
    const gap = b.offsetTop - (a.offsetTop + Math.max(1, a.offsetHeight));
    return gap >= -Math.max(a.offsetHeight, b.offsetHeight) * .25 &&
      gap <= Math.max(a.offsetHeight, b.offsetHeight) * .95 &&
      Math.abs(a.offsetLeft - b.offsetLeft) <= Math.max(18, page.clientWidth * .035) &&
      Math.abs((+a.dataset.fontSizePt || 0) - (+b.dataset.fontSizePt || 0)) <= .25 &&
      a.style.getPropertyValue('--word-family') === b.style.getPropertyValue('--word-family') &&
      a.style.getPropertyValue('--word-weight') === b.style.getPropertyValue('--word-weight') &&
      a.style.getPropertyValue('--word-color') === b.style.getPropertyValue('--word-color');
  };
  let first = start, last = start;
  while (first > 0 && compatible(items[first - 1], items[first])) first--;
  while (last < items.length - 1 && compatible(items[last], items[last + 1])) last++;
  return items.slice(first, last + 1);
}

function editorLines(range = savedRange) {
  if (!range) return [];
  return [...input.querySelectorAll('.editor-source-line')].filter(line => {
    try { return range.intersectsNode(line); } catch { return false; }
  });
}

function updateSize(range = savedRange) {
  const sizes = [...new Set(editorLines(range).map(line => +line.dataset.fontSizePt))]
    .filter(Number.isFinite).sort((a, b) => b - a);
  if (!sizes.length) return;
  size.value = String(sizes[0]);
  sizeHint.textContent = sizes.length === 1
    ? '원본 ' + sizes[0] + 'pt'
    : '원본 ' + sizes.map(value => value + 'pt').join(' · ');
}

function remember() {
  const selection = getSelection();
  if (!selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  const node = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
    ? range.commonAncestorContainer.parentElement : range.commonAncestorContainer;
  if (node && input.contains(node)) {
    savedRange = range.cloneRange();
    updateSize(range);
  }
}

function selectAllText() {
  const range = document.createRange();
  range.selectNodeContents(input);
  const selection = getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  savedRange = range.cloneRange();
  updateSize(range);
}

function segments(range) {
  const walker = document.createTreeWalker(input, NodeFilter.SHOW_TEXT);
  const found = [];
  let node = walker.nextNode();
  while (node) {
    if (node.textContent && node.parentElement?.closest('.editor-source-line') && range.intersectsNode(node)) {
      const start = node === range.startContainer ? range.startOffset : 0;
      const end = node === range.endContainer ? range.endOffset : node.textContent.length;
      if (end > start) found.push({ node, start, end });
    }
    node = walker.nextNode();
  }
  return found;
}

function applyStyles(styles, data = null) {
  if (!savedRange || savedRange.collapsed) {
    alert('서식을 바꿀 글자를 먼저 드래그해 선택해 주세요.');
    return;
  }
  const parts = segments(savedRange.cloneRange());
  const wrappers = [];
  for (let index = parts.length - 1; index >= 0; index--) {
    const part = document.createRange();
    part.setStart(parts[index].node, parts[index].start);
    part.setEnd(parts[index].node, parts[index].end);
    const span = document.createElement('span');
    const sourceLine = parts[index].node.parentElement.closest('.editor-source-line');
    const resolvedStyles = typeof styles === 'function'
      ? styles(sourceLine, parts[index].node)
      : styles;
    const resolvedData = typeof data === 'function'
      ? data(sourceLine, parts[index].node)
      : data;
    Object.assign(span.style, resolvedStyles);
    if (resolvedData) Object.assign(span.dataset, resolvedData);
    span.append(part.extractContents());
    part.insertNode(span);
    wrappers.unshift(span);
  }
  if (!wrappers.length) return;
  const next = document.createRange();
  next.setStartBefore(wrappers[0]);
  next.setEndAfter(wrappers[wrappers.length - 1]);
  const selection = getSelection();
  selection.removeAllRanges();
  selection.addRange(next);
  savedRange = next.cloneRange();
}

function sanitize(root, targetEl) {
  const output = document.createElement('div');
  const allowed = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'color'];
  function copy(node, parent) {
    if (node.nodeType === Node.TEXT_NODE) {
      parent.append(document.createTextNode(node.textContent));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.tagName === 'BR') {
      parent.append(document.createTextNode(' '));
      return;
    }
    const span = document.createElement('span');
    let styled = false;
    for (const prop of allowed) {
      const dataValue = {
        fontFamily: node.dataset?.fontFamily,
        fontWeight: node.dataset?.fontWeight,
        color: node.dataset?.fontColor
      }[prop];
      let value = dataValue || node.style?.[prop] || '';
      if (!value || /url\\s*\\(|expression|[<>]/i.test(value)) continue;
      if (prop === 'fontSize' && node.dataset?.fontSizePt) {
        const ratio = +targetEl.dataset.cqwPerPt;
        if (ratio > 0) value = (+node.dataset.fontSizePt * ratio) + 'cqw';
      }
      const cssProp = prop.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase());
      span.style.setProperty(cssProp, value, 'important');
      styled = true;
    }
    for (const key of ['fontFamily', 'fontSizePt', 'fontWeight', 'fontColor']) {
      if (node.dataset?.[key]) span.dataset[key] = node.dataset[key];
    }
    const destination = styled ? span : parent;
    for (const child of node.childNodes) copy(child, destination);
    if (styled && span.textContent) parent.append(span);
  }
  for (const child of root.childNodes) copy(child, output);
  return output.innerHTML;
}

function openLine(el) {
  activeLines = collectGroup(el);
  input.replaceChildren();
  for (const target of activeLines) {
    const row = document.createElement('div');
    row.className = 'editor-source-line';
    row.dataset.editId = target.dataset.editId;
    row.dataset.fontSizePt = target.dataset.fontSizePt;
    row.dataset.cqwPerPt = target.dataset.cqwPerPt;
    row.style.setProperty('--word-family', target.style.getPropertyValue('--word-family'));
    row.style.setProperty('--word-size', target.dataset.fontSizePt + 'pt');
    row.style.setProperty('--word-weight', target.style.getPropertyValue('--word-weight'));
    row.style.setProperty('--word-style', target.style.getPropertyValue('--word-style'));
    row.style.setProperty('--word-color', target.style.getPropertyValue('--word-color'));
    row.style.fontFamily = 'var(--word-family)';
    row.style.fontSize = 'var(--word-size)';
    row.style.fontWeight = 'var(--word-weight)';
    row.style.fontStyle = 'var(--word-style)';
    row.style.color = 'var(--word-color)';
    row.innerHTML = lineText(target)?.innerHTML || '';
    const ratio = +target.dataset.cqwPerPt;
    row.querySelectorAll('[style]').forEach(node => {
      if (node.style.fontSize.endsWith('cqw') && ratio) {
        const pt = parseFloat(node.style.fontSize) / ratio;
        node.style.setProperty('font-size', pt + 'pt', 'important');
        node.dataset.fontSizePt = String(pt);
      }
    });
    input.append(row);
  }
  panel.classList.remove('hidden');
  setTimeout(() => { input.focus(); selectAllText(); }, 0);
}

function closeLine() {
  activeLines = [];
  savedRange = null;
  panel.classList.add('hidden');
  input.replaceChildren();
}

function sync(el) {
  const text = lineText(el);
  el.classList.toggle('modified',
    (text?.textContent.trim() || '') !== (el.dataset.original || '').trim() ||
    !!text?.querySelector('[style]'));
}

function applyLine() {
  for (const row of input.querySelectorAll('.editor-source-line')) {
    const el = activeLines.find(item => item.dataset.editId === row.dataset.editId);
    if (!el) continue;
    lineText(el).innerHTML = sanitize(row, el);
    sync(el);
    fit(el);
  }
  closeLine();
}

function resetLine() {
  for (const el of activeLines) {
    lineText(el).textContent = el.dataset.original || '';
    sync(el);
    fit(el);
  }
  closeLine();
}

document.querySelectorAll('.editable-word').forEach(el => {
  el.contentEditable = 'false';
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  el.addEventListener('click', () => openLine(el));
  el.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openLine(el);
    }
  });
  if (el.classList.contains('modified')) fit(el);
});
for (const eventName of ['mouseup', 'keyup', 'input', 'focus']) input.addEventListener(eventName, remember);
family.addEventListener('change', () => {
  if (family.value) {
    applyStyles(
      { fontFamily: family.value },
      { fontFamily: family.value }
    );
  }
  family.value = '';
});
function applyStandaloneSize() {
  const pt = +size.value;
  if (pt >= 6 && pt <= 72) {
    applyStyles(
      { fontSize: pt + 'pt' },
      { fontSizePt: String(pt) }
    );
  }
}
function adjustStandaloneSize(delta) {
  const next = Math.max(6, Math.min(72, Math.round(((+size.value || 10.5) + delta) * 2) / 2));
  size.value = String(next);
  applyStandaloneSize();
}
size.addEventListener('change', applyStandaloneSize);
size.addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    event.preventDefault();
    applyStandaloneSize();
  }
});
[sizeDown, sizeApply, sizeUp].forEach(button =>
  button.addEventListener('mousedown', event => event.preventDefault())
);
sizeDown.addEventListener('click', () => adjustStandaloneSize(-1));
sizeApply.addEventListener('click', applyStandaloneSize);
sizeUp.addEventListener('click', () => adjustStandaloneSize(1));
bold.addEventListener('mousedown', event => event.preventDefault());
bold.addEventListener('click', () =>
  applyStyles({ fontWeight: '700' }, { fontWeight: '700' })
);
color.addEventListener('change', () =>
  applyStyles({ color: color.value }, { fontColor: color.value })
);
clearFormat.addEventListener('mousedown', event => event.preventDefault());
clearFormat.addEventListener('click', () => applyStyles({
  fontFamily: 'var(--word-family, inherit)',
  fontSize: 'var(--word-size, inherit)',
  fontWeight: 'var(--word-weight, inherit)',
  fontStyle: 'var(--word-style, inherit)',
  color: 'var(--word-color, inherit)'
}));
input.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeLine();
  }
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    applyLine();
  }
});
window.addEventListener('resize', () => document.querySelectorAll('.editable-word.modified').forEach(fit));
if (document.fonts?.ready) document.fonts.ready.then(() => document.querySelectorAll('.editable-word.modified').forEach(fit));
function pageText(page){const entries=[...page.querySelectorAll('.editable-word')].map(el=>({left:el.offsetLeft,top:el.offsetTop,height:Math.max(1,el.offsetHeight),text:lineText(el)?.textContent.trim()||''})).filter(x=>x.text).sort((a,b)=>a.top-b.top||a.left-b.left);const rows=[];for(const entry of entries){const row=rows[rows.length-1];if(!row||Math.abs(entry.top-row.top)>Math.max(entry.height,row.height)*.58){rows.push({items:[entry],top:entry.top,height:entry.height});continue}row.items.push(entry);row.top=row.items.reduce((sum,x)=>sum+x.top,0)/row.items.length;row.height=row.items.reduce((sum,x)=>sum+x.height,0)/row.items.length}return rows.map(row=>row.items.sort((a,b)=>a.left-b.left).map(x=>x.text).join(row.items.length>1?'\\t':'')).join('\\n')}
function saveText(){const text=[...document.querySelectorAll('.document-page')].map((page,index)=>'['+(index+1)+'쪽]\\n'+pageText(page)).join('\\n\\n');const blob=new Blob(['\\uFEFF'+text],{type:'text/plain;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=document.title+'_텍스트.txt';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
function saveHtml(){closeLine();const html='<!DOCTYPE html>\\\\n'+document.documentElement.outerHTML;const blob=new Blob([html],{type:'text/html;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=document.title+'_수정본.html';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
`;
  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Nanum+Gothic:wght@400;700;800&family=Nanum+Myeongjo:wght@400;700;800&family=Noto+Sans+KR:wght@100..900&display=swap" rel="stylesheet"><style>${editorStyles}</style></head>
<body><div class="toolbar no-print"><button class="secondary" onclick="saveText()">텍스트만 추출</button><button class="blue" onclick="saveHtml()">수정된 HTML 저장</button><button onclick="window.print()">PDF로 저장 · 인쇄</button></div>
<div class="help no-print">문장 줄을 클릭한 뒤 아래 편집창에서 수정하세요. 원본은 적용 전까지 그대로 유지됩니다.</div><main class="pages">${pagesHtml}</main>
<section id="standaloneLineEditor" class="line-editor hidden no-print"><strong>선택한 문장 또는 표 칸 수정</strong><div class="format-toolbar"><label>글꼴<select id="standaloneFontFamily"><option value="">원본 글꼴</option><option value="Nanum Gothic">나눔고딕</option><option value="Malgun Gothic">맑은 고딕</option><option value="Noto Sans KR">Noto Sans KR</option><option value="Nanum Myeongjo">나눔명조</option><option value="Batang">바탕</option><option value="Dotum">돋움</option><option value="Arial">Arial</option></select></label><label>크기 (pt)<input id="standaloneFontSize" type="number" min="6" max="72" step=".5" value="10.5"><small id="standaloneSizeHint">원본 10.5pt</small></label><button id="standaloneSizeDown" type="button" aria-label="글자 크기 줄이기">−</button><button id="standaloneSizeApply" type="button">크기 적용</button><button id="standaloneSizeUp" type="button" aria-label="글자 크기 늘리기">+</button><button id="standaloneBold" type="button">굵게</button><label>색상<input id="standaloneColor" type="color" value="#111111"></label><button id="standaloneClearFormat" type="button">원본 서식</button></div><div id="standaloneLineInput" class="line-editor-input" contenteditable="true" role="textbox" aria-multiline="true"></div><p class="format-help">한 줄 또는 여러 줄에서 원하는 글자만 드래그한 다음 서식을 선택하세요.</p><div class="line-editor-actions"><button class="secondary" type="button" onclick="closeLine()">취소</button><button class="secondary" type="button" onclick="resetLine()">원문으로 되돌리기</button><button class="blue" type="button" onclick="applyLine()">수정 적용</button></div></section>
<script>${script}<\/script></body></html>`;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character]);
}
