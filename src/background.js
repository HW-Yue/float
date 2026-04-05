// ===== IMPORTS =====

import {
  WORD_LEVELS as WORD_LEVELS_VOCAB,
  WORD_DEFS as WORD_DEFS_VOCAB,
  WORD_VARIANTS as WORD_VARIANTS_VOCAB,
} from "./word-data.js";
import {
  VOCAB_LIBS_KEY,
  VOCAB_LOADED_IDS_KEY,
  vocabLibStorageKey,
  verifyLibChecksum,
  updateLibManifestChecksum,
  createEmptyLib,
  addWordToLibData,
  hasWordInLibData,
  generateLibId,
} from "./vocab-lib.js";
import {
  packLocalVocabData,
  uploadToGist,
  downloadFromGist,
  getLocalSyncMeta,
  setLocalSyncMeta,
  getSyncConfig,
  setSyncConfig,
} from "./gist-service.js";


// ===== VOCABULARY DATA MAPS =====

let vocabM = new Map(
  Object.entries(WORD_LEVELS_VOCAB).map(([k, v]) => [k.toLowerCase(), v])
);
let vocabA = new Map(
  Object.entries(WORD_DEFS_VOCAB).map(([k, v]) => [k.toLowerCase(), v])
);
let vocabEe = new Map(
  Object.entries(WORD_VARIANTS_VOCAB).map(([k, v]) => [k.toLowerCase(), v.toLowerCase()])
);

const presetObjects = {
  levels: Object.fromEntries(vocabM),
  defs: Object.fromEntries(vocabA),
  variants: Object.fromEntries(vocabEe),
};


// ===== WORD VARIANT GENERATOR =====

function vocabMe(word) {
  const lower = word.toLowerCase();
  const candidates = [lower];

  if (vocabEe.has(lower)) {
    candidates.push(vocabEe.get(lower));
  } else {
    // -ing forms
    if (lower.endsWith("ing") && lower.length > 5) {
      const stem = lower.slice(0, -3);
      candidates.push(stem, stem + "e");
      if (stem.length >= 3 && stem[stem.length - 1] === stem[stem.length - 2]) {
        candidates.push(stem.slice(0, -1));
      }
    }
    // -ed forms
    if (lower.endsWith("ed") && lower.length > 4) {
      candidates.push(lower.slice(0, -2), lower.slice(0, -1));
      const stem = lower.slice(0, -2);
      if (stem.length >= 3 && stem[stem.length - 1] === stem[stem.length - 2]) {
        candidates.push(stem.slice(0, -1));
      }
      if (lower.endsWith("ied")) {
        candidates.push(lower.slice(0, -3) + "y");
      }
    }
    // plural / third-person -s forms
    if (
      lower.endsWith("ses") ||
      lower.endsWith("xes") ||
      lower.endsWith("zes") ||
      lower.endsWith("ches") ||
      lower.endsWith("shes")
    ) {
      candidates.push(lower.slice(0, -2));
    } else if (lower.endsWith("ies") && lower.length > 4) {
      candidates.push(lower.slice(0, -3) + "y");
    } else if (lower.endsWith("s") && !lower.endsWith("ss") && lower.length > 3) {
      candidates.push(lower.slice(0, -1));
    }
    // -ly adverbs
    if (lower.endsWith("ly") && lower.length > 4) {
      candidates.push(lower.slice(0, -2));
      if (lower.endsWith("ally") && lower.length > 6) {
        candidates.push(lower.slice(0, -4), lower.slice(0, -4) + "al");
      }
      if (lower.endsWith("ily")) {
        candidates.push(lower.slice(0, -3) + "y");
      }
    }
  }

  return [...new Set(candidates)];
}


// ===== WORD LOOKUP =====

function getWordInfo(word) {
  const candidates = vocabMe(word);
  let fallbackLevel = null;

  for (const candidate of candidates) {
    const level = vocabM.get(candidate);
    if (!level) continue;

    fallbackLevel = fallbackLevel || level;

    const definition = vocabA.get(candidate);
    if (definition != null && String(definition).trim()) {
      return { exists: true, level, definition };
    }

    const canonical = vocabEe.get(candidate);
    if (canonical) {
      const canonLevel = vocabM.get(canonical) || level;
      const canonDef = vocabA.get(canonical);
      if (canonDef != null && String(canonDef).trim()) {
        return { exists: true, level: canonLevel, definition: canonDef };
      }
    }
  }

  return fallbackLevel
    ? { exists: true, level: fallbackLevel, definition: null }
    : { exists: false, level: null, definition: null };
}


// ===== USER VOCAB LIBRARY MERGING =====

