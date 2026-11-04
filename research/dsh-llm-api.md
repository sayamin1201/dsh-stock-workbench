# DSH 插件在 Host 侧调用 LLM 流式生成：可照抄规格（0.2.1-rc.5）

> 目标：给「Cordis Host 插件里调一次模型、流式拿文本」提供**确切的 API 形状**——字段名、判别式、最小调用序列、错误与取消。
>
> 本次调研**纯只读**：只 read 了 asar 内文件；**未安装任何 bundle、未改 profile、未写 cordis.patch.yml、未发起真实模型请求**。
>
> 结论先行（三句话）：
> 1. 入口是 Cordis 服务 `llm`（`ctx.llm.stream(options)`），`options` 里跑的是 `provider` / `model` / `messages`，system prompt 走 `options.system`（字符串）**或**一条 `role: "system"` 的 message，**没有** `system`/`developer` 之外的第三条路。
> 2. 流是**扁平的判别联合**，判据就是 `chunk.type`：`block-start` / `text-delta` / `reasoning-delta` / `tool-call-delta` / `block-end` / `usage` / `finish`。文本增量是 `chunk.text`（**不是** `chunk.delta.text`）。**没有独立的 `error` chunk**——失败与取消都塞在 `finish.reason.kind === "error" | "aborted"` 里。
> 3. 直接 `ctx.llm.stream({provider, model, messages})` 能跑（内部自己 prepare），但**推荐 `await ctx.llm.prepareCall(config)` 拿 `PreparedLlmCall`，再 `prepared.stream({...prepared.config, messages})`**：能拿到 `context.contextWindow` / `retryPolicy` / `adapterDefaults` / `systemPromptUpdate`，且 `provider/model` 来自 `ctx.agentDefaultModel.currentSelection()`（`{provider, model, reasoningEffort?}`）——这个形状本身就是 `LlmCallConfig` 的子集。

---

## 0. 结论速查

| 问题 | 答案 | 证据级别 |
|---|---|---|
| 服务名 | `llm`（`super(ctx, "llm")`），Cordis 里写 `ctx.llm` | A |
| 包名 | 类型/工具函数 `import { ... } from '@deepseek-ai/dsh-llm'`；服务走 `ctx`，**不要**自己 new | A |
| 主调用 | `ctx.llm.stream(options)` / `prepared.stream(options)`；`llm/stream` 是 waterfall，可被插件包裹 | A |
| `GenerateOptions` 必填 | `provider`、`model`、`messages` | A |
| `GenerateOptions` 可选 | `system`、`maxTokens`、`temperature`、`stop`、`reasoningEffort`、`tools`、`toolHistory`、`sessionId`、`signal` | A（`system` 见 §3.3 注） |
| 文本增量 | `chunk.type === 'text-delta'` → `chunk.text: string` | A |
| 推理增量 | `chunk.type === 'reasoning-delta'` → `chunk.text: string` | A |
| 工具调用 | `chunk.type === 'tool-call-delta'` → `{index, id, name?, argumentsDelta}`；完整块在 `block-end` 的 `chunk.block` | A |
| 结束 | `chunk.type === 'finish'`，`chunk.reason.kind ∈ 'stop' \| 'tool-calls' \| 'max-tokens' \| 'error' \| 'aborted'` | A |
| 错误 chunk | **不存在** `type: 'error'`；错误码在 `finish.reason.failure.code` | A |
| system prompt | `options.system: string`（与首条 system 消息合并）或 `role:'system'` 消息；`developer` 消息是**工具变更通道**，不是 system prompt | A |
| user message | `{ role: 'user', content: [{ type: 'text', text: '...' }] }` 合法，**无需** id/source；但 `content` 必须是 block 数组，不是裸字符串 | A（读法见 §5.2） |
| 鉴权 | 插件**完全不管**。适配器按请求解析 provider 自己的凭据（`apiKeyEnv` 默认 `DEEPSEEK_API_KEY`；账号路线走存储 grant） | A |
| 取消 | `options.signal: AbortSignal`；取消 → 末尾 `finish.reason = {kind:'aborted', failure:{code:'ABORTED'}}`（不 throw） | A |

**证据分级**（沿用本目录既有约定）：

1. **A 级**：asar 内 `lib/index.js` 运行时代码 / `README.md` 原文，带行号，可直接照抄。
2. **B 级**：由运行时代码反推、但没有 `.d.ts` 或示例字面量直接佐证（例如某字段是否在 TS 类型里 `?` 可选）。
3. **C 级**：明确标注「未确认 / 未跑过」。

---

## 1. 证据来源

| 简称 | 文件（read 工具可读的 asar 路径） | 规模 |
|---|---|---|
| **L** | `D:\dsh\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-llm\lib\index.js` | 2429 行 |
| **R** | `...\@deepseek-ai\dsh-llm\README.md` | 197 行 |
| **A** | `...\@deepseek-ai\dsh-llm-deepseek\lib\index.js` | 2744 行 |
| **AR** | `...\@deepseek-ai\dsh-llm-deepseek\README.md` | 218 行 |
| **K** | `...\@deepseek-ai\dsh-llm-deepseek-api-key\README.md` | 97 行 |
| **M** | `...\@deepseek-ai\dsh-agent-default-model\lib\index.js` | 69 行 |
| **G** | `...\@deepseek-ai\dsh-agent-loop\lib\index.js` | 2023 行 |
| **T** | `...\@deepseek-ai\dsh-token-meter\README.md` | 159 行 |
| **RT** | `...\@deepseek-ai\dsh-llm-retry\lib\index.js` | 186 行 |

