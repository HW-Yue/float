#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const { WebSocketServer } = require("ws");

const WS_PORT = 2999;
const REQUEST_TIMEOUT_MS = 15000;

let extensionSocket = null;
let extensionHello = null;
let wsReqSeq = 1;

const pendingWsRequests = new Map();

function debugLog(...args) {
  console.error("[mcp-server]", ...args);
}

function checksumOf(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function writeJsonRpc(id, result, error) {
  const payload = { jsonrpc: "2.0", id };
  if (error) payload.error = error;
  else payload.result = result;
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function toolSuccessText(obj) {
  return {
    content: [{ type: "text", text: JSON.stringify(obj, null, 2) }],
    isError: false,
  };
}

function toolErrorText(message, extra = {}) {
  return {
    content: [{ type: "text", text: JSON.stringify({ ok: false, error: message, ...extra }, null, 2) }],
    isError: true,
  };
}

function ensureExtensionOnline() {
  return extensionSocket && extensionSocket.readyState === extensionSocket.OPEN;
}

function sendToExtension(type, data, timeoutMs = REQUEST_TIMEOUT_MS) {
  if (!ensureExtensionOnline()) {
    return Promise.reject(new Error("插件未连接到 WS:2999，请先在插件 Options 中启用 MCP_URL=ws://127.0.0.1:2999"));
  }

  const id = `ws-${wsReqSeq++}`;
  const reqPayload = { id, type, data: data || {} };
  const reqChecksum = checksumOf(reqPayload);
  // 把请求 checksum 带给插件；插件回包时回显并给出 checksumConfirmed
  reqPayload.data.requestChecksum = reqChecksum;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingWsRequests.delete(id);
      reject(new Error(`插件响应超时: ${type}`));
    }, timeoutMs);

    pendingWsRequests.set(id, {
      resolve: (resp) => {
        clearTimeout(timer);
        const confirmationChecksum = checksumOf({
          requestChecksum: reqChecksum,
          response: resp,
          type,
        });
        resolve({
          response: resp,
          requestChecksum: reqChecksum,
          confirmationChecksum,
          checksumConfirmed:
            !!resp &&
            (typeof resp.checksumConfirmed === "boolean" ? resp.checksumConfirmed : resp.ok === true),
        });
      },
      reject: (err) => {
        clearTimeout(timer);
        reject(err);
      },
    });

    try {
      extensionSocket.send(JSON.stringify(reqPayload));
    } catch (err) {
      clearTimeout(timer);
      pendingWsRequests.delete(id);
      reject(err);
    }
  });
}

async function handleToolCall(name, args) {
  if (name === "list_vocab_libs") {
    const ret = await sendToExtension("GET_VOCAB_LIBS", {});
    return toolSuccessText({
      ok: true,
      route: "GET_VOCAB_LIBS",
      hello: extensionHello,
      ...ret,
    });
  }

  if (name === "add_word") {
    const payload = {
      libId: args?.libId,
      word: args?.word,
      definition: args?.definition || "",
      variants: Array.isArray(args?.variants) ? args.variants : [],
    };
    const ret = await sendToExtension("ADD_WORD", payload);
    return toolSuccessText({
      ok: ret.checksumConfirmed === true,
      route: "ADD_WORD",
      ...ret,
    });
  }

  if (name === "add_words_batch") {
    const payload = {
      libId: args?.libId,
      items: Array.isArray(args?.items) ? args.items : [],
    };
    const ret = await sendToExtension("ADD_WORDS_BATCH", payload);
    return toolSuccessText({
      ok: ret.checksumConfirmed === true,
      route: "ADD_WORDS_BATCH",
      ...ret,
    });
  }

  return toolErrorText(`Unknown tool: ${name}`);
}