async function mergeUserVocabLibs() {
  const loaded = (await chrome.storage.local.get({ [VOCAB_LOADED_IDS_KEY]: [] }))[VOCAB_LOADED_IDS_KEY];
  if (!Array.isArray(loaded) || loaded.length === 0) return;

  const keys = loaded.map(id => vocabLibStorageKey(id));
  const stored = await chrome.storage.local.get(keys);
  const libJsonStrings = loaded
    .map(id => stored[vocabLibStorageKey(id)])
    .filter(Boolean);
  if (libJsonStrings.length === 0) return;

  const fallbackMerge = () => {
    const levels = { ...presetObjects.levels };
    const defs = { ...presetObjects.defs };
    const variants = { ...presetObjects.variants };

    for (const s of libJsonStrings) {
      try {
        const lib = JSON.parse(s);
        const data = lib?.data || {};
        const ls = data.levels || {};
        const ds = data.defs || {};
        const vs = data.variants || {};

        for (const k of Object.keys(ls)) {
          const lk = k.toLowerCase();
          levels[lk] = ls[k];
          defs[lk] = ds[k] ?? "";
        }
        for (const k of Object.keys(vs)) {
          const lk = k.toLowerCase();
          const ck = String(vs[k] || "").toLowerCase();
          if (lk && ck && lk !== ck) variants[lk] = ck;
        }
      } catch {}
    }

    vocabM = new Map(Object.entries(levels));
    vocabA = new Map(Object.entries(defs));
    vocabEe = new Map(Object.entries(variants));
  };

  try {
    return await new Promise((resolve, reject) => {
      let worker;
      try {
        worker = new Worker(chrome.runtime.getURL("src/vocab-worker.js"));
      } catch (e) {
        reject(e);
        return;
      }

      worker.onmessage = (e) => {
        const { levels, defs, variants } = e.data || {};
        vocabM = new Map(Object.entries(levels || {}));
        vocabA = new Map(Object.entries(defs || {}));
        vocabEe = new Map(Object.entries(variants || {}));
        worker.terminate();
        resolve();
      };

      worker.onerror = () => {
        worker.terminate();
        reject(new Error("worker merge failed"));
      };

      worker.postMessage({ preset: presetObjects, libJsonStrings });
    });
  } catch {
    fallbackMerge();
  }
}

const __userVocabReady = mergeUserVocabLibs().catch(() => {});


// ===== VOCAB LIBRARY CRUD =====

async function getVocabLibs() {
  const o = await chrome.storage.local.get({ [VOCAB_LIBS_KEY]: [] });
  return { libs: Array.isArray(o[VOCAB_LIBS_KEY]) ? o[VOCAB_LIBS_KEY] : [] };
}

async function setLoadedLibs(loadedIds) {
  await chrome.storage.local.set({ [VOCAB_LOADED_IDS_KEY]: Array.isArray(loadedIds) ? loadedIds : [] });
  await mergeUserVocabLibs().catch(() => {});
  return { ok: true };
}

function writeThroughWord(libId, word, definition, variantOf) {
  const key = (word || "").trim().toLowerCase();
  if (!key) return;
  vocabM.set(key, "ss");
  vocabA.set(key, definition != null ? String(definition).trim() : "");
  if (variantOf != null) {
    const canonical = (variantOf || "").trim().toLowerCase();
    if (canonical && canonical !== key) vocabEe.set(key, canonical);
  }
}

async function addWordToVocabLib(libId, word, definition, variantOf) {
  if (!libId) return { ok: false, error: "missing libId" };

  const loaded = (await chrome.storage.local.get({ [VOCAB_LOADED_IDS_KEY]: [] }))[VOCAB_LOADED_IDS_KEY];
  const isLoaded = Array.isArray(loaded) && loaded.includes(libId);
  if (isLoaded) writeThroughWord(libId, word, definition, variantOf);

  const key = vocabLibStorageKey(libId);
  const libStr = (await chrome.storage.local.get({ [key]: null }))[key];
  let lib;
  try {
    lib = libStr ? JSON.parse(libStr) : null;
  } catch {
    return { ok: false, error: "词库数据损坏" };
  }
  if (!lib || !lib.data) return { ok: false, error: "词库不存在" };

  addWordToLibData(lib.data, word, definition, variantOf);
  await updateLibManifestChecksum(lib);
  await chrome.storage.local.set({ [key]: JSON.stringify(lib) });
  __syncOnWordAdded().catch(() => {});
  return { ok: true, synced: true };
}

async function addWordBatchToVocabLib(libId, word, definition, variants) {
  if (!libId) return { ok: false, error: "missing libId" };
  const main = (word || "").trim();
  if (!main) return { ok: false, error: "missing word" };

  const variantList = Array.isArray(variants) ? variants : [];
  const loaded = (await chrome.storage.local.get({ [VOCAB_LOADED_IDS_KEY]: [] }))[VOCAB_LOADED_IDS_KEY];
  const isLoaded = Array.isArray(loaded) && loaded.includes(libId);

  const key = vocabLibStorageKey(libId);
  const libStr = (await chrome.storage.local.get({ [key]: null }))[key];
  let lib;
  try {
    lib = libStr ? JSON.parse(libStr) : null;
  } catch {
    return { ok: false, error: "词库数据损坏" };
  }
  if (!lib || !lib.data) return { ok: false, error: "词库不存在" };

  addWordToLibData(lib.data, main, definition, null);
  if (isLoaded) writeThroughWord(libId, main, definition, null);

  const seen = new Set([main.toLowerCase()]);
  for (const raw of variantList) {
    const v = (raw || "").trim();
    if (!v) continue;
    const vk = v.toLowerCase();
    if (seen.has(vk)) continue;
    seen.add(vk);
    addWordToLibData(lib.data, v, "", main);
    if (isLoaded) writeThroughWord(libId, v, "", main);
  }

  await updateLibManifestChecksum(lib);
  await chrome.storage.local.set({ [key]: JSON.stringify(lib) });
  __syncOnWordAdded().catch(() => {});
  return { ok: true, synced: true, variantsAdded: Math.max(0, seen.size - 1) };
}

async function createVocabLib(name) {
  const id = generateLibId();
  const lib = createEmptyLib(id, name || "未命名词库");
  await updateLibManifestChecksum(lib);

  const libs = (await chrome.storage.local.get({ [VOCAB_LIBS_KEY]: [] }))[VOCAB_LIBS_KEY];
  const list = Array.isArray(libs) ? libs : [];
  list.push({ id, name: lib.manifest.name, type: "ss_custom" });

  await chrome.storage.local.set({
    [VOCAB_LIBS_KEY]: list,
    [vocabLibStorageKey(id)]: JSON.stringify(lib),
  });
  return { id, name: lib.manifest.name };
}

