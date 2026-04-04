import {
  VOCAB_LIBS_KEY,
  VOCAB_LOADED_IDS_KEY,
  VOCAB_SYNC_CONFIG_KEY,
  VOCAB_SYNC_META_KEY,
  getVocabLibStorageKeysFromLibs,
  buildVocabSyncData,
  parseVocabSyncData,
  nowIsoTimestamp,
} from "./vocab-lib.js";

const GIST_FILE_NAME = "float-vocab-sync.json";

function normalizeSyncConfig(raw) {
  const cfg = raw && typeof raw === "object" ? raw : {};
  return {
    enabled: cfg.enabled !== false,
    token: typeof cfg.token === "string" ? cfg.token.trim() : "",
    gistId: typeof cfg.gistId === "string" ? cfg.gistId.trim() : "",
  };
}

export async function getSyncConfig() {
  const raw = (await chrome.storage.sync.get({ [VOCAB_SYNC_CONFIG_KEY]: {} }))[VOCAB_SYNC_CONFIG_KEY];
  return normalizeSyncConfig(raw);
}

export async function setSyncConfig(nextConfig) {
  const prev = await getSyncConfig();
  const merged = normalizeSyncConfig({ ...prev, ...nextConfig });
  await chrome.storage.sync.set({ [VOCAB_SYNC_CONFIG_KEY]: merged });
  return merged;
}

export async function getLocalSyncMeta() {
  return (await chrome.storage.local.get({ [VOCAB_SYNC_META_KEY]: { last_updated: null } }))[VOCAB_SYNC_META_KEY];
}

export async function setLocalSyncMeta(meta) {
  const safeMeta = meta && typeof meta === "object" ? meta : {};
  await chrome.storage.local.set({
    [VOCAB_SYNC_META_KEY]: {
      last_updated:
        typeof safeMeta.last_updated === "string"
          ? safeMeta.last_updated
          : nowIsoTimestamp(),
      source: safeMeta.source || "local",
    },
  });
}

export async function packLocalVocabData() {
  const base = await chrome.storage.local.get({
    [VOCAB_LIBS_KEY]: [],
    [VOCAB_LOADED_IDS_KEY]: [],
  });
  const libs = Array.isArray(base[VOCAB_LIBS_KEY]) ? base[VOCAB_LIBS_KEY] : [];
  const loadedIds = Array.isArray(base[VOCAB_LOADED_IDS_KEY])
    ? base[VOCAB_LOADED_IDS_KEY]
    : [];

  const keys = getVocabLibStorageKeysFromLibs(libs);
  const entriesRaw = keys.length > 0 ? await chrome.storage.local.get(keys) : {};
  const libEntries = {};
  for (const k of keys) {
    if (typeof entriesRaw[k] === "string") libEntries[k] = entriesRaw[k];
  }

  const meta = await getLocalSyncMeta();
  const lastUpdated = typeof meta?.last_updated === "string" ? meta.last_updated : nowIsoTimestamp();
  return buildVocabSyncData({ libs, loadedIds, libEntries, lastUpdated });
}

async function gistFetch(path, options, token) {
  const resp = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...(options?.headers || {}),
    },
  });
  return resp;
}

export async function uploadToGist(syncData) {
  const cfg = await getSyncConfig();
  if (!cfg.enabled) return { ok: false, error: "同步未启用", code: "DISABLED" };
  if (!cfg.token) return { ok: false, error: "未配置 GitHub Token", code: "MISSING_TOKEN" };

  const content = JSON.stringify(syncData);
  const body = {
    description: "Float vocab sync data",
    public: false,
    files: {
      [GIST_FILE_NAME]: {
        content,
      },
    },
  };

  let gistId = cfg.gistId;
  let resp;

  if (gistId) {
    resp = await gistFetch(`/gists/${gistId}`, { method: "PATCH", body: JSON.stringify(body) }, cfg.token);
    if (resp.status === 404) {
      gistId = "";
    } else if (!resp.ok) {
      const text = await resp.text();
      return { ok: false, error: `上传失败(${resp.status}): ${text.slice(0, 180)}`, code: "PATCH_FAILED" };
    }
  }

  if (!gistId) {
    resp = await gistFetch("/gists", { method: "POST", body: JSON.stringify(body) }, cfg.token);
    if (!resp.ok) {
      const text = await resp.text();
      return { ok: false, error: `创建 Gist 失败(${resp.status}): ${text.slice(0, 180)}`, code: "CREATE_FAILED" };
    }
  }

  const json = await resp.json();
  const newGistId = json?.id;
  if (!newGistId) return { ok: false, error: "Gist 响应缺少 id", code: "INVALID_RESPONSE" };
  if (newGistId !== cfg.gistId) await setSyncConfig({ gistId: newGistId });
  return { ok: true, gistId: newGistId, url: json?.html_url || "" };
}

export async function downloadFromGist() {
  const cfg = await getSyncConfig();
  if (!cfg.enabled) return { ok: false, error: "同步未启用", code: "DISABLED" };
  if (!cfg.token) return { ok: false, error: "未配置 GitHub Token", code: "MISSING_TOKEN" };
  if (!cfg.gistId) return { ok: false, error: "未配置 Gist ID", code: "MISSING_GIST_ID" };

  const resp = await gistFetch(`/gists/${cfg.gistId}`, { method: "GET" }, cfg.token);
  if (!resp.ok) {
    const text = await resp.text();
    return { ok: false, error: `下载失败(${resp.status}): ${text.slice(0, 180)}`, code: "GET_FAILED" };
  }
  const json = await resp.json();
  const files = json?.files || {};
  const file =
    files[GIST_FILE_NAME] ||
    files["sync_data.json"] ||
    Object.values(files)[0];
  const content = file?.content;
  if (!content || typeof content !== "string") {
    return { ok: false, error: "Gist 文件内容为空", code: "EMPTY_CONTENT" };
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { ok: false, error: "Gist 文件不是有效 JSON", code: "BAD_JSON" };
  }
  const unpacked = parseVocabSyncData(parsed);
  if (!unpacked.ok) return { ok: false, error: unpacked.error, code: "BAD_PAYLOAD" };
  return { ok: true, syncData: parsed, localData: unpacked.localData, lastUpdated: unpacked.lastUpdated };
}