> **重要**：`lib\types\*.d.ts`、`lib\typert.host.d.ts` 在 asar 里**全部缺失**（read 报 `not found`，`dsh-llm\src\*.ts` 也没有）。所以「字段类型 / 是否可选」只能来自运行时代码 + README，不是 TS 声明原文——这是本文所有 B 级判断的根因。
>
> 另：`grep`/`rg` 对 asar 内部路径会报 `IO error ... (os error 3)`，只能用 `read` 按 offset/limit 分段读；本文所有行号均为 read 返回的行号。

包版本（`@deepseek-ai/dsh-llm\package.json`）：`"version": "0.2.1-rc.5"`，`"type": "module"`，`main: lib/index.js`，`peerDependencies: { "@deepseek-ai/cordis": "~4.0.5" }`。

---

## 2. 调用入口：`llm` 服务、`stream`、`prepareCall`、waterfall

### 2.1 服务本身

**L:1815-1817**（构造函数给出服务名）：

```js
constructor(ctx) {
    super(ctx, "llm");
}
```

**L:2393-2398**（两个公开入口，都过 `llm/stream` waterfall）：

```js
stream(options) {
    return this.streamWithRegistration(options);
}
streamWithRegistration(options, prepared) {
    return this.ctx.waterfall(this, "llm/stream", options, () => this.adapterStream(options, prepared));
}
```

**L:2304-2308**（边界语义，JSDoc 原文）：

> Adapter selection, dispatch, iterator construction, and iteration failures become one terminal failure chunk. Middleware and downstream consumer failures remain thrown plugin or consumer errors.

即：**provider 层的失败不会 throw，会变成末尾的 `finish` 错误 chunk；只有你自己的中间件/消费代码出错才 throw。** 这条决定了骨架里必须检查 `finish.reason.kind`，不能只靠 try/catch。

### 2.2 `stream()` 自己会 prepare（所以「直接 stream」是可用的）

**L:2317-2321**：

```js
if (prepared === void 0) {
    const adapterCall = await adapter.prepareCall(options.provider, options.model, options.signal);
    modelInfo = this.normalizeModelInfo(registration, options.model, adapterCall.model);
    resolvedConfig = this.resolveCallWithInfo(options, modelInfo).config;
    dispatch = (options) => adapterCall.stream(options);
}
```

**结论**：`llm.stream({provider, model, messages})` 这条路是**真实可用**的，不需要你手工 `prepareCall`；适配器默认值（`maxTokens`、`reasoningEffort`）在这一层被物化后**直接交给适配器**，但**调用方拿不到物化结果**。

### 2.3 `prepareCall` 给出 `PreparedLlmCall`（推荐）

**L:2220-2260**（节选，保留全部字段）：

```js
async prepareCall(config, signal, configure) {
    signal?.throwIfAborted();
    const { provider, model, ...controls } = config;
    const registration = this.registration(provider);
    const adapterCall = await registration.adapter.prepareCall(provider, model, signal);
    ...
    const resolved = this.resolveCallWithInfo(proposed, modelInfo);
    const resolvedConfig = deepFreeze(structuredClone(resolved.config));
    ...
    return Object.freeze({
        config: resolvedConfig,
        retryPolicy: registration.retryPolicy,
        adapterDefaults,
        ...context === void 0 ? {} : { context },
        ...modelInfo.inputModalities === void 0 ? {} : { inputModalities: Object.freeze([...modelInfo.inputModalities]) },
        ...modelInfo.systemPromptUpdate === void 0 ? {} : { systemPromptUpdate: modelInfo.systemPromptUpdate },
        ...modelInfo.toolUpdate === void 0 ? {} : { toolUpdate: modelInfo.toolUpdate },
        stream: (options) => {
            if (dispatched) throw new LlmError("a prepared LLM call can only be dispatched once", "INVALID_PREPARED_CALL");
            if (!callConfigEquals(options, resolvedConfig)) throw new LlmError("prepared LLM call config changed before adapter dispatch", "INVALID_PREPARED_CALL");
            dispatched = true;
            return this.streamWithRegistration(options, {
                registration,
                config: resolvedConfig,
                modelInfo,
                dispatch: (options) => adapterCall.stream(options)
            });
        }
    });
}
```

**`PreparedLlmCall` 字段（全部）**：`config`、`retryPolicy`、`adapterDefaults`、`context?`、`inputModalities?`、`systemPromptUpdate?`、`toolUpdate?`、`stream(options)`。

**两条硬约束**：
- **一次性**：`prepared.stream()` 只能派发一次（再调用抛 `INVALID_PREPARED_CALL`）。
- **config 必须全等**：`callConfigEquals(options, resolvedConfig)` 逐字段比 `provider/model/reasoningEffort/temperature/maxTokens/stop`（**L:367-371**）。所以正确写法是 `prepared.stream({ ...prepared.config, messages, system, signal })`——**别改写 config 里已有的控制字段**，否则 `INVALID_PREPARED_CALL`。

**L:367-371**（比较函数原文，同时是 `LlmCallConfig` 的字段清单）：

```js
function callConfigEquals(a, b) {
    if (a.provider !== b.provider || a.model !== b.model || a.reasoningEffort !== b.reasoningEffort || a.temperature !== b.temperature || a.maxTokens !== b.maxTokens) return false;
    if (a.stop === void 0 || b.stop === void 0) return a.stop === b.stop;
    return a.stop.length === b.stop.length && a.stop.every((s, i) => s === b.stop?.[i]);
}
```

### 2.4 `resolveCallConfig` 是什么、要不要用

**L:2174-2176**：

```js
async resolveCallConfig(config, signal) {
    return (await this.resolveCallFor(this.registration(config.provider), config, signal)).config;
}
```

它**只**校验 + 物化 `LlmCallConfig`（`provider/model/reasoningEffort/temperature/maxTokens/stop`），返回的也是这个 config，**不含 messages、不含 stream**。它不是「准备一次调用」，只适合「想先知道最终 maxTokens 是多少」这类场景。JSDoc **L:2164-2169** 明确说：这个独立查询不绑定后续派发，需要日志与流共享一个 adapter registration 时用 `prepareCall`。