async function importVocabLib(jsonString, autoLoad) {
  let lib;
  try {
    lib = JSON.parse(jsonString);
  } catch {
    return { ok: false, error: "JSON 格式无效" };
  }

  if (!(await verifyLibChecksum(lib))) {
    return { ok: false, error: "校验和不匹配，文件可能已损坏" };
  }

  const id = lib.manifest?.id || generateLibId();
  lib.manifest = lib.manifest || {};
  lib.manifest.id = id;
  lib.manifest.type = "ss_custom";
  await updateLibManifestChecksum(lib);

  const libs = (await chrome.storage.local.get({ [VOCAB_LIBS_KEY]: [] }))[VOCAB_LIBS_KEY];
  const list = Array.isArray(libs) ? libs : [];
  if (!list.some(l => l.id === id)) {
    list.push({ id, name: lib.manifest.name || "导入的词库", type: "ss_custom" });
  }

  await chrome.storage.local.set({
    [VOCAB_LIBS_KEY]: list,
    [vocabLibStorageKey(id)]: JSON.stringify(lib),
  });

  if (autoLoad) {
    const loaded = (await chrome.storage.local.get({ [VOCAB_LOADED_IDS_KEY]: [] }))[VOCAB_LOADED_IDS_KEY];
    const next = Array.isArray(loaded) ? loaded : [];
    if (!next.includes(id)) next.push(id);
    await chrome.storage.local.set({ [VOCAB_LOADED_IDS_KEY]: next });
    await mergeUserVocabLibs().catch(() => {});
  }

  return { ok: true, id, name: lib.manifest.name };
}

async function exportVocabLib(libId) {
  if (!libId) return { ok: false, json: null };
  const key = vocabLibStorageKey(libId);
  const libStr = (await chrome.storage.local.get({ [key]: null }))[key];
  if (!libStr) return { ok: false, json: null };

  let lib;
  try {
    lib = JSON.parse(libStr);
  } catch {
    return { ok: false, json: null };
  }

  await updateLibManifestChecksum(lib);
  return { ok: true, json: JSON.stringify(lib) };
}

async function getVocabLoadedIds() {
  const o = await chrome.storage.local.get({ [VOCAB_LOADED_IDS_KEY]: [] });
  return { loadedIds: Array.isArray(o[VOCAB_LOADED_IDS_KEY]) ? o[VOCAB_LOADED_IDS_KEY] : [] };
}

async function getVocabLibData(libId) {
  if (!libId) return { ok: false, data: null };
  const key = vocabLibStorageKey(libId);
  const libStr = (await chrome.storage.local.get({ [key]: null }))[key];
  if (!libStr) return { ok: false, data: null };

  try {
    const lib = JSON.parse(libStr);
    return { ok: true, data: lib.data || { levels: {}, defs: {}, variants: {} } };
  } catch {
    return { ok: false, data: null };
  }
}

async function deleteVocabLib(libId) {
  if (!libId) return { ok: false, error: "missing libId" };

  const libsRaw = (await chrome.storage.local.get({ [VOCAB_LIBS_KEY]: [] }))[VOCAB_LIBS_KEY];
  const libs = Array.isArray(libsRaw) ? libsRaw : [];
  const nextLibs = libs.filter(l => l.id !== libId);

  const loadedRaw = (await chrome.storage.local.get({ [VOCAB_LOADED_IDS_KEY]: [] }))[VOCAB_LOADED_IDS_KEY];
  const loadedIds = Array.isArray(loadedRaw) ? loadedRaw : [];
  const nextLoadedIds = loadedIds.filter(id => id !== libId);

  const key = vocabLibStorageKey(libId);
  await chrome.storage.local.set({
    [VOCAB_LIBS_KEY]: nextLibs,
    [VOCAB_LOADED_IDS_KEY]: nextLoadedIds,
  });
  await chrome.storage.local.remove(key);
  await mergeUserVocabLibs().catch(() => {});

  setTimeout(() => {
    try { chrome.runtime.reload(); } catch {}
  }, 100);

  return { ok: true };
}


// ===== CLOUD VOCAB SYNC =====

let __vocabSyncApplyingRemote = false;

function __notifyVocabSync(event, payload = {}) {
  chrome.runtime.sendMessage({ type: "vocabSyncUpdated", event, ...payload }).catch(() => {});
}

function __isVocabKey(k) {
  return (
    k === VOCAB_LIBS_KEY ||
    k === VOCAB_LOADED_IDS_KEY ||
    k === "vocab_sync_meta" ||
    k.startsWith("vocab_lib_")
  );
}

