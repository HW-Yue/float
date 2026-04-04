// floating-ball.js
// 在每个页面右侧中部插入一个使用 Shadow DOM 的悬浮球，
// 点击后展开「添加新词」面板。

(async () => {
  try {
    if (typeof window === "undefined" || window !== window.top) return;

    const HOST_ID = "__float_floating_ball_root__";
    if (document.getElementById(HOST_ID)) return;

    function send(type, payload = {}) {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type, ...payload }, (res) => {
          if (chrome.runtime.lastError) resolve(null);
          else resolve(res);
        });
      });
    }

    // 检查是否启用悬浮球
    const cfg = await send("getConfig");
    if (cfg && cfg.showFloatingBall === false) return;

    // 创建挂载点 + Shadow DOM
    const host = document.createElement("div");
    host.id = HOST_ID;
    (document.body || document.documentElement).appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial; }

      .fb-wrapper {
        position: fixed;
        top: 50%;
        right: 8px;
        transform: translateY(-50%);
        z-index: 2147483647;
        font-family: 'Space Grotesk', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
      }

      .fb-ball {
        position: relative;
        width: 32px;
        height: 32px;
        border-radius: 999px;
        background: #f5c6d0;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 2px 10px rgba(200, 120, 140, 0.25);
        cursor: pointer;
        user-select: none;
        font-weight: 700;
        font-size: 13px;
        transition: background 0.15s, transform 0.15s, box-shadow 0.15s;
      }

      .fb-ball:hover {
        background: #f0b4c2;
        transform: translateY(-1px);
        box-shadow: 0 4px 14px rgba(200, 120, 140, 0.35);
      }

      .fb-ball:focus-visible {
        outline: 2px solid #6366f1;
        outline-offset: 2px;
      }

      .fb-ball-star {
        position: absolute;
        top: 4px;
        left: 5px;
        font-size: 7px;
        opacity: 0.9;
        line-height: 1;
      }

      .fb-ball-char {
        font-size: 13px;
        color: #7c3d50;
      }

      /* 面板：纯白浅色，无毛玻璃 */
      .fb-panel {
        position: absolute;
        top: 50%;
        right: 44px;
        transform: translateY(-50%);
        width: min(calc(100vw - 60px), 380px);
        padding: 16px 18px 14px;
        border-radius: 14px;
        background: #ffffff;
        color: #111827;
        font-size: 13px;
        line-height: 1.5;
        display: none;
        border: 1px solid #e5e7eb;
        box-shadow: 0 8px 24px rgba(0,0,0,0.10), 0 2px 6px rgba(0,0,0,0.06);
      }

      .fb-panel.open {
        display: block;
        animation: fbPanelIn 0.2s cubic-bezier(0.2, 0, 0, 1);
      }

      @keyframes fbPanelIn {
        from { opacity: 0; transform: translateY(-50%) translateX(6px); }
        to   { opacity: 1; transform: translateY(-50%) translateX(0); }
      }

      .fb-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 14px;
      }

      .fb-title {
        font-size: 14px;
        font-weight: 600;
        color: #111827;
      }

      .fb-close {
        border: none;
        background: transparent;
        color: #9ca3af;
        cursor: pointer;
        font-size: 18px;
        line-height: 1;
        padding: 2px 4px;
        border-radius: 4px;
        transition: color 0.15s, background 0.15s;
      }

      .fb-close:hover { color: #374151; background: #f3f4f6; }

      .fb-close:focus-visible {
        outline: 2px solid #6366f1;
        outline-offset: 2px;
      }

      /* 两栏：词库 1 : 单词 2 */
      .fb-row-first {
        display: grid;
        grid-template-columns: 1fr 2fr;
        gap: 8px;
        margin-bottom: 8px;
      }

      .fb-select, .fb-input, .fb-textarea {
        box-sizing: border-box;
        width: 100%;
        padding: 8px 10px;
        border-radius: 7px;
        border: 1px solid #e5e7eb;
        background: #f9fafb;
        color: #374151;
        font-size: 13px;
        font-family: inherit;
        outline: none;
        transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
        min-height: 36px;
      }

      .fb-select:focus, .fb-input:focus, .fb-textarea:focus {
        background: #ffffff;
        border-color: rgba(99,102,241,0.5);
        box-shadow: 0 0 0 3px rgba(99,102,241,0.08);
      }

      .fb-select { cursor: pointer; }

      .fb-textarea {
        min-height: 68px;
        resize: vertical;
        margin-bottom: 8px;
      }

      .fb-input::placeholder, .fb-textarea::placeholder { color: #c4c9d4; }

      .fb-label {
        display: block;
        font-size: 11px;
        color: #9ca3af;
        margin-bottom: 4px;
        letter-spacing: 0.2px;
      }

      .fb-hint {
        font-size: 11px;
        color: #c4c9d4;
        margin-top: 3px;
      }

      /* 底部 */
      .fb-footer {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 10px;
        margin-top: 12px;
      }

      .fb-shortcut {
        font-size: 11px;
        color: #c4c9d4;
      }

      .fb-btn {
        padding: 8px 18px;
        border-radius: 7px;
        border: none;
        background: #6366f1;
        color: #fff;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.15s, transform 0.12s, box-shadow 0.15s;
        box-shadow: 0 2px 8px rgba(99,102,241,0.22);
        min-height: 36px;
      }

      .fb-btn:hover {
        background: #818cf8;
        transform: translateY(-1px);
        box-shadow: 0 4px 14px rgba(99,102,241,0.30);
      }

      .fb-btn:active { transform: translateY(0); }

      .fb-btn:focus-visible {
        outline: 2px solid #6366f1;
        outline-offset: 3px;
      }

      .fb-toast {
        position: fixed;
        left: 50%;
        bottom: 20px;
        transform: translateX(-50%);
        background: #111827;
        color: #f9fafb;
        padding: 8px 14px;
        border-radius: 8px;
        font-size: 12px;
        box-shadow: 0 4px 14px rgba(0,0,0,0.15);
        z-index: 2147483647;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.2s;
        white-space: nowrap;
      }

      .fb-toast.show { opacity: 1; }
    `;

    const wrapper = document.createElement("div");
    wrapper.className = "fb-wrapper";

    const ball = document.createElement("div");
    ball.className = "fb-ball";
    ball.setAttribute("role", "button");
    ball.setAttribute("tabindex", "0");
    ball.setAttribute("aria-label", "轻译：添加新词");
    const ballStar = document.createElement("span");
    ballStar.className = "fb-ball-star";
    ballStar.textContent = "✦";
    ballStar.setAttribute("aria-hidden", "true");
    const ballChar = document.createElement("span");
    ballChar.className = "fb-ball-char";
    ballChar.textContent = "词";
    ballChar.setAttribute("aria-hidden", "true");
    ball.appendChild(ballStar);
    ball.appendChild(ballChar);

    const panel = document.createElement("div");
    panel.className = "fb-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "添加新词");

    const header = document.createElement("div");
    header.className = "fb-header";
    const title = document.createElement("div");
    title.className = "fb-title";
    title.textContent = "添加新词";
    const closeBtn = document.createElement("button");
    closeBtn.className = "fb-close";
    closeBtn.textContent = "×";
    closeBtn.setAttribute("aria-label", "关闭面板");
    header.appendChild(title);
    header.appendChild(closeBtn);

    const libLabel = document.createElement("label");
    libLabel.className = "fb-label";
    libLabel.setAttribute("for", "fb-lib-select");
    libLabel.textContent = "词库";

    const libSelect = document.createElement("select");
    libSelect.id = "fb-lib-select";
    libSelect.className = "fb-select";

    const wordLabel = document.createElement("label");
    wordLabel.className = "fb-label";
    wordLabel.setAttribute("for", "fb-word-input");
    wordLabel.textContent = "单词";

    const wordInput = document.createElement("input");
    wordInput.id = "fb-word-input";
    wordInput.className = "fb-input";
    wordInput.placeholder = "英文单词";

    const rowFirst = document.createElement("div");
    rowFirst.className = "fb-row-first";

    const libCol = document.createElement("div");
    libCol.appendChild(libLabel);
    libCol.appendChild(libSelect);

    const wordCol = document.createElement("div");
    wordCol.appendChild(wordLabel);
    wordCol.appendChild(wordInput);

    rowFirst.appendChild(libCol);
    rowFirst.appendChild(wordCol);

    const defLabel = document.createElement("label");
    defLabel.className = "fb-label";
    defLabel.setAttribute("for", "fb-def-input");
    defLabel.textContent = "释义（支持换行）";

    const defInput = document.createElement("textarea");
    defInput.id = "fb-def-input";
    defInput.className = "fb-textarea";
    defInput.placeholder = "中文释义（可选）";

    const variantsLabel = document.createElement("label");
    variantsLabel.className = "fb-label";
    variantsLabel.setAttribute("for", "fb-variants-input");
    variantsLabel.textContent = "词形变体（可选）";

    const variantsInput = document.createElement("input");
    variantsInput.id = "fb-variants-input";
    variantsInput.className = "fb-input";
    variantsInput.placeholder = "多个用逗号分隔，如 deadlocks, deadlocked";

    const variantsHint = document.createElement("div");
    variantsHint.className = "fb-hint";
    variantsHint.setAttribute("aria-hidden", "true");
    variantsHint.textContent = "Ctrl + Enter 快速提交";

    const footer = document.createElement("div");
    footer.className = "fb-footer";
    const shortcutHint = document.createElement("span");
    shortcutHint.className = "fb-shortcut";
    shortcutHint.setAttribute("aria-hidden", "true");
    shortcutHint.textContent = "Ctrl + Enter";
    const addBtn = document.createElement("button");
    addBtn.className = "fb-btn";
    addBtn.textContent = "添加";
    addBtn.setAttribute("aria-label", "添加单词到词库");
    footer.appendChild(shortcutHint);
    footer.appendChild(addBtn);

    panel.appendChild(header);
    panel.appendChild(rowFirst);
    panel.appendChild(defLabel);
    panel.appendChild(defInput);
    panel.appendChild(variantsLabel);
    panel.appendChild(variantsInput);
    panel.appendChild(variantsHint);
    panel.appendChild(footer);

    wrapper.appendChild(ball);
    wrapper.appendChild(panel);

    const toast = document.createElement("div");
    toast.className = "fb-toast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");

    shadow.appendChild(style);
    shadow.appendChild(wrapper);
    shadow.appendChild(toast);

    let toastTimer = null;
    function showToast(msg) {
      toast.textContent = msg;
      toast.classList.add("show");
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toast.classList.remove("show"), 2000);
    }

    async function loadLibs() {
      const res = await send("getVocabLibs");
      const libs = (res && res.libs) || [];
      libSelect.textContent = "";
      libs.forEach((lib) => {
        const opt = document.createElement("option");
        opt.value = lib.id;
        opt.textContent = lib.name;
        libSelect.appendChild(opt);
      });
    }

    async function handleAdd() {
      const libId = libSelect.value;
      const word = wordInput.value.trim();
      const definition = defInput.value.trim();
      const variantsStr = variantsInput.value.trim();

      if (!libId || !word) {
        showToast("请选择词库并输入单词");
        return;
      }

      const dataRes = await send("getVocabLibData", { libId });
      const data = dataRes && dataRes.ok ? dataRes.data : null;
      const has = data && data.levels && data.levels[word.toLowerCase()];
      const variants = variantsStr
        ? variantsStr.replace(/，/g, ",").split(",").map((s) => s.trim()).filter(Boolean)
        : [];
      const addMain = await send("addWordBatchToVocabLib", {
        libId, word, definition, variants,
      });
      if (!addMain || !addMain.ok) {
        showToast(addMain?.error || "添加失败");
        return;
      }

      wordInput.value = "";
      defInput.value = "";
      variantsInput.value = "";

      if (addMain.synced) {
        showToast("已添加并同步到词库");
      } else if (variants.length) {
        showToast("已添加单词及变体");
      } else if (has) {
        showToast("已覆盖原有单词");
      } else {
        showToast("已添加");
      }
    }

    function openPanel() {
      loadLibs().catch(() => {});
      panel.classList.add("open");
      requestAnimationFrame(() => wordInput.focus());
    }

    function closePanel() {
      panel.classList.remove("open");
    }

    ball.addEventListener("click", (evt) => {
      evt.stopPropagation();
      panel.classList.contains("open") ? closePanel() : openPanel();
    });

    ball.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter" || evt.key === " ") {
        evt.preventDefault();
        panel.classList.contains("open") ? closePanel() : openPanel();
      }
    });

    closeBtn.addEventListener("click", closePanel);

    addBtn.addEventListener("click", () => {
      handleAdd().catch(() => showToast("添加失败"));
    });

    wordInput.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter" && !evt.isComposing) {
        evt.preventDefault();
        handleAdd().catch(() => showToast("添加失败"));
      }
    });

    variantsInput.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter" && !evt.isComposing) {
        evt.preventDefault();
        handleAdd().catch(() => showToast("添加失败"));
      }
    });

    panel.addEventListener("keydown", (evt) => {
      if (evt.ctrlKey && evt.key === "Enter" && !evt.isComposing) {
        evt.preventDefault();
        handleAdd().catch(() => showToast("添加失败"));
      }
      if (evt.key === "Escape") closePanel();
    });

    document.addEventListener("click", (evt) => {
      if (!host.contains(evt.target)) closePanel();
    });

    // 监听来自选项页的悬浮球开关消息
    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg) return;
      if (msg.type === "setFloatingBall") {
        host.style.display = msg.show ? "" : "none";
        if (!msg.show) closePanel();
      }
    });

  } catch (e) {
    console.warn("[轻译 floating ball]", e);
  }
})();
