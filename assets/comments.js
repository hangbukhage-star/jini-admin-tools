(() => {
  "use strict";

  const apiBase = String(window.JINI_STATS_CONFIG?.apiBase || "").replace(/\/$/, "");
  const dialog = document.querySelector(".comments-dialog");
  const title = dialog?.querySelector("#comments-title");
  const list = dialog?.querySelector(".comments-list");
  const form = dialog?.querySelector(".comments-form");
  const status = dialog?.querySelector(".comments-status");
  const submit = form?.querySelector('[type="submit"]');
  let activeToolId = "";

  if (!apiBase || !dialog || !title || !list || !form || !status || !submit) return;

  function showStatus(message, isError = false) {
    status.textContent = message;
    status.style.color = isError ? "#b42318" : "#717987";
  }

  function makeComment(comment) {
    const item = document.createElement("article");
    item.className = "comment-item";

    const meta = document.createElement("div");
    meta.className = "comment-meta";

    const author = document.createElement("span");
    author.className = "comment-author";
    author.textContent = comment.author;

    const date = document.createElement("time");
    date.dateTime = new Date(Number(comment.created_at) * 1000).toISOString();
    date.textContent = new Intl.DateTimeFormat("ko-KR", {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(Number(comment.created_at) * 1000));

    const content = document.createElement("p");
    content.className = "comment-content";
    content.textContent = comment.content;

    meta.append(author, date);
    item.append(meta, content);
    return item;
  }

  async function loadComments(toolId) {
    list.replaceChildren();
    const loading = document.createElement("p");
    loading.className = "comments-empty";
    loading.textContent = "댓글을 불러오는 중이에요.";
    list.append(loading);

    const response = await fetch(`${apiBase}/comments/${encodeURIComponent(toolId)}`, {
      mode: "cors",
      cache: "no-store"
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "댓글을 불러오지 못했습니다.");

    list.replaceChildren();
    const comments = Array.isArray(data.comments) ? data.comments : [];
    if (!comments.length) {
      const empty = document.createElement("p");
      empty.className = "comments-empty";
      empty.textContent = "아직 댓글이 없어요. 첫 댓글을 남겨 주세요.";
      list.append(empty);
      return;
    }

    comments.forEach((comment) => list.append(makeComment(comment)));
  }

  document.querySelectorAll(".tool-card[data-tool-id]").forEach((card) => {
    const launchLink = card.querySelector("[data-track-tool]");
    if (!launchLink) return;

    const actions = document.createElement("div");
    actions.className = "card-actions";
    launchLink.parentNode.insertBefore(actions, launchLink);
    actions.append(launchLink);

    const commentButton = document.createElement("button");
    commentButton.className = "comment-open";
    commentButton.type = "button";
    commentButton.textContent = "💬 댓글";
    commentButton.setAttribute("aria-label", `${card.querySelector("h2")?.textContent.trim() || "도구"} 댓글 보기 및 작성`);
    actions.append(commentButton);

    commentButton.addEventListener("click", async () => {
      activeToolId = card.dataset.toolId;
      const toolName = card.querySelector("h2")?.textContent.trim() || "도구";
      title.textContent = `${toolName} 댓글`;
      form.reset();
      showStatus("");
      dialog.showModal();
      try {
        await loadComments(activeToolId);
      } catch {
        list.replaceChildren();
        showStatus("댓글을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.", true);
      }
    });
  });

  dialog.querySelector(".comments-close")?.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!activeToolId) return;

    const values = new FormData(form);
    const payload = {
      author: String(values.get("author") || "").trim(),
      content: String(values.get("content") || "").trim(),
      website: String(values.get("website") || "")
    };

    submit.disabled = true;
    showStatus("댓글을 등록하고 있어요.");
    try {
      const response = await fetch(`${apiBase}/comments/${encodeURIComponent(activeToolId)}`, {
        method: "POST",
        mode: "cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "댓글 등록에 실패했습니다.");

      form.elements.author.value = payload.author;
      form.elements.content.value = "";
      await loadComments(activeToolId);
      showStatus("댓글이 등록됐어요.");
    } catch (error) {
      showStatus(error.message || "댓글 등록에 실패했어요. 잠시 후 다시 시도해 주세요.", true);
    } finally {
      submit.disabled = false;
    }
  });
})();