async function __uploadVocabToCloud(reason = "auto") {
  try {
    const cfg = await getSyncConfig();
    if (!cfg.enabled || !cfg.token) {
      return {
        ok: false,
        skipped: true,
        error: !cfg.enabled ? "同步未启用" : "未配置 GitHub Token",
      };
    }

    const data = await packLocalVocabData();
    data.last_updated = new Date().toISOString();
    const result = await uploadToGist(data);

    if (result.ok) {
      await setLocalSyncMeta({ last_updated: data.last_updated, source: "local_upload" });
      __notifyVocabSync("upload_success", { reason, lastUpdated: data.last_updated, gistId: result.gistId });
      return { ok: true };
    } else {
      __notifyVocabSync("upload_error", { reason, error: result.error || "上传失败" });
      return result;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "上传失败";
    __notifyVocabSync("upload_error", { reason, error: msg });
    return { ok: false, error: msg };
  }
}

async function __downloadVocabFromCloud() {
  try {
    const result = await downloadFromGist();
    if (!result.ok) return result;

    const localMeta = await getLocalSyncMeta();
    const localTs = Date.parse(localMeta?.last_updated || "");
    const cloudTs = Date.parse(result.lastUpdated || "");

    if (Number.isFinite(localTs) && Number.isFinite(cloudTs) && localTs > cloudTs) {
      return { ok: false, error: "云端数据较旧，已拒绝覆盖本地", code: "CLOUD_OLDER" };
    }

    __vocabSyncApplyingRemote = true;
    await chrome.storage.local.set(result.localData);
    await setLocalSyncMeta({
      last_updated: result.lastUpdated || new Date().toISOString(),
      source: "cloud_download",
    });
    await mergeUserVocabLibs().catch(() => {});
    __notifyVocabSync("download_success", { lastUpdated: result.lastUpdated || null });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "下载失败";
    __notifyVocabSync("download_error", { error: msg });
    return { ok: false, error: msg };
  } finally {
    setTimeout(() => { __vocabSyncApplyingRemote = false; }, 100);
  }
}


chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg.type !== "string") return;
  if (msg.type === "vocabSyncUploadNow") {
    __uploadVocabToCloud("manual").then(sendResponse);
    return true;
  }
  if (msg.type === "vocabSyncDownloadNow") {
    __downloadVocabFromCloud().then(sendResponse);
    return true;
  }
  if (msg.type === "getVocabSyncConfig") {
    getSyncConfig()
      .then(cfg => sendResponse({ ok: true, config: cfg }))
      .catch(err => sendResponse({ ok: false, error: err instanceof Error ? err.message : "读取配置失败" }));
    return true;
  }
  if (msg.type === "setVocabSyncConfig") {
    setSyncConfig(msg.config || {})
      .then(cfg => sendResponse({ ok: true, config: cfg }))
      .catch(err => sendResponse({ ok: false, error: err instanceof Error ? err.message : "保存配置失败" }));
    return true;
  }
});

async function __syncOnWordAdded() {
  await __downloadVocabFromCloud().catch(() => {});
  await __uploadVocabToCloud("word_added").catch(() => {});
}

// Alarm for periodic cloud pull
const __VOCAB_SYNC_PULL_ALARM = "vocab-sync-auto-pull";

// 必须在下方 `ensureWordBackfillQueueScheduled()` 首次调用之前定义，否则会 TDZ 报错并被 .catch 吞掉
const WORD_INFO_BACKFILL_QUEUE_KEY = "word_info_backfill_queue";
const WORD_INFO_BACKFILL_ALARM = "word-info-backfill";
let isProcessingWordBackfillQueue = false;

async function ensureWordBackfillQueueKeyInitialized() {
  const raw = await chrome.storage.local.get(WORD_INFO_BACKFILL_QUEUE_KEY);
  if (raw[WORD_INFO_BACKFILL_QUEUE_KEY] !== undefined) return;
  await chrome.storage.local.set({ [WORD_INFO_BACKFILL_QUEUE_KEY]: [] });
}

function __ensureVocabSyncAlarm() {
  try {
    chrome.alarms.create(__VOCAB_SYNC_PULL_ALARM, { delayInMinutes: 15, periodInMinutes: 15 });
  } catch {}
}

chrome.runtime.onInstalled.addListener(() => {
  __ensureVocabSyncAlarm();
  __downloadVocabFromCloud().catch(() => {});
});
chrome.runtime.onStartup.addListener(() => {
  __ensureVocabSyncAlarm();
  __downloadVocabFromCloud().catch(() => {});
});
__ensureVocabSyncAlarm();
ensureWordBackfillQueueKeyInitialized()
  .then(() => ensureWordBackfillQueueScheduled())
  .catch(() => {});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm && alarm.name === __VOCAB_SYNC_PULL_ALARM) {
    __downloadVocabFromCloud().catch(() => {});
    return;
  }
  if (alarm && alarm.name === WORD_INFO_BACKFILL_ALARM) {
    processWordBackfillQueue().catch(() => {});
  }
});


// ===== LLM INFRASTRUCTURE =====

const DEFAULT_PROVIDERS = {
  gemini:   { apiKey: "", model: "gemini-2.0-flash" },
  chatgpt:  { apiKey: "", model: "gpt-4.1-mini" },
  deepseek: { apiKey: "", model: "deepseek-chat" },
  qwen:     { apiKey: "", model: "qwen3-flash" },
  kimi:     { apiKey: "", model: "kimi-k2.5" },
};

const PROVIDER_META = {
  gemini:   { format: "gemini",            baseUrl: "",                                          label: "Gemini"   },
  chatgpt:  { format: "openai-compatible", baseUrl: "https://api.openai.com",                   label: "ChatGPT"  },
  deepseek: { format: "openai-compatible", baseUrl: "https://api.deepseek.com",                 label: "DeepSeek" },
  qwen:     { format: "openai-compatible", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode", label: "Qwen" },
  kimi:     { format: "openai-compatible", baseUrl: "https://api.moonshot.cn",                  label: "Kimi"     },
};

// Extract the active provider's resolved LLM config from settings
function extractLlmConfig(llmSettings) {
  const providerName = llmSettings.activeProvider;
  const providerConfig = llmSettings.providers[providerName];
  const meta = PROVIDER_META[providerName];
  return {
    format:  meta.format,
    apiKey:  providerConfig.apiKey,
    baseUrl: meta.baseUrl,
    model:   providerConfig.model,
  };
}

// Normalize legacy single-provider LLM config to the multi-provider format
function normalizeLlmConfig(llmSettings) {
  if (llmSettings && typeof llmSettings === "object" && "activeProvider" in llmSettings) {
    return llmSettings;
  }
  const legacy = llmSettings;
  const providers = { ...DEFAULT_PROVIDERS };
  if (legacy?.apiKey) {
    const providerName = legacy.format === "gemini" ? "gemini" : "chatgpt";
    providers[providerName] = {
      apiKey: legacy.apiKey,
      model:  legacy.model || DEFAULT_PROVIDERS[providerName].model,
    };
    return { activeProvider: providerName, providers };
  }
  return { activeProvider: "gemini", providers };
}

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

// Build a Gemini API request object
function buildGeminiRequest(prompt, llmConfig) {
  const model = llmConfig.model || "gemini-2.0-flash";
  return {
    url: `${GEMINI_API_BASE}/${model}:generateContent?key=${llmConfig.apiKey}`,
    body: {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json",
        thinkingConfig: { thinkingBudget: 0 },
      },
    },
  };
}

