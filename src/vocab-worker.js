/**
 * Web Worker：解析用户词库 JSON 并合并到预设数据。
 * 输入：{ preset: { levels, defs, variants }, libJsonStrings: string[] }
 * 输出：{ levels, defs, variants } 普通对象，主线程转 Map。
 * 合并规则：先预设，再按顺序合并各库；用户库等级均为 ss，同键后写入覆盖。
 */

const SS = "ss";

function mergeLibInto(levels, defs, variants, libData) {
  const l = libData?.levels || {};
  const d = libData?.defs || {};
  const v = libData?.variants || {};
  for (const word of Object.keys(l)) {
    const key = word.toLowerCase();
    levels[key] = SS;
    if (d[key] !== undefined) defs[key] = d[key];
  }
  for (const word of Object.keys(d)) {
    const key = word.toLowerCase();
    if (levels[key] === undefined) levels[key] = SS;
    defs[key] = d[key];
  }
  for (const [variant, canonical] of Object.entries(v)) {
    const vk = variant.toLowerCase();
    const ck = canonical.toLowerCase();
    variants[vk] = ck;
  }
}

self.onmessage = function (e) {
  const { preset, libJsonStrings } = e.data || {};
  const levels = { ...(preset?.levels || {}) };
  const defs = { ...(preset?.defs || {}) };
  const variants = { ...(preset?.variants || {}) };

  const libs = Array.isArray(libJsonStrings) ? libJsonStrings : [];
  for (const str of libs) {
    try {
      const lib = typeof str === "string" ? JSON.parse(str) : str;
      const data = lib?.data;
      if (data) mergeLibInto(levels, defs, variants, data);
    } catch (_) {
      // 单库解析失败则跳过
    }
  }

  self.postMessage({ levels, defs, variants });
};