### 2.5 官方最小示例（README 原文）

**R:47-57**：

> A stream returns token-level chunks and always ends with one terminal `finish` chunk. `BlockAssembler` turns the chunks into content blocks and messages…

```text
for await (const chunk of ctx.llm.stream({
  provider: 'deepseek-official',
  model: 'deepseek-v4-flash',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
})) {
  // chunks: block-start, text-delta, ..., usage, finish
}
```

（注意：示例里的 model id `deepseek-v4-flash` 与 asar 内置 catalog 的 `deepseek-flash` / `deepseek-v4-pro` 不一致——**以 catalog 为准**，见 §6.4。）

---

## 3. `GenerateOptions` 完整字段

### 3.1 权威字面量：agent loop 真正发出去的请求

**G:1281-1288**（这是全仓唯一一处「完整请求对象」的构造，比任何文档都硬）：

```js
return markAgentLoopRequest(Object.freeze({
    ...header.config,
    messages: boundaryMessages,
    toolHistory: session.toolHistory(),
    ...header.tools !== void 0 ? { tools: header.tools } : {},
    sessionId: this.session.id,
    signal
}));
```

配合 **L:2222**（`prepareCall` 里对 config 的解构，说明 `config` 只含路由与控制字段）：

```js
const { provider, model, ...controls } = config;
```

于是可以把 `GenerateOptions` 精确拆成 **`LlmCallConfig`（路由+采样）+ 请求体（messages 等）**：

| 字段 | 类型（推断） | 必填 | 来源 / 谁给默认值 | 证据 |
|---|---|---|---|---|
| `provider` | `string` | **是** | 无默认。`ctx.agentDefaultModel.currentSelection().provider` 或调用方指定；未注册 → `NO_ADAPTER` | G:1282、L:2262-2266 |
| `model` | `string` | **是** | 同上；catalog 外的 id 也放行（core 路由不校验会员资格） | G:1282、R:28 |
| `messages` | `Message[] \| RequestUserInput[]` | **是** | 无默认 | G:1283、R:61 |
| `system` | `string` | 否 | 无默认；与消息里首条 `system` 文本用 `"\n\n"` 合并 | A:1725（见 §3.3） |
| `maxTokens` | `number`（正整数） | 否 | `prepareCall`/`stream` 用 `model.defaultMaxTokens` 物化；DeepSeek 再兜底 `model.maxTokens ?? connection.maxTokens`（默认 256000） | L:2183-2186、A:1730、A:40 |
| `temperature` | `number` | 否 | 无默认；仅显式给了才发给 provider | A:1734、AR:103 |
| `stop` | `string[]` | 否 | 无默认；序列化为 provider 的 stop 序列 | A:1735、L:367-371 |
| `reasoningEffort` | `string`（branded `ReasoningEffortId`） | 否 | 无显式值时用模型的 `reasoning.defaultEffort`；DeepSeek 兜底 `connection.defaults.reasoningEffort ?? (thinking==='disabled' ? 'off' : 'high')`（默认 `high`） | L:2187-2201、A:1718、AR:59 |
| `tools` | `LlmToolSchema[]` | 否 | 无默认；元素形状见下 | G:1285、A:1736-1741 |
| `toolHistory` | `Session.toolHistory()` 的返回值 | 否 | 只有 agent loop 会给；缺省时降级为「当前 tools、不投递 developer 更新」 | G:1284、L:786-798 |
| `sessionId` | branded id（`SessionId` 本地声明版） | 否 | 只有 agent loop 会给；用于 provider 侧会话/缓存归属 | G:1286、R:180 |
| `signal` | `AbortSignal` | 否 | 调用方自备；缺省则不可取消 | G:1287、L:2318 |

### 3.2 三条「不要写」的字段

**R:177**（原文）：

> **`GenerateOptions` sampling is `temperature`/`maxTokens`/`stop` only** — no `tool_choice`, `top_p`, or penalty fields; the vocabulary grows when a producer lands

即：**没有** `tool_choice` / `top_p` / `presence_penalty` / `frequency_penalty` / `seed` / `response_format`。`AR:206` 在 DeepSeek 适配器侧再次确认：「`tool_choice` is not mapped — not part of the core vocabulary」。

### 3.3 `system` 到底存不存在（本次最关键的查证）

**存在**，而且是 DeepSeek 适配器真正读的字段 —— **A:1725**：

```js
const system = [options.system, historySystem].filter(Boolean).join("\n\n");
```

（`historySystem` 来自消息流里最新的 `role:"system"` 消息，见 **A:1673-1687**。）

**B 级提醒**：`options.system` 被适配器读取是 A 级事实，但它是否写进 `GenerateOptions` 的公开 TS 类型、是否已标记 deprecated，**无法从 asar 确认**（`.d.ts` 缺失），且 harness 自身所有生产者（agent loop）都**不写** `options.system`，只投递 system 消息。→ 只读场景下**最稳的是投一条 system 消息**；`system` 字段可作简写，见 §5.3 的取舍表。

### 3.4 `tools` 元素形状

**A:1736-1741**（唯一消费点，字段全在这里）：

```js
...options.tools === void 0 ? {} : { tools: options.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
    ...tool.deferLoading === true ? { defer_loading: true } : {}
})) }
```

→ 元素是 `{ name: string, description: string, parameters: <JSON Schema>, deferLoading?: true }`。`parameters` 是工具参数 JSON Schema（适配器原样塞进 `input_schema`）。
插件一般不自己造 tools；要用 harness 的工具请走 `ctx.tools`（本文不展开）。

---

## 4. `StreamChunk`：判别联合（带判据）

### 4.1 唯一的类型分派点（运行时代码原样）

