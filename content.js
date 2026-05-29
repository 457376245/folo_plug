/* ============================================
   Folo Reader Optimizer - Content Script
   ============================================ */

(function () {
  "use strict";

  if (window.__FOLO_OPTIMIZER_ACTIVE__) {
    return;
  }
  window.__FOLO_OPTIMIZER_ACTIVE__ = true;

  const MODAL_ID = "folo-reader-modal";
  const ENTRY_PENDING = "pending";
  const FALLBACK_TITLE = "文章阅读";
  const HIDDEN_PANEL_ATTR = "data-folo-hidden-panel";
  const HIDDEN_SPLITTER_ATTR = "data-folo-hidden-splitter";
  const BLOCKED_ENTRY_ATTR = "data-folo-blocked-entry";
  const BLOCK_KEYWORDS_STORAGE_KEY = "foloBlockKeywords";
  const DEFAULT_BLOCK_KEYWORDS = [];

  const state = {
    lastUrl: location.href,
    pendingTitle: "",
    modalOpen: false,
    requestToken: 0,
    blockKeywords: [],
  };

  function isTimelinePath(pathname = location.pathname) {
    return pathname.includes("/timeline/");
  }

  function getEntryIdFromUrl(url = location.href) {
    try {
      const parsed = new URL(url, location.origin);
      const parts = parsed.pathname.split("/").filter(Boolean);
      const timelineIndex = parts.indexOf("timeline");
      if (timelineIndex < 0) return null;

      const entryId = parts[timelineIndex + 3];
      if (!entryId || entryId === ENTRY_PENDING) return null;
      return entryId;
    } catch {
      return null;
    }
  }

  function getMainContainer() {
    const root = document.getElementById("follow-root-container");
    if (root) {
      const main = root.querySelector("main");
      if (main) return main;
    }
    return document.querySelector("main");
  }

  function extractTitleFromCard(card) {
    const titleEl = card.querySelector(
      "h1, h2, h3, h4, [class*='title'], [class*='headline']"
    );
    if (titleEl && titleEl.textContent) {
      return titleEl.textContent.trim();
    }

    const text = (card.textContent || "").trim().split("\n")[0];
    if (!text) return FALLBACK_TITLE;
    return text.slice(0, 120);
  }

  function normalizeText(text) {
    return String(text || "").toLowerCase().trim();
  }

  function parseKeywords(raw) {
    if (!raw) return [];

    if (Array.isArray(raw)) {
      return raw.map((item) => normalizeText(item)).filter(Boolean);
    }

    if (typeof raw !== "string") return [];

    const parsedText = raw.trim();
    if (!parsedText) return [];

    if (parsedText.startsWith("[")) {
      try {
        const parsed = JSON.parse(parsedText);
        if (Array.isArray(parsed)) {
          return parsed.map((item) => normalizeText(item)).filter(Boolean);
        }
      } catch {
        // 忽略 JSON 解析失败，降级到逗号分隔解析
      }
    }

    return parsedText
      .split(/[,\n，]/)
      .map((item) => normalizeText(item))
      .filter(Boolean);
  }

  function readBlockKeywords(callback) {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(BLOCK_KEYWORDS_STORAGE_KEY, (result) => {
        const configured = parseKeywords(result[BLOCK_KEYWORDS_STORAGE_KEY]);
        if (callback) callback(configured.length > 0 ? configured : parseKeywords(DEFAULT_BLOCK_KEYWORDS));
      });
    } else {
      const storageValue = window.localStorage.getItem(BLOCK_KEYWORDS_STORAGE_KEY);
      const configured = parseKeywords(storageValue);
      if (callback) callback(configured.length > 0 ? configured : parseKeywords(DEFAULT_BLOCK_KEYWORDS));
    }
  }

  function refreshBlockKeywords(callback) {
    readBlockKeywords((keywords) => {
      state.blockKeywords = keywords;
      if (callback) callback();
    });
  }

  function listenBlockKeywordsChange() {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "local" && changes[BLOCK_KEYWORDS_STORAGE_KEY]) {
          state.blockKeywords = parseKeywords(changes[BLOCK_KEYWORDS_STORAGE_KEY].newValue);
          applyKeywordFilter();
        }
      });
    }
  }

  function isTextBlocked(text, keywords = state.blockKeywords) {
    if (!keywords || keywords.length === 0) return false;
    const normalized = normalizeText(text);
    if (!normalized) return false;
    return keywords.some((keyword) => normalized.includes(keyword));
  }

  function isCardBlocked(card, keywords = state.blockKeywords) {
    if (!(card instanceof Element)) return false;
    return isTextBlocked(card.textContent || "", keywords);
  }

  function applyKeywordFilter() {
    const main = getMainContainer();
    if (!main) return;

    const cards = Array.from(main.querySelectorAll("[data-entry-id]"));
    cards.forEach((card) => {
      if (!(card instanceof HTMLElement)) return;

      const blocked = isCardBlocked(card);
      if (blocked) {
        card.style.display = "none";
        card.setAttribute(BLOCKED_ENTRY_ATTR, "true");
        return;
      }

      if (card.getAttribute(BLOCKED_ENTRY_ATTR) === "true") {
        card.style.display = "";
        card.removeAttribute(BLOCKED_ENTRY_ATTR);
      }
    });
  }

  function findLayoutPanels() {
    const main = getMainContainer();
    if (!main) return null;

    const entrySeed = main.querySelector("[data-entry-id]");
    if (!entrySeed) return null;

    const minimumColumnHeight = Math.min(window.innerHeight * 0.55, 320);
    let current = entrySeed.parentElement;

    while (current && current !== main) {
      if (current.querySelectorAll("[data-entry-id]").length >= 3) {
        const parent = current.parentElement;
        if (!parent) break;

        const siblings = Array.from(parent.children).filter(
          (node) => node instanceof HTMLElement
        );
        if (siblings.length >= 2) {
          const currentRect = current.getBoundingClientRect();

          const rightCandidates = siblings
            .filter((node) => node !== current)
            .map((node) => ({ node, rect: node.getBoundingClientRect() }))
            .filter(
              ({ rect }) =>
                rect.width > 140 &&
                rect.height > minimumColumnHeight &&
                rect.left >= currentRect.left + currentRect.width * 0.35
            )
            .sort((a, b) => a.rect.left - b.rect.left);

          if (rightCandidates.length > 0) {
            const rightPanel = rightCandidates[0].node;
            const splitters = siblings.filter((node) => {
              if (node === current || node === rightPanel) return false;
              const rect = node.getBoundingClientRect();
              return rect.width > 0 && rect.width <= 80 && rect.height > minimumColumnHeight * 0.8;
            });

            return {
              main,
              middlePanel: current,
              rightPanel,
              splitters,
            };
          }
        }
      }
      current = current.parentElement;
    }

    return {
      main,
      middlePanel: null,
      rightPanel: null,
      splitters: [],
    };
  }

  function hideRightPanelAndExpandMiddle() {
    const layout = findLayoutPanels();
    if (!layout || !layout.middlePanel) return;

    layout.middlePanel.style.flex = "1 1 auto";
    layout.middlePanel.style.width = "100%";
    layout.middlePanel.style.maxWidth = "none";
    layout.middlePanel.style.minWidth = "0";

    if (layout.rightPanel) {
      layout.rightPanel.style.display = "none";
      layout.rightPanel.setAttribute(HIDDEN_PANEL_ATTR, "true");
    }

    layout.splitters.forEach((splitter) => {
      splitter.style.display = "none";
      splitter.setAttribute(HIDDEN_SPLITTER_ATTR, "true");
    });
  }

  function createModal() {
    if (document.getElementById(MODAL_ID)) return;

    const modal = document.createElement("div");
    modal.id = MODAL_ID;
    modal.innerHTML = `
      <div class="folo-modal-backdrop"></div>
      <div class="folo-modal-container" role="dialog" aria-modal="true" aria-label="文章阅读">
        <div class="folo-modal-header">
          <h2 class="folo-modal-title">${FALLBACK_TITLE}</h2>
          <button class="folo-modal-close" type="button" aria-label="关闭">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        <div class="folo-modal-body"></div>
      </div>
    `;

    document.body.appendChild(modal);

    const closeBtn = modal.querySelector(".folo-modal-close");
    const backdrop = modal.querySelector(".folo-modal-backdrop");
    if (closeBtn) closeBtn.addEventListener("click", closeModal);
    if (backdrop) backdrop.addEventListener("click", closeModal);
  }

  function openModal(title) {
    createModal();
    const modal = document.getElementById(MODAL_ID);
    if (!modal) return;

    const titleEl = modal.querySelector(".folo-modal-title");
    const bodyEl = modal.querySelector(".folo-modal-body");

    if (titleEl) titleEl.textContent = title || FALLBACK_TITLE;
    if (bodyEl) bodyEl.innerHTML = '<div class="folo-loading">正在加载文章内容...</div>';

    modal.classList.add("active");
    document.body.classList.add("folo-modal-open");
    state.modalOpen = true;
  }

  function closeModal() {
    const modal = document.getElementById(MODAL_ID);
    if (!modal) return;

    state.requestToken += 1;
    modal.classList.remove("active");
    document.body.classList.remove("folo-modal-open");
    state.modalOpen = false;
  }

  function setModalContent(html, title) {
    const modal = document.getElementById(MODAL_ID);
    if (!modal) return;

    const titleEl = modal.querySelector(".folo-modal-title");
    const bodyEl = modal.querySelector(".folo-modal-body");

    if (titleEl) titleEl.textContent = title || FALLBACK_TITLE;
    if (!bodyEl) return;

    bodyEl.innerHTML = html;
    bodyEl.querySelectorAll("a").forEach((link) => {
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    });
  }

  function extractShadowDomHtml(root) {
    if (!(root instanceof Element)) return "";

    const hosts = [root, ...Array.from(root.querySelectorAll("*"))];
    const chunks = [];

    hosts.forEach((host) => {
      if (!(host instanceof Element) || !host.shadowRoot) return;

      const shadowContainer = host.shadowRoot.querySelector("#shadow-html");
      const contentRoot = document.createElement("div");
      contentRoot.innerHTML = shadowContainer ? shadowContainer.innerHTML : host.shadowRoot.innerHTML || "";
      contentRoot.querySelectorAll("style, link[rel='stylesheet'], script").forEach((node) => node.remove());
      const html = (contentRoot.innerHTML || "").trim();
      if (html) chunks.push(html);
    });

    return chunks.join("\n");
  }

  function buildModalHtmlFromArticle(article) {
    const clone = article.cloneNode(true);
    if (!(clone instanceof Element)) return "";

    const baseHtml = clone.innerHTML || "";
    const shadowHtml = extractShadowDomHtml(article);

    if (!shadowHtml) return baseHtml;

    return `${baseHtml}
      <div class="folo-shadow-content">${shadowHtml}</div>`;
  }

  function getRenderableTextLength(root) {
    if (!(root instanceof Element)) return 0;

    let maxLength = ((root.textContent || "").trim() || "").length;
    const hosts = [root, ...Array.from(root.querySelectorAll("*"))];

    hosts.forEach((host) => {
      if (!(host instanceof Element) || !host.shadowRoot) return;
      const shadowContainer = host.shadowRoot.querySelector("#shadow-html");
      const shadowText = (
        (shadowContainer ? shadowContainer.textContent : host.shadowRoot.textContent) || ""
      ).trim();
      if (shadowText.length > maxLength) {
        maxLength = shadowText.length;
      }
    });

    return maxLength;
  }

  function waitForArticleRender(token, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const poll = () => {
        if (token !== state.requestToken) {
          reject(new Error("stale request"));
          return;
        }

        const renders = Array.from(document.querySelectorAll("[data-testid='entry-render']"));
        const ranked = renders
          .map((node) => ({ node, textLength: getRenderableTextLength(node) }))
          .sort((a, b) => b.textLength - a.textLength);
        const usable = ranked[0];

        if (usable && usable.textLength > 50) {
          resolve(usable.node);
          return;
        }

        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error("timeout"));
          return;
        }

        setTimeout(poll, 120);
      };

      poll();
    });
  }

  async function loadActiveEntryIntoModal(title) {
    const token = ++state.requestToken;
    try {
      const article = await waitForArticleRender(token);
      if (token !== state.requestToken) return;

      if (isTextBlocked(article.textContent || "")) {
        setModalContent(
          '<p style="color:#999;text-align:center;padding-top:40px;">该文章已根据关键字规则屏蔽。</p>',
          title
        );
        return;
      }

      const html = buildModalHtmlFromArticle(article);
      setModalContent(html, title);
    } catch {
      if (token !== state.requestToken) return;
      setModalContent(
        '<p style="color:#999;text-align:center;padding-top:40px;">文章内容加载失败，请关闭后重试。</p>',
        title
      );
    }
  }

  function handleTimelineState() {
    if (!isTimelinePath()) {
      closeModal();
      return;
    }

    hideRightPanelAndExpandMiddle();
    applyKeywordFilter();

    const entryId = getEntryIdFromUrl();
    if (!entryId) {
      closeModal();
      return;
    }

    const title = state.pendingTitle || FALLBACK_TITLE;
    openModal(title);
    loadActiveEntryIntoModal(title);
  }

  function onUrlMaybeChanged() {
    if (location.href === state.lastUrl) return;
    state.lastUrl = location.href;

    setTimeout(() => {
      handleTimelineState();
    }, 80);
  }

  function bindRouteEvents() {
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function (...args) {
      originalPushState.apply(this, args);
      onUrlMaybeChanged();
    };

    history.replaceState = function (...args) {
      originalReplaceState.apply(this, args);
      onUrlMaybeChanged();
    };

    window.addEventListener("popstate", onUrlMaybeChanged);

    // 兜底：部分内部跳转不会触发 History 包装回调
    setInterval(onUrlMaybeChanged, 300);
  }

  function bindLayoutGuard() {
    setInterval(() => {
      if (isTimelinePath()) {
        refreshBlockKeywords();
        applyKeywordFilter();
        hideRightPanelAndExpandMiddle();
      }
    }, 400);
  }

  function bindClickTracking() {
    document.addEventListener(
      "click",
      (event) => {
        if (!isTimelinePath()) return;

        const target = event.target;
        if (!(target instanceof Element)) return;

        const card = target.closest("[data-entry-id]");
        if (!card) return;

        if (isCardBlocked(card)) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          return;
        }

        state.pendingTitle = extractTitleFromCard(card);
      },
      true
    );
  }

  function bindEscClose() {
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && state.modalOpen) {
        closeModal();
      }
    });
  }

  function init() {
    listenBlockKeywordsChange();
    bindRouteEvents();
    bindClickTracking();
    bindEscClose();
    bindLayoutGuard();

    const attemptInit = () => {
      refreshBlockKeywords(() => {
        if (isTimelinePath()) {
          handleTimelineState();
        }
      });
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", attemptInit, { once: true });
    } else {
      attemptInit();
    }
  }

  init();
})();
