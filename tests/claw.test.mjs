/**
 * Claw/Mintlify 正文格式测试：span[data-as="p"]、ul li、ol li 等
 * 与 claw-fixture.html 中正文结构一致，保证扩展能识别并处理。
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { JSDOM } from "jsdom";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = __dirname.replace(/[/\\]tests$/, "");

function loadFile(relPath) {
  const abs = path.join(projectRoot, relPath);
  return fs.readFileSync(abs, "utf8");
}

function isProcessed(el) {
  // content.js 当前使用 .float-* 类进行标注
  return !!el.querySelector(".float-word");
}

async function main() {
  const html = loadFile("tests/claw-fixture.html");
  const dom = new JSDOM(html, {
    url: "https://example.com/docs/claw",
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
  });

  const { window } = dom;
  const { document } = window;

  global.window = window;
  global.document = document;
  global.Node = window.Node;

  if (!("IntersectionObserver" in window)) {
    class FakeIntersectionObserver {
      constructor(callback) {
        this._callback = callback;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    window.IntersectionObserver = FakeIntersectionObserver;
    global.IntersectionObserver = FakeIntersectionObserver;
  }

  // 词库 stub：返回释义以便出现 .float-word
  window.chrome = {
    runtime: {
      sendMessage(message, cb) {
        let response = {};
        switch (message.type) {
          case "getConfig":
            response = {
              llm: { activeProvider: "gemini", providers: { gemini: { apiKey: "", model: "" } } },
              sensitivity: 3,
              scanThreshold: "medium",
              chunkGranularity: "fine",
              chunkIntensity: 5,
              disabledSites: [],
            };
            break;
          case "checkActive":
            response = { active: true };
            break;
          case "QUERY_WORD":
            response = { exists: true, level: "gz", definition: "n. 测试释义" };
            break;
          case "QUERY_WORDS":
            response = (message.words || []).map((word) => ({
              exists: true,
              level: "gz",
              definition: `n. ${word}`,
            }));
            break;
          default:
            response = {};
        }
        if (typeof cb === "function") cb(response);
      },
      onMessage: { addListener() {} },
    },
    storage: {
      sync: { get: (d) => Promise.resolve(d), set: () => Promise.resolve() },
      local: { get: (d) => Promise.resolve(d), set: () => Promise.resolve() },
      session: { get: (d) => Promise.resolve(d), set: () => Promise.resolve() },
      onChanged: { addListener() {} },
    },
  };

  const contentScript = loadFile("src/content.js");
  window.eval(contentScript);

  await new Promise((r) => setTimeout(r, 50));

  if (!window.__floatTestHooks?.runInitialScan) {
    console.error("__floatTestHooks.runInitialScan not found");
    process.exit(1);
  }

  await window.__floatTestHooks.runInitialScan();

  const contentRoot = document.querySelector("#content") || document.querySelector(".mdx-content");
  if (!contentRoot) {
    console.error("Claw 正文容器 #content / .mdx-content not found.");
    process.exit(1);
  }

  // 正文格式（与 claw-fixture.html 一致）：均在 #content 内
  const spans = Array.from(contentRoot.querySelectorAll('span[data-as="p"]'));
  const spansProcessed = spans.filter(isProcessed);

  const ulLis = Array.from(contentRoot.querySelectorAll("ul li"));
  const ulLisProcessed = ulLis.filter(isProcessed);

  const olLis = Array.from(contentRoot.querySelectorAll("ol li"));
  const olLisProcessed = olLis.filter(isProcessed);

  const h2s = Array.from(contentRoot.querySelectorAll("h2"));
  const h2sProcessed = h2s.filter(isProcessed);

  const h3s = Array.from(contentRoot.querySelectorAll("h3"));
  const h3sProcessed = h3s.filter(isProcessed);

  const withWords = document.querySelectorAll(".float-word").length;

  if (spansProcessed.length === 0) {
    console.error("No #content span[data-as=\"p\"] were processed (claw 正文段落).");
    process.exit(1);
  }
  if (ulLisProcessed.length === 0) {
    console.error("No #content ul li were processed (claw 无序列表).");
    process.exit(1);
  }
  if (olLisProcessed.length === 0) {
    console.error("No #content ol li were processed (claw 有序列表).");
    process.exit(1);
  }
  if (h2sProcessed.length === 0) {
    console.error("No #content h2 were processed (claw 二级标题).");
    process.exit(1);
  }
  if (h3sProcessed.length === 0) {
    console.error("No #content h3 were processed (claw 三级标题).");
    process.exit(1);
  }
  if (withWords === 0) {
    console.error("No .float-word found (claw 生词标注).");
    process.exit(1);
  }

  console.log(
    `OK claw: #content 正文 ${spansProcessed.length} span[data-as="p"], ${h2sProcessed.length} h2, ${h3sProcessed.length} h3, ${ulLisProcessed.length} ul li, ${olLisProcessed.length} ol li processed, ${withWords} word annotations.`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