**L:964-1005**（`BlockAssembler.push` 的 switch 就是 StreamChunk 的完整成员表）：

```js
push(chunk) {
    switch (chunk.type) {
        case "block-start":
            ... this.partials.set(chunk.index, {
                    blockType: chunk.blockType,
                    ...
        case "text-delta":
        case "reasoning-delta": {
            const partial = this.ensure(chunk.index, chunk.type === "text-delta" ? "text" : "reasoning");
            if (partial.block) return;
            partial.text += chunk.text;
        case "tool-call-delta": {
            const partial = this.ensure(chunk.index, "tool-call");
            if (partial.block) return;
            partial.toolCallId = chunk.id;
            if (chunk.name) partial.toolCallName = chunk.name;
            partial.toolCallArguments += chunk.argumentsDelta;
        case "block-end": {
            const partial = this.ensure(chunk.index, chunk.block.type);
            partial.block = chunk.block;
        case "usage":
            this._usage = chunk.usage;
        case "finish":
            this._finish = chunk.reason;
            this._replayState = chunk.replayState;
```

### 4.2 七个变体速查

| `chunk.type` | 其它字段 | 判据 / 用途 |
|---|---|---|
| `'block-start'` | `index: number`、`blockType: 'text' \| 'reasoning' \| 'tool-call'` | 新块开始；`index` 是 **harness 侧的顺序号**（适配器自己分配的 0,1,2…），不是 provider 的 wire index（A:1963-1971） |
| `'text-delta'` | `index`、`text: string` | **正文增量**，拼回答只认这个 |
| `'reasoning-delta'` | `index`、`text: string` | 思维链增量（DeepSeek 的 `thinking`） |
| `'tool-call-delta'` | `index`、`id: string`、`name?: string`、`argumentsDelta: string` | 工具名只在首个 delta 出现；`argumentsDelta` 是**原始 JSON 字符串片段**，需自行拼接 |
| `'block-end'` | `index`、`block: ContentBlock` | 完整块：`{type:'text',text}` / `{type:'reasoning',text}` / `{type:'tool-call',id,name,arguments}`（L:1020-1037） |
| `'usage'` | `usage: { inputTokens, outputTokens, cacheReadTokens?, cacheWriteTokens?, totalTokens? }` | 协议保证 `usage` 在 `finish` 之前，且只有一次（R:138、A:2018-2021） |
| `'finish'` | `reason: FinishReason`、`replayState?: {response, blocks}` | 终止块；**之后不会再有 chunk**（R:138） |

**没有 `'error'` 变体，也没有 `'delta'` 包装层**。文本就在 `chunk.text`，不是 `chunk.delta.text`；工具参数在 `chunk.argumentsDelta`，不是 `chunk.delta.argumentsDelta`。

### 4.3 `FinishReason` 五个 kind

**A:1925-1933**（provider 停止原因 → harness kind）：

```js
function stopReason(raw) {
    switch (raw) {
        case "end_turn":
        case "stop_sequence": return { kind: "stop" };
        case "tool_use": return { kind: "tool-calls" };
        case "max_tokens": return { kind: "max-tokens" };
        default: return malformed(`unsupported stop reason ${String(raw)}`);
    }
}
```

**L:2401-2414**（失败/取消被折叠成 finish，而不是 throw）：

```js
function adapterFailureChunk(error, signal) {
    const failure = normalizeLlmFailure(error);
    return {
        type: "finish",
        reason: signal?.aborted || failure.code === "ABORTED" ? {
            kind: "aborted",
            failure
        } : {
            kind: "error",
            failure
        }
    };
}
```

**`failure` 的字段（L:449-457，运行时校验后的快照）**：

```js
return Object.freeze({
    message,
    code,
    ...status === void 0 ? {} : { status },
    ...providerRetryAfterMs === void 0 ? {} : { providerRetryAfterMs },
    ...requestId === void 0 ? {} : { requestId },
    ...offloadImages === void 0 ? {} : { offloadImages }
});
```

→ `failure = { message: string, code: string, status?: number(100-599), providerRetryAfterMs?: number, requestId?: string, offloadImages?: number }`。

**判据总结**：

```ts
for await (const chunk of stream) {
  if (chunk.type === 'text-delta') answer += chunk.text
  else if (chunk.type === 'finish') {
    if (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted')
      throw new Error(`${chunk.reason.failure.code}: ${chunk.reason.failure.message}`)
  }
}
```

### 4.4 `usage` 的确切字段

**A:1832-1845**（wire → harness 的映射表，字段名就在这里）：

```js
for (const [wire, local] of Object.entries({
    input_tokens: "inputTokens",
    output_tokens: "outputTokens",
    cache_read_input_tokens: "cacheReadTokens",
    cache_creation_input_tokens: "cacheWriteTokens"
})) {
    ...
    usage[local] = value;
}
```

**A:2017**（适配器还会补 `totalTokens`）：

```js
usage.totalTokens = usage.inputTokens + usage.outputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
```

**A:1941-1944**（初始值，说明 `inputTokens`/`outputTokens` 恒在，缓存两项可缺）：

```js
const usage = {
    inputTokens: 0,
    outputTokens: 0
};
```

**B 级对照**：token-meter 的投影把计费口径写成 `uncachedInputTokens / outputTokens / cacheReadTokens / cacheWriteTokens`（**T:49**），与上面的 `inputTokens` 不是同一个名字——`uncachedInputTokens` 是**投影端**的字段，别拿它当 chunk 字段用。

### 4.5 协议不变量（照抄时别破坏）

**R:138**：

> **Protocol ordering** — `usage` precedes `finish`, tool arguments stay raw JSON strings, and nothing follows the terminal `finish`.

**L:1051-1054**（`max-tokens` 截断时工具调用会被丢弃，别指望 `block-end` 一定出现）：

