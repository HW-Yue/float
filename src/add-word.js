"use strict";

const params = new URLSearchParams(location.search);
const word = params.get("word") || "";

const wordText = document.getElementById("word-text");
const libSelect = document.getElementById("lib-select");
const libEmpty = document.getElementById("lib-empty");
const domainGrid = document.getElementById("domain-grid");
const customWrap = document.getElementById("custom-wrap");
const customDomain = document.getElementById("custom-domain");
const contextInput = document.getElementById("context-input");
const submitBtn = document.getElementById("submit-btn");
const result = document.getElementById("result");
const openOptions = document.getElementById("open-options");

// Pre-fill context from URL if available
const contextParam = params.get("context") || "";
if (contextParam) contextInput.value = contextParam;

wordText.textContent = word || "—";

// ── Domain pill logic ────────────────────────────────────────────
let selectedDomain = ""; // "" = 通用


function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderDomainPills(domains) {
  const list = Array.isArray(domains) ? domains : [];
  const pills = [
    `<button class="domain-pill active" data-domain="" type="button">通用</button>`,
    ...list.map((d) => `<button class="domain-pill" data-domain="${escapeHtml(d)}" type="button">${escapeHtml(d)}</button>`),
    `<button class="domain-pill" data-domain="__custom__" type="button">自定义</button>`,
  ];
  domainGrid.innerHTML = pills.join("");
}

domainGrid.addEventListener("click", (e) => {
  const pill = e.target.closest(".domain-pill");
  if (!pill) return;

  domainGrid.querySelectorAll(".domain-pill").forEach(p => p.classList.remove("active"));
  pill.classList.add("active");

  const val = pill.dataset.domain;
  if (val === "__custom__") {
    customWrap.classList.add("visible");
    customDomain.focus();
    selectedDomain = customDomain.value.trim();
  } else {
    customWrap.classList.remove("visible");
    selectedDomain = val;
  }
});

customDomain.addEventListener("input", () => {
  selectedDomain = customDomain.value.trim();
});

function getActiveDomain() {
  const activePill = domainGrid.querySelector(".domain-pill.active");
  if (activePill?.dataset.domain === "__custom__") return customDomain.value.trim();
  return activePill?.dataset.domain || "";
}

// ── Load libs + prefs ────────────────────────────────────────────
async function init() {
  const [libsResp, prefsResp, cfgResp] = await Promise.all([
    chrome.runtime.sendMessage({ type: "getVocabLibs" }),
    chrome.runtime.sendMessage({ type: "getAddWordPrefs" }),
    chrome.runtime.sendMessage({ type: "getConfig" }),
  ]);

  const libs = libsResp?.libs || [];
  const { lastLibId = "", lastDomain = "" } = prefsResp || {};
  const domains = Array.isArray(cfgResp?.articleDomains) ? cfgResp.articleDomains : [];
  renderDomainPills(domains);

  // Populate library dropdown
  if (libs.length === 0) {
    libSelect.style.display = "none";
    libEmpty.style.display = "block";
    submitBtn.disabled = true;
  } else {
    libSelect.innerHTML = libs
      .map(l => `<option value="${l.id}">${l.name}</option>`)
      .join("");
    // Restore last used lib
    if (lastLibId && libs.some(l => l.id === lastLibId)) {
      libSelect.value = lastLibId;
    }
  }

  // Restore last used domain
  if (lastDomain) {
    const matchingPill = [...domainGrid.querySelectorAll(".domain-pill")]
      .find(p => p.dataset.domain === lastDomain);

    if (matchingPill) {
      domainGrid.querySelectorAll(".domain-pill").forEach(p => p.classList.remove("active"));
      matchingPill.classList.add("active");
      if (lastDomain === "__custom__") {
        customWrap.classList.add("visible");
      }
    } else if (lastDomain) {
      // It was a custom domain
      const customPill = domainGrid.querySelector('[data-domain="__custom__"]');
      domainGrid.querySelectorAll(".domain-pill").forEach(p => p.classList.remove("active"));
      customPill.classList.add("active");
      customWrap.classList.add("visible");
      customDomain.value = lastDomain;
      selectedDomain = lastDomain;
    }
  }
}

// ── Submit ───────────────────────────────────────────────────────
submitBtn.addEventListener("click", () => {
  if (!word) return;

  const libId = libSelect.value;
  if (!libId) {
    showError("请选择词库");
    return;
  }

  const domain = getActiveDomain();
  const context = contextInput.value.trim();

  // 发送消息后立即关闭；后台独立完成生成、写入、刷新页面标记
  chrome.runtime.sendMessage({ type: "generateAndAddWord", word, libId, domain, context });
  window.close();
});

function showError(msg) {
  result.className = "result error";
  result.textContent = msg;
}

openOptions?.addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

init().catch(err => showError(err.message || "初始化失败"));
