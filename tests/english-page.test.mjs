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

async function main() {
  const html = loadFile("tests/fixtures/english-page.html");

  const dom = new JSDOM(html, {
    url: "https://example.com/docs/intro",
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
  });

  const { window } = dom;
  const { document } = window;

  global.window = window;
  global.document = document;
  global.Node = window.Node;

  // jsdom 里没有原生 IntersectionObserver，打一个最小 stub
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

  // Minimal chrome API stub used by content.js
  window.chrome = {
    runtime: {
      sendMessage(message, cb) {
        let response = {};
        switch (message.type) {
          case "getConfig":
            response = {
              llm: {
                activeProvider: "gemini",
                providers: {
                  gemini: { apiKey: "", model: "gemini-3.1-flash-lite-preview" },
                },
              },
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
      onMessage: {
        addListener() {},
      },
    },
    storage: {
      sync: {
        get(defaults) {
          return Promise.resolve(defaults);
        },
        set() {
          return Promise.resolve();
        },
      },
      local: {
        get(defaults) {
          return Promise.resolve(defaults);
        },
        set() {
          return Promise.resolve();
        },
      },
      session: {
        get(defaults) {
          return Promise.resolve(defaults);
        },
        set() {
          return Promise.resolve();
        },
      },
      onChanged: {
        addListener() {},
      },
    },
  };

  const contentScript = loadFile("src/content.js");
  window.eval(contentScript);

  // 等待初始化逻辑跑完
  await new Promise((resolve) => setTimeout(resolve, 50));

  if (!window.__floatTestHooks || typeof window.__floatTestHooks.runInitialScan !== "function") {
    console.error("Test hooks not found on window.__floatTestHooks");
    process.exit(1);
  }

  await window.__floatTestHooks.runInitialScan();

  const docRoot = document.querySelector(".theme-doc-markdown");
  if (!docRoot) {
    console.error("theme-doc-markdown not found in english-page.html");
    process.exit(1);
  }

  const listItems = Array.from(
    docRoot.querySelectorAll("ul li")
  );

  const withWords = listItems.filter((li) => li.querySelector(".float-word"));

  if (withWords.length === 0) {
    console.error(
      "No list items in .theme-doc-markdown have word annotation (.float-word)."
    );
    process.exit(1);
  }

  console.log(
    `OK: ${withWords.length} list items with word annotation (.float-word).`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