const wss = new WebSocketServer({ port: WS_PORT });
wss.on("connection", (socket, req) => {
  debugLog("Extension socket connected from", req.socket.remoteAddress);
  extensionSocket = socket;
  extensionHello = null;

  socket.on("message", (buf) => {
    let msg;
    try {
      msg = JSON.parse(String(buf));
    } catch {
      debugLog("Invalid JSON from extension");
      return;
    }

    if (msg && msg.type === "HELLO") {
      extensionHello = msg;
      debugLog("HELLO received:", msg.source, msg.version);
      return;
    }

    const id = msg?.id;
    if (id && pendingWsRequests.has(id)) {
      const slot = pendingWsRequests.get(id);
      pendingWsRequests.delete(id);
      slot.resolve(msg);
      return;
    }

    debugLog("Unhandled WS message:", msg);
  });

  socket.on("close", () => {
    if (extensionSocket === socket) {
      extensionSocket = null;
      extensionHello = null;
    }
    debugLog("Extension socket closed");
  });

  socket.on("error", (err) => {
    debugLog("Extension socket error:", err.message);
  });
});

wss.on("listening", () => {
  debugLog(`WebSocket bridge listening on ws://127.0.0.1:${WS_PORT}`);
});
wss.on("error", (err) => {
  debugLog("WebSocket server error:", err.message);
});

process.stdin.setEncoding("utf8");
let inputBuffer = "";

function handleJsonRpc(msg) {
  if (!msg || msg.jsonrpc !== "2.0") return;
  const method = msg.method;

  if (method === "initialize") {
    writeJsonRpc(msg.id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "float-mcp-server", version: "0.1.0" },
    });
    return;
  }

  if (method === "notifications/initialized") {
    return;
  }

  if (method === "tools/list") {
    writeJsonRpc(msg.id, {
      tools: [
        {
          name: "list_vocab_libs",
          description: "读取插件中的用户自定义词库列表与加载状态",
          inputSchema: { type: "object", properties: {}, additionalProperties: false },
        },
        {
          name: "add_word",
          description: "向指定词库写入单词与词形变体，并等待插件确认",
          inputSchema: {
            type: "object",
            properties: {
              libId: { type: "string" },
              word: { type: "string" },
              definition: { type: "string" },
              variants: { type: "array", items: { type: "string" } },
            },
            required: ["libId", "word"],
            additionalProperties: false,
          },
        },
        {
          name: "add_words_batch",
          description: "批量写入多个单词（每个可含 variants）并等待插件确认",
          inputSchema: {
            type: "object",
            properties: {
              libId: { type: "string" },
              items: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    word: { type: "string" },
                    definition: { type: "string" },
                    variants: { type: "array", items: { type: "string" } },
                  },
                  required: ["word"],
                  additionalProperties: false,
                },
              },
            },
            required: ["libId", "items"],
            additionalProperties: false,
          },
        },
      ],
    });
    return;
  }

  if (method === "tools/call") {
    handleToolCall(msg.params?.name, msg.params?.arguments || {})
      .then((result) => writeJsonRpc(msg.id, result))
      .catch((err) => {
        debugLog("tools/call failed:", err.message);
        writeJsonRpc(msg.id, toolErrorText(err.message));
      });
    return;
  }

  if (msg.id !== undefined && msg.id !== null) {
    writeJsonRpc(msg.id, null, { code: -32601, message: `Method not found: ${method}` });
  }
}

process.stdin.on("data", (chunk) => {
  inputBuffer += chunk;
  while (true) {
    const idx = inputBuffer.indexOf("\n");
    if (idx < 0) break;
    const line = inputBuffer.slice(0, idx).trim();
    inputBuffer = inputBuffer.slice(idx + 1);
    if (!line) continue;

    // 仅处理看起来像 JSON 的输入，避免终端手工输入（ls、pwd 等）触发噪音日志
    if (!line.startsWith("{")) continue;

    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      // 非法 JSON 直接忽略，避免干扰 stdout/stderr
      continue;
    }

    // 仅处理 MCP JSON-RPC 消息
    if (msg?.jsonrpc !== "2.0" || typeof msg?.method !== "string") continue;
    handleJsonRpc(msg);
  }
});

process.stdin.on("end", () => {
  debugLog("stdin ended, exiting");
  process.exit(0);
});
