(function () {
  "use strict";

  const ROOT_ID = "bili-course-progress-root";
  const SAVE_INTERVAL_MS = 5000;
  const REFRESH_INTERVAL_MS = 1000;

  const state = {
    root: null,
    panel: null,
    button: null,
    buttonLabel: null,
    ringProgress: null,
    hoverOpen: false,
    clickOpen: false,
    pages: [],
    pagesComplete: false,
    pagesSource: "",
    bvid: "",
    lastUrl: "",
    lastSavedAt: 0,
    currentVideo: null,
    refreshTimer: null,
    mutationObserver: null,
    urlTimer: null,
    lastRingPageIndex: null,
    ringResetTimer: 0,
    ringResetting: false
  };

  function safeNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : fallback;
  }

  function formatDuration(seconds) {
    if (!Number.isFinite(Number(seconds)) || Number(seconds) < 0) return "未知";
    const total = Math.floor(Number(seconds));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    if (hours > 0) return `${hours}小时${minutes}分${secs}秒`;
    return `${minutes}分${secs}秒`;
  }

  function parseTimeText(text) {
    if (!text) return NaN;
    const match = String(text).match(/\b(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\b/);
    if (!match) return NaN;
    const hours = match[1] ? Number(match[1]) : 0;
    const minutes = Number(match[2]);
    const seconds = Number(match[3]);
    if (![hours, minutes, seconds].every(Number.isFinite)) return NaN;
    return hours * 3600 + minutes * 60 + seconds;
  }

  function getLinearWatchedSeconds(pages, currentPageIndex, currentTime) {
    const index = Math.max(1, safeNumber(currentPageIndex, 1));
    const before = pages.slice(0, Math.max(0, index - 1)).reduce((sum, page) => sum + safeNumber(page.duration), 0);
    return before + safeNumber(currentTime);
  }

  function getTotalSeconds(pages) {
    return pages.reduce((sum, page) => sum + safeNumber(page.duration), 0);
  }

  function getProgressPercent(watchedSeconds, totalSeconds) {
    const total = safeNumber(totalSeconds);
    if (total <= 0) return "0.00";
    const percent = Math.min(100, Math.max(0, (safeNumber(watchedSeconds) / total) * 100));
    return percent.toFixed(2);
  }

  function findPageByLinearSeconds(pages, linearSeconds) {
    const total = getTotalSeconds(pages);
    const clamped = Math.min(Math.max(0, safeNumber(linearSeconds)), total);
    let acc = 0;

    for (let i = 0; i < pages.length; i += 1) {
      const duration = safeNumber(pages[i].duration);
      if (clamped <= acc + duration || i === pages.length - 1) {
        return {
          targetPageIndex: i + 1,
          targetTimeInPage: Math.min(duration, Math.max(0, clamped - acc)),
          targetLinearSeconds: clamped
        };
      }
      acc += duration;
    }

    return {
      targetPageIndex: 1,
      targetTimeInPage: 0,
      targetLinearSeconds: 0
    };
  }

  function predictAfterSeconds(pages, currentPageIndex, currentTime, deltaSeconds) {
    const total = getTotalSeconds(pages);
    const currentLinear = getLinearWatchedSeconds(pages, currentPageIndex, currentTime);
    const target = findPageByLinearSeconds(pages, currentLinear + safeNumber(deltaSeconds));
    return {
      targetPageIndex: target.targetPageIndex,
      targetTimeInPage: target.targetTimeInPage,
      targetLinearSeconds: target.targetLinearSeconds,
      targetPercent: getProgressPercent(target.targetLinearSeconds, total)
    };
  }

  function predictAfterParts(pages, currentPageIndex, currentTime, partCount) {
    const startIndex = Math.max(1, safeNumber(currentPageIndex, 1));
    const count = Math.max(1, safeNumber(partCount, 1));
    const endIndex = Math.min(pages.length, startIndex + count - 1);
    const targetLinearSeconds = pages.slice(0, endIndex).reduce((sum, page) => sum + safeNumber(page.duration), 0);
    const currentLinear = getLinearWatchedSeconds(pages, startIndex, currentTime);
    const neededSeconds = Math.max(0, targetLinearSeconds - currentLinear);

    return {
      neededSeconds,
      targetPageIndex: endIndex,
      targetLinearSeconds,
      targetPercent: getProgressPercent(targetLinearSeconds, getTotalSeconds(pages)),
      isNotEnoughParts: pages.length - startIndex + 1 < count
    };
  }

  function getBvidFromUrl(urlText = location.href) {
    try {
      const match = String(urlText).match(/\/video\/(BV[0-9A-Za-z]+)/);
      return match ? match[1] : "";
    } catch (error) {
      debug(error);
      return "";
    }
  }

  function getCurrentPageIndex() {
    try {
      const url = new URL(location.href);
      const fromQuery = Number(url.searchParams.get("p"));
      if (Number.isFinite(fromQuery) && fromQuery > 0) return Math.floor(fromQuery);
    } catch (error) {
      debug(error);
    }

    const activeSelectors = [
      ".cur-list .on",
      ".list-box li.on",
      ".video-pod__item.active",
      ".video-pod__item--active",
      ".video-episode-card__info-playing",
      "[class*='episode'][class*='active']",
      "[class*='pod'][class*='active']"
    ];

    for (const selector of activeSelectors) {
      const element = document.querySelector(selector);
      const number = element ? parseFirstInteger(element.textContent) : NaN;
      if (Number.isFinite(number) && number > 0) return number;
    }

    return 1;
  }

  function parseFirstInteger(text) {
    const match = String(text || "").match(/\b(\d{1,4})\b/);
    return match ? Number(match[1]) : NaN;
  }

  function normalizePage(page, index) {
    const duration = safeNumber(page && page.duration, NaN);
    return {
      page: safeNumber(page && page.page, index + 1) || index + 1,
      part: String((page && (page.part || page.title || page.name)) || `第 ${index + 1} P`).trim(),
      duration: Number.isFinite(duration) ? duration : 0,
      cid: page && page.cid
    };
  }

  function isUsablePages(pages) {
    return Array.isArray(pages) && pages.length > 0 && pages.every((page) => safeNumber(page.duration) > 0);
  }

  function extractBalancedObject(text, startIndex) {
    const firstBrace = text.indexOf("{", startIndex);
    if (firstBrace < 0) return "";

    let depth = 0;
    let inString = false;
    let stringQuote = "";
    let escaped = false;

    for (let i = firstBrace; i < text.length; i += 1) {
      const char = text[i];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === stringQuote) {
          inString = false;
        }
        continue;
      }

      if (char === '"' || char === "'") {
        inString = true;
        stringQuote = char;
        continue;
      }

      if (char === "{") depth += 1;
      if (char === "}") depth -= 1;
      if (depth === 0) return text.slice(firstBrace, i + 1);
    }

    return "";
  }

  function findPagesInObject(value) {
    if (!value || typeof value !== "object") return null;
    if (Array.isArray(value)) return null;

    const directCandidates = [
      value.videoData && value.videoData.pages,
      value.videoData && value.videoData.ugc_season && value.videoData.ugc_season.sections,
      value.ugc_season && value.ugc_season.sections,
      value.pages
    ];

    for (const candidate of directCandidates) {
      const pages = normalizeCandidatePages(candidate);
      if (isUsablePages(pages)) return pages;
    }

    for (const item of Object.values(value)) {
      if (!item || typeof item !== "object") continue;
      const pages = findPagesInObject(item);
      if (isUsablePages(pages)) return pages;
    }

    return null;
  }

  function normalizeCandidatePages(candidate) {
    if (!candidate) return [];

    if (Array.isArray(candidate) && candidate.length && candidate[0] && Array.isArray(candidate[0].episodes)) {
      return candidate.flatMap((section) => section.episodes || []).map(normalizePage);
    }

    if (Array.isArray(candidate) && candidate.length && candidate[0] && typeof candidate[0] === "object") {
      return candidate.map(normalizePage);
    }

    return [];
  }

  function parseInitialStatePages() {
    try {
      const scripts = Array.from(document.scripts || []);
      for (const script of scripts) {
        const text = script.textContent || "";
        const markerIndex = text.indexOf("window.__INITIAL_STATE__");
        if (markerIndex < 0) continue;

        const objectText = extractBalancedObject(text, markerIndex);
        if (!objectText) continue;

        try {
          const data = JSON.parse(objectText);
          const pages = findPagesInObject(data);
          if (isUsablePages(pages)) return pages;
        } catch (error) {
          debug(error);
        }
      }
    } catch (error) {
      debug(error);
    }

    return [];
  }

  function cleanTitle(text) {
    return String(text || "")
      .replace(/\b(?:(?:\d{1,2}:)?\d{1,2}:\d{2})\b/g, "")
      .replace(/^\s*\d+\s*[.、-]?\s*/, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function parseDomPages() {
    const selectors = [
      ".cur-list li",
      ".list-box li",
      ".multi-page-v1 .list-box li",
      ".video-pod__list .video-pod__item",
      ".video-pod__body .video-pod__item",
      ".base-video-sections-v1 .video-episode-card",
      ".video-sections-content-list .video-episode-card",
      "[class*='video-pod'] [class*='item']",
      "[class*='episode-card']"
    ];

    try {
      for (const selector of selectors) {
        const elements = Array.from(document.querySelectorAll(selector)).filter((element) => {
          const text = element.textContent || "";
          return parseTimeText(text) > 0 && cleanTitle(text).length > 0;
        });

        const uniqueElements = Array.from(new Set(elements)).slice(0, 300);
        const pages = uniqueElements.map((element, index) => {
          const text = element.textContent || "";
          const titleElement = element.querySelector("[title], .title, [class*='title'], [class*='part']");
          const title = titleElement ? titleElement.getAttribute("title") || titleElement.textContent : cleanTitle(text);
          return {
            page: index + 1,
            part: cleanTitle(title) || `第 ${index + 1} P`,
            duration: parseTimeText(text),
            cid: undefined
          };
        });

        if (isUsablePages(pages)) return pages;
      }
    } catch (error) {
      debug(error);
    }

    return [];
  }

  function makeCurrentVideoFallbackPage(video, currentPageIndex) {
    const duration = video ? safeNumber(video.duration, 0) : 0;
    if (duration <= 0) return [];
    return [
      {
        page: currentPageIndex,
        part: document.title ? document.title.replace(/_哔哩哔哩.*$/, "").trim() : `第 ${currentPageIndex} P`,
        duration,
        cid: undefined
      }
    ];
  }

  function parsePages() {
    const initialStatePages = parseInitialStatePages();
    if (isUsablePages(initialStatePages)) {
      state.pagesSource = "__INITIAL_STATE__";
      state.pagesComplete = initialStatePages.length > 1;
      state.pages = initialStatePages;
      return;
    }

    const domPages = parseDomPages();
    if (isUsablePages(domPages)) {
      state.pagesSource = "DOM";
      state.pagesComplete = domPages.length > 1;
      state.pages = domPages;
      return;
    }

    const fallbackPages = makeCurrentVideoFallbackPage(document.querySelector("video"), getCurrentPageIndex());
    state.pagesSource = "video.duration";
    state.pagesComplete = false;
    state.pages = fallbackPages;
  }

  function getCurrentPageTitle(pages, currentPageIndex) {
    const page = pages[Math.max(0, currentPageIndex - 1)];
    if (page && page.part) return page.part;
    return document.title ? document.title.replace(/_哔哩哔哩.*$/, "").trim() : "未知";
  }

  function createUi() {
    const existing = document.getElementById(ROOT_ID);
    if (existing) {
      state.root = existing;
      state.button = existing.querySelector(".bcp-button");
      state.panel = existing.querySelector(".bcp-panel");
      state.buttonLabel = existing.querySelector(".bcp-button-label");
      state.ringProgress = existing.querySelector(".bcp-ring-progress");
      return;
    }

    const root = document.createElement("div");
    root.id = ROOT_ID;

    const panel = document.createElement("div");
    panel.className = "bcp-panel";
    panel.hidden = true;
    panel.textContent = "正在读取 B 站课程数据...";

    const button = document.createElement("button");
    button.className = "bcp-button";
    button.type = "button";
    button.innerHTML = `
      <svg class="bcp-ring-svg" viewBox="0 0 72 72" aria-hidden="true">
        <circle class="bcp-ring-track" cx="36" cy="36" r="31" pathLength="100"></circle>
        <circle class="bcp-ring-progress" cx="36" cy="36" r="31" pathLength="100"></circle>
      </svg>
      <span class="bcp-button-core">
        <span class="bcp-button-label">P1</span>
        <span class="bcp-button-caption">进度</span>
      </span>
    `;
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-label", "查看 B 站课程学习进度");

    root.append(panel, button);
    (document.body || document.documentElement).appendChild(root);

    root.addEventListener("mouseenter", () => {
      state.hoverOpen = true;
      setPanelVisible(true);
    });

    root.addEventListener("mouseleave", () => {
      state.hoverOpen = false;
      if (!state.clickOpen) setPanelVisible(false);
    });

    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      state.clickOpen = !state.clickOpen;
      setPanelVisible(state.clickOpen || state.hoverOpen);
    });

    document.addEventListener("click", (event) => {
      if (!state.root || state.root.contains(event.target)) return;
      state.clickOpen = false;
      if (!state.hoverOpen) setPanelVisible(false);
    });

    state.root = root;
    state.panel = panel;
    state.button = button;
    state.buttonLabel = button.querySelector(".bcp-button-label");
    state.ringProgress = button.querySelector(".bcp-ring-progress");
  }

  function setPanelVisible(visible) {
    if (!state.panel || !state.button) return;
    state.panel.hidden = !visible;
    state.button.setAttribute("aria-expanded", visible ? "true" : "false");
  }

  function renderFloatingButtonProgress(currentPageIndex, currentTime, currentDuration) {
    if (!state.button) return;

    const duration = safeNumber(currentDuration);
    const percent = duration > 0 ? Math.min(100, Math.max(0, (safeNumber(currentTime) / duration) * 100)) : 0;
    const dashOffset = (100 - percent).toFixed(2);
    const label = `P${currentPageIndex || 1}`;

    if (state.buttonLabel) {
      state.buttonLabel.textContent = label;
    }
    state.button.setAttribute("aria-label", `查看 B 站课程学习进度，当前第 ${currentPageIndex || 1} P`);

    const pageChanged = state.lastRingPageIndex !== null && state.lastRingPageIndex !== currentPageIndex;

    if (!state.ringProgress) {
      state.lastRingPageIndex = currentPageIndex;
      return;
    }

    if (pageChanged) {
      window.clearTimeout(state.ringResetTimer);
      state.ringResetting = true;
      state.button.classList.add("bcp-ring-resetting");
      state.ringProgress.style.transitionDuration = "180ms";
      state.ringProgress.style.strokeDashoffset = "100";
      state.ringResetTimer = window.setTimeout(() => {
        state.ringResetting = false;
        state.button.classList.remove("bcp-ring-resetting");
        state.ringProgress.style.transitionDuration = "";
        state.ringProgress.style.strokeDashoffset = dashOffset;
      }, 180);
    } else if (state.ringResetting) {
      state.lastRingPageIndex = currentPageIndex;
      return;
    } else {
      state.ringProgress.style.transitionDuration = "";
      state.ringProgress.style.strokeDashoffset = dashOffset;
    }

    state.lastRingPageIndex = currentPageIndex;
  }

  function renderValue(value, extraClass = "") {
    return `<span class="bcp-value-chip ${extraClass}">${escapeHtml(value)}</span>`;
  }

  function renderInfoBlock(value, extraClass = "") {
    return `<span class="bcp-info-block ${extraClass}" title="${escapeHtml(value)}">${escapeHtml(value)}</span>`;
  }

  function renderPanel(data) {
    if (!state.panel) return;

    const progressNumber = Math.min(100, Math.max(0, Number(data.progressPercentNumber) || 0)).toFixed(2);
    const progressStyle = `width: ${progressNumber}%`;
    const savedText = state.lastSavedAt ? formatClock(state.lastSavedAt) : "等待保存";
    const sourceText = data.source || "LOCAL";

    state.panel.innerHTML = `
      <div class="bcp-panel-header">
        <div>
          <div class="bcp-brand">BiliCourse</div>
          <div class="bcp-brand-subtitle">multi-part course timeline</div>
        </div>
        <div class="bcp-header-badges">
          <span class="bcp-mini-badge">v1.1</span>
          <span class="bcp-mini-badge bcp-mini-badge-soft">${escapeHtml(sourceText)}</span>
        </div>
      </div>

      <section class="bcp-section bcp-core-section">
        <div class="bcp-row">
          <span class="bcp-label">当前</span>
          ${renderValue(`第 ${data.currentPageIndex} / ${data.totalPages} P`, "bcp-value-chip-strong")}
        </div>
        <div class="bcp-row bcp-row-stack">
          <span class="bcp-label">标题</span>
          ${renderInfoBlock(data.title, "bcp-title-block")}
        </div>
        <div class="bcp-stat-grid">
          <div class="bcp-stat">
            <span class="bcp-stat-label">已看</span>
            ${renderValue(data.watchedText)}
          </div>
          <div class="bcp-stat">
            <span class="bcp-stat-label">总时长</span>
            ${renderValue(data.totalText)}
          </div>
        </div>
        <div class="bcp-total-progress" aria-label="整门课程线性进度 ${escapeHtml(data.progressText)}">
          <div class="bcp-progress-meta">
            <span>课程总进度</span>
            ${renderValue(data.progressText, "bcp-percent-chip")}
          </div>
          <div class="bcp-progress-track">
            <div class="bcp-progress-fill" style="${progressStyle}"></div>
          </div>
        </div>
      </section>

      <section class="bcp-section bcp-predictions">
        <div class="bcp-section-title">继续观看预测</div>
        <div class="bcp-prediction-card">
          <span class="bcp-prediction-label">再看 1h</span>
          ${renderInfoBlock(data.afterOneHourText)}
        </div>
        <div class="bcp-prediction-card">
          <span class="bcp-prediction-label">再看 5P</span>
          ${renderInfoBlock(data.afterFivePartsText)}
        </div>
      </section>

      <section class="bcp-section bcp-status-grid">
        <div class="bcp-status-item">
          <span class="bcp-label">播放状态</span>
          ${renderValue(data.status)}
        </div>
        <div class="bcp-status-item">
          <span class="bcp-label">当前倍速</span>
          ${renderValue(data.playbackRate)}
        </div>
        <div class="bcp-status-item bcp-status-item-wide">
          <span class="bcp-label">本地记录</span>
          ${renderValue(savedText, "bcp-saved-chip")}
        </div>
      </section>

      ${data.warning ? `<div class="bcp-warning">${escapeHtml(data.warning)}</div>` : ""}
      <div class="bcp-footnote">按课程原始时间线估算，数据仅保存在本地。</div>
    `;
  }

  function renderMessage(message) {
    if (!state.panel) return;
    state.panel.innerHTML = `
      <div class="bcp-panel-header">
        <div>
          <div class="bcp-brand">BiliCourse</div>
          <div class="bcp-brand-subtitle">multi-part course timeline</div>
        </div>
        <span class="bcp-mini-badge">v1.1</span>
      </div>
      <div class="bcp-empty-state">${escapeHtml(message)}</div>
    `;
  }

  function updatePanel() {
    try {
      state.bvid = getBvidFromUrl();
      const video = document.querySelector("video");
      if (!video) {
        renderMessage("正在读取 B 站课程数据...");
        return;
      }

      bindVideoEvents(video);

      if (!state.pages.length || state.lastUrl !== location.href) {
        parsePages();
      }

      const currentPageIndex = getCurrentPageIndex();
      const calculationPageIndex = state.pagesComplete ? currentPageIndex : 1;
      const currentTime = safeNumber(video.currentTime);
      const currentVideoDuration = safeNumber(video.duration);
      const totalPages = Math.max(state.pages.length, currentPageIndex);
      renderFloatingButtonProgress(currentPageIndex, currentTime, currentVideoDuration);

      if (!state.pages.length) {
        renderMessage("暂未识别到多 P 课程");
        return;
      }

      const totalSeconds = getTotalSeconds(state.pages);
      const linearWatchedSeconds = getLinearWatchedSeconds(state.pages, calculationPageIndex, currentTime);
      const progressPercent = getProgressPercent(linearWatchedSeconds, totalSeconds);
      const afterOneHour = predictAfterSeconds(state.pages, calculationPageIndex, currentTime, 3600);
      const afterFiveParts = predictAfterParts(state.pages, calculationPageIndex, currentTime, 5);
      const status = video.paused ? "已暂停" : "播放中";

      const warnings = [];
      if (!state.pagesComplete) warnings.push("暂未获取完整分 P 列表，无法计算课程总进度");
      if (afterFiveParts.isNotEnoughParts) warnings.push("剩余不足 5P，已按课程结束计算");

      renderPanel({
        source: state.pagesSource || "LOCAL",
        currentPageIndex,
        totalPages,
        title: getCurrentPageTitle(state.pages, currentPageIndex),
        watchedText: formatDuration(linearWatchedSeconds),
        totalText: state.pagesComplete ? formatDuration(totalSeconds) : "未知",
        progressText: state.pagesComplete ? `${progressPercent}%` : "暂不可计算",
        progressPercentNumber: state.pagesComplete ? progressPercent : "0.00",
        afterOneHourText: state.pagesComplete
          ? `预计到第 ${afterOneHour.targetPageIndex} P，课程进度 ${afterOneHour.targetPercent}%`
          : "暂不可计算",
        afterFivePartsText: state.pagesComplete
          ? `还需 ${formatDuration(afterFiveParts.neededSeconds)}，预计到第 ${afterFiveParts.targetPageIndex} P，课程进度 ${afterFiveParts.targetPercent}%`
          : "暂不可计算",
        status,
        playbackRate: `${safeNumber(video.playbackRate, 1)}x`,
        warning: warnings.join("；")
      });
      saveProgressThrottled({
        bvid: state.bvid,
        title: getCurrentPageTitle(state.pages, currentPageIndex),
        currentPageIndex,
        currentTime,
        linearWatchedSeconds,
        totalSeconds,
        progressPercent,
        updatedAt: Date.now()
      });
    } catch (error) {
      debug(error);
      renderMessage("正在读取 B 站课程数据...");
    }
  }

  function saveProgressThrottled(payload) {
    if (
      !payload.bvid ||
      typeof chrome === "undefined" ||
      !chrome.storage ||
      !chrome.storage.local
    ) {
      return;
    }
    const now = Date.now();
    if (now - state.lastSavedAt < SAVE_INTERVAL_MS) return;

    try {
      chrome.storage.local.set({ [payload.bvid]: payload }, () => {
        if (chrome.runtime && chrome.runtime.lastError) {
          debug(chrome.runtime.lastError);
          return;
        }
        state.lastSavedAt = now;
      });
    } catch (error) {
      debug(error);
    }
  }

  function bindVideoEvents(video) {
    if (!video || state.currentVideo === video) return;

    if (state.currentVideo) {
      ["timeupdate", "loadedmetadata", "play", "pause"].forEach((eventName) => {
        state.currentVideo.removeEventListener(eventName, updatePanel);
      });
    }

    ["timeupdate", "loadedmetadata", "play", "pause"].forEach((eventName) => {
      video.addEventListener(eventName, updatePanel, { passive: true });
    });

    state.currentVideo = video;
  }

  function observeMutations() {
    if (state.mutationObserver) state.mutationObserver.disconnect();

    state.mutationObserver = new MutationObserver((records) => {
      const onlyOwnUiChanged = records.every((record) => {
        const target = record.target;
        return state.root && target instanceof Node && state.root.contains(target);
      });
      if (onlyOwnUiChanged) return;
      scheduleReparse();
    });

    state.mutationObserver.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  let reparseTimer = 0;
  function scheduleReparse() {
    window.clearTimeout(reparseTimer);
    reparseTimer = window.setTimeout(() => {
      state.pages = [];
      parsePages();
      updatePanel();
    }, 350);
  }

  function watchUrlChanges() {
    state.lastUrl = location.href;
    state.urlTimer = window.setInterval(() => {
      if (state.lastUrl === location.href) return;
      state.lastUrl = location.href;
      state.pages = [];
      scheduleReparse();
    }, 500);

    window.addEventListener("popstate", scheduleReparse);
    window.addEventListener("hashchange", scheduleReparse);
  }

  function formatClock(timestamp) {
    try {
      return new Date(timestamp).toLocaleTimeString("zh-CN", { hour12: false });
    } catch (error) {
      debug(error);
      return "未知";
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function debug(error) {
    if (typeof console !== "undefined" && console.debug) {
      console.debug("[BiliCourseProgress]", error);
    }
  }

  function init() {
    try {
      if (!location.href.includes("bilibili.com/video/")) return;
      createUi();
      parsePages();
      updatePanel();
      observeMutations();
      watchUrlChanges();
      state.refreshTimer = window.setInterval(updatePanel, REFRESH_INTERVAL_MS);
    } catch (error) {
      debug(error);
    }
  }

  init();
})();
