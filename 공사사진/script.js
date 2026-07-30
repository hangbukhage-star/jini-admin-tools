const stages = ["before", "during", "after"];
const projectName = document.getElementById("projectName");
const projectTitle = document.getElementById("projectTitle");
const template = document.getElementById("photoTemplate");
const photoSize = document.getElementById("photoSize");
const sizeValue = document.getElementById("sizeValue");
const overviewToggle = document.getElementById("overviewToggle");
const overviewFields = document.getElementById("overviewFields");
const overviewPreview = document.getElementById("overviewPreview");
const startDate = document.getElementById("startDate");
const endDate = document.getElementById("endDate");
const projectPlace = document.getElementById("projectPlace");
const contractor = document.getElementById("contractor");
const projectDetails = document.getElementById("projectDetails");
const periodPreview = document.getElementById("periodPreview");
const placePreview = document.getElementById("placePreview");
const contractorPreview = document.getElementById("contractorPreview");
const detailsPreview = document.getElementById("detailsPreview");
const printRule = document.getElementById("printRule");

function updateProjectTitle() {
  projectTitle.textContent = projectName.value.trim() || "공사명을 입력하세요";
}

function sizeName(value) {
  const n = Number(value);
  if (n <= 40) return "작게";
  if (n < 54) return "보통";
  return "크게";
}

function updatePhotoSize() {
  const value = Number(photoSize.value);
  document.documentElement.style.setProperty(
    "--photo-screen-height",
    `${Math.round(value * 2.6)}px`
  );
  document.documentElement.style.setProperty("--photo-print-height", `${value}mm`);
  sizeValue.textContent = `${sizeName(value)} · ${value}mm`;
}

function formatDate(value) {
  if (!value) return "";
  return `${value.slice(0, 4)}. ${value.slice(5, 7)}. ${value.slice(8, 10)}.`;
}

function updateOverviewData() {
  const start = formatDate(startDate.value);
  const end = formatDate(endDate.value);

  periodPreview.textContent =
    start || end ? `${start || "-"} ~ ${end || "-"}` : "-";
  placePreview.textContent = projectPlace.value.trim() || "-";
  contractorPreview.textContent = contractor.value.trim() || "-";
  detailsPreview.textContent = projectDetails.value.trim() || "-";
}

function updateOverviewMode() {
  const enabled = overviewToggle.checked;

  overviewFields.hidden = !enabled;
  overviewPreview.hidden = !enabled;
  document.body.classList.toggle("overview-on", enabled);
  document.body.classList.toggle("overview-off", !enabled);
  printRule.textContent = enabled
    ? "개요 포함: 내용이 길면 다음 페이지로 이어지며 전·중·후 단계는 잘리지 않습니다."
    : "개요 없음: 전·중·후 사진을 A4 한 장에 맞춰 인쇄합니다.";
}

function validImage(file) {
  if (!file) return false;

  if (!file.type.startsWith("image/")) {
    alert("이미지 파일만 선택할 수 있습니다.");
    return false;
  }

  if (file.size > 15 * 1024 * 1024) {
    alert("사진 한 장의 용량은 15MB 이하로 선택해 주세요.");
    return false;
  }

  return true;
}

function loadImage(box, file) {
  if (!validImage(file)) return;

  const reader = new FileReader();

  reader.onload = (event) => {
    box.querySelector("img").src = event.target.result;
    box.classList.add("has-image");
  };

  reader.onerror = () => alert("사진을 불러오지 못했습니다.");
  reader.readAsDataURL(file);
}

function setupDrop(box) {
  ["dragenter", "dragover"].forEach((name) => {
    box.addEventListener(name, (event) => {
      event.preventDefault();
      box.style.borderColor = "#2d5d8e";
    });
  });

  ["dragleave", "drop"].forEach((name) => {
    box.addEventListener(name, (event) => {
      event.preventDefault();
      box.style.borderColor = "";
    });
  });

  box.addEventListener("drop", (event) => {
    loadImage(box, event.dataTransfer.files[0]);
  });
}