```js
const kept = this.finish.kind === "max-tokens" ? all.map((block) => block.type !== "tool-call") : void 0;
```

---

## 5. `messages` 元素形状与 system prompt

### 5.1 两种合法元素

**R:61**（原文）：

> `GenerateOptions.messages` accepts durable `Message` values and request-only `RequestUserInput` values. Request-only inputs carry user-role content with no `id` or `source`; Session writes and Agent delivery still require durable messages.

| 形态 | 形状 | 何时用 |
|---|---|---|
| 请求专用 user input | `{ role: 'user', content: ContentBlock[] }` | **插件自己拼一次问句**（推荐，最省事） |
| durable `Message` | `{ id, role, content, source, toolCallId?, isError? }` | 需要把这次调用写回 session、或要回放历史（assistant/tool 历史**必须**是这种） |

`Message` 的构造器在 **L:37-112**：`createMessage` 会 `{...input, id: brandString(randomUUID())}` 并 `deepFreeze(structuredClone(...))`；`createUserMessage` / `createSystemMessage(text)` / `createAssistantMessage` / `createToolResultMessage` / `createDeveloperMessage` 各自补 `role` 与 `source`。`createToolResultMessage`（**L:101-112**）额外要求 `callId`、`content`、`isError`，并落成 `toolCallId`。

### 5.2 `content` 必须是数组

README 的示例（R:53）就是数组：

```js
messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
```

**B 级（由运行时反推）**：`content: 'Hello'` 这种裸字符串**没有**任何校验会拦你，但服务在派发前会无条件对每条消息的内容做数组式遍历：

**L:2336-2337**：

```js
if (projectedMessages.some((message) => contentHasFile(message.content))) projectedMessages = projectFilesToText(...);
if (modelInfo.inputModalities !== void 0 && !modelInfo.inputModalities.includes("image") && projectedMessages.some((message) => contentHasImage(message.content))) projectedMessages = projectImagesForTextModel(projectedMessages);
```

而 **L:593-605**：

```js
function contentHasImage(content) {
    return content.some((block) => block.type === "image");
}
function contentHasFile(content) {
    for (const block of content) if (block.type === "file") return true;
    return false;
}
```

字符串有 `[Symbol.iterator]` 但**没有 `.some`**，一旦走到图片分支就是 `TypeError`。→ **永远传 block 数组**，别传字符串。

### 5.3 system prompt 走哪

三条通道的实测语义（全部有代码依据）：

| 通道 | 行为 | 结论 |
|---|---|---|
| `options.system: string` | 适配器把它与消息里最新的 system 文本 `join("\n\n")` 成顶层 system（**A:1725**） | ✅ 最简，适合「一句话人设」 |
| `messages` 里 `role:'system'` 消息 | 只允许 text 块，否则 `UNSUPPORTED_CONTENT`（**A:1673-1676**）；`systemPromptUpdate:'in-history'` 的模型会把它当后续 system 快照（**A:1677-1687**） | ✅ 官方生产者走的就是这条（`createSystemMessage`，L:86-95） |
| `role:'developer'` 消息 | 被序列化成 **system 角色下的 `tool_addition`/`tool_removal` 块**（**A:1642-1670**）；路由不支持工具增量时还会被整条过滤掉（**L:755-758**） | ❌ 这不是 system prompt 通道，是工具变更通道 |

→ **不要**把 prompt 塞 developer message。

### 5.4 历史消息的坑（写回放/多轮时）

- **assistant 消息必须有 `source`**：DeepSeek 适配器读 replay 时直接解引用 —— **A:1526**：
  ```js
  if (message.source.kind !== "model" || message.source.replayState === void 0) return void 0;
  ```
  `source` 缺省 → `TypeError: Cannot read properties of undefined`。用 `createAssistantMessage({content, source:{provider, model}})`。
- **tool 消息必须有 `toolCallId`**：**A:1689-1693** 直接读 `message.toolCallId` / `message.isError`。
- user 消息里出现 `reasoning`/`tool-call` 块会被**静默丢弃**（**A:1609**），其它未知块类型 → `UNSUPPORTED_CONTENT`（**A:1610**）。
- user 消息里混入 `tool-addition`/`tool-removal` → `UNSUPPORTED_CONTENT`（**A:1672**）。

---

## 6. 模型 / provider 从哪来

### 6.1 `agentDefaultModel.currentSelection()` 的确切形状

**M:5-12**（类型投影，逐字段）：

```js
function selection(settings) {
    return {
        provider: settings.provider,
        model: settings.model,
        ...settings.reasoningEffort === void 0 ? {} : { reasoningEffort: ReasoningEffortId(settings.reasoningEffort) }
    };
}
```

**M:34-45**：

```js
currentSelection() {
    const reasoningEffort = this.config.reasoningEffort.get();
    return selection({
        provider: this.config.provider.get(),
        model: this.config.model.get(),
        ...reasoningEffort === void 0 ? {} : { reasoningEffort }
    });
}
```

→ 返回 `{ provider: string, model: string, reasoningEffort?: string }`，**就是 `LlmCallConfig` 去掉可选控制项**，可以**直接**喂给 `prepareCall` / `stream`（不用补字段）。配置侧 `provider`、`model` 都是 `required()`（**M:21-25**），所以不可能是空串。

服务名：`super(ownerContext, "agentDefaultModel")`（**M:27**）→ `ctx.agentDefaultModel`。

### 6.2 需不需要 `resolveCallConfig` / `prepareCall`

