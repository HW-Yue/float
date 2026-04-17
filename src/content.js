"use strict";

(() => {
  try {
    if (typeof window === "undefined" || window !== window.top) return;
    if (window.__floatContentInstalled) return;
    window.__floatContentInstalled = true;
    try {
      document.documentElement?.setAttribute("data-float-content", "1");
    } catch {}

    const MARK_ATTR = "data-float-marked";
    const TRANSLATED_ATTR = "data-float-translated";
    const DEFAULT_CONFIG = {
      disabledSites: [],
    };

    const STYLE_TEXT = `
.float-word {
  border-bottom: 1px dotted rgba(99, 102, 241, 0.5);
  cursor: pointer;
}
.float-word:hover {
  border-bottom-color: #818cf8;
}
.float-tooltip-root {
  position: fixed !important;
  inset: 0 !important;
  z-index: 2147483647 !important;
  pointer-events: none !important;
}
.float-tooltip {
  all: initial;
  box-sizing: border-box;
  position: fixed !important;
  display: none;
  max-width: min(360px, calc(100vw - 16px));
  background: #0f1117;
  color: #e2e8f0;
  padding: 6px 11px;
  border-radius: 8px;
  border: 1px solid rgba(99, 102, 241, 0.25);
  font-size: 13px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  line-height: 1.5;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
  z-index: 2147483647 !important;
  word-break: break-word;
  white-space: pre-wrap;
  text-shadow: none !important;
  filter: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  mix-blend-mode: normal !important;
  isolation: isolate;
  -webkit-font-smoothing: antialiased;
}
[${MARK_ATTR}="true"] {
  position: relative;
  z-index: 999 !important;
  user-select: text !important;
}
html.float-markdown-mode .float-word {
  pointer-events: auto !important;
  position: relative !important;
  z-index: 2147483000 !important;
}
`;

    const BLOCK_TAGS = new Set([
      "DIV",
      "P",
      "LI",
      "BLOCKQUOTE",
      "SECTION",
      "ARTICLE",
      "ASIDE",
      "MAIN",
      "DD",
      "DT",
      "FIGCAPTION",
      "OL",
      "UL",
      "DL",
      "H1",
      "H2",
      "H3",
      "H4",
      "H5",
      "H6",
      "PRE",
      "FIGURE",
      "DETAILS",
      "SUMMARY",
      "SPAN",
    ]);

    const SKIP_TAGS = new Set([
      "SCRIPT",
      "STYLE",
      "NOSCRIPT",
      "SVG",
      "CANVAS",
      "VIDEO",
      "AUDIO",
      "IFRAME",
      "OBJECT",
      "EMBED",
      "INPUT",
      "TEXTAREA",
      "SELECT",
      "BUTTON",
      "FORM",
      "FIELDSET",
    ]);

    let active = false;
    let paused = false;
    let styleInjected = false;
    let scanTimer = null;
    let tooltipRoot = null;
    let tooltipEl = null;
    let tooltipHideTimer = null;
    let hoveredWordEl = null;
    let currentVocabLevel = "gz";
    let elementTextSignatures = new WeakMap();
    let noMatchRetryAt = new WeakMap();
    const pendingCandidates = new Set();
    const visibleCandidates = new Set();
    let pendingFlushTimer = null;
    const warmupScanTimers = new Set();
    let io = null;
    const observedRoots = new WeakSet();
    const observers = [];
    const VOCAB_LEVEL_ORDER = ["zk", "gz", "gk", "cet4", "cet6", "ky", "adv", "ss"];

    function escapeHtml(value) {
      return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    function isMarkdownViewerLikePage() {
      const isFile = window.location.protocol === "file:";
      if (isFile) return true;
      const hasMarkdownRoot = !!document.querySelector("#_html.markdown-body");
      const hasViewerTheme = !!document.querySelector(
        'link[href^="chrome-extension://"][href*="/themes/github.css"]'
      );
      return hasMarkdownRoot || hasViewerTheme;
    }

    function ensureTooltip() {
      const rootGone = !tooltipRoot || !tooltipRoot.isConnected;
      const tipGone = !tooltipEl || !tooltipEl.isConnected;
      if (!rootGone && !tipGone) return;
      try {
        tooltipRoot?.remove?.();
      } catch {}
      if (!document.body) return;
      tooltipRoot = document.createElement("div");
      tooltipRoot.className = "float-tooltip-root";
      tooltipRoot.setAttribute(MARK_ATTR, "true");
      tooltipEl = document.createElement("div");
      tooltipEl.className = "float-tooltip";
      tooltipRoot.appendChild(tooltipEl);
      document.body.appendChild(tooltipRoot);
    }

    function hideTooltip(immediate = false) {
      if (!tooltipEl) return;
      if (tooltipHideTimer) clearTimeout(tooltipHideTimer);
      if (immediate) {
        tooltipEl.style.setProperty("display", "none", "important");
        tooltipEl.style.setProperty("visibility", "hidden", "important");
        tooltipEl.style.setProperty("opacity", "0", "important");
        return;
      }
      tooltipHideTimer = setTimeout(() => {
        if (!tooltipEl) return;
        tooltipEl.style.setProperty("display", "none", "important");
        tooltipEl.style.setProperty("visibility", "hidden", "important");
        tooltipEl.style.setProperty("opacity", "0", "important");
      }, 120);
    }

    function showTooltipForWord(target) {
      if (!target || !target.classList?.contains("float-word")) return;
      ensureTooltip();
      if (!tooltipRoot?.isConnected || !tooltipEl?.isConnected) ensureTooltip();
      if (!tooltipEl) return;
      if (tooltipHideTimer) {
        clearTimeout(tooltipHideTimer);
        tooltipHideTimer = null;
      }

      const def = target.getAttribute("data-def") || "暂无释义";
      tooltipEl.textContent = def;
      tooltipEl.style.setProperty("display", "block", "important");
      tooltipEl.style.setProperty("visibility", "visible", "important");
      tooltipEl.style.setProperty("opacity", "1", "important");

      const rect = target.getBoundingClientRect();
      const tipRect = tooltipEl.getBoundingClientRect();

      let left = rect.left + rect.width / 2 - tipRect.width / 2;
      let top = rect.top - tipRect.height - 8;
      if (left < 8) left = 8;
      if (left + tipRect.width > window.innerWidth - 8) left = window.innerWidth - 8 - tipRect.width;
      if (top < 8) top = rect.bottom + 8;
      if (top + tipRect.height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - 8 - tipRect.height);

      tooltipEl.style.left = `${Math.round(left)}px`;
      tooltipEl.style.top = `${Math.round(top)}px`;
    }

    function eventTargetElement(target) {
      if (!target) return null;
      if (target.nodeType === Node.ELEMENT_NODE) return target;
      if (target.nodeType === Node.TEXT_NODE) return target.parentElement || null;
      return null;
    }

    function findWordFromEvent(event) {
      const path = typeof event.composedPath === "function" ? event.composedPath() : null;
      if (Array.isArray(path)) {
        for (const node of path) {
          if (node && node.nodeType === Node.ELEMENT_NODE && node.classList?.contains("float-word")) {
            return node;
          }
        }
      }
      return eventTargetElement(event.target)?.closest?.(".float-word") || null;
    }

    function findWordFromPoint(clientX, clientY) {
      const stack =
        typeof document.elementsFromPoint === "function"
          ? document.elementsFromPoint(clientX, clientY)
          : [];
      for (const el of stack) {
        const hit = el?.closest?.(".float-word");
        if (hit) return hit;
      }
      const el = document.elementFromPoint(clientX, clientY);
      return el?.closest?.(".float-word") || null;
    }

    function handleWordMouseOver(event) {
      const target = findWordFromEvent(event) || findWordFromPoint(event.clientX, event.clientY);
      if (!target) return;
      hoveredWordEl = target;
      showTooltipForWord(target);
    }

    function handleWordMouseOut(event) {
      const fromWord = findWordFromEvent(event);
      if (!fromWord) return;
      const toEl = eventTargetElement(event.relatedTarget);
      if (toEl && fromWord.contains(toEl)) return;
      hoveredWordEl = null;
      hideTooltip(false);
    }

    function handleWordMouseMove(event) {
      const target = findWordFromEvent(event) || findWordFromPoint(event.clientX, event.clientY);
      if (target) {
        hoveredWordEl = target;
        showTooltipForWord(target);
        return;
      }
      if (!hoveredWordEl) return;
      hoveredWordEl = null;
      hideTooltip(false);
    }

    function handleWordClick(event) {
      const target = findWordFromEvent(event) || findWordFromPoint(event.clientX, event.clientY);
      if (!target) return;
      hoveredWordEl = target;
      showTooltipForWord(target);
    }

    function normalizeText(text) {
      return text.replace(/\s+/g, " ").trim();
    }

    function isAsciiLetter(ch) {
      return /^[A-Za-z]$/.test(ch || "");
    }

    function tokenizeEnglishWords(text) {
      const tokens = [];
      if (!text) return tokens;
      const re = /[A-Za-z](?:[A-Za-z'’‘-]*[A-Za-z])?/g;
      let m;
      while ((m = re.exec(text))) {
        const raw = m[0];
        const start = m.index;
        const end = start + raw.length;
        const prev = start > 0 ? text[start - 1] : "";
        const next = end < text.length ? text[end] : "";
        if (isAsciiLetter(prev) || isAsciiLetter(next)) continue;
        const normalized = raw.replace(/[’‘]/g, "'").toLowerCase();
        if (normalized.length < 3) continue;
        tokens.push({ index: start, length: raw.length, raw, normalized });
      }
      return tokens;
    }

    function isEnglishLike(text, ratio = 0.35) {
      if (!text || text.length < 3) return false;
      const cleaned = text.replace(/[\s\d\p{P}]/gu, "");
      if (!cleaned) return false;
      const latin = cleaned.replace(/[^a-zA-Z]/g, "").length;
      return latin / cleaned.length >= ratio;
    }

    function getSelectionContext() {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || !sel.toString().trim()) return "";
      try {
        const range = sel.getRangeAt(0);
        const container = range.commonAncestorContainer;
        const parentEl = container.nodeType === Node.TEXT_NODE ? container.parentElement : container;
        // Walk up to the nearest block-level element to get a full sentence/paragraph
        const blockTags = new Set(["P", "DIV", "LI", "ARTICLE", "SECTION", "BLOCKQUOTE", "TD", "TH", "SPAN"]);
        let blockEl = parentEl;
        while (blockEl && !blockTags.has(blockEl.tagName) && blockEl.parentElement) {
          blockEl = blockEl.parentElement;
        }
        const fullText = ((blockEl || parentEl)?.textContent || "").replace(/\s+/g, " ").trim();
        return fullText.slice(0, 400);
      } catch {
        return "";
      }
    }

    function sendMessage(payload) {
      return new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage(payload, (resp) => resolve(resp ?? {}));
        } catch {
          resolve({});
        }
      });
    }

    async function getWordInfos(words) {
      if (!words.length) return [];
      const resp = await sendMessage({ type: "QUERY_WORDS", words });
      if (!Array.isArray(resp)) return words.map(() => ({ exists: false, definition: null }));
      return resp;
    }

    async function extractWordInfos(text) {
      const tokens = tokenizeEnglishWords(text);
      if (!tokens.length) return [];
      const uniq = [...new Set(tokens.map((t) => t.normalized))];
      const infos = await getWordInfos(uniq);
      const out = [];
      for (let i = 0; i < uniq.length; i++) {
        const info = infos[i];
        if (info && info.definition && shouldMarkByVocabLevel(info.level, currentVocabLevel)) {
          out.push({ word: uniq[i], definition: info.definition });
        }
      }
      return out;
    }

    function vocabLevelRank(level) {
      const idx = VOCAB_LEVEL_ORDER.indexOf(String(level || "").toLowerCase());
      return idx >= 0 ? idx : Number.POSITIVE_INFINITY;
    }

    function shouldMarkByVocabLevel(wordLevel, selectedLevel) {
      const selectedRank = vocabLevelRank(selectedLevel);
      const wordRank = vocabLevelRank(wordLevel);
      if (!Number.isFinite(selectedRank) || !Number.isFinite(wordRank)) return true;
      return wordRank >= selectedRank;
    }

    function isEditableContainer(el) {
      if (!el) return false;
      // Covers rich-text editors (contenteditable), many comment boxes (role=textbox),
      // and any element participating in an editable subtree.
      if (el.isContentEditable) return true;
      if (el.closest?.('[contenteditable]:not([contenteditable="false"])')) return true;
      if (el.closest?.('[role="textbox"]')) return true;
      return false;
    }

    function isInsideSkippedContainer(node) {
      const el = node.parentElement;
      if (!el) return true;
      if (el.closest(`[${MARK_ATTR}="true"]`)) return true;
      if (el.closest("script,style,noscript,iframe,textarea,select,button")) return true;
      if (
        el.closest("nav,header,footer,aside,form,[role='navigation'],[role='banner'],[role='complementary'],[role='grid'],[role='listbox']")
      ) return true;
      if (isEditableContainer(el)) return true;
      if (SKIP_TAGS.has(el.tagName)) return true;
      return false;
    }

    function isHiddenByStyle(el) {
      if (!el || !el.isConnected) return true;
      if (el.hidden) return true;
      if (el.closest("[hidden], [aria-hidden='true']")) return true;
      if (el.closest("details:not([open])")) return true;
      const style = window.getComputedStyle(el);
      if (!style) return false;
      if (style.display === "none") return true;
      if (style.visibility === "hidden" || style.visibility === "collapse") return true;
      if (Number.parseFloat(style.opacity || "1") === 0) return true;
      return false;
    }

    function getElementText(element) {
      const walker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: (node) => {
            if (!node.textContent || !node.textContent.trim()) return NodeFilter.FILTER_REJECT;
            if (isInsideSkippedContainer(node)) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
          },
        }
      );
      let out = "";
      let current;
      while ((current = walker.nextNode())) {
        out += current.textContent + " ";
      }
      return normalizeText(out);
    }

    function shouldSkipElement(element) {
      if (!element) return true;
      if (isHiddenByStyle(element)) return true;
      if (element.closest?.(`[${MARK_ATTR}="true"]`)) return true;
      return false;
    }

    function getElementPath(el) {
      const parts = [];
      let cur = el;
      let depth = 0;
      while (cur && cur.nodeType === Node.ELEMENT_NODE && depth < 8) {
        const tag = (cur.tagName || "").toLowerCase();
        const idx = cur.parentElement
          ? Array.from(cur.parentElement.children).indexOf(cur)
          : 0;
        parts.push(`${tag}:${idx}`);
        cur = cur.parentElement;
        depth += 1;
      }
      return parts.reverse().join(">");
    }

    function simpleHash(text) {
      let h = 2166136261;
      for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
      }
      return (h >>> 0).toString(36);
    }

    function markWordsInRoot(root, wordInfos) {
      if (!wordInfos.length) return;
      const map = new Map(wordInfos.map((w) => [w.word.toLowerCase(), w.definition]));

      const walker = document.createTreeWalker(
        root,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: (node) => {
            if (!node.textContent || !node.textContent.trim()) return NodeFilter.FILTER_REJECT;
            if (isInsideSkippedContainer(node)) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
          },
        }
      );

      const textNodes = [];
      let node;
      while ((node = walker.nextNode())) textNodes.push(node);

      for (let i = textNodes.length - 1; i >= 0; i--) {
        const textNode = textNodes[i];
        const text = textNode.textContent || "";
        const matches = tokenizeEnglishWords(text).filter((t) => map.has(t.normalized));
        if (!matches.length) continue;

        let current = textNode;
        for (let j = matches.length - 1; j >= 0; j--) {
          const item = matches[j];
          current.splitText(item.index + item.length);
          const hit = current.splitText(item.index);
          const span = document.createElement("span");
          span.className = "float-word";
          span.setAttribute(MARK_ATTR, "true");
          span.setAttribute("data-word", item.normalized);
          const definition = map.get(item.normalized) || "";
          span.setAttribute("data-def", definition);
          // Fallback: if JS hover handlers are blocked/missing (e.g. some rendered pages),
          // browser native tooltip still shows translation.
          if (definition) span.title = definition;
          span.textContent = hit.textContent;
          hit.parentNode?.replaceChild(span, hit);
        }
      }
    }

    async function processElement(element) {
      if (shouldSkipElement(element)) return;
      const text = getElementText(element);
      if (text.length <= 2) return;
      const tokenCount = tokenizeEnglishWords(text).length;
      if (tokenCount === 0) return;
      if (!isEnglishLike(text) && tokenCount < 2) return;
      const signature = `${currentVocabLevel}::${getElementPath(element)}::${simpleHash(text)}`;
      if (elementTextSignatures.get(element) === signature) return;
      const nextRetryAt = noMatchRetryAt.get(element) || 0;
      if (Date.now() < nextRetryAt) return;

      const wordInfos = await extractWordInfos(text);
      if (!wordInfos.length) {
        // Do not permanently lock this block when there is no hit.
        // Dynamic pages / delayed vocab readiness can make first pass miss.
        noMatchRetryAt.set(element, Date.now() + 4000);
        return;
      }

      markWordsInRoot(element, wordInfos);
      element.setAttribute(TRANSLATED_ATTR, signature);
      elementTextSignatures.set(element, signature);
      noMatchRetryAt.delete(element);
    }

    function findCandidateAncestor(textNode, rootBoundary) {
      let el = textNode.parentElement;
      while (el && el !== rootBoundary && el !== document.body && !BLOCK_TAGS.has(el.tagName)) {
        el = el.parentElement;
      }
      if (!el) return null;
      if (BLOCK_TAGS.has(el.tagName)) return el;
      if (!BLOCK_TAGS.has(el.tagName)) return null;
      return el;
    }

    function collectRoots() {
      const roots = [];
      const seen = new WeakSet();
      function visit(root) {
        if (!root || seen.has(root)) return;
        seen.add(root);
        roots.push(root);
        const boundary = root instanceof Document ? root.documentElement : root;
        if (!boundary) return;
        const walker = document.createTreeWalker(boundary, NodeFilter.SHOW_ELEMENT);
        let node = boundary;
        while (node) {
          if (node.shadowRoot) visit(node.shadowRoot);
          node = walker.nextNode();
        }
      }
      visit(document);
      return roots;
    }

    function collectCandidatesFromRoot(root) {
      const result = new Set();
      const boundary = root instanceof Document ? root.body : root;
      if (!boundary) return result;

      const walker = document.createTreeWalker(
        boundary,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: (node) => {
            if (!node.textContent || !node.textContent.trim()) return NodeFilter.FILTER_REJECT;
            if (isInsideSkippedContainer(node)) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
          },
        }
      );

      let node;
      while ((node = walker.nextNode())) {
        const host = findCandidateAncestor(node, boundary);
        if (host) result.add(host);
      }
      return result;
    }

    function enqueueCandidates(elements) {
      for (const el of elements) {
        if (!el || shouldSkipElement(el)) continue;
        pendingCandidates.add(el);
        if (io) io.observe(el);
        // Keep a fallback visible queue entry so environments without
        // intersection callbacks (tests, restricted docs pages) still process.
        visibleCandidates.add(el);
      }
      scheduleFlush(320);
    }

    function collectPriorityCandidates() {
      const out = new Set();
      const selectors = [
        "#main h1, #main h2, #main h3, #main h4, #main h5, #main h6",
        ".markdown h1, .markdown h2, .markdown h3, .markdown li, .markdown p",
        ".markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body li, .markdown-body p",
        "article.markdown-body.entry-content h1, article.markdown-body.entry-content h2, article.markdown-body.entry-content h3",
        "article.markdown-body.entry-content .heading-element, article.markdown-body.entry-content li, article.markdown-body.entry-content p",
        ".markdown-body td, .markdown-body blockquote p",
        ".theme-doc-markdown h1, .theme-doc-markdown h2, .theme-doc-markdown h3, .theme-doc-markdown li, .theme-doc-markdown p",
        "#content h2, #content h3, #content span[data-as='p'], #content ul li, #content ol li",
        ".mdx-content span[data-as='p'], .mdx-content ul li, .mdx-content ol li",
      ];
      for (const sel of selectors) {
        for (const el of document.querySelectorAll(sel)) out.add(el);
      }
      return out;
    }

    async function runInitialScan() {
      if (!active || paused) return;
      const candidates = new Set();
      for (const root of collectRoots()) {
        for (const el of collectCandidatesFromRoot(root)) candidates.add(el);
      }
      for (const el of collectPriorityCandidates()) candidates.add(el);
      if (window.location.hostname === "github.com") {
        const visibleReadmeRoots = Array.from(
          document.querySelectorAll("article.markdown-body.entry-content")
        ).filter((el) => !isHiddenByStyle(el));
        for (const root of visibleReadmeRoots) {
          const githubSelectors = [
            "p",
            "li",
            "td",
            ".heading-element",
            "blockquote p",
          ];
          for (const sel of githubSelectors) {
            for (const el of root.querySelectorAll(sel)) candidates.add(el);
          }
        }
        const githubSelectors = [
          "article.markdown-body.entry-content p",
          "article.markdown-body.entry-content li",
          "article.markdown-body.entry-content td",
          "article.markdown-body.entry-content .heading-element",
          "article.markdown-body.entry-content blockquote p",
        ];
        for (const sel of githubSelectors) {
          for (const el of document.querySelectorAll(sel)) candidates.add(el);
        }
      }

      enqueueCandidates(candidates);
      await flushPendingCandidates();
    }

    function disconnectObservers() {
      while (observers.length) {
        const ob = observers.pop();
        try {
          ob.disconnect();
        } catch {}
      }
    }

    function setupIntersectionObserver() {
      if (io || typeof IntersectionObserver !== "function") return;
      io = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          const el = entry.target;
          if (entry.isIntersecting || entry.intersectionRatio > 0) {
            visibleCandidates.add(el);
            scheduleFlush(180);
          } else {
            visibleCandidates.delete(el);
          }
        }
      }, { root: null, rootMargin: "150px 0px", threshold: 0.01 });
    }

    async function flushPendingCandidates() {
      if (!active || paused) return;
      const batch = [];
      const source = io ? visibleCandidates : pendingCandidates;
      for (const el of source) {
        if (!pendingCandidates.has(el)) continue;
        pendingCandidates.delete(el);
        if (io) visibleCandidates.delete(el);
        if (!el.isConnected || shouldSkipElement(el)) continue;
        batch.push(el);
        if (batch.length >= 40) break;
      }
      for (const el of batch) {
        try {
          await processElement(el);
        } catch {}
      }
      if (pendingCandidates.size) scheduleFlush(260);
    }

    function scheduleFlush(delay = 320) {
      if (!active || paused) return;
      if (pendingFlushTimer) clearTimeout(pendingFlushTimer);
      pendingFlushTimer = setTimeout(() => {
        pendingFlushTimer = null;
        flushPendingCandidates().catch(() => {});
      }, delay);
    }

    function scheduleScan(delay = 250) {
      if (!active || paused) return;
      if (scanTimer) clearTimeout(scanTimer);
      scanTimer = setTimeout(() => {
        scanTimer = null;
        runInitialScan();
      }, delay);
    }

    function scheduleWarmupScans() {
      const delays = [350, 1200, 3000];
      for (const delay of delays) {
        const timer = setTimeout(() => {
          warmupScanTimers.delete(timer);
          if (!active || paused) return;
          runInitialScan();
        }, delay);
        warmupScanTimers.add(timer);
      }
    }

    function observeRoot(root) {
      if (!root || observedRoots.has(root)) return;
      const target = root instanceof Document ? root.body : root;
      if (!target) return;

      const observer = new MutationObserver((mutations) => {
        const localCandidates = new Set();
        for (const m of mutations) {
          const mutationTargetEl =
            m.target?.nodeType === Node.TEXT_NODE ? m.target.parentElement : m.target;
          if (mutationTargetEl?.closest?.(`[${MARK_ATTR}="true"]`)) continue;
          if (mutationTargetEl?.closest?.(`.${"float-tooltip-root"}`)) continue;

          for (const n of m.addedNodes) {
            if (n.nodeType === Node.ELEMENT_NODE && n.shadowRoot) {
              observeRoot(n.shadowRoot);
            }
            if (n.nodeType === Node.ELEMENT_NODE) {
              if (n.getAttribute?.(MARK_ATTR) === "true") continue;
              const host = n.closest?.(`[${TRANSLATED_ATTR}]`) ? null : n;
              if (host && BLOCK_TAGS.has(host.tagName)) localCandidates.add(host);
              for (const el of collectCandidatesFromRoot(n)) localCandidates.add(el);
            } else if (n.nodeType === Node.TEXT_NODE && n.parentElement) {
              const host = findCandidateAncestor(n, target);
              if (host) localCandidates.add(host);
            }
          }
          if (m.type === "characterData" && m.target?.parentElement) {
            const host = findCandidateAncestor(m.target, target);
            if (host) localCandidates.add(host);
          }
        }
        if (localCandidates.size) enqueueCandidates(localCandidates);
      });

      observer.observe(target, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["class", "style", "hidden", "aria-hidden", "aria-selected", "data-selected"],
      });
      observers.push(observer);
      observedRoots.add(root);
    }

    function startObserving() {
      disconnectObservers();
      setupIntersectionObserver();
      for (const root of collectRoots()) observeRoot(root);
    }

    function cleanupMarkup() {
      // Remove all word-marking spans, restoring original text nodes
      document.querySelectorAll(`.float-word[${MARK_ATTR}="true"]`).forEach((span) => {
        const text = document.createTextNode(span.textContent || "");
        span.parentNode?.replaceChild(text, span);
      });
      document.querySelectorAll(`[${TRANSLATED_ATTR}]`).forEach((el) => {
        el.removeAttribute(TRANSLATED_ATTR);
      });
    }

    function ensureStyles() {
      if (styleInjected) return;
      const style = document.createElement("style");
      style.id = "float-styles";
      style.textContent = STYLE_TEXT;
      document.head.appendChild(style);
      styleInjected = true;
    }

    async function activate() {
      if (active) return;
      active = true;
      paused = false;
      pendingCandidates.clear();
      visibleCandidates.clear();
      ensureStyles();
      ensureTooltip();
      try {
        const settings = await chrome.storage.sync.get({ vocabLevel: "gz" });
        currentVocabLevel = settings.vocabLevel || "gz";
      } catch {
        currentVocabLevel = "gz";
      }
      runInitialScan();
      scheduleWarmupScans();
      startObserving();
      try {
        chrome.storage.onChanged.addListener(handleStorageChange);
      } catch {}
    }

    function deactivate() {
      if (!active) return;
      active = false;
      paused = false;
      if (scanTimer) {
        clearTimeout(scanTimer);
        scanTimer = null;
      }
      if (pendingFlushTimer) {
        clearTimeout(pendingFlushTimer);
        pendingFlushTimer = null;
      }
      for (const timer of warmupScanTimers) {
        clearTimeout(timer);
      }
      warmupScanTimers.clear();
      pendingCandidates.clear();
      visibleCandidates.clear();
      if (io) {
        io.disconnect();
        io = null;
      }
      disconnectObservers();
      cleanupMarkup();
      hideTooltip(true);
      try {
        chrome.storage.onChanged.removeListener(handleStorageChange);
      } catch {}
    }

    function pause() {
      if (!active || paused) return;
      paused = true;
      disconnectObservers();
      document.body.classList.add("float-paused");
    }

    function resume() {
      if (!active || !paused) return;
      paused = false;
      document.body.classList.remove("float-paused");
      runInitialScan();
      startObserving();
    }

    function handleStorageChange(changes) {
      if (!active) return;
      if (changes.vocabLevel?.newValue) {
        currentVocabLevel = changes.vocabLevel.newValue;
        elementTextSignatures = new WeakMap();
        noMatchRetryAt = new WeakMap();
        cleanupMarkup();
        scheduleScan(50);
      }
    }

    function performFullRescan(delay = 0) {
      if (!active) return;
      elementTextSignatures = new WeakMap();
      noMatchRetryAt = new WeakMap();
      pendingCandidates.clear();
      visibleCandidates.clear();
      cleanupMarkup();
      scheduleScan(delay);
    }

    async function tryActivateWithRetry() {
      const delays = [0, 400, 1400, 3200];
      for (const delay of delays) {
        if (delay) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
        let isActive = false;
        try {
          const state = await sendMessage({ type: "checkActive" });
          isActive = !!state.active;
        } catch {}
        if (isActive) {
          await activate();
          return true;
        }
      }
      return false;
    }

    async function init() {
      ensureStyles();
      if (isMarkdownViewerLikePage()) {
        document.documentElement.classList.add("float-markdown-mode");
        document.documentElement.setAttribute("data-float-markdown-mode", "1");
      }
      ensureTooltip();
      document.addEventListener("mouseover", handleWordMouseOver, { capture: true, passive: true });
      document.addEventListener("mouseout", handleWordMouseOut, { capture: true, passive: true });
      document.addEventListener("mousemove", handleWordMouseMove, { passive: true, capture: true });
      document.addEventListener("pointerover", handleWordMouseOver, { capture: true, passive: true });
      document.addEventListener("pointerout", handleWordMouseOut, { capture: true, passive: true });
      document.addEventListener("pointermove", handleWordMouseMove, { passive: true, capture: true });
      document.addEventListener("click", handleWordClick, true);
      // GitHub repository pages rely on pjax/turbo updates; rescan after in-page navigation.
      document.addEventListener("pjax:end", () => scheduleScan(60));
      document.addEventListener("turbo:load", () => scheduleScan(60));
      document.addEventListener("turbo:render", () => scheduleScan(60));
      await tryActivateWithRetry();

      try {
        chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
          if (!message || !message.type) return;
          if (message.type === "activate") activate();
          else if (message.type === "deactivate") deactivate();
          else if (message.type === "pause") pause();
          else if (message.type === "resume") resume();
          else if (message.type === "wordAdded") {
            if (active && message.force) performFullRescan(10);
            else if (active) scheduleScan(50);
          }
          else if (message.type === "forceRescan") {
            if (active) performFullRescan(10);
          }
          else if (message.type === "getSelectionContext") {
            sendResponse({ context: getSelectionContext() });
          }
        });
      } catch {}
    }

    if (typeof window !== "undefined") {
      const testHooks = { runInitialScan };
      window.__floatTestHooks = testHooks;
    }

    init();
  } catch (e) {
    console.warn("[Float]", e);
  }
})();