function renumber(stage) {
  document.querySelectorAll(`#${stage}List .photo-item`).forEach((item, index) => {
    item.querySelector(".photo-number").textContent =
      String(index + 1).padStart(2, "0");
  });
}

function addPhoto(stage) {
  const list = document.getElementById(`${stage}List`);
  const item = template.content.firstElementChild.cloneNode(true);
  const box = item.querySelector(".photo-box");
  const input = item.querySelector(".file-input");
  const remove = item.querySelector(".remove-btn");

  input.addEventListener("change", (event) => {
    loadImage(box, event.target.files[0]);
  });

  setupDrop(box);

  remove.addEventListener("click", () => {
    const items = list.querySelectorAll(".photo-item");

    if (items.length <= 2) {
      box.classList.remove("has-image");
      box.querySelector("img").removeAttribute("src");
      input.value = "";
      return;
    }

    item.remove();
    renumber(stage);
  });

  list.appendChild(item);
  renumber(stage);
}

function preparePrint() {
  let totalRows = 0;

  stages.forEach((stage) => {
    const list = document.getElementById(`${stage}List`);
    const items = [...list.querySelectorAll(".photo-item")];
    const filled = items.filter((item) =>
      item.querySelector(".photo-box").classList.contains("has-image")
    );

    items.forEach((item) => {
      item.classList.toggle(
        "print-hidden",
        filled.length > 0 &&
        !item.querySelector(".photo-box").classList.contains("has-image")
      );
    });

    list.classList.toggle("single-filled", filled.length === 1);
    totalRows += Math.ceil((filled.length || items.length) / 2);
  });

  if (!overviewToggle.checked) {
    const selectedSize = Number(photoSize.value);
    const fittedSize = Math.max(
      12,
      Math.min(selectedSize, Math.floor(200 / Math.max(totalRows, 1)))
    );
    document.documentElement.style.setProperty(
      "--photo-print-height",
      `${fittedSize}mm`
    );
  }
}

function cleanupAfterPrint() {
  document.querySelectorAll(".print-hidden").forEach((item) => {
    item.classList.remove("print-hidden");
  });

  document.querySelectorAll(".photo-grid").forEach((grid) => {
    grid.classList.remove("single-filled");
  });

  document.documentElement.style.setProperty(
    "--photo-print-height",
    `${photoSize.value}mm`
  );
}

function resetAll() {
  const hasData =
    projectName.value.trim() ||
    startDate.value ||
    endDate.value ||
    projectPlace.value.trim() ||
    contractor.value.trim() ||
    projectDetails.value.trim() ||
    document.querySelector(".photo-box.has-image");

  if (hasData && !confirm("입력 내용과 사진을 모두 지울까요?")) return;

  projectName.value = "";
  startDate.value = "";
  endDate.value = "";
  projectPlace.value = "";
  contractor.value = "";
  projectDetails.value = "";
  overviewToggle.checked = true;
  photoSize.value = "46";
  updateProjectTitle();
  updateOverviewData();
  updateOverviewMode();
  updatePhotoSize();

  stages.forEach((stage) => {
    const list = document.getElementById(`${stage}List`);
    list.innerHTML = "";
    addPhoto(stage);
    addPhoto(stage);
  });
}

projectName.addEventListener("input", updateProjectTitle);
photoSize.addEventListener("input", updatePhotoSize);
overviewToggle.addEventListener("change", updateOverviewMode);
[startDate, endDate, projectPlace, contractor, projectDetails].forEach((field) => {
  field.addEventListener("input", updateOverviewData);
});

document.querySelectorAll("[data-add]").forEach((button) => {
  button.addEventListener("click", () => addPhoto(button.dataset.add));
});

document.getElementById("printBtn").addEventListener("click", () => {
  updateProjectTitle();
  preparePrint();
  window.print();
});

document.getElementById("resetBtn").addEventListener("click", resetAll);

window.addEventListener("beforeprint", preparePrint);
window.addEventListener("afterprint", cleanupAfterPrint);

stages.forEach((stage) => {
  addPhoto(stage);
  addPhoto(stage);
});

updateProjectTitle();
updateOverviewData();
updateOverviewMode();
updatePhotoSize();
