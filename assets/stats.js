(() => {
  "use strict";

  const cards = [...document.querySelectorAll(".tool-card[data-tool-id]")];
  const apiBase = String(window.JINI_STATS_CONFIG?.apiBase || "").replace(/\/$/, "");
  const numberFormat = new Intl.NumberFormat("ko-KR");

  function counter(card) {
    return card.querySelector(".tool-stats");
  }

  function showCount(card, value) {
    const element = counter(card);
    if (!element) return;
    const count = Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
    element.textContent = `👁 실행 ${numberFormat.format(count)}회`;
    element.dataset.state = "ready";
    card.dataset.toolCount = String(count);
  }

  function hideCounters() {
    cards.forEach((card) => {
      const element = counter(card);
      if (element) element.dataset.state = "offline";
    });
  }

  async function request(path, options = {}) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 3500);
    try {
      const response = await fetch(`${apiBase}${path}`, {
        ...options,
        mode: "cors",
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`통계 API 오류: ${response.status}`);
      return await response.json();
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function loadCounts() {
    try {
      const data = await request("/counts", { cache: "no-store" });
      cards.forEach((card) => showCount(card, data.counts?.[card.dataset.toolId] || 0));
    } catch {
      hideCounters();
    }
  }

  function track(card) {
    const toolId = card.dataset.toolId;
    if (!toolId) return;

    const current = Number(card.dataset.toolCount || 0);
    showCount(card, current + 1);

    request(`/count/${encodeURIComponent(toolId)}`, {
      method: "POST",
      keepalive: true
    }).then((data) => {
      showCount(card, data.count);
    }).catch(() => {
      showCount(card, current);
    });
  }

  if (!apiBase) {
    hideCounters();
    return;
  }

  cards.forEach((card) => {
    card.querySelector("[data-track-tool]")?.addEventListener("click", () => track(card));
  });

  loadCounts();
})();
