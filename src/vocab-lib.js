/**
 * 用户词库：storage 键、JSON 结构、checksum 与空库/加词 helpers。
 * 词库 type 固定为 ss_custom，等级统一为 "ss"。
 */

export const VOCAB_LIBS_KEY = "vocab_libs";
export const VOCAB_LOADED_IDS_KEY = "vocab_loaded_ids";
export const VOCAB_SYNC_CONFIG_KEY = "vocab_sync_config";
export const VOCAB_SYNC_META_KEY = "vocab_sync_meta";

export function vocabLibStorageKey(libId) {
  return `vocab_lib_${libId}`;
}

export function getVocabLibStorageKeysFromLibs(libs) {
  if (!Array.isArray(libs)) return [];
  return libs
    .map((lib) => vocabLibStorageKey(lib?.id))
    .filter((k) => typeof k === "string" && k !== "vocab_lib_");
}

export function nowIsoTimestamp() {
  return new Date().toISOString();
}

/**
 * 构建用于云同步的数据包。
 * libEntries 结构：{ "vocab_lib_xxx": "<json string>" }
 */
export function buildVocabSyncData({ libs, loadedIds, libEntries, lastUpdated }) {
  const safeLibs = Array.isArray(libs) ? libs : [];
  const safeLoadedIds = Array.isArray(loadedIds) ? loadedIds : [];
  const safeEntries = libEntries && typeof libEntries === "object" ? libEntries : {};
  const data = {
    version: 1,
    last_updated: lastUpdated || nowIsoTimestamp(),
    vocab_libs: safeLibs,
    vocab_loaded_ids: safeLoadedIds,
    vocab_entries: safeEntries,
  };
  return data;
}

/**
 * 解析云端同步包并恢复为可直接写入 chrome.storage.local 的结构。
 */
export function parseVocabSyncData(syncData) {
  if (!syncData || typeof syncData !== "object") {
    return {
      ok: false,
      error: "同步数据为空或格式错误",
      localData: null,
      lastUpdated: null,
    };
  }

  const libs = Array.isArray(syncData.vocab_libs) ? syncData.vocab_libs : [];
  const loadedIds = Array.isArray(syncData.vocab_loaded_ids)
    ? syncData.vocab_loaded_ids
    : [];
  const entries =
    syncData.vocab_entries && typeof syncData.vocab_entries === "object"
      ? syncData.vocab_entries
      : {};

  const localData = {
    [VOCAB_LIBS_KEY]: libs,
    [VOCAB_LOADED_IDS_KEY]: loadedIds,
  };

  for (const lib of libs) {
    const key = vocabLibStorageKey(lib?.id);
    if (!key || key === "vocab_lib_") continue;
    if (typeof entries[key] === "string") {
      localData[key] = entries[key];
    }
  }

  return {
    ok: true,
    error: null,
    localData,
    lastUpdated:
      typeof syncData.last_updated === "string" ? syncData.last_updated : null,
  };
}

const SS_LEVEL = "ss";
const TYPE_SS_CUSTOM = "ss_custom";

/** 对 data 对象做规范化 JSON 字符串再算 SHA-256，返回十六进制字符串 */
export async function computeDataChecksum(data) {
  const str = JSON.stringify(data);
  const buf = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** 校验词库 JSON 的 manifest.checksum 与 data 是否一致 */
export async function verifyLibChecksum(lib) {
  if (!lib?.manifest?.checksum || !lib?.data) return false;
  const expected = await computeDataChecksum(lib.data);
  return lib.manifest.checksum.toLowerCase() === expected.toLowerCase();
}

/** 为 lib 的 manifest 写入 count 与 checksum（就地修改） */
export async function updateLibManifestChecksum(lib) {
  if (!lib.data) return lib;
  const levels = lib.data.levels || {};
  const count = Object.keys(levels).length;
  lib.manifest = lib.manifest || {};
  lib.manifest.count = count;
  lib.manifest.type = TYPE_SS_CUSTOM;
  lib.manifest.checksum = await computeDataChecksum(lib.data);
  return lib;
}

/** 创建空词库 JSON 结构 */
export function createEmptyLib(id, name) {
  return {
    manifest: {
      name: name || "未命名词库",
      id,
      type: TYPE_SS_CUSTOM,
      count: 0,
      checksum: "",
    },
    data: {
      levels: {},
      defs: {},
      variants: {},
    },
  };
}

/** 规范化单词键：小写 */
function normKey(word) {
  return String(word || "").trim().toLowerCase();
}

/** 在 lib.data 中添加或覆盖一个词；variant 可选，为变体指向的 canonical 词 */
export function addWordToLibData(data, word, definition, variantOf = null) {
  const k = normKey(word);
  if (!k) return data;
  data.levels = data.levels || {};
  data.defs = data.defs || {};
  data.variants = data.variants || {};
  data.levels[k] = SS_LEVEL;
  data.defs[k] = definition != null ? String(definition).trim() : "";
  if (variantOf != null) {
    const canon = normKey(variantOf);
    if (canon && canon !== k) data.variants[k] = canon;
  }
  return data;
}

/** 检查 data 中是否已有该词 */
export function hasWordInLibData(data, word) {
  const k = normKey(word);
  return !!(data?.levels && data.levels[k]);
}

/** 生成 UUID 风格 id */
export function generateLibId() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === "x" ? r : (r & 3) | 8;
        return v.toString(16);
      });
}