| 路径 | 能拿到什么 | 适用 |
|---|---|---|
| `ctx.llm.stream(options)` | 只有 chunk 流；`maxTokens`/`reasoningEffort` 的物化结果你看不到 | 一次性小调用、不关心上下文窗口 |
| `await ctx.llm.resolveCallConfig(config, signal)` | 仅物化后的 `LlmCallConfig` | 只想先说清「这次 maxTokens 是多少」 |
| `await ctx.llm.prepareCall(config, signal?, configure?)` → `PreparedLlmCall` | `config` + `retryPolicy` + `adapterDefaults` + `context.contextWindow` + `inputModalities` + `systemPromptUpdate` + `toolUpdate` + 一次性 `stream()` | **推荐**：要记日志、要算上下文占用、要交给 `dsh-llm-retry` 走重试 |

`configure` 回调（**L:2227-2231**）在「默认值物化之前」被调用，签名 `(controls: LlmCallControls, model: LlmModelInfo) => LlmCallControls`，必须是纯函数（R:63-80 给了组合示例）。**一般插件用不到**，留空即可。

### 6.3 直接 `stream({provider, model, messages})` 能不能工作

**能**（§2.2 的 L:2317-2321 是正向证据）。但注意两个差异：

1. 没有 `PreparedLlmCall` 的 `registration` 绑定 → 高并发/热更新（HMR）时可能拿到「能力元数据」与「实际派发端点」来自不同 generation 的风险（**R:127** 的设计说明就是为解决这个）。
2. 拿不到 `retryPolicy`，raw stream 不会自动重试（**RT:32**：直接 `ctx.llm.stream()` 的调用者保持单次尝试）。

### 6.4 可用 provider / model（本机 asar 内置）

| provider 路由 | 认证路线 | 内置 model | 证据 |
|---|---|---|---|
| `deepseek-official` | API key（`x-api-key`） | `deepseek-flash`（text+image，`systemPromptUpdate: in-history`，`toolUpdate: addition-only`）、`deepseek-v4-pro`（text-only），contextWindow 1048576 | **A:19-31**、**AR:53**、**K:14** |
| `deepseek-account` | 存储的账号 grant（`x-dsh-auth-token`，无 Bearer） | 账号侧 listing | **AR:89-91** |

**catalog 不约束路由**：**R:28** —— "`listModels` describes models offered by catalog-driven interfaces. Core resolution and streaming can still accept unlisted ids. The GUI requires catalog membership…"。所以插件里用 catalog 外的 model id 也可能跑通（但 GUI 选不到）。

> 你的实际 profile 不一定挂了这两个 route。要枚举：`ctx.llm.listProviders()`（**L:1908-1910**，`@Remote`）。
> 要查某 model 的上下文窗口：`await ctx.llm.resolveModelInfo(provider, model, signal)`（**L:2111-2113**）。

---

## 7. 鉴权 / 凭据：插件什么都不用做

**K:28**（原文）：

> `apiKeyEnv` defaults to `DEEPSEEK_API_KEY` and resolves per request and model discovery. When the credentials service exists, its precedence applies; only compositions without that service read the launch environment directly. Requests with missing credentials fail with `MISSING_CREDENTIAL`; malformed credentials fail with `INVALID_CREDENTIAL`.

**AR:91**：

> Messages and Files requests send account tokens as `x-dsh-auth-token` without a Bearer prefix; API keys use `x-api-key`.

**结论**：

- 凭据解析在**适配器/provider 插件**里，按请求解析；插件传 `provider` 名即可，**不传 apiKey、不传 account token、不读环境变量、不碰 credentials 服务**。
- 缺失 → `finish.reason.failure.code === 'MISSING_CREDENTIAL'`；格式坏（非法 header 字符）→ `INVALID_CREDENTIAL`，错误信息里只给「去改哪个引用」，不含密钥本身（**L:1659-1663** 的 `assertUsableApiKey`）。
- 401/403 → `AUTH`；402 或配额措辞 → `QUOTA`；账号余额 → `ACCOUNT_QUOTA`（**A:1774-1780**、**L:136-140**）。
- 两个 route 互不兜底：`deepseek-official` 只认 API key，`deepseek-account` 只认 grant（AR:89）。

---

## 8. 错误与取消

### 8.1 取消

- 传 `options.signal`（`AbortSignal`）。`prepareCall` 里会 `signal?.throwIfAborted()`（**L:2221、L:2225、L:2232**）。
- 取消**不会**让你在 `for await` 里 catch 到异常：适配器把 sse 读中断归一到 `ABORTED`，服务在 **L:2406-2411** 折成 `finish.reason = {kind:'aborted', failure:{code:'ABORTED', message}}`。
- 收尾后想拿「已经吐出来的那部分」：`BlockAssembler.interruptedBlocks()`（**L:1088-1095**，只保留非空白的 text/reasoning 块，丢弃工具调用）。agent loop 就是这么干的（**G:1097-1099**）。
- 适配器侧语义：DeepSeek 传输层对 caller abort 抛 `ABORTED`（**AR:119**），并且「Caller cancellation stops the request」（**AR:97**）。

### 8.2 错误形状

- **终态**：`finish.reason.kind === 'error'`（或 `'aborted'`），`failure` 见 §4.3。
- **抛出**：只有 middleware / consumer 自身失败才是异常（**L:2304-2308**）。所以骨架里 **`try/catch` 和 `finish.reason` 检查都要有**。
- `LlmError` 本体也带同样字段（**L:1615-1640**）：`error.code`、`error.failure`、`error.cause`；`isHarnessError(e)`（**L:226-228**）可判。

### 8.3 常见 code 表（照抄时按 code 路由，别解析 message）

