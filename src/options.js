"use strict";
(function () {
  const app = document.getElementById("app");
  if (!app) return;
  let updateSyncStatus = null;

  function send(type, payload = {}) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type, ...payload }, (r) => {
        if (chrome.runtime.lastError) resolve(null);
        else resolve(r);
      });
    });
  }

  function toast(text) {
    const el = document.createElement("div");
    el.className = "vocab-toast";
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2500);
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg) return;
    if (msg.type === "vocabSyncUpdated" && updateSyncStatus) {
      if (msg.event === "upload_success") {
        updateSyncStatus("自动上传成功", true);
      } else if (msg.event === "upload_error") {
        updateSyncStatus(msg.error || "自动上传失败", false);
      } else if (msg.event === "download_success") {
        updateSyncStatus("下载成功", true);
      } else if (msg.event === "download_error") {
        updateSyncStatus(msg.error || "下载失败", false);
      }
      return;
    }
  });

  function render() {
    const wrap = document.createElement("div");
    wrap.className = "opt-page";

    const title = document.createElement("h1");
    title.className = "opt-page-title";
    title.textContent = "词库管理";
    wrap.appendChild(title);

    // ===== 悬浮球开关 =====
    const ballCard = document.createElement("div");
    ballCard.className = "glass opt-card";

    const ballTitle = document.createElement("h2");
    ballTitle.className = "opt-card-title";
    ballTitle.textContent = "悬浮球";
    ballCard.appendChild(ballTitle);

    const ballRow = document.createElement("div");
    ballRow.style.cssText = "display:flex;align-items:center;justify-content:space-between;padding:4px 0";

    const ballDesc = document.createElement("div");
    const ballDescMain = document.createElement("div");
    ballDescMain.style.cssText = "font-size:13px;color:var(--color-text-2);font-weight:500";
    ballDescMain.textContent = "在网页上显示悬浮球";
    const ballDescSub = document.createElement("div");
    ballDescSub.style.cssText = "font-size:12px;color:var(--color-text-3);margin-top:3px";
    ballDescSub.textContent = "点击悬浮球可快速添加单词到词库";
    ballDesc.appendChild(ballDescMain);
    ballDesc.appendChild(ballDescSub);

    const ballToggle = document.createElement("button");
    ballToggle.className = "toggle";
    ballToggle.setAttribute("role", "switch");
    ballToggle.setAttribute("aria-checked", "true");
    ballToggle.setAttribute("aria-label", "开启或关闭悬浮球");
    const ballThumb = document.createElement("span");
    ballThumb.className = "toggle-thumb";
    ballToggle.appendChild(ballThumb);

    ballRow.appendChild(ballDesc);
    ballRow.appendChild(ballToggle);
    ballCard.appendChild(ballRow);
    wrap.appendChild(ballCard);

    // 读取当前状态
    send("getConfig").then((cfg) => {
      const show = cfg?.showFloatingBall !== false;
      if (show) ballToggle.classList.add("on");
      ballToggle.setAttribute("aria-checked", String(show));
    });

    ballToggle.onclick = async () => {
      const isOn = ballToggle.classList.toggle("on");
      ballToggle.setAttribute("aria-checked", String(isOn));
      await send("updateConfig", { config: { showFloatingBall: isOn } });
    };

    // ===== 文章领域管理（CRUD） =====
    const domainsSection = document.createElement("div");
    domainsSection.className = "glass opt-card";

    const domainsTitle = document.createElement("h2");
    domainsTitle.className = "opt-card-title";
    domainsTitle.textContent = "文章领域管理";
    domainsSection.appendChild(domainsTitle);

    const domainsHint = document.createElement("p");
    domainsHint.className = "opt-card-hint";
    domainsHint.textContent = "用于“添加单词”弹窗中的领域选项，支持新增、编辑、删除。";
    domainsSection.appendChild(domainsHint);

    const domainsList = document.createElement("div");
    domainsList.style.cssText = "display:flex;flex-direction:column;gap:8px;margin-bottom:12px";
    domainsSection.appendChild(domainsList);

    const addRow = document.createElement("div");
    addRow.className = "opt-btn-row";

    const addDomainInput = document.createElement("input");
    addDomainInput.className = "opt-input";
    addDomainInput.placeholder = "新增领域，例如：生物信息学";
    addDomainInput.style.marginBottom = "0";
    addDomainInput.style.flex = "1";
    addDomainInput.style.minWidth = "160px";

    const addDomainBtn = document.createElement("button");
    addDomainBtn.className = "opt-btn opt-btn-primary";
    addDomainBtn.textContent = "新增";
    addDomainBtn.setAttribute("aria-label", "新增文章领域");

    addRow.appendChild(addDomainInput);
    addRow.appendChild(addDomainBtn);
    domainsSection.appendChild(addRow);
    wrap.appendChild(domainsSection);

    let domainsState = [];

    function renderDomainsList() {
      domainsList.textContent = "";
      if (!domainsState.length) {
        const empty = document.createElement("div");
        empty.style.cssText = "font-size:12px;color:var(--color-text-4);padding:4px 0";
        empty.textContent = "暂无领域，请先新增。";
        domainsList.appendChild(empty);
        return;
      }

      domainsState.forEach((item, idx) => {
        const row = document.createElement("div");
        row.style.cssText = "display:flex;gap:8px;align-items:center";

        const idxBadge = document.createElement("span");
        idxBadge.textContent = String(idx + 1);
        idxBadge.style.cssText = "min-width:20px;font-size:12px;color:var(--color-text-4)";

        const input = document.createElement("input");
        input.className = "opt-input";
        input.value = item;
        input.style.marginBottom = "0";
        input.style.flex = "1";
        input.addEventListener("input", () => {
          domainsState[idx] = input.value;
        });

        const delBtn = document.createElement("button");
        delBtn.className = "opt-btn opt-btn-danger";
        delBtn.textContent = "删除";
        delBtn.setAttribute("aria-label", `删除领域 ${item}`);
        delBtn.onclick = () => {
          domainsState.splice(idx, 1);
          renderDomainsList();
        };

        row.appendChild(idxBadge);
        row.appendChild(input);
        row.appendChild(delBtn);
        domainsList.appendChild(row);
      });
    }

    async function saveDomains() {
      const normalized = domainsState
        .map((v) => String(v || "").trim())
        .filter(Boolean)
        .slice(0, 50);
      domainsState = normalized;
      const res = await send("updateConfig", { config: { articleDomains: normalized } });
      if (res) toast("文章领域已保存");
      renderDomainsList();
    }

    addDomainBtn.onclick = async () => {
      const value = addDomainInput.value.trim();
      if (!value) return;
      if (domainsState.includes(value)) {
        toast("该领域已存在");
        return;
      }
      domainsState.push(value);
      addDomainInput.value = "";
      await saveDomains();
    };

    addDomainInput.addEventListener("keydown", async (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addDomainBtn.click();
      }
    });

    const domainsSaveBtn = document.createElement("button");
    domainsSaveBtn.className = "opt-btn";
    domainsSaveBtn.textContent = "保存领域修改";
    domainsSaveBtn.style.marginTop = "10px";
    domainsSaveBtn.onclick = saveDomains;
    domainsSection.appendChild(domainsSaveBtn);

    send("getConfig").then((cfg) => {
      domainsState = Array.isArray(cfg?.articleDomains) ? cfg.articleDomains.slice() : [];
      renderDomainsList();
    });

    // ===== 创建词库 =====
    const createRow = document.createElement("div");
    createRow.className = "glass opt-card";

    const createTitle = document.createElement("h2");
    createTitle.className = "opt-card-title";
    createTitle.textContent = "创建新词库";
    createRow.appendChild(createTitle);

    const createInputRow = document.createElement("div");
    createInputRow.className = "opt-btn-row";

    const createLabelEl = document.createElement("label");
    createLabelEl.setAttribute("for", "create-lib-input");
    createLabelEl.style.cssText = "font-size:13px;color:var(--color-text-2);white-space:nowrap";
    createLabelEl.textContent = "词库名称";

    const createInput = document.createElement("input");
    createInput.id = "create-lib-input";
    createInput.className = "opt-input";
    createInput.placeholder = "例如：技术词汇、备考单词…";
    createInput.style.marginBottom = "0";
    createInput.style.flex = "1";
    createInput.style.minWidth = "160px";

    const createBtn = document.createElement("button");
    createBtn.textContent = "创建";
    createBtn.className = "opt-btn opt-btn-primary";
    createBtn.setAttribute("aria-label", "创建新词汇库");
    createBtn.onclick = async () => {
      const name = createInput.value.trim() || "未命名词库";
      const r = await send("createVocabLib", { name });
      if (r && r.id) {
        createInput.value = "";
        toast("已创建词库：" + r.name);
        render();
      }
    };

    createInputRow.appendChild(createLabelEl);
    createInputRow.appendChild(createInput);
    createInputRow.appendChild(createBtn);
    createRow.appendChild(createInputRow);
    wrap.appendChild(createRow);

    // ===== 导入词库 =====
    const importRow = document.createElement("div");
    importRow.className = "glass opt-card";

    const importTitle = document.createElement("h2");
    importTitle.className = "opt-card-title";
    importTitle.textContent = "导入词库";
    importRow.appendChild(importTitle);

    const importBtn = document.createElement("button");
    importBtn.textContent = "从 JSON 文件导入";
    importBtn.className = "opt-btn";
    importBtn.setAttribute("aria-label", "从 JSON 文件导入词汇库");
    const importInput = document.createElement("input");
    importInput.type = "file";
    importInput.accept = ".json,application/json";
    importInput.style.display = "none";
    importInput.onchange = async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      const text = await f.text();
      const r = await send("importVocabLib", { jsonString: text, autoLoad: true });
      e.target.value = "";
      if (r && r.ok) {
        toast("已导入：" + (r.name || "词库"));
        render();
      } else {
        toast(r?.error || "导入失败");
      }
    };
    importBtn.onclick = () => importInput.click();
    importRow.appendChild(importBtn);
    importRow.appendChild(importInput);
    wrap.appendChild(importRow);

    // ===== 云同步 =====
    const syncSection = document.createElement("div");
    syncSection.className = "glass opt-card";

    const syncTitle = document.createElement("h2");
    syncTitle.className = "opt-card-title";
    syncTitle.textContent = "云同步（GitHub Gist）";
    syncSection.appendChild(syncTitle);

    const syncHint = document.createElement("p");
    syncHint.className = "opt-card-hint";
    syncHint.textContent = "Token 与 Gist ID 保存在 chrome.storage.sync，可在多设备共享。词库变更后会自动防抖上传（10 秒）。";
    syncSection.appendChild(syncHint);

    const syncEnableRow = document.createElement("div");
    syncEnableRow.className = "opt-checkbox-row";
    const syncEnable = document.createElement("input");
    syncEnable.type = "checkbox";
    syncEnable.id = "sync-enabled";
    const syncEnableLabel = document.createElement("label");
    syncEnableLabel.setAttribute("for", "sync-enabled");
    syncEnableLabel.textContent = "启用词库云同步";
    syncEnableRow.appendChild(syncEnable);
    syncEnableRow.appendChild(syncEnableLabel);
    syncSection.appendChild(syncEnableRow);

    const tokenLabel = document.createElement("label");
    tokenLabel.setAttribute("for", "sync-token-input");
    tokenLabel.style.cssText = "display:block;font-size:12px;color:var(--color-text-3);margin-bottom:4px";
    tokenLabel.textContent = "GitHub Token（需要 gist 权限）";
    syncSection.appendChild(tokenLabel);

    const tokenInput = document.createElement("input");
    tokenInput.id = "sync-token-input";
    tokenInput.type = "password";
    tokenInput.placeholder = "ghp_xxxxxxxxxxxx";
    tokenInput.className = "opt-input";
    syncSection.appendChild(tokenInput);

    const gistLabel = document.createElement("label");
    gistLabel.setAttribute("for", "sync-gist-input");
    gistLabel.style.cssText = "display:block;font-size:12px;color:var(--color-text-3);margin-bottom:4px";
    gistLabel.textContent = "Gist ID（可留空，首次上传自动创建）";
    syncSection.appendChild(gistLabel);

    const gistInput = document.createElement("input");
    gistInput.id = "sync-gist-input";
    gistInput.placeholder = "留空则首次上传时自动创建";
    gistInput.className = "opt-input";
    syncSection.appendChild(gistInput);

    const syncBtnRow = document.createElement("div");
    syncBtnRow.className = "opt-btn-row";
    const syncSaveBtn = document.createElement("button");
    syncSaveBtn.textContent = "保存同步配置";
    syncSaveBtn.className = "opt-btn opt-btn-primary";
    syncSaveBtn.setAttribute("aria-label", "保存云同步配置");
    const syncUploadBtn = document.createElement("button");
    syncUploadBtn.textContent = "立即上传";
    syncUploadBtn.className = "opt-btn";
    syncUploadBtn.setAttribute("aria-label", "立即上传词库到云端");
    const syncDownloadBtn = document.createElement("button");
    syncDownloadBtn.textContent = "立即下载并覆盖本地";
    syncDownloadBtn.className = "opt-btn";
    syncDownloadBtn.setAttribute("aria-label", "从云端下载词库并覆盖本地");
    syncBtnRow.appendChild(syncSaveBtn);
    syncBtnRow.appendChild(syncUploadBtn);
    syncBtnRow.appendChild(syncDownloadBtn);
    syncSection.appendChild(syncBtnRow);

    const syncStatus = document.createElement("p");
    syncStatus.className = "opt-status";
    syncStatus.textContent = "同步状态：未初始化";
    syncStatus.setAttribute("aria-live", "polite");
    syncSection.appendChild(syncStatus);

    function setSyncStatus(text, ok = true) {
      syncStatus.textContent = "同步状态：" + text;
      syncStatus.className = "opt-status" + (ok ? "" : " error");
    }
    updateSyncStatus = setSyncStatus;

    async function loadSyncConfig() {
      const res = await send("getVocabSyncConfig");
      if (!res || !res.ok) {
        setSyncStatus(res?.error || "读取同步配置失败", false);
        return;
      }
      const cfg = res.config || {};
      syncEnable.checked = cfg.enabled !== false;
      tokenInput.value = cfg.token || "";
      gistInput.value = cfg.gistId || "";
      setSyncStatus("配置已加载");
    }

    syncSaveBtn.onclick = async () => {
      const res = await send("setVocabSyncConfig", {
        config: {
          enabled: !!syncEnable.checked,
          token: tokenInput.value.trim(),
          gistId: gistInput.value.trim(),
        },
      });
      if (res && res.ok) {
        gistInput.value = res.config?.gistId || gistInput.value;
        setSyncStatus("配置保存成功");
        toast("同步配置已保存");
      } else {
        setSyncStatus(res?.error || "保存失败", false);
        toast(res?.error || "同步配置保存失败");
      }
    };

    syncUploadBtn.onclick = async () => {
      setSyncStatus("上传中...");
      const res = await send("vocabSyncUploadNow");
      if (res && res.ok) {
        setSyncStatus("上传成功");
        const cfgRes = await send("getVocabSyncConfig");
        if (cfgRes?.ok && cfgRes.config?.gistId) gistInput.value = cfgRes.config.gistId;
        toast("云端上传成功");
      } else {
        setSyncStatus(res?.error || "上传失败", false);
        toast(res?.error || "云端上传失败");
      }
    };

    syncDownloadBtn.onclick = async () => {
      if (!confirm("下载会覆盖当前本地词库，确定继续吗？")) return;
      setSyncStatus("下载中...");
      const res = await send("vocabSyncDownloadNow");
      if (res && res.ok) {
        setSyncStatus("下载成功，已覆盖本地");
        toast("云端词库已同步到本地");
        render();
      } else {
        setSyncStatus(res?.error || "下载失败", false);
        toast(res?.error || "云端下载失败");
      }
    };

    loadSyncConfig().catch(() => {
      setSyncStatus("读取同步配置失败", false);
    });
    wrap.appendChild(syncSection);

    // ===== AI 配置 =====
    const AI_PROVIDERS = {
      gemini:   { label: "Gemini",        defaultModel: "gemini-3.1-flash-lite-preview" },
      chatgpt:  { label: "ChatGPT",       defaultModel: "gpt-4.1-mini" },
      deepseek: { label: "DeepSeek",      defaultModel: "deepseek-chat" },
      qwen:     { label: "Qwen（阿里云）", defaultModel: "qwen3-flash" },
      kimi:     { label: "Kimi",          defaultModel: "kimi-k2.5" },
    };

    const aiSection = document.createElement("div");
    aiSection.className = "glass opt-card";

    const aiTitle = document.createElement("h2");
    aiTitle.className = "opt-card-title";
    aiTitle.textContent = "AI 配置";
    aiSection.appendChild(aiTitle);

    const aiHint = document.createElement("p");
    aiHint.className = "opt-card-hint";
    aiHint.textContent = "用于句子拆解和添加单词时的 AI 释义生成。";
    aiSection.appendChild(aiHint);

    const providerLabel = document.createElement("label");
    providerLabel.setAttribute("for", "ai-provider-select");
    providerLabel.style.cssText = "display:block;font-size:12px;color:var(--color-text-3);margin-bottom:4px";
    providerLabel.textContent = "AI 服务商";
    aiSection.appendChild(providerLabel);

    const providerSelect = document.createElement("select");
    providerSelect.id = "ai-provider-select";
    providerSelect.className = "opt-select";
    Object.entries(AI_PROVIDERS).forEach(([key, { label }]) => {
      const opt = document.createElement("option");
      opt.value = key;
      opt.textContent = label;
      providerSelect.appendChild(opt);
    });
    aiSection.appendChild(providerSelect);

    const apiKeyLabel = document.createElement("label");
    apiKeyLabel.setAttribute("for", "ai-apikey-input");
    apiKeyLabel.style.cssText = "display:block;font-size:12px;color:var(--color-text-3);margin-bottom:4px";
    apiKeyLabel.textContent = "API Key";
    aiSection.appendChild(apiKeyLabel);

    const apiKeyInput = document.createElement("input");
    apiKeyInput.id = "ai-apikey-input";
    apiKeyInput.type = "password";
    apiKeyInput.placeholder = "API Key";
    apiKeyInput.className = "opt-input";
    aiSection.appendChild(apiKeyInput);

    const modelLabel = document.createElement("label");
    modelLabel.setAttribute("for", "ai-model-input");
    modelLabel.style.cssText = "display:block;font-size:12px;color:var(--color-text-3);margin-bottom:4px";
    modelLabel.textContent = "模型名称（可选）";
    aiSection.appendChild(modelLabel);

    const modelInput = document.createElement("input");
    modelInput.id = "ai-model-input";
    modelInput.type = "text";
    modelInput.className = "opt-input";
    aiSection.appendChild(modelInput);

    function updateAiInputs(provider, providers) {
      const cfg = providers?.[provider] || {};
      apiKeyInput.value = cfg.apiKey || "";
      const defaultModel = AI_PROVIDERS[provider]?.defaultModel || "";
      modelInput.placeholder = `留空则使用默认：${defaultModel}`;
      modelInput.value = cfg.model !== defaultModel ? (cfg.model || "") : "";
    }

    const aiSaveBtn = document.createElement("button");
    aiSaveBtn.textContent = "保存 AI 配置";
    aiSaveBtn.className = "opt-btn opt-btn-primary";
    aiSaveBtn.setAttribute("aria-label", "保存 AI 配置");
    aiSection.appendChild(aiSaveBtn);

    const aiStatus = document.createElement("p");
    aiStatus.className = "opt-status";
    aiStatus.setAttribute("aria-live", "polite");
    aiSection.appendChild(aiStatus);

    // Load current config
    let aiConfig = {};
    send("getConfig").then((cfg) => {
      aiConfig = cfg?.llm || {};
      const activeProvider = aiConfig.activeProvider || "gemini";
      providerSelect.value = activeProvider;
      updateAiInputs(activeProvider, aiConfig.providers);
    }).catch(() => {});

    providerSelect.addEventListener("change", () => {
      updateAiInputs(providerSelect.value, aiConfig.providers);
    });

    aiSaveBtn.onclick = async () => {
      const provider = providerSelect.value;
      const defaultModel = AI_PROVIDERS[provider]?.defaultModel || "";
      const newProviders = { ...(aiConfig.providers || {}) };
      newProviders[provider] = {
        apiKey: apiKeyInput.value.trim(),
        model: modelInput.value.trim() || defaultModel,
      };
      const newLlm = { activeProvider: provider, providers: newProviders };
      try {
        await send("updateConfig", { config: { llm: newLlm } });
        aiConfig = newLlm;
        aiStatus.textContent = "✓ 保存成功";
        aiStatus.className = "opt-status ok";
        toast("AI 配置已保存");
        setTimeout(() => { aiStatus.textContent = ""; aiStatus.className = "opt-status"; }, 3000);
      } catch (e) {
        aiStatus.textContent = "保存失败：" + (e?.message || "未知错误");
        aiStatus.className = "opt-status error";
      }
    };

    wrap.appendChild(aiSection);

    const libListPromise = send("getVocabLibs");
    const loadedPromise = send("getVocabLoadedIds");

    Promise.all([libListPromise, loadedPromise]).then(([libRes, loadedRes]) => {
      const libs = (libRes && libRes.libs) || [];
      const loadedIds = (loadedRes && loadedRes.loadedIds) || [];

      // ===== 选择要加载的词库 =====
      const loadSection = document.createElement("div");
      loadSection.className = "glass opt-card";

      const loadTitle = document.createElement("h2");
      loadTitle.className = "opt-card-title";
      loadTitle.textContent = "选择要加载的词库";
      loadSection.appendChild(loadTitle);

      libs.forEach((lib) => {
        const row = document.createElement("div");
        row.className = "opt-lib-row";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.id = "lib-cb-" + lib.id;
        cb.checked = loadedIds.includes(lib.id);
        cb.dataset.libId = lib.id;
        const labelEl = document.createElement("label");
        labelEl.setAttribute("for", "lib-cb-" + lib.id);
        labelEl.textContent = lib.name;
        row.appendChild(cb);
        row.appendChild(labelEl);
        loadSection.appendChild(row);
      });

      const saveLoadBtn = document.createElement("button");
      saveLoadBtn.textContent = "保存加载配置";
      saveLoadBtn.className = "opt-btn opt-btn-primary";
      saveLoadBtn.setAttribute("aria-label", "保存词库加载配置");
      saveLoadBtn.style.marginTop = "14px";
      saveLoadBtn.onclick = async () => {
        const ids = [...loadSection.querySelectorAll("input[type=checkbox]:checked")].map((c) => c.dataset.libId);
        await send("setLoadedLibs", { loadedIds: ids });
        toast("已保存");
      };
      loadSection.appendChild(saveLoadBtn);
      wrap.appendChild(loadSection);

      // ===== 手动添加词汇 =====
      const addSection = document.createElement("div");
      addSection.className = "glass opt-card";

      const addTitle = document.createElement("h2");
      addTitle.className = "opt-card-title";
      addTitle.textContent = "手动添加词汇";
      addSection.appendChild(addTitle);

      const addLibLabel = document.createElement("label");
      addLibLabel.setAttribute("for", "add-lib-select");
      addLibLabel.style.cssText = "display:block;font-size:12px;color:var(--color-text-3);margin-bottom:4px";
      addLibLabel.textContent = "目标词库";
      addSection.appendChild(addLibLabel);

      const selectLib = document.createElement("select");
      selectLib.id = "add-lib-select";
      selectLib.className = "opt-select";
      libs.forEach((lib) => {
        const opt = document.createElement("option");
        opt.value = lib.id;
        opt.textContent = lib.name;
        selectLib.appendChild(opt);
      });
      addSection.appendChild(selectLib);

      const addWordLabel = document.createElement("label");
      addWordLabel.setAttribute("for", "add-word-input");
      addWordLabel.style.cssText = "display:block;font-size:12px;color:var(--color-text-3);margin-bottom:4px";
      addWordLabel.textContent = "单词";
      addSection.appendChild(addWordLabel);

      const wordInput = document.createElement("input");
      wordInput.id = "add-word-input";
      wordInput.placeholder = "英文单词";
      wordInput.className = "opt-input";
      addSection.appendChild(wordInput);

      const addDefLabel = document.createElement("label");
      addDefLabel.setAttribute("for", "add-def-input");
      addDefLabel.style.cssText = "display:block;font-size:12px;color:var(--color-text-3);margin-bottom:4px";
      addDefLabel.textContent = "释义";
      addSection.appendChild(addDefLabel);

      const defInput = document.createElement("input");
      defInput.id = "add-def-input";
      defInput.placeholder = "中文释义（可选）";
      defInput.className = "opt-input";
      addSection.appendChild(defInput);

      const variantsLabel = document.createElement("label");
      variantsLabel.setAttribute("for", "add-variants-input");
      variantsLabel.style.cssText = "display:block;font-size:12px;color:var(--color-text-3);margin-bottom:4px";
      variantsLabel.textContent = "词形变体（可选，多个用逗号分隔）";
      addSection.appendChild(variantsLabel);

      const variantsInput = document.createElement("input");
      variantsInput.id = "add-variants-input";
      variantsInput.placeholder = "例：deadlocks, deadlocked";
      variantsInput.className = "opt-input";
      addSection.appendChild(variantsInput);

      const addWordBtn = document.createElement("button");
      addWordBtn.textContent = "添加";
      addWordBtn.className = "opt-btn opt-btn-primary";
      addWordBtn.setAttribute("aria-label", "添加单词到词库");
      addWordBtn.onclick = async () => {
        const libId = selectLib.value;
        const word = wordInput.value.trim();
        const definition = defInput.value.trim();
        const variantsStr = variantsInput.value.trim();
        if (!libId || !word) {
          toast("请选择词库并输入单词");
          return;
        }
        const dataRes = await send("getVocabLibData", { libId });
        const data = dataRes?.ok ? dataRes.data : null;
        const has = data && data.levels && data.levels[word.toLowerCase()];
        if (has) {
          if (!confirm("该词库中已有此词，是否覆盖？")) return;
        }
        const variants = variantsStr
          ? variantsStr.replace(/\uFF0C/g, ",").split(",").map((s) => s.trim()).filter(Boolean)
          : [];
        const r = await send("addWordBatchToVocabLib", { libId, word, definition, variants });
        if (!r || !r.ok) {
          toast(r?.error || "添加失败");
          return;
        }
        wordInput.value = "";
        defInput.value = "";
        variantsInput.value = "";
        if (r.synced) toast("已同步至磁盘");
        else toast(variants.length ? "已添加单词及变体" : "已添加");
      };
      addSection.appendChild(addWordBtn);
      wrap.appendChild(addSection);

      // ===== 导出词库 =====
      const exportSection = document.createElement("div");
      exportSection.className = "glass opt-card";

      const exportTitle = document.createElement("h2");
      exportTitle.className = "opt-card-title";
      exportTitle.textContent = "导出词库";
      exportSection.appendChild(exportTitle);

      const exportLibLabel = document.createElement("label");
      exportLibLabel.setAttribute("for", "export-lib-select");
      exportLibLabel.style.cssText = "display:block;font-size:12px;color:var(--color-text-3);margin-bottom:4px";
      exportLibLabel.textContent = "选择词库";
      exportSection.appendChild(exportLibLabel);

      const exportSelect = document.createElement("select");
      exportSelect.id = "export-lib-select";
      exportSelect.className = "opt-select";
      libs.forEach((lib) => {
        const opt = document.createElement("option");
        opt.value = lib.id;
        opt.textContent = lib.name;
        exportSelect.appendChild(opt);
      });
      exportSection.appendChild(exportSelect);

      const exportBtn = document.createElement("button");
      exportBtn.textContent = "导出为 JSON";
      exportBtn.className = "opt-btn opt-btn-primary";
      exportBtn.setAttribute("aria-label", "导出词库为 JSON 文件");
      exportBtn.onclick = async () => {
        const libId = exportSelect.value;
        const r = await send("exportVocabLib", { libId });
        if (r && r.ok && r.json) {
          const a = document.createElement("a");
          a.href = "data:application/json;charset=utf-8," + encodeURIComponent(r.json);
          a.download = (libs.find((l) => l.id === libId)?.name || "词库") + ".json";
          a.click();
          toast("已导出");
        } else {
          toast("导出失败");
        }
      };
      exportSection.appendChild(exportBtn);
      wrap.appendChild(exportSection);

      // ===== 删除词库 =====
      const deleteSection = document.createElement("div");
      deleteSection.className = "glass opt-card";

      const deleteTitle = document.createElement("h2");
      deleteTitle.className = "opt-card-title";
      deleteTitle.style.color = "var(--color-error)";
      deleteTitle.textContent = "删除词库（不可恢复）";
      deleteSection.appendChild(deleteTitle);

      const deleteLibLabel = document.createElement("label");
      deleteLibLabel.setAttribute("for", "delete-lib-select");
      deleteLibLabel.style.cssText = "display:block;font-size:12px;color:var(--color-text-3);margin-bottom:4px";
      deleteLibLabel.textContent = "选择词库";
      deleteSection.appendChild(deleteLibLabel);

      const deleteSelect = document.createElement("select");
      deleteSelect.id = "delete-lib-select";
      deleteSelect.className = "opt-select";
      libs.forEach((lib) => {
        const opt = document.createElement("option");
        opt.value = lib.id;
        opt.textContent = lib.name;
        deleteSelect.appendChild(opt);
      });
      deleteSection.appendChild(deleteSelect);

      const deleteBtn = document.createElement("button");
      deleteBtn.textContent = "删除该词库";
      deleteBtn.className = "opt-btn opt-btn-danger";
      deleteBtn.setAttribute("aria-label", "永久删除所选词库");
      deleteBtn.onclick = async () => {
        const libId = deleteSelect.value;
        if (!libId) {
          toast("请选择要删除的词库");
          return;
        }
        const libName = libs.find((l) => l.id === libId)?.name || "词库";
        if (!confirm(`确定要删除词库「${libName}」吗？此操作不可恢复。`)) return;
        try {
          const local = await chrome.storage.local.get({
            vocab_libs: [],
            vocab_loaded_ids: [],
          });
          const nextLibs = Array.isArray(local.vocab_libs)
            ? local.vocab_libs.filter((l) => l.id !== libId)
            : [];
          const nextLoadedIds = Array.isArray(local.vocab_loaded_ids)
            ? local.vocab_loaded_ids.filter((id) => id !== libId)
            : [];
          await chrome.storage.local.set({
            vocab_libs: nextLibs,
            vocab_loaded_ids: nextLoadedIds,
          });
          await chrome.storage.local.remove(`vocab_lib_${libId}`);
          toast("已删除词库，正在刷新插件…");
          setTimeout(() => {
            try { chrome.runtime.reload(); } catch (e) {}
          }, 200);
        } catch (e) {
          toast("删除失败");
        }
      };
      deleteSection.appendChild(deleteBtn);
      wrap.appendChild(deleteSection);
    });

    app.textContent = "";
    app.appendChild(wrap);
  }

  render();
})();
