# 轻译 Float MCP Server（Node.js + WebSocket）

这个 MCP Server 通过 `WebSocket`（`ws://127.0.0.1:2999`）与浏览器插件 `background.js` 通信，并通过 `stdio` 向 MCP 客户端（Cursor/Claude Desktop 等）提供 tools。

## 1. 启动 MCP Server

```bash
cd mcp-server
npm install
npm start
```

服务监听：
- WS：`ws://127.0.0.1:2999`
- MCP（stdio）：由 MCP 客户端通过 stdin/stdout 与该进程通信

调试日志全部使用 `console.error` 输出，不占用 stdout。

## 2. 插件侧配置

在插件 Options 页面：
- `启用 MCP WebSocket 连接`：勾选
- `MCP_URL`：填 `ws://127.0.0.1:2999`
- `Token`：可选（会在握手 HELLO 中发送）

插件会发送：

```json
{ "type": "HELLO", "source": "float-extension", "token": "你的token", "version": "0.4.0" }
```

## 3. IDE（MCP 客户端）配置

不同 IDE 的 UI 名称略有差异，但核心是：**把下面命令作为 MCP server（stdio 传输）启动**。

### Cursor（示例）

在 Cursor Settings 中找到 MCP/Servers 相关配置，然后添加一个本地 server：

- Command：`node`
- Args：`["<项目路径>/mcp-server/server.js"]`
- Transport：`stdio`

工具（tools）名称：
- `list_vocab_libs`
- `add_word`
- `add_words_batch`

### Claude Desktop（思路一致）

同样添加一个本地 MCP server（stdio），command/args 指向 `mcp-server/server.js`。

## 4. tools 的输入结构

- `list_vocab_libs`：无输入
- `add_word`
  - `libId: string`
  - `word: string`
  - `definition?: string`
  - `variants?: string[]`
- `add_words_batch`
  - `libId: string`
  - `items: { word: string, definition?: string, variants?: string[] }[]`

## 5. 常见问题排查

1. 插件显示错误/状态不对
   - 确认 MCP server 已启动
   - 确认端口 `2999` 未被占用
2. 仍看到 `Unknown message type`
   - 这通常意味着 WS 协议类型不匹配
   - 把 `mcp-server` 进程的最近 stderr 日志贴出来对齐协议