| code | 触发 | 依据 |
|---|---|---|
| `NO_ADAPTER` | provider 没有注册适配器 | L:2264 |
| `MISSING_CREDENTIAL` | 该 route 解析不到凭据 | K:28 |
| `INVALID_CREDENTIAL` | 凭据含非法 header 字符/空白 | L:1659-1663 |
| `AUTH` | 401/403 | A:1774 |
| `QUOTA` | 额度/余额耗尽（provider 中性） | L:138、A:1775 |
| `ACCOUNT_QUOTA` | 第一方账号余额（可充值） | L:140 |
| `RATE_LIMIT` | 429 / rate_limit_error | A:1776 |
| `CONTEXT_WINDOW_EXCEEDED` | 上下文超窗 | L:136、A:1777 |
| `INVALID_REQUEST` | 400/413 等请求非法 | A:1778 |
| `SERVER` | 5xx / api_error | A:1779 |
| `HTTP_<status>` | 其它状态码 | A:1780 |
| `TRANSPORT` / `TIMEOUT` / `ABORTED` | 传输失败 / 流空闲超时 / 调用方取消 | AR:119、L:2406 |
| `EMPTY_RESPONSE` | 正常 stop 但零内容块 | L:150、A:2006 |
| `STREAM_CLOSED` / `MALFORMED_RESPONSE` | 流提前结束 / 协议违规 | A:2030、A:1826 |
| `UNSUPPORTED_CONTENT` | 该 route 无法表达的块类型 | A:1550 |
| `IMAGE_OFFLOAD_REQUIRED` | 图片预算超限，需先 offload N 个（失败对象带 `offloadImages`） | L:236、AR:64 |
| `UNSUPPORTED_REASONING_EFFORT` | 模型不支持该 effort | L:2191、A:1724 |
| `INVALID_PREPARED_CALL` | prepared 二次派发 / config 被改 | L:2250-2251 |

### 8.4 重试

本服务**不重试**（R:93、R:176）。`dsh-llm-retry` 只在 agent 的 `agent/request-error` 扩展点跑，且**对直接 `ctx.llm.stream()` 的调用者无效**（RT:32）。→ 插件自己调 LLM 时，重试要么自己写循环（注意 prepared call 是一次性的，重试要重新 `prepareCall`），要么接受单次尝试。

---

## 9. 最小可运行骨架（Host 插件）

### 9.1 最简：只要文本

```ts
// src/host/index.ts —— 纯 Host 插件，不碰 UI
import { BlockAssembler } from '@deepseek-ai/dsh-llm'

export const name = 'stock-llm-demo'
export const inject = ['llm', 'agentDefaultModel']

export function apply(ctx) {
  // 故意不 await：插件 apply 保持同步，长任务由调用方 await
  void (async () => {
    const { provider, model } = ctx.agentDefaultModel.currentSelection()

    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(new Error('llm demo timeout')), 30_000)

    let answer = ''
    let failure
    const assembler = new BlockAssembler()

    try {
      for await (const chunk of ctx.llm.stream({
        provider,
        model,
        system: '你是一个 A 股数据助手，回答只用简体中文。',
        messages: [{ role: 'user', content: [{ type: 'text', text: '用一句话解释什么是涨停板。' }] }],
        signal: ac.signal,
      })) {
        assembler.push(chunk)                       // 需要完整块/usage 时保留
        if (chunk.type === 'text-delta') answer += chunk.text
        else if (chunk.type === 'reasoning-delta') { /* 思维链，一般只记日志 */ }
        else if (chunk.type === 'tool-call-delta') { /* 自己累积 id/name/argumentsDelta */ }
        else if (chunk.type === 'finish') {
          const kind = chunk.reason.kind
          if (kind === 'error' || kind === 'aborted') failure = chunk.reason.failure
          ctx.logger?.info?.(`llm finish: ${kind}, usage=${JSON.stringify(assembler.usage ?? null)}`)
        }
      }
    } finally {
      clearTimeout(timer)
    }

    if (failure) throw new Error(`${failure.code}: ${failure.message}`)  // 按 code 分支，别解析 message
    ctx.logger?.info?.(`answer: ${answer}`)
  })()
}
```

**要点**：文本只从 `chunk.text` 拼；`finish` 必须检查；`assembler` 可选（只有需要 `blocks()`/`usage`/`interruptedBlocks()` 时才要）。

### 9.2 推荐：`prepareCall` 版（能拿到上下文窗口与重试策略）

```ts
import { BlockAssembler } from '@deepseek-ai/dsh-llm'

async function askOnce(ctx, prompt, signal) {
  // 1) 路由：优先用 agent 的默认选择
  const { provider, model, reasoningEffort } = ctx.agentDefaultModel.currentSelection()

  // 2) 绑定一次 adapter generation，并物化默认值（maxTokens / reasoningEffort）
  const prepared = await ctx.llm.prepareCall(
    { provider, model, ...(reasoningEffort === undefined ? {} : { reasoningEffort }) },
    signal,
  )

  // 3) 组装请求：config 字段一个都别改，只追加请求体
  const options = {
    ...prepared.config,           // provider/model/reasoningEffort/maxTokens（可能被物化）
    system: '你是一个 A 股数据助手，回答只用简体中文。',
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    ...(signal === undefined ? {} : { signal }),
  }

  // 4) 一次性派发（同样的 options 不能再给 prepared.stream 一次）
  const assembler = new BlockAssembler()
  let text = ''
  let failure
  for await (const chunk of prepared.stream(options)) {
    assembler.push(chunk)
    if (chunk.type === 'text-delta') text += chunk.text
    else if (chunk.type === 'finish' && (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted')) {
      failure = chunk.reason.failure
    }
  }

  if (failure) throw new Error(`${failure.code}: ${failure.message}`)
  return {
    text,
    blocks: assembler.blocks(),
    usage: assembler.usage,             // {inputTokens, outputTokens, cacheReadTokens?, cacheWriteTokens?, totalTokens?}
    finish: assembler.finish,
    contextWindow: prepared.context?.contextWindow,   // 用于占位率/压缩判断
    retryPolicy: prepared.retryPolicy,
  }
}
```

### 9.3 插件里怎么「拿到」`llm`（三种写法，都有实例）

