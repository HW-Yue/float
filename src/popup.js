"use strict";

// ── Element references ──────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const siteNameEl   = $("site-name");
const siteDomainEl = $("site-domain");
const mainBtn      = $("main-btn");
const mainBtnText  = $("main-btn-text");
const siteToggle   = $("site-toggle");
const contentEl    = $("content");
const vocabLevels  = $("vocab-levels");
const vocabHint    = $("vocab-hint");
const linkOptions  = $("link-options");

// ── Vocab level display hints ───────────────────────────────────
const VOCAB_HINTS = {
  zk:   "初中以上词汇都标注",
  gz:   "高中以上词汇都标注",
  gk:   "高考以上词汇都标注",
  cet4: "四级以上词汇都标注",
  cet6: "六级以上词汇都标注",
  ky:   "考研以上词汇都标注",
  adv:  "只标注进阶词汇",
};

// ── State ───────────────────────────────────────────────────────
let currentTab    = null;
let currentDomain = "";
let isMarking     = false;
let isSiteEnabled = true;

function sendMessage(payload) {
  return chrome.runtime.sendMessage(payload);
}

// ── UI updaters ─────────────────────────────────────────────────
function updateMainButton() {
  if (isMarking) {
    mainBtn.className = "main-btn active";
    mainBtnText.textContent = "暂停标注";
  } else {
    mainBtn.className = "main-btn inactive";
    mainBtnText.textContent = "开启标注";
  }
  mainBtn.style.opacity = isSiteEnabled ? "1" : "0.45";
  mainBtn.style.pointerEvents = isSiteEnabled ? "auto" : "none";
}

function updateContentSection() {
  contentEl.classList.toggle("disabled", !isSiteEnabled || !isMarking);
}

function setVocabLevel(level) {
  vocabLevels.querySelectorAll(".vocab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.level === level);
  });
  vocabHint.textContent = VOCAB_HINTS[level] || "";
}

// ── Init ─────────────────────────────────────────────────────────
async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab ?? null;

  if (currentTab?.url) {
    try { currentDomain = new URL(currentTab.url).hostname; } catch { currentDomain = ""; }
  }

  siteNameEl.textContent   = currentDomain || "—";
  siteDomainEl.textContent = currentDomain || "—";

  const [tabState, savedLevel] = await Promise.all([
    currentTab?.id && currentDomain
      ? sendMessage({ type: "getTabState", tabId: currentTab.id, hostname: currentDomain })
      : Promise.resolve({ state: "disabled" }),
    chrome.storage.sync.get({ vocabLevel: "gz" }),
  ]);

  isSiteEnabled      = tabState.state !== "disabled";
  isMarking          = tabState.state === "active";
  siteToggle.checked = isSiteEnabled;

  setVocabLevel(savedLevel.vocabLevel);
  updateMainButton();
  updateContentSection();
  bindEvents();
}

// ── Events ───────────────────────────────────────────────────────
function bindEvents() {
  mainBtn.addEventListener("click", async () => {
    if (!isSiteEnabled || !currentTab?.id) return;
    isMarking = !isMarking;
    await sendMessage(isMarking
      ? { type: "resumeTab", tabId: currentTab.id }
      : { type: "pauseTab",  tabId: currentTab.id }
    );
    updateMainButton();
    updateContentSection();
  });

  siteToggle.addEventListener("change", async () => {
    if (!currentDomain) return;
    const result = await sendMessage({ type: "toggleSite", hostname: currentDomain });
    isSiteEnabled      = result.enabled;
    isMarking          = isSiteEnabled;
    siteToggle.checked = isSiteEnabled;
    updateMainButton();
    updateContentSection();
  });

  vocabLevels.addEventListener("click", async (e) => {
    const btn = e.target.closest(".vocab-btn");
    if (!btn || btn.classList.contains("active")) return;
    const level = btn.dataset.level;
    setVocabLevel(level);
    await chrome.storage.sync.set({ vocabLevel: level });
  });

  linkOptions.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
}

init();