// Build an OpenAI-compatible API request object
function buildOpenAIRequest(prompt, llmConfig) {
  const url = `${llmConfig.baseUrl.replace(/\/+$/, "")}/v1/chat/completions`;
  const body = {
    model: llmConfig.model,
    messages: [
      { role: "system", content: "You are a helpful English reading assistant. Always respond with valid JSON." },
      { role: "user", content: prompt },
    ],
    temperature: 0.1,
    response_format: { type: "json_object" },
  };
  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${llmConfig.apiKey}`,
  };
  return { url, body, headers };
}


// ===== SETTINGS =====

const DEFAULT_CONFIG = {
  llm: {
    activeProvider: "gemini",
    providers: { ...DEFAULT_PROVIDERS },
  },
  articleDomains: [
    "技术/编程",
    "医学",
    "法律",
    "金融",
    "学术/科研",
    "文学",
  ],
  disabledSites: [],
  showFloatingBall: true,
};

async function loadSettings() {
  const keys = Object.keys(DEFAULT_CONFIG);
  const stored = await chrome.storage.sync.get(keys);
  if (!Array.isArray(stored.disabledSites)) stored.disabledSites = [];
  if (!Array.isArray(stored.articleDomains)) stored.articleDomains = [...DEFAULT_CONFIG.articleDomains];
  stored.articleDomains = stored.articleDomains
    .map(v => String(v || "").trim())
    .filter(Boolean)
    .slice(0, 50);
  stored.llm = normalizeLlmConfig(stored.llm);
  return stored;
}

async function saveSettings(updates) {
  const current = await loadSettings();
  const merged = { ...current, ...updates };
  if (updates.llm) merged.llm = { ...current.llm, ...updates.llm };
  await chrome.storage.sync.set(merged);
  return merged;
}


// ===== SITE ENABLE/DISABLE =====

function getHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

async function isSiteEnabled(hostname) {
  const settings = await loadSettings();
  return !settings.disabledSites.includes(hostname);
}

async function toggleSite(hostname) {
  const settings = await loadSettings();
  const idx = settings.disabledSites.indexOf(hostname);
  let enabled;

  if (idx >= 0) {
    settings.disabledSites.splice(idx, 1);
    enabled = true;
  } else {
    settings.disabledSites.push(hostname);
    enabled = false;
  }

  await chrome.storage.sync.set({ disabledSites: settings.disabledSites });
  return { enabled, disabledSites: settings.disabledSites };
}


// ===== ICON MANAGEMENT =====

async function updateIcon(tabId, active) {
  const suffix = active ? "-on" : "";
  try {
    await chrome.action.setIcon({
      path: {
        16:  `src/icons/icon16${suffix}.png`,
        48:  `src/icons/icon48${suffix}.png`,
        128: `src/icons/icon128${suffix}.png`,
      },
      tabId,
    });
  } catch {}
}


// ===== PAUSED TABS MANAGEMENT =====

async function isTabPaused(tabId) {
  const { pausedTabs = [] } = await chrome.storage.session.get({ pausedTabs: [] });
  return pausedTabs.includes(tabId);
}

async function pauseTab(tabId) {
  const { pausedTabs = [] } = await chrome.storage.session.get({ pausedTabs: [] });
  if (!pausedTabs.includes(tabId)) {
    pausedTabs.push(tabId);
    await chrome.storage.session.set({ pausedTabs });
  }
}

async function resumeTab(tabId) {
  const { pausedTabs = [] } = await chrome.storage.session.get({ pausedTabs: [] });
  const updated = pausedTabs.filter(id => id !== tabId);
  await chrome.storage.session.set({ pausedTabs: updated });
}


// ===== TAB EVENT LISTENERS =====

chrome.tabs.onRemoved.addListener(async tabId => {
  await resumeTab(tabId);
});

chrome.tabs.onActivated.addListener(async event => {
  try {
    const tab = await chrome.tabs.get(event.tabId);
    if (tab.url) {
      const hostname = getHostname(tab.url);
      const active = tab.url.startsWith("file:")
        ? !await isTabPaused(event.tabId)
        : (hostname ? await isSiteEnabled(hostname) : false) && !await isTabPaused(event.tabId);
      updateIcon(event.tabId, active);
    }
  } catch {}
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url) {
    const hostname = getHostname(tab.url);
    const active = tab.url.startsWith("file:")
      ? !await isTabPaused(tabId)
      : (hostname ? await isSiteEnabled(hostname) : false) && !await isTabPaused(tabId);
    updateIcon(tabId, active);
  }
});

chrome.commands.onCommand.addListener(async command => {
  if (command !== "toggle-page") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) return;

  const hostname = getHostname(tab.url);
  if (!tab.url.startsWith("file:") && !(hostname ? await isSiteEnabled(hostname) : false)) return;

  if (await isTabPaused(tab.id)) {
    await resumeTab(tab.id);
    updateIcon(tab.id, true);
    chrome.tabs.sendMessage(tab.id, { type: "resume" }).catch(() => {});
  } else {
    await pauseTab(tab.id);
    updateIcon(tab.id, false);
    chrome.tabs.sendMessage(tab.id, { type: "pause" }).catch(() => {});
  }
});


// ===== MAIN MESSAGE HANDLER =====

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(result => {
      try { sendResponse(result); } catch {}
    });
  return true;
});

async function handleMessage(message, sender) {
  switch (message.type) {

    case "QUERY_WORD":
      await __userVocabReady;
      return getWordInfo(message.word);

    case "QUERY_WORDS":
      await __userVocabReady;
      return (Array.isArray(message.words) ? message.words : []).map(w => getWordInfo(w));

    case "checkActive": {
      const tabId = sender.tab?.id;
      const url = sender.tab?.url ?? "";
      const hostname = getHostname(url);
      if (!tabId) return { active: false };

      let active;
      if (url.startsWith("file:")) {
        active = !(tabId && await isTabPaused(tabId));
      } else {
        active = (hostname ? await isSiteEnabled(hostname) : false) && !(tabId && await isTabPaused(tabId));
      }

      updateIcon(tabId, active);
      return { active };
    }

    case "toggleSite": {
      const { hostname } = message;
      const result = await toggleSite(hostname);
      const allTabs = await chrome.tabs.query({});
      for (const tab of allTabs) {
        if (tab.id && tab.url && getHostname(tab.url) === hostname) {
          updateIcon(tab.id, result.enabled);
          chrome.tabs.sendMessage(tab.id, { type: result.enabled ? "activate" : "deactivate" }).catch(() => {});
        }
      }
      return { enabled: result.enabled, disabledSites: result.disabledSites };
    }

    case "pauseTab": {
      const { tabId } = message;
      await pauseTab(tabId);
      updateIcon(tabId, false);
      chrome.tabs.sendMessage(tabId, { type: "pause" }).catch(() => {});
      return { ok: true };
    }

    case "resumeTab": {
      const { tabId } = message;
      await resumeTab(tabId);
      updateIcon(tabId, true);
      chrome.tabs.sendMessage(tabId, { type: "resume" }).catch(() => {});
      return { ok: true };
    }

    case "getTabState": {
      const { tabId, hostname } = message;
      if (await isTabPaused(tabId)) return { state: "paused" };
      if (hostname ? await isSiteEnabled(hostname) : false) return { state: "active" };
      return { state: "disabled" };
    }

    case "hasApiKey": {
      const settings = await loadSettings();
      return { hasKey: !!extractLlmConfig(settings.llm).apiKey };
    }

    case "getConfig":
      return loadSettings();

    case "updateConfig": {
      const saved = await saveSettings(message.config);
      // 若悬浮球开关变更，广播给所有 content script
      if (typeof message.config?.showFloatingBall === "boolean") {
        const tabs = await chrome.tabs.query({});
        for (const tab of tabs) {
          try {
            await chrome.tabs.sendMessage(tab.id, {
              type: "setFloatingBall",
              show: message.config.showFloatingBall,
            });
          } catch {}
        }
      }
      return saved;
    }

    case "getVocabLibs":
      return getVocabLibs();

    case "getVocabLoadedIds":
      return getVocabLoadedIds();

    case "getVocabSyncConfig":
      return { ok: true, config: await getSyncConfig() };

    case "setVocabSyncConfig":
      return { ok: true, config: await setSyncConfig(message.config || {}) };

    case "vocabSyncUploadNow":
      return __uploadVocabToCloud("manual");

    case "vocabSyncDownloadNow":
      return __downloadVocabFromCloud();

    case "setLoadedLibs":
      return setLoadedLibs(message.loadedIds);

    case "addWordToVocabLib":
      return addWordToVocabLib(message.libId, message.word, message.definition, message.variantOf);

    case "addWordBatchToVocabLib":
      return addWordBatchToVocabLib(message.libId, message.word, message.definition, message.variants);

    case "importVocabLib":
      return importVocabLib(message.jsonString, message.autoLoad);

    case "exportVocabLib":
      return exportVocabLib(message.libId);

    case "createVocabLib":
      return createVocabLib(message.name);

    case "deleteVocabLib":
      return deleteVocabLib(message.libId);

    case "getVocabLibData":
      return getVocabLibData(message.libId);

    case "generateAndAddWord":
      return generateAndAddWord(message.word, message.libId, message.domain);

    case "getAddWordPrefs":
      return getAddWordPrefs();

    case "processWordBackfillNow":
      await processWordBackfillQueue();
      return { ok: true };

    default:
      return { error: "Unknown message type" };
  }
}


// ===== ADD WORD VIA AI =====

const LAST_USED_LIB_KEY = "add_word_last_lib_id";
const LAST_USED_DOMAIN_KEY = "add_word_last_domain";
const WORD_INFO_TIMEOUT_MS = 15000;
const WORD_INFO_BACKFILL_TIMEOUT_MS = 20000;
const WORD_INFO_CACHE_TTL_MS = 5 * 60 * 1000;
const wordInfoCache = new Map();

function buildWordInfoPrompt(word, domain) {
  return `System: fast JSON mode. Output JSON only, no explanation.
Task: word="${word}"${domain ? `, domain="${domain}"` : ""}.
Schema: {"definition":"中文释义<=12字","variants":["word_form"]}.
Rules:
1) definition must be concise Chinese.
2) variants only morphological forms; max 4.
3) If none, use [].
Return one-line JSON only.`;
}

function normalizeWordInfo(parsed) {
  return {
    definition: String(parsed?.definition || "").trim().slice(0, 32),
    variants: Array.isArray(parsed?.variants)
      ? parsed.variants.map(v => String(v).trim()).filter(Boolean).slice(0, 8)
      : [],
  };
}

function parseWordInfoResponse(responseText) {
  let text = String(responseText || "").trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();

  const tryParse = (input) => {
    try {
      return JSON.parse(input);
    } catch {
      return null;
    }
  };

  let parsed = tryParse(text);
  if (parsed) return parsed;

  const objectMatch = text.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    parsed = tryParse(objectMatch[0]);
    if (parsed) return parsed;
  }
  // Graceful fallback for non-JSON model outputs in async backfill.
  const normalizedLine = text
    .replace(/`+/g, "")
    .replace(/^[\s\-\*\d\.\)\(]+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  if (normalizedLine) {
    return {
      definition: normalizedLine.slice(0, 20),
      variants: [],
    };
  }
  throw new Error("AI 返回 JSON 解析失败");
}