| 写法 | 出处 | 适用 |
|---|---|---|
| `export const inject = ['llm']`（函数插件） | **RT:21-22**：`const name = "llm-retry"; const inject = ["agents", "sessionProjections"];`，**RT:186** 导出 `{ Config, apply, inject, name }` | 最省事，`ctx.llm` 一定已就绪 |
| `class X extends Service { static inject = ['llm'] }` | **G:1543-1551**：`static inject = ["agents","sessions","llm","tools","systemPrompt","sessionProjections"]`，类里用 `this.loopCtx.llm.stream(...)`（G:1084） | 要对外暴露自己的服务 |
| `ctx.inject(['llm'], (ctx) => { ... })` | **M:30-32**：`ownerContext.inject(["settings"], (child) => { child.effect(() => ...) })` | 依赖可缺席、要延迟到服务就绪再跑 |
| `ctx.get('llm')` | **L:2297**：`this.ctx.get("attachments")?.fileHostPath(ref)`（可选服务才用 `?.`） | 可选依赖，允许 `undefined` |

**import 走包，服务走 ctx**：`BlockAssembler`、`createUserMessage` 等从 `'@deepseek-ai/dsh-llm'` 导入（**G:6** 一次性导入了 `AssistantStreamAccumulator, BlockAssembler, LlmAttemptId, LlmError, createAssistantMessage, createDeveloperMessage, createSystemMessage, createToolResultMessage, createUserMessage, errorChain, markAgentLoopRequest`）；**`llm` 服务本身绝不 import**，只用 `ctx.llm`。
插件 `package.json` 里把它声明成 peer（照 **G:31-40** 的写法，`"@deepseek-ai/dsh-llm": "0.2.1-rc.5"`）。

### 9.4 想在命令/HTTP 入口里跑（不要写在 apply 顶层）

`apply` 里只做「注册能力 + 返回 disposer」，真正的调用放在 `ctx.on(...)` / 工具 / RPC 处理器里，并用 `ctx.effect(() => { const ac = new AbortController(); return () => ac.abort() })` 把 abort 挂到插件生命周期上——**RT:179-183** 是现成范式：

```js
ctx.effect(() => async () => {
    disposeListener();
    lifetime.abort(new Error("llm-retry plugin disposed"));
    await Promise.allSettled([...active]);
}, "llm-retry: abort and drain active recovery");
```

---

## 10. 未确认点 / 风险（照抄前请读）

1. **`.d.ts` 全部缺失**（`lib/types/*.d.ts`、`lib/typert.host.d.ts`、`src/*.ts` 均 read 不到）。所有「类型 / 是否可选」是从运行时代码与 README 反推，不是声明原文。真正动手前建议 `pnpm tsc` 在你自己的插件里让 IDE 报一次类型错来对齐。
2. **`options.system` 的公开性**：DeepSeek 适配器确实读它（A:1725），但 harness 自身生产者不写它、README 也没提。B 级。若要最稳，走 `createSystemMessage(...)` 投一条 `role:'system'` 消息（L:86-95）。
3. **`content` 是否真的禁止裸字符串**：运行时只会在图片/文件投影时炸（L:2336-2337），没有显式校验。B 级；结论是「必须传 block 数组」。
4. **`RequestUserInput` 是否允许非 user 角色**：README 只说 user（R:61）。`role:'system'` 的消息在 DeepSeek 适配器里是只读 text 块的（A:1673-1675），但**不带 `id`/`source` 的 system 消息**是否在所有适配器都安全，未验证（C 级）。
5. **`FinishReason` 是否只有五个 kind**：我在 llm + deepseek 两处代码里只见到 `stop` / `tool-calls` / `max-tokens` / `error` / `aborted`。C 级（别的适配器可能扩）。
6. **`LlmUsage.totalTokens` 是否属于类型**：适配器写入（A:2017），但 token-meter 的投影字段名不同（T:49）。作为运行时字段可直接读，作为类型字段 B 级。
7. **具体 provider id 取决于 composition**：`deepseek-official` / `deepseek-account` 是本机 asar 里的两个 route，你的 profile 可能只挂了其中一个或另挂了 pi-ai 适配器。用 `ctx.llm.listProviders()`（L:1908-1910）先探。
8. **未跑过**：本文没有发起任何真实模型请求，骨架未在真实插件工程里 `tsc`/运行验证。特别是 `prepared.stream` 的 `callConfigEquals` 约束（L:2251）——只要你 `...prepared.config` 展开、不改其中的控制字段，就不会踩。
9. **`ctx.logger` / `ctx.effect` 的可用性**：RT 与 G 都在用（`ctx.logger.warn`、`ctx.effect(...)`），但那是 Cordis 4 的宿主 API，具体签名未在本次范围内核。骨架里的 `ctx.logger?.info?.()` 用了可选链，安全。

---

## 11. 一页速抄卡

```ts
// 路由
const { provider, model, reasoningEffort } = ctx.agentDefaultModel.currentSelection()
// 准备（可选但推荐）
const prepared = await ctx.llm.prepareCall({ provider, model, reasoningEffort }, signal)
// 请求
const options = {
  ...prepared.config,
  system: '...',                                   // 或省略，改用 system 消息
  messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
  signal,
}
// 流
for await (const chunk of prepared.stream(options)) {
  switch (chunk.type) {
    case 'text-delta':        answer += chunk.text; break
    case 'reasoning-delta':   break                 // 思维链
    case 'tool-call-delta':   break                 // id / name? / argumentsDelta
    case 'block-start':       break                 // index / blockType
    case 'block-end':         break                 // block
    case 'usage':             usage = chunk.usage; break
    case 'finish':            reason = chunk.reason; break
  }
}
if (reason?.kind === 'error' || reason?.kind === 'aborted') throw new Error(`${reason.failure.code}: ${reason.failure.message}`)
```
