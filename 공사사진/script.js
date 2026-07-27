const stages = ["before", "during", "after"];
const projectName = document.getElementById("projectName");
const projectTitle = document.getElementById("projectTitle");
const template = document.getElementById("photoTemplate");
const photoSize = document.getElementById("photoSize");
const sizeValue = document.getElementById("sizeValue");

function updateProjectTitle() {
  projectTitle.textContent = projectName.value.trim() || "공사명을 입력하세요";
}

function sizeName(value) {
  const n = Number(value);
  if (n <= 50) return "작게";
  if (n <= 60) return "보통";
  return "크게";
}

function updatePhotoSize() {
  const value = photoSize.value;
  document.documentElement.style.setProperty("--photo-height", `${value}mm`);
  sizeValue.textContent = `${sizeName(value)} · ${value}mm`;
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
  });
}

function cleanupAfterPrint() {
  document.querySelectorAll(".print-hidden").forEach((item) => {
    item.classList.remove("print-hidden");
  });

  document.querySelectorAll(".photo-grid").forEach((grid) => {
    grid.classList.remove("single-filled");
  });
}

function resetAll() {
  const hasData =
    projectName.value.trim() ||
    document.querySelector(".photo-box.has-image");

  if (hasData && !confirm("공사명과 사진을 모두 지울까요?")) return;

  projectName.value = "";
  photoSize.value = "58";
  updateProjectTitle();
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
updatePhotoSize();