function localWordInfoFallback(word) {
  return {
    definition: `${String(word || "").trim()}（待补充）`,
    variants: [],
    source: "fallback",
  };
}

function fetchWithTimeout(url, init, timeoutMs = WORD_INFO_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

function getWordInfoCacheKey(word, domain) {
  return `${String(word || "").trim().toLowerCase()}::${String(domain || "").trim().toLowerCase()}`;
}

function invalidateWordInfoCache(word, domain) {
  wordInfoCache.delete(getWordInfoCacheKey(word, domain));
}

async function generateWordInfo(word, domain, options = {}) {
  const { timeoutMs = WORD_INFO_TIMEOUT_MS, skipCache = false } = options;
  const settings = await loadSettings();
  const llmConfig = extractLlmConfig(settings.llm);
  if (!llmConfig.apiKey) throw new Error("API key 未配置，请先在设置中填写");

  const cacheKey = getWordInfoCacheKey(word, domain);
  if (!skipCache) {
    const cached = wordInfoCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < WORD_INFO_CACHE_TTL_MS) {
      const def = cached.value?.definition;
      const defStr = def != null ? String(def) : "";
      // 不把「待补充」或空释义当作可用缓存，避免回填永远命中脏数据
      if (defStr.trim() && !defStr.includes("待补充")) {
        return { ...cached.value, fromCache: true, latencyMs: 0 };
      }
      wordInfoCache.delete(cacheKey);
    }
  }

  const prompt = buildWordInfoPrompt(word, domain);
  let responseText;
  const startedAt = Date.now();

  if (llmConfig.format === "gemini") {
    const { url, body } = buildGeminiRequest(prompt, llmConfig);
    body.generationConfig = {
      ...(body.generationConfig || {}),
      maxOutputTokens: 96,
      candidateCount: 1,
    };
    const res = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }, timeoutMs);
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Gemini API 错误 (${res.status}): ${err.slice(0, 200)}`);
    }
    const data = await res.json();
    responseText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  } else {
    const { url, body, headers } = buildOpenAIRequest(prompt, llmConfig);
    body.max_tokens = 96;
    body.n = 1;
    const res = await fetchWithTimeout(url, { method: "POST", headers, body: JSON.stringify(body) }, timeoutMs);
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`API 错误 (${res.status}): ${err.slice(0, 200)}`);
    }
    const data = await res.json();
    responseText = data?.choices?.[0]?.message?.content;
  }

  if (!responseText) throw new Error("AI 返回了空响应");
  const normalized = normalizeWordInfo(parseWordInfoResponse(responseText));
  const result = { ...normalized, source: "llm", latencyMs: Date.now() - startedAt };
  const outDef = String(result.definition || "");
  if (outDef.trim() && !outDef.includes("待补充")) {
    wordInfoCache.set(cacheKey, { ts: Date.now(), value: result });
  }
  return result;
}

async function broadcastForceRescan(word, reason = "wordAdded") {
  const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
  for (const tab of tabs) {
    chrome.tabs.sendMessage(tab.id, { type: "forceRescan", reason, word }).catch(() => {});
  }
}

async function broadcastWordWrittenToAddWordPopups({ word, libId, definition, variants, source }) {
  const tabs = await chrome.tabs.query({
    url: ["chrome-extension://*/src/add-word.html*"],
  });
  for (const tab of tabs) {
    chrome.tabs
      .sendMessage(tab.id, {
        type: "wordDefinitionWritten",
        word,
        libId,
        definition,
        variants: Array.isArray(variants) ? variants : [],
        source: source || "backfill",
      })
      .catch(() => {});
  }
}

function scheduleWordBackfillAlarm(delayMs = 5000) {
  try {
    const when = Date.now() + Math.max(2000, delayMs);
    chrome.alarms.create(WORD_INFO_BACKFILL_ALARM, { when });
  } catch {}
}

async function enqueueWordBackfillJob(word, libId, domain) {
  const raw = await chrome.storage.local.get({ [WORD_INFO_BACKFILL_QUEUE_KEY]: [] });
  const queue = Array.isArray(raw[WORD_INFO_BACKFILL_QUEUE_KEY]) ? raw[WORD_INFO_BACKFILL_QUEUE_KEY] : [];
  const key = `${String(word || "").trim().toLowerCase()}::${libId}::${String(domain || "").trim().toLowerCase()}`;
  const exists = queue.some((job) => (
    `${String(job?.word || "").trim().toLowerCase()}::${job?.libId}::${String(job?.domain || "").trim().toLowerCase()}` === key
  ));
  if (exists) {
    scheduleWordBackfillAlarm(3000);
    processWordBackfillQueue().catch(() => {});
    return;
  }
  queue.push({ word, libId, domain: domain || "", attempts: 0, queuedAt: Date.now() });
  await chrome.storage.local.set({ [WORD_INFO_BACKFILL_QUEUE_KEY]: queue });
  scheduleWordBackfillAlarm(3000);
  processWordBackfillQueue().catch(() => {});
}

async function ensureWordBackfillQueueScheduled() {
  const raw = await chrome.storage.local.get({ [WORD_INFO_BACKFILL_QUEUE_KEY]: [] });
  const queue = Array.isArray(raw[WORD_INFO_BACKFILL_QUEUE_KEY]) ? raw[WORD_INFO_BACKFILL_QUEUE_KEY] : [];
  if (!queue.length) return;
  scheduleWordBackfillAlarm(3000);
  processWordBackfillQueue().catch(() => {});
}

async function processWordBackfillQueue() {
  if (isProcessingWordBackfillQueue) return;
  isProcessingWordBackfillQueue = true;
  try {
    const raw = await chrome.storage.local.get({ [WORD_INFO_BACKFILL_QUEUE_KEY]: [] });
    const queue = Array.isArray(raw[WORD_INFO_BACKFILL_QUEUE_KEY]) ? raw[WORD_INFO_BACKFILL_QUEUE_KEY] : [];
    if (!queue.length) return;

    const job = queue.shift();
    await chrome.storage.local.set({ [WORD_INFO_BACKFILL_QUEUE_KEY]: queue });
    if (!job?.word || !job?.libId) return;

    try {
      const generated = await generateWordInfo(job.word, job.domain || "", {
        timeoutMs: WORD_INFO_BACKFILL_TIMEOUT_MS,
        skipCache: true,
      });
      const hasDefinition = generated?.definition && !String(generated.definition).includes("待补充");
      if (!hasDefinition) throw new Error("empty backfill definition");
      const addRes = await addWordBatchToVocabLib(job.libId, job.word, generated.definition, generated.variants || []);
      if (!addRes?.ok) {
        throw new Error(addRes?.error || "addWordBatchToVocabLib failed");
      }
      invalidateWordInfoCache(job.word, job.domain || "");
      await mergeUserVocabLibs().catch(() => {});
      await broadcastForceRescan(job.word, "wordBackfilled");
      await broadcastWordWrittenToAddWordPopups({
        word: job.word,
        libId: job.libId,
        definition: generated.definition,
        variants: generated.variants || [],
        source: "backfill",
      });
      __scheduleVocabAutoUpload("word_backfilled");
    } catch (err) {
      const attempts = Number(job?.attempts || 0) + 1;
      const lastError = err instanceof Error ? err.message : String(err || "backfill_failed");
      queue.push({ ...job, attempts, lastError });
      await chrome.storage.local.set({ [WORD_INFO_BACKFILL_QUEUE_KEY]: queue });
    }

    if (queue.length) scheduleWordBackfillAlarm(5000);
  } finally {
    isProcessingWordBackfillQueue = false;
  }
}

async function generateAndAddWord(word, libId, domain) {
  if (!word) return { ok: false, error: "缺少单词" };
  if (!libId) return { ok: false, error: "请选择词库" };
  const startedAt = Date.now();
  const queryStartedAt = Date.now();
  try {
    const generated = await generateWordInfo(word, domain, { timeoutMs: WORD_INFO_TIMEOUT_MS });
    const { definition, variants } = generated;
    const queryLatencyMs = Date.now() - queryStartedAt;
    const result = await addWordBatchToVocabLib(libId, word, definition, variants);
    if (result.ok) {
      // Ensure the target library is loaded so content queries can hit the new word immediately.
      const loadedRaw = (await chrome.storage.local.get({ [VOCAB_LOADED_IDS_KEY]: [] }))[VOCAB_LOADED_IDS_KEY];
      const loadedIds = Array.isArray(loadedRaw) ? loadedRaw : [];
      if (!loadedIds.includes(libId)) {
        loadedIds.push(libId);
        await chrome.storage.local.set({ [VOCAB_LOADED_IDS_KEY]: loadedIds });
        await mergeUserVocabLibs().catch(() => {});
      }

      await chrome.storage.local.set({
        [LAST_USED_LIB_KEY]: libId,
        [LAST_USED_DOMAIN_KEY]: domain || "",
      });
      __scheduleVocabAutoUpload("add_word");
      await broadcastForceRescan(word, "wordAdded");
    }
    return {
      ok: result.ok,
      definition,
      variants,
      error: result.error,
      source: "llm",
      queryLatencyMs,
      latencyMs: Date.now() - startedAt,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "添加失败" };
  }
}

async function getAddWordPrefs() {
  const data = await chrome.storage.local.get({
    [LAST_USED_LIB_KEY]: "",
    [LAST_USED_DOMAIN_KEY]: "",
  });
  return { lastLibId: data[LAST_USED_LIB_KEY], lastDomain: data[LAST_USED_DOMAIN_KEY] };
}


// ===== CONTEXT MENU =====

function setupContextMenu() {
  if (!chrome.contextMenus) return;
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "float-add-word",
      title: "添加到Float词库",
      contexts: ["selection"],
    });
  });
}

chrome.runtime.onInstalled.addListener(setupContextMenu);
chrome.runtime.onStartup.addListener(setupContextMenu);
setupContextMenu();

chrome.contextMenus.onClicked.addListener(async info => {
  if (info.menuItemId !== "float-add-word") return;
  const word = (info.selectionText || "").trim();
  if (!word) return;

  const W = 400, H = 460;
  let left, top;
  try {
    const win = await chrome.windows.getLastFocused();
    left = Math.round(win.left + (win.width - W) / 2);
    top = Math.round(win.top + (win.height - H) / 2);
  } catch {
    left = 200;
    top = 200;
  }

  chrome.windows.create({
    url: chrome.runtime.getURL(`src/add-word.html?word=${encodeURIComponent(word)}`),
    type: "popup",
    width: W,
    height: H,
    left,
    top,
    focused: true,
  });
});
