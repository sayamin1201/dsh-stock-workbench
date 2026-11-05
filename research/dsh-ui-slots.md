# DSH Web UI 左侧栏入口 + 整页工作台：插件实现蓝图

> 目标需求：在 DSH Web UI 左侧栏加一个入口图标，点击后展示一个整页工作台（A 股全市场快照表格：排序 / 筛选 / 每 1 秒刷新）。
>
> 本文只做调研与验证，**未安装任何 bundle、未改 profile 目录、未写 cordis.patch.yml**。
>
> 结论先行：这条需求在 DSH 0.2.1-rc.5 上有**一等公民通道**，不需要 DOM 补丁、不需要 iframe：
> 左侧栏一行 = `sidebar.panellist`（list slot）+ 整页内容 = `main`（keyed slot），两处用**同一个 id/key** 配对，宿主自己处理点击选中与切换。
> 这条通道正是官方 Plugins 页、Automation tasks 页、dsh-market 页在用的通道。

---

## 0. 环境与证据来源

| 事实 | 值 | 依据 |
|---|---|---|
| DSH 版本 | `0.2.1-rc.5` | `D:\dsh\resources\app.asar\dsh\package.json`（`@deepseek-ai/dsh-desktop-runtime`，version 0.2.1-rc.5） |
| Web GUI | `http://127.0.0.1:54251` | 运行时上下文 |
| 已装 UI 插件（可作真实参照） | `dsh-pet@0.3.7`、`dshmarket@1.73.9` | `C:\Users\10932\.dsh\profiles\desktop\package.json` |
| 技能文档 | `...\dsh\node_modules\@deepseek-ai\dsh-agent-preset\skills\cordis-plugin-development\` | read 工具可读（asar 路径） |

### 证据分级（重要）

1. **A 级（可直接照抄）**：本机已安装、正在运行的第三方插件源码——`dsh-pet`（`src/client/app.ts`、`src/host/index.ts`）、`dshmarket`（`client/client.js`、`cordis.patch.yml`、`package.json`）。它们在当前这个 0.2.1-rc.5 宿主上是活的。
2. **A 级**：asar 内嵌的官方包 README 与编译产物（用 read 工具读技能文档成功；用「拷贝 asar 到工作区 + 字节偏移检索」定位官方包文本，见下）。
3. **B 级（有据但未跑通）**：`cordis_inspect_query` 的 Client 侧查询——**本会话全部超时**（4 次：`Slots.listSubTree` ×3、`Theme.listTokens` ×1、`Service.listService` ×1，均 `timed out after 10000ms`）。原因：Client Inspect 需要该会话自己连着的页面回话，本会话没有页面通道。
4. **C 级（明确标注 TODO）**：Node 侧 GBK 解码、上游行情接口字段等**业务**细节。

> 关于 asar 读取：技能文档与 `dsh/package.json` 可用 read 工具直接读；但 `@deepseek-ai/dsh-client-ui-*` 这些包在 asar 里**没有落在 `node_modules` 顶层**（`read` 报 not found），它们是 `dsh-web-frontend` 的构建期依赖、被打进 `dist/assets/*.js`。
> 我用「`Copy-Item` 把 app.asar 拷到工作区 → 分块 `Latin1` 解码 → 按字节偏移取上下文」的方式读到了官方包 README 与编译代码（副本已删除，未触碰 profile）。下文标注的「asar 偏移」即该检索的落点，可复现。

---

## 1. 问题一：左侧栏入口由哪个 Slot 提供

### 1.1 确切答案

**Slot：`sidebar.panellist`**（`kind: "list"`，`scope: "root"`）。

它与 **`main`**（`kind: "keyed"`，`scope: "root"`）配对使用：`sidebar.panellist` 的注册项 `id` 必须等于 `main` 注册项的 `key`。

**宿主声明（asar 内 `@deepseek-ai/dsh-client-ui-sidebar` 的 `lib/client.js`，偏移 47,735,808 附近）：**

```js
ctx.slots.inject("sidebar", () => ctx.slots.register({
  name: "sidebar",
  locale: NS,
  children: {
    "sidebar.brand.mark":        { kind: "single", scope: "root" },
    "sidebar.brand.name":        { kind: "single", scope: "root" },
    "sidebar.toggle.badge":      { kind: "single", scope: "root" },
    "sidebar.panellist":         { kind: "list",   scope: "root" },   // ← 左栏图标行
    "sidebar.panellist.actions": { kind: "list",   scope: "root" },   // ← "更多" 菜单行
    "sidebar.workspaces":        { kind: "single", scope: "root" },
    "sidebar.settings":          { kind: "single", scope: "root" },
    "sidebar.footer.action":     { kind: "list",   scope: "root" },
  },
  inject: injectProps,
}, SidebarRoot));
```

**`main` 的声明（asar 内 `@deepseek-ai/dsh-client-ui-layout`，偏移 25,869,717 附近）：**

```js
ctx.slots.register({
  name: "root",
  locale: "common",
  children: {
    "sidebar":        { kind: "single", scope: "root" },
    "main":           { kind: "keyed",  scope: "root" },   // ← 整页内容
    "rightbar":       { kind: "single", scope: "root" },
    "shell.bottom":   { kind: "single", scope: "root" },
    "shell.overlay":  { kind: "list",   scope: "root" },
    "shell.leading":  { kind: "single", scope: "root" },
  },
  store,
}, AppFrame);
```

### 1.2 官方 README 原文（最权威的一段）

asar 偏移 47,679,352（`@deepseek-ai/dsh-client-ui-sidebar` README 的 *Global panel entries* 节）：

> Plugins add an icon component to the root-scoped `sidebar.panellist` list with an `id`, optional `order`, and a string or locale-aware `label`. **The same id addresses the component registered in the layout's root-scoped `main` keyed slot; selecting a missing main entry throws without changing the current selection.** The label supplies plain visible text, the accessible name, and the collapsed tooltip. Expanded navigation rows have a 2px gap. Each row reads its own selected state through `usePanelInfo` … With no panel registrations, neither the list nor spacing for it is rendered.

### 1.3 注册方式（真实用法，两处佐证）

**A. 官方 Plugins 页（asar 偏移 26,894,729）**

```js
ctx.slots.inject("main", () => ctx.slots.register({
  name: "main",
  key: PANEL_ID,          // "plugins"
  locale: NS,
  inject: () => face,
}, PluginManagerPage));

ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
  name: "sidebar.panellist",
  id: PANEL_ID,           // 同一个 PANEL_ID
  order: 0,
  label: () => t("panel"),
  locale: NS,
}, PluginsPanelIcon));
```

**B. 官方 Automation tasks 页（asar 偏移 27,504,401）** 形态同上，`order: 10`。

**C. dsh-market（本机已装、正在运行）** `C:\Users\10932\.dsh\profiles\desktop\node_modules\dshmarket\client\client.js:18440-18453`

```js
const offPanel = ctx.slots.register({
  name: "main", key: SIDEBAR_PANEL_ID, locale: NS, inject: () => ({ t })
}, () => React.createElement("div", { className: css.panelHost }, buildMarketElement({ surface: "sidebar" })));

const offRow = ctx.slots.register({
  name: "sidebar.panellist", id: SIDEBAR_PANEL_ID, order: 1, label: () => t("nav"), locale: NS
}, (owner = {}) => React.createElement(MarketLogo, { size: owner.size ?? 16 }));
```

### 1.4 props：入口图标组件收到什么

宿主渲染那一行时（asar 偏移 47,718,902 的 `PanelRow`）：

```js
function PanelRow({ id, label, wide, usePanelInfo, selectPanel, trackEntryClick, renderSlot }) {
  const active = usePanelInfo((info) => info.activePanelId === id);   // 选中态由宿主算
  return h(Tooltip, { label, delayMs: 500, disabled: wide, children:
    h("button", {
      type: "button",
      className: clsx(css.panelRow, active && css.panelActive),
      "aria-label": label,
      "aria-current": active ? "page" : undefined,
      onClick: () => selectPanel(id),                                 // 点击 = ctx.layout.selectPanel(id)
      children: [
        h("span", { className: css.panelGlyph, "aria-hidden": "true",
          children: renderSlot("sidebar.panellist", { size: wide ? 16 : 18, active }, { only: id }) }),
        wide && h("span", { className: clsx(css.panelTitle, css.wide), children: label }),
      ],
    }) });
}
```

因此你的图标组件**唯一会收到的 owner props 是 `{ size, active }`**：

| prop | 类型 | 含义 | 用法 |
|---|---|---|---|
| `size` | `16 \| 18` | 展开态 16px、收起态（rail）18px | `width={size} height={size}`，不要写死 |
| `active` | `boolean` | 当前是否选中 | 可选：用 `currentColor` 就够，宿主已给 `.panelActive` 上色 |

其余全部由**宿主**负责，你**不用管**：

- **排序**：注册项的 `order`（缺省 0，升序；官方 Plugins = 0、Automation tasks = 10、market = 1）。
- **选中态 / 路由 key**：宿主用 `usePanelInfo` + `selectPanel(id)`，点击即 `ctx.layout.selectPanel(id)`，无需你写 onClick。
- **Tooltip / aria-label / 收起态图标**：宿主用 `label` 生成可见文字、无障碍名与 tooltip。
- **实现细节**：`label` 可以是字符串，也可以是 `() => string` 的 thunk（locale 相关），宿主通过 `resolveSlotLabel(options.label) ?? options.id` 解析，并在 locale 变化时重新投影（asar 偏移 47,735,808 的 `syncPanels`）。

### 1.5 "插入装饰 vs 注册导航项"——本次不需要妥协

`sidebar.panellist` 就是**导航项**通道，不是装饰槽。装饰槽（`conversation.composer.dock`、`shell.overlay`）才需要 DOM 技巧。
本机 dsh-pet 在**设置面板**里做图标替换是 DOM 层补丁（`dsh-pet/src/client/nav-icon.ts`，212 行注释解释为什么必须 DOM），那是因为 `settings.section` 的 options 里**没有 icon 位**；`sidebar.panellist` 没有这个问题——**它直接渲染你返回的 React 组件**。

> 注意：不要试图给 `sidebar.panellist` 传 `icon` 选项——没有这个字段。图标就是你注册的组件本身。

### 1.6 注册签名（可照抄）

```js
// 入口图标
ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
  name: 'sidebar.panellist',
  id: PANEL_ID,            // 必填，且必须等于 main 的 key
  order: 20,               // 可选，缺省 0
  label: () => t('panel'), // 必填（字符串或 thunk），供可见文字/aria/tooltip
  locale: NS,              // 可选：locale 变化时让宿主重新解析 label
  // inject: () => ({ ... }) —— 入口图标不需要
}, WorkbenchIcon));
```

`ctx.slots.inject(ownerSlotKey, callback)` 是**必须**的包装（不是可选的便利）：

> asar 偏移 49,083,281（ui-workspace README，讲 client 插件通用契约）："`ctx.slots.inject()` is required even if the owner is normally present: it waits for the declaration, removes the contribution when that declaration collapses, and registers it again after restoration."

（同一模式在 dsh-pet `src/client/app.ts:146-158` 与 dshmarket 中反复出现；官方 conversation 包用的是 generator 形式 `function* () { yield ctx.slots.register(...) }`，可用于一次注册多个子槽。）

---

## 2. 问题二：整页内容用哪个 Slot

### 2.1 确切答案

**Slot：`main`**（`kind: "keyed"`，`scope: "root"`），注册时用 **`key`**（不是 `id`），key 值必须等于左侧栏行的 `id`。

```js
ctx.slots.inject('main', () => ctx.slots.register({
  name: 'main',
  key: PANEL_ID,                 // 与 sidebar.panellist 的 id 相同
  locale: NS,
  inject: () => ({ t }),         // 注入给组件的 props（回调 / 文案）
}, WorkbenchPage));
```

### 2.2 页面是否占满主区域：占满，但**没有内边距、没有页头、没有滚动容器**

宿主渲染路径（`@deepseek-ai/dsh-client-ui-layout`，偏移 25,848,463 / 25,855,987）：

```js
function MainPanel({ usePanelInfo, renderSlot }) {
  return renderSlot("main", {}, { entryKey: usePanelInfo((info) => info.activePanelId) ?? "conversation" });
}
// ...
jsx(CenterColumn, { children: main })
// CenterColumn -> <div className="mP3x-q_centerCol">
```

对应 CSS（同包）：

```css
.mP3x-q_centerCol{ flex-direction:column; min-width:0; display:flex; overflow:hidden }
```

结论：

- **占满中心列**（`main` 就是 conversation 和 Plugins 页共用的那块区域），页头/对话区都不存在。
- **组件收到的 owner props 是 `{}`**（`renderSlot("main", {}, …)`），没有任何布局参数、没有 `t`（除非你在 `inject` 里给）。组件 = 你自己的 React 组件 + `inject` 返回的对象。
- **`overflow:hidden` + `display:flex; flex-direction:column`** → 你的根节点必须自己 `height:100%`，并自己开滚动容器，否则内容撑破被裁掉。
- **顶部安全区要自己留**：窗口标题栏是覆盖式的。dsh-market 的 `panelHost` 实测写法（`dshmarket/client/client.js:4031` 内联 CSS）：

```css
.nUhMVa_panelHost{
  box-sizing:border-box;
  height:100%;
  min-height:0;
  padding:calc(28px + var(--dsh-frame-top-clearance, 0px)) 0 0;  /* ← 关键 */
  flex-direction:column;
  display:flex;
}
```

`--dsh-frame-top-clearance` 由 `ui-layout` 注入：macOS 48px、Windows 标题栏 = 标题栏高度、纯浏览器为未定义（回落 0）。**照抄这一行**，否则 macOS/Windows 桌面上第一行会被标题栏压住。

- 默认态：`activePanelId === null` → `entryKey` 回落到 `"conversation"`。你注册的 panel 只有在用户点击图标后才出现（`ctx.layout.selectPanel(id)`）。**不存在"注册了就默认显示"**，这正好符合需求。

### 2.3 主题 tokens：可以直接用 CSS 变量

**能用，且是推荐做法。** 宿主所有样式都用 `--dsw-alias-*` 变量（light/dark 由宿主在 `html` 上切换，插件什么都不用做）。

dsh-market 内联 CSS 里实际使用的 token（我用正则从 `dshmarket/client/client.js` 提取，共 31 个，全部真实存在）：

```text
--dsw-alias-bg-base            --dsw-alias-bg-layer-1/2/3   --dsw-alias-bg-overlay
--dsw-alias-bg-module-platform --dsw-alias-border-l1/l2/l3/l4
--dsw-alias-brand-primary      --dsw-alias-button-primary-fill
--dsw-alias-interactive-bg-hover
--dsw-alias-label-primary      --dsw-alias-label-primary-foreground
--dsw-alias-label-secondary    --dsw-alias-label-tertiary   --dsw-alias-label-dimmed
--dsw-alias-link
--dsw-alias-settings-card-fill --dsw-alias-settings-card-stroke
--dsw-alias-state-success-primary/tertiary  --dsw-alias-state-error-primary
--dsw-alias-state-warn-primary/tertiary     --dsw-alias-state-business-primary
--dsw-radius-sm/md/lg/xl       --dsw-shadow-lv1
--dsw-specific-sidebar-fill
```

风格规则（`references/practices.md:34-35`）：只用 token，字面色仅用于 artwork；跟同类宿主页对齐间距/字号/行pattern（管理列表参照 Plugin Manager 页）。

> 需要 JS 侧读主题时（例如给 canvas 用）：`ctx.theme.getTheme()` + `ctx.on('theme/change', cb)`（dshmarket 就是这么包 store 的：`{ subscribe: cb => ctx.on('theme/change', cb), getSnapshot: () => ctx.theme.getTheme() }`）。表格页**不需要**，CSS 变量足够。

---

## 3. 问题三：Host 与 Client 的分工与传数据

### 3.1 Client 能不能直接 fetch 外部 HTTP？——技术上能，工程上不要

浏览器 `fetch` 到第三方行情站会遇到三件事，且**没有一条能在插件里干净解决**：

1. **CORS**：`qt.gtimg.cn` / `push2.eastmoney.com` 之类不返回 `Access-Control-Allow-Origin`，预检或响应直接被浏览器拦掉。GUI 的 origin 是 `http://127.0.0.1:54251`，属于跨域。
2. **证书 / 中间盒**：企业网、抓包代理下自签证书会让 fetch 失败。
3. **数据只在 Host 侧可信**：把"抓取逻辑"放浏览器意味着每个标签页各抓一份、各自被限频。

**结论：抓取放 Host，Client 只读 Host 的同源端点。**

### 3.2 Host 暴露给 Client 的三种通道（按成本排序）

| 通道 | API | 成本 | 适用 |
|---|---|---|---|
| **自定义 HTTP 路由** ✅ 推荐 | `ctx.webServer.register({ kind:'prefix', path, handler(req,res) })` | 最低：一个 `inject: ['webServer']` + 一个 effect | 本项目：拉快照 JSON |
| 已鉴权 RPC（`/api`） | `ctx.remote.<svc>.<method>()`（Typert Remote） | 高：要把自己的 service 注册进 typert registry | 需要与宿主鉴权/会话绑定、强类型 |
| 会话命令 | `ctx.remote.commands.execute(sessionId, '/cmd args')` | 中：写 command + 消息副作用 | 需要"用户动作=一条会话记录/驱动 agent" |

**HTTP 路由契约（两处独立佐证）**

- dsh-pet（本机运行中）`src/host/index.ts:1209-1227`：

```js
ctx.effect(
  () => ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_PREFIX,
    handler: async (req /* IncomingMessage */, res /* ServerResponse */) => { ... },
  }),
  'dsh-pet: /dsh-pet-7340 asset route',
);
// inject：export const inject = ['webServer', ...]
// 端口：ctx.webServer.port
```

- 宿主自己的 client-connection 也是同一形状（asar 偏移 22,739,677）：

```js
register(owner, channel, handler) {
  const route = { kind: "prefix", path: channel, handler: async (req, res) => { ... } };
  return owner.effect(() => owner.webServer.register(route), `client-connection: ${channel} rpc channel`)
}
```

即：`register(route) → disposer`，`handler` 是**原生 Node `(req, res)`**，路径是**前缀匹配**。

**Client 侧同源调用（必须注意部署前缀）**

asar 偏移 27,500,000 附近，dsh-market 的 `api()` 说明了为什么不能写 `/stock-workbench/...`：

> "Every call used to be root-absolute (`/dsh-market/…`), which the browser resolves against the ORIGIN — so behind a reverse proxy that mounts dsh under a prefix, every request went to `https://host/dsh-market/…` and 404'd."

```js
function api(path) {
  const relative = path.replace(/^\/+/, '');
  if (typeof document === 'undefined') return `/${relative}`;
  return new URL(relative, document.baseURI).pathname;   // ← 锚在 document.baseURI
}
```

### 3.3 「Host 每秒/每次点击抓一次全 A 快照，Client 渲染表格」的最小可行接法

**推荐形态：Host 侧 1 秒 TTL 缓存 + Client 1 秒轮询。**（不要做 Host→Client 推送：DSH 没有给第三方插件的通用推送通道，`ctx.remote` 的事件订阅是宿主服务专有的。）

链路：

```text
Client (1s setInterval)
  → GET  {baseURI}stock-workbench/snapshot            [同源，无 CORS]
    → Host 路由 handler
       ├─ 距上次抓取 < 900ms  → 直接回缓存 JSON        [多标签页共享，不打爆上游]
       └─ 否则 → fetch(上游, signal: AbortSignal.timeout(3000))
                 → 归一化成 [{code,name,price,changePct,volume,amount,turnover,...}]
                 → 写入内存 state {at, rows, error}
                 → 回 { ok, at, rows, error }
  ← Client setState → React 渲染 / 排序 / 筛选
```

**调用点清单（照抄位置）**

| 位置 | API |
|---|---|
| Host 声明 | `export const inject = ['webServer']`；`export function apply(ctx, config)` |
| Host 注册路由 | `ctx.effect(() => ctx.webServer.register({ kind:'prefix', path:'/stock-workbench', handler }), 'label')` |
| Host 抓外部 | 全局 `fetch`（Node 22 内置）/ `undici`；`AbortSignal.timeout()`、`new TextDecoder('gbk')` |
| Client 取数 | `fetch(new URL('stock-workbench/snapshot', document.baseURI), { cache: 'no-store' })` |
| Client 声明服务 | 模块返回 `inject: ['slots','locale']`（要读主题再加 `'theme'`） |

**"UI 操作与 agent 工具共享同一实现"（`references/user-actions.md`）——适合，但不是第一版必须**

该模式要求：① 操作只实现一次（Host service 方法，返回结果或显式状态+原因）；② UI 通过 Client 可调用的 Host 入口（会话命令 / 路由）调用同一方法并展示失败；③ 用参数与语义一致的 agent tool 暴露同一方法；④ 授权类动作（批准/回答问题/放宽策略）**只能**用户做。

对本项目的判定：

- **只读快照轮询 → 不需要**该模式。纯读、无副作用、agent 也没必要每秒拿一份，套进 service+tool 只会增加表面积。
- **"刷新自选股 / 加自选 / 设阈值告警 / 导出 CSV"这类写操作 → 强烈建议**用该模式：`Host service` 一份实现 + 路由（UI 调）+ `ctx.tools`/tool 插件（agent 调）。
- 这也是把"排序/筛选"留在 Client 的正确理由：纯视图状态不该变成工具。

### 3.4 数据抓取的两个真实坑（C 级，需实现时验证）

1. **GBK**：`qt.gtimg.cn`、`hq.sinajs.cn` 返回 GBK。`res.text()` 永远按 UTF-8 解 → 中文名乱码。必须 `arrayBuffer()` + `new TextDecoder('gbk').decode(buf)`。Node 22 默认 full-icu，通常支持；**TODO：在本机 `node -e "new TextDecoder('gbk')"` 实测**。
2. **Referer / UA**：新浪行情对空 Referer 返回 403。Host 侧显式带 `user-agent` 与 `referer`。
3. **限频**：全 A 5000+ 标的应分批（如每批 800 个代码）并发上限 2~3，或直接用指数/板块聚合接口；不要 1 秒一次全量扫。

---

## 4. 问题四：最小可安装 bundle 的文件与字段

### 4.1 目录树（可直接创建）

```text
D:\h5\stock-workbench\bundle\            ← install_bundle 的 target（绝对路径）
├── package.json                          ← 清单：dsh.bundle.patch + dsh.client + exports/files/icon
├── cordis.patch.yml                      ← 只插 1 行 Host 行；client 半边由 dsh.client 自动发现
├── index.js                              ← Host 半边：webServer 路由 + 快照缓存 + 上游抓取
├── client.js                             ← 浏览器半边：__ModuleLoader__ 工厂 + 两个 slot 注册
├── icon.svg                              ← 插件管理页图标（≤256 KiB，必须真能渲染）
├── locale/
│   ├── en.json                           ← 插件管理页 meta.title / meta.description（英文）
│   └── zh.json                           ← 中文
└── README.md                             ← 可选
```

**没有 build 步骤**：`client.js` 是手写纯 JS（用 `React.createElement`，不用 JSX），因此不需要 tsdown/vite，也不会出现"`lib/client.js` 不存在导致激活失败"（modules README: "a missing bundle fails activation loudly"）。

### 4.2 `package.json`

```json
{
  "name": "stock-workbench",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "icon": "icon.svg",
  "exports": {
    ".": "./index.js",
    "./client": "./client.js",
    "./locale/*.json": "./locale/*.json",
    "./icon": "./icon.svg"
  },
  "files": ["index.js", "client.js", "cordis.patch.yml", "locale/*.json", "icon.svg"],
  "dsh": {
    "manifestVersion": 1,
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "inject": [
        "@deepseek-ai/dsh-client-ui-layout",
        "@deepseek-ai/dsh-client-ui-sidebar",
        "@deepseek-ai/dsh-client-locale"
      ]
    }
  }
}
```

字段逐条说明（每条都有出处）：

| 字段 | 必需 | 语义 / 依据 |
|---|---|---|
| `dsh.bundle.patch` | ✅ | 声明"我是 bundle"；一个路径或有序数组（`references/host-plugin.md:11-27`；`@deepseek-ai/dsh-package-manifest` README） |
| `dsh.client.platform: "web"` | ✅ | 浏览器半边只在 web 载体加载（`references/ui-plugin.md:3`） |
| `dsh.client.inject` | 建议 | **模块图排序边（包名）**，不是 cordis 服务。用于保证 layout/sidebar 的声明先于你的 `apply`。写错/不存在会在组合期被拒（"Composition rejects ... missing suppliers"）。**最稳可以写 `[]`**：`ctx.slots.inject` 本身是声明感知的，顺序无关 |
| `dsh.client.external` | 可选 | 追加"非 baseline"的精确模块请求；`react`/`react-dom`/`@deepseek-ai/dsh-client-ui-slots` 等已在平台表内，**不要写** |
| `dsh.client.immediately` | 可选 | 让该行进入启动批次（kernel 包如 `dsh-client-connection`、`dsh-client-modules` 用 `true`）。dshmarket 作为纯 UI 插件**没有写**，本插件也不需要 |
| `exports["./client"]` | ✅ | 模块系统按 `<pkg>/client` 找浏览器产物（modules README: "`<id>/client` and the bare id resolve to the same exports"） |
| `exports["./locale/*.json"]` / `exports["./icon"]` | ✅ | 插件管理页/升级弹窗在不激活插件的情况下读 `meta.title`/`meta.description` 与图标（`references/host-plugin.md:31-51`） |
| `icon`(顶层) 或 `./icon` | ✅ | svg/png/jpeg/webp，≤256 KiB，realpath 必须在包内；`package.json.icon` 优先于 `./icon` |
| `files` | 建议 | npm pack 白名单；**目录 link 安装时不过滤**，但仍应写全 |
| `peerDependencies` | 可选 | 只在需要类型/编译时。手写纯 JS + `createElement` 就**一个都不用写** |

### 4.3 `cordis.patch.yml`（只有一行）

```yaml
# stock-workbench bundle patch：把 Host 半边插进 profile 的层栈。
# 浏览器半边不需要单独的行——dsh.client 段会被 dsh-client-modules 扫描进启动图。
- insert:
    - id: stock-workbench
      name: 'stock-workbench'
      config: {}
```

**回答"要插哪些行"：**

- **Host 行：1 行**（就是上面这行）。`id` 是 Loader 行 id（日志/诊断里出现），`name` 是包名（必须能 resolve 到本包）。
- **Client 行：0 行。** client 半边由 `package.json` 的 `dsh.client` 经 `dsh-client-modules` 自动组图并 serve 到 `/plugins/...`。真实证据：`dshmarket/cordis.patch.yml` 全文就 3 行 + 1 个 insert 行，而它有完整 UI。
- **依赖的注入项：0 行。** `webServer` 这类宿主服务用 `export const inject = ['webServer']`（Host 侧）声明，不写进 patch。`indent/config` 走 `config: {}`（有 `Config` 导出时按 schema 校验）。
- 覆盖/禁用已存在行时才需要 `override`（`references/host-plugin.md:3`：匹配的 override 会**整体替换** `config`）。

### 4.4 `index.js`（Host 半边，最小可跑）

```js
/** stock-workbench Host 半边：把上游行情抓成一份内存快照，用同源 HTTP 路由喂给浏览器。 */

export const name = 'stock-workbench'

/** 需要的宿主服务：webServer（注册同源路由）。没有它插件就不激活，而不是抛错。 */
export const inject = ['webServer']

const ROUTE = '/stock-workbench'
const SNAPSHOT_TTL_MS = 900
const UPSTREAM_TIMEOUT_MS = 3000

/** 上游接口（TODO 换成确定的数据源；这里只是形状示例）。 */
function upstreamUrl(symbols) {
  return 'https://qt.gtimg.cn/q=' + symbols.join(',')
}

/** 把上游响应归一化成表格行。TODO：按真实返回格式改。 */
function parseRows(text) {
  return text
    .split(';')
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.startsWith('v_'))
    .map((chunk) => {
      const body = chunk.slice(chunk.indexOf('="') + 2, chunk.lastIndexOf('"'))
      const f = body.split('~')
      return {
        code: f[2] ?? '',
        name: f[1] ?? '',
        price: Number(f[3] ?? 0),
        prevClose: Number(f[4] ?? 0),
        changePct: Number(f[32] ?? 0),
        volume: Number(f[6] ?? 0),
        amount: Number(f[37] ?? 0),
        turnover: Number(f[38] ?? 0),
      }
    })
}

export function apply(ctx) {
  const state = { at: 0, rows: [], error: null }
  let inflight

  const snapshot = () => ({ ok: true, at: state.at, rows: state.rows, error: state.error })

  async function refresh() {
    const res = await fetch(upstreamUrl(['sh000001', 'sz399001']), {
      headers: { 'user-agent': 'Mozilla/5.0', referer: 'https://gu.qq.com/' },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error('upstream HTTP ' + res.status)
    // 关键：GBK 站点必须按字节解码，res.text() 只会按 UTF-8 解出乱码。
    const buf = await res.arrayBuffer()
    const text = new TextDecoder('gbk').decode(buf) // TODO: 在本机确认 Node 22 支持 gbk
    state.rows = parseRows(text)
    state.at = Date.now()
    state.error = null
  }

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: ROUTE,
        handler: async (req, res) => {
          const { pathname } = new URL(req.url ?? '/', 'http://localhost')
          const send = (status, body) => {
            res.writeHead(status, {
              'content-type': 'application/json; charset=utf-8',
              'cache-control': 'no-store',
            })
            res.end(JSON.stringify(body))
          }
          try {
            if (pathname !== ROUTE + '/snapshot') return send(404, { ok: false, error: 'not found' })
            if (Date.now() - state.at > SNAPSHOT_TTL_MS) {
              // 单飞：并发请求共用一次上游抓取
              inflight ??= refresh().finally(() => { inflight = undefined })
              try { await inflight } catch (e) { state.error = String(e && e.message || e) }
            }
            send(200, snapshot())
          } catch (e) {
            send(500, { ok: false, error: String((e && e.message) || e) })
          }
        },
      }),
    'stock-workbench: /stock-workbench route',
  )
}
```

### 4.5 `client.js`（浏览器半边，最小可跑，含整页表格）

```js
/**
 * stock-workbench 浏览器半边。
 * 纪律：模块体只注册工厂；一切副作用（样式、定时器）在 apply 里用 ctx.effect 建立并返回清理。
 * id 必须等于 package.json 的 name。
 */
window.__ModuleLoader__.load({
  id: 'stock-workbench',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'stock-workbench'
    const PANEL_ID = 'stock-workbench' // sidebar.panellist.id === main.key

    const en = {
      panel: 'A-share workbench',
      title: 'A-share workbench',
      refresh: 'Refresh',
      filter: 'Filter code or name',
      at: 'Updated',
      error: 'Upstream error',
      loading: 'Loading…',
    }
    const zh = {
      panel: 'A股工作台',
      title: 'A股全市场工作台',
      refresh: '刷新',
      filter: '筛选代码或名称',
      at: '更新于',
      error: '上游错误',
      loading: '加载中…',
    }

    /** 样式：只引用 --dsw-alias-* 主题 token，字面色仅用于涨跌（艺术色）。 */
    const CSS = `
      .swb-root{box-sizing:border-box;height:100%;min-height:0;display:flex;flex-direction:column;
        padding:calc(28px + var(--dsh-frame-top-clearance,0px)) 24px 0;
        background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px}
      .swb-head{display:flex;align-items:center;gap:8px;padding-bottom:8px}
      .swb-title{margin:0;font-size:15px;font-weight:600;line-height:22px;flex:1}
      .swb-meta{color:var(--dsw-alias-label-tertiary);font-size:12px}
      .swb-input{height:28px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2);
        border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1);
        color:var(--dsw-alias-label-primary);font:inherit}
      .swb-btn{height:28px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);
        border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1);
        color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer}
      .swb-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
      .swb-scroll{flex:1;min-height:0;overflow:auto;border-top:1px solid var(--dsw-alias-border-l3)}
      .swb-table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}
      .swb-table th,.swb-table td{padding:6px 10px;text-align:right;white-space:nowrap;
        border-bottom:1px solid var(--dsw-alias-border-l1)}
      .swb-table th:first-child,.swb-table td:first-child{text-align:left}
      .swb-table th{position:sticky;top:0;background:var(--dsw-alias-bg-layer-1);
        color:var(--dsw-alias-label-secondary);font-weight:500;cursor:pointer;user-select:none}
      .swb-up{color:var(--dsw-alias-state-error-primary)}
      .swb-down{color:var(--dsw-alias-state-success-primary)}
      .swb-err{color:var(--dsw-alias-state-warn-primary);padding:6px 0}
    `

    const COLUMNS = [
      { key: 'code', label: '代码', align: 'left' },
      { key: 'name', label: '名称', align: 'left' },
      { key: 'price', label: '现价' },
      { key: 'changePct', label: '涨跌幅%' },
      { key: 'turnover', label: '换手%' },
      { key: 'amount', label: '成交额' },
    ]

    function WorkbenchIcon({ size }) {
      const s = size ?? 16
      return h('svg', {
        width: s, height: s, viewBox: '0 0 16 16', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round',
        'aria-hidden': true,
      },
        h('path', { d: 'M2 13V8M6 13V4M10 13V6.5M14 13V2.5' }),
        h('path', { d: 'M1.5 13.5h13' }),
      )
    }

    /** 同源 API 路径：锚在 document.baseURI，兼容反向代理挂载在子路径下。 */
    function api(path) {
      const relative = path.replace(/^\/+/, '')
      if (typeof document === 'undefined') return '/' + relative
      return new URL(relative, document.baseURI).pathname
    }

    function WorkbenchPage(props) {
      const t = props.t
      const [state, setState] = React.useState({ status: 'loading', rows: [], at: 0, error: null })
      const [filter, setFilter] = React.useState('')
      const [sort, setSort] = React.useState({ key: 'changePct', dir: 'desc' })

      const load = React.useCallback(async () => {
        try {
          const res = await fetch(api('stock-workbench/snapshot'), { cache: 'no-store' })
          const body = await res.json()
          setState((prev) => ({
            status: 'ready', rows: Array.isArray(body.rows) ? body.rows : [],
            at: body.at ?? 0, error: body.error ?? null,
          }))
        } catch (e) {
          setState((prev) => ({ ...prev, status: prev.rows.length ? 'ready' : 'error', error: String(e) }))
        }
      }, [])

      React.useEffect(() => {
        let alive = true
        const tick = () => { if (alive) load() }
        tick()
        const timer = setInterval(tick, 1000) // 1s 轮询；Host 侧有 900ms TTL 兜住多标签页
        return () => { alive = false; clearInterval(timer) }
      }, [load])

      const rows = React.useMemo(() => {
        const q = filter.trim().toLowerCase()
        const filtered = q
          ? state.rows.filter((r) =>
              String(r.code).toLowerCase().includes(q) || String(r.name).toLowerCase().includes(q))
          : state.rows
        const dir = sort.dir === 'asc' ? 1 : -1
        return [...filtered].sort((a, b) => {
          const x = a[sort.key], y = b[sort.key]
          if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir
          return String(x).localeCompare(String(y)) * dir
        })
      }, [state.rows, filter, sort])

      const onSort = (key) =>
        setSort((prev) => ({ key, dir: prev.key === key && prev.dir === 'desc' ? 'asc' : 'desc' }))

      return h('div', { className: 'swb-root' },
        h('div', { className: 'swb-head' },
          h('h1', { className: 'swb-title' }, t('title')),
          h('span', { className: 'swb-meta' },
            state.at ? t('at') + ' ' + new Date(state.at).toLocaleTimeString() : ''),
          h('input', {
            className: 'swb-input', value: filter, placeholder: t('filter'),
            onChange: (e) => setFilter(e.target.value),
          }),
          h('button', { className: 'swb-btn', type: 'button', onClick: load }, t('refresh')),
        ),
        state.error ? h('div', { className: 'swb-err' }, t('error') + ': ' + state.error) : null,
        h('div', { className: 'swb-scroll' },
          h('table', { className: 'swb-table' },
            h('thead', null, h('tr', null, COLUMNS.map((c) =>
              h('th', { key: c.key, onClick: () => onSort(c.key) }, c.label)))),
            h('tbody', null, rows.map((r) =>
              h('tr', { key: r.code },
                h('td', null, r.code),
                h('td', null, r.name),
                h('td', null, r.price),
                h('td', { className: r.changePct >= 0 ? 'swb-up' : 'swb-down' }, r.changePct),
                h('td', null, r.turnover),
                h('td', null, r.amount))))))),
        state.status === 'loading' ? h('div', { className: 'swb-meta' }, t('loading')) : null,
      )
    }

    return {
      /** cordis 服务：slots 必需；locale 用于文案；theme 仅在需要 JS 读主题时加。 */
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'stock-workbench: dictionaries')
        const t = ctx.locale.bind(NS)

        // 样式：一次注入，带 data-plugin-css 去重（与 dsh-pet / dshmarket 同一约定）
        ctx.effect(() => {
          const tagId = 'stock-workbench/panel.css'
          if (document.querySelector('style[data-plugin-css="' + tagId + '"]') !== null) return () => {}
          const tag = document.createElement('style')
          tag.dataset.plugin = 'stock-workbench'
          tag.dataset.pluginCss = tagId
          tag.textContent = CSS
          document.head.appendChild(tag)
          return () => { tag.remove() }
        }, 'stock-workbench: styles')

        // 整页：keyed slot，key 必须等于左栏行的 id
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          locale: NS,
          inject: () => ({ t }),   // 显式给 t，避免依赖宿主自动注入
        }, WorkbenchPage))

        // 左栏入口：list slot，id 与上面的 key 相同
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 20,
          label: () => t('panel'),
          locale: NS,
        }, WorkbenchIcon))
      },
    }
  },
})
```

### 4.6 `locale/en.json` / `locale/zh.json`

```json
{ "meta": { "title": "A-share Workbench", "description": "A full-page A-share snapshot with sorting, filtering and one-second refresh." } }
```

```json
{ "meta": { "title": "A股工作台", "description": "整页 A 股全市场快照，支持排序、筛选与每秒刷新。" } }
```

> 这两个文件只服务**插件管理页/升级弹窗的展示元数据**（不激活插件也会读）；运行时文案走 `ctx.locale.register`。别把模板文案留在里面（`references/host-plugin.md:31-53`）。

### 4.7 `icon.svg`（原创，16×16 视觉，`currentColor`）

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none"
     stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
  <path d="M2 13V8M6 13V4M10 13V6.5M14 13V2.5"/>
  <path d="M1.5 13.5h13"/>
</svg>
```

要求：svg/png/jpeg/webp、**≤256 KiB**、必须留在包目录内（绝对路径/URL/出包软链会被拒）；"文件名合法"不等于"字节能渲染"，要肉眼确认。

---

## 5. 问题五：开发 / 验证回路

### 5.1 生效机制（有明确机制说明，不是猜）

来自 asar 内 `@deepseek-ai/dsh-client-modules` README 的 *Live plugin composition*（偏移 23,009,000 附近）：

> "An open Web page follows the Host's complete module graph through the HMR transport. **Enabling an ordinary plugin adds its Loader entry; disabling it removes the entry and waits for its asynchronous effects before evicting unused modules and styles. Re-enabling loads one instance with its styles.**"

以及 *Build requirements*：

> "The host serves built client bundles, so `pnpm run build` must have produced each `lib/client.js` before launch; a missing bundle fails activation loudly."

以及 `references/host-plugin.md:68-70`：

> "Installing a new bundle can activate through HMR; **replacing an installed package requires restart** to load a fresh JavaScript module generation. Do not infer updated browser code from an unchanged slot id."

结论表：

| 场景 | 是否需要刷新页面 / 重启 |
|---|---|
| 首次 `install_bundle`（新包，`application: applied`） | 正常**不刷新**：Loader 新行进图，页面经 HMR 通道加进来并执行 `apply`。若图标没出现 → **先 F5**，再看 console |
| 修改已安装 bundle 的 `client.js` 内容 | **不能**只靠热更（"Bundle content changes reach the graph only through `rebuilt()`"）。最省事：`plugin_manager set_plugin` 关再开（等价重挂），或重启应用 |
| 修改 host 侧 `index.js` | 必须重启（Node 模块不热替换） |
| 改了 profile 里的任何东西 | 不在本任务范围（禁止手写 profile） |
| `pnpm run dev:web` 在跑 | 才有"前端源码热更"那条路径；**打包版桌面端没有这个 watcher** |

> `dsh.client.immediately` 与"是否需要刷新"无关：它决定该行是否进启动批次，不影响 HMR 图同步。

### 5.2 验证步骤（按可执行顺序）

1. **静态检查（不安装）**
   - `node --check` 两个 JS 文件：`node --check bundle/index.js`、`node --check bundle/client.js`（`node --check` 对 ESM 用 `--input-type=module` 或直接 `node --check file.mjs`；`.js` + `"type":"module"` 时 node 仍按 CJS 解析 `--check`，**若报 import/export 语法错，改用 `node --input-type=module --check < client.js`**）。
   - JSON 合法性：`package.json`、两个 locale。
   - patch YAML 缩进：`- insert:` → 4 空格 `- id:`。
   - `icon.svg` 用 `read_image` 或直接渲染确认（不是只看扩展名）。
2. **安装**：`plugin_manager(action: install_bundle, target: "D:\\h5\\stock-workbench\\bundle")`。
   ⚠️ **本会话不能执行**：delegated subagent 无审批能力，`plugin_manager` 任何动作都需要审批 → 自动拒绝。此步必须由有权限的会话/人来做。
3. **读安装结果**：`application`（`applied` 才算活）+ `warnings`。`restart-required` = 没生效。
4. **免审批确认行**：`cordis_inspect_query(platform:'host', provider:'Config', method:'listConfigs', input:{name:'stock-workbench'})`，能列出条目即 Host 行已在。
5. **Client 侧确认（本会话不可用）**：`cordis_inspect_query(platform:'client', provider:'Slots', method:'listSubTree')` → 看 `sidebar.panellist` 的 occupants 里有 `stock-workbench`，`main` 的 catalog 里有 key。
   **本会话 4 次全部 10s 超时**，故这一环必须由"有页面连着"的会话执行；不要用"装成功了"代替"slot 真的注册上了"。
6. **肉眼验收**：左栏出现图标（展开态 16px + 文字/tooltip；收起态 18px 单图标）→ 点击 → 中心列整页出现 → 顶部不被标题栏压住 → 表格能排序/筛选 → 1 秒刷新（看"更新于"时间戳跳动）→ 切 light/dark 配色正确 → 切中文/英文文案正确 → 切到别的 panel 再切回来，定时器没有叠加（console 无重复请求）。
7. **清理**：测试期间改过的用户状态（折叠侧栏、语言、选中的 panel）恢复原样。

### 5.3 无法验证的边界（必须写进交付报告）

- **本会话没有可用的 Client Inspect**（4 次超时）→ 无法证明"这个宿主现在真的声明了 `sidebar.panellist`"。证据是 0.2.1-rc.5 官方 sidebar 包的声明代码 + 本机正在跑的 dshmarket 走同一通道（间接但很强）。
- **不能安装/不能改 profile** → 无法看到渲染结果、无法截屏、无法验证视觉。
- **不能起第二个服务/浏览器**（且 `validation` 规则禁止为缺少浏览器控制去装光栅化工具或 mock 页面）。
- **宿主若早于 0.2.1**：`sidebar.panellist` 可能不存在（dshmarket 的 `sidebar.load()` 明写"whether the host declares `sidebar.panellist` at all (hosts before the Plugins page moved to the sidebar do not)"）。**必须**用 `ctx.slots.inject` 做降级：声明不存在 → 注册永不发生 → 插件静默不显示，而不是崩。

---

## 6. 问题六：React、依赖来源、样式方案

### 6.1 能用 React 吗？能，从模块表拿，**不要装第二份**

平台模块表（asar 偏移 105,743,233，`@deepseek-ai/dsh-web-frontend` 的 boot 代码，`PLATFORM_MODULES` 的构造）：

```js
{
  react, "react/jsx-runtime", "react-dom", "react-dom/client",
  "@deepseek-ai/cordis", zod,
  "@tanstack/react-virtual",
  "@deepseek-ai/dsh-client-store",
  "@deepseek-ai/dsh-client-ui-slots",
  "@deepseek-ai/dsh-client-ui-primitives",
  "@deepseek-ai/dsh-client-ui-dockkit"
}
```

规则：

- 通过 `factory(require)` 的 `require('react')` 取；**不要** peerDependency 再装一份、不要 CDN、不要 UMD（`references/ui-plugin.md:7-9`）。
- 上表之外的包必须写进 `dsh.client.external` 且由某个动态包或静态表键供给；写不存在的东西 → 组合期报错（missing suppliers / cycle）。
- **不写 JSX** 就不需要构建：`const h = React.createElement`。若要 JSX/TSX，就必须自己跑 tsdown 产出 `lib/client.js`（市场里的 dshmarket 用的是 tsdown + lightningcss），本蓝图刻意避开。

### 6.2 `@deepseek-ai/dsh-client-ui-primitives`：技术可用，但**官方技能明确禁止依赖**

- 事实：它在平台表里（`require('@deepseek-ai/dsh-client-ui-primitives')` 能解析），官方 `ui-workspace` README 甚至称它为 "implicit baseline external"。
- 但 `references/practices.md:35` 的规则更严：

> "Do not `require('@deepseek-ai/dsh-client-ui-primitives')` or load any other Harness Client package as a module … **They change without notice, a plain-JS plugin has no type check, and a throwing component blanks your slot entry** (console: `slot entry crashed in '<slot>'`). Write your own controls and match the host instead … Rename copied classes under your plugin's prefix, keep only `--dsw-alias-*` token references."

也印证风险：dshmarket 自己在用 primitives 前先 `missingPrimitives(mod)` 检查，缺一个就**整个市场页不注册**（"rendering would throw and blank the whole settings dialog"）。

**本蓝图的选择：0 依赖** —— 自己写 `<button>`/`<input>`/`<table>`，只用 token 配色，从宿主页抄间距与行高。这样即使 primitives 改名/换版，最多是"看起来不够像宿主"，不会白屏。

### 6.3 样式落地方案（按优先级）

1. **主题 token + 单一 `<style>` 标签** ✅ 采用
   - `ctx.effect` 内 `document.createElement('style')`，带 `data-plugin` / `data-plugin-css` 去重标记，返回 `tag.remove()` 做清理（与 dsh-pet、dshmarket 完全同一约定）。
   - 只用 `--dsw-alias-*`（+ `--dsw-radius-*`、`--dsw-shadow-*`、`--dsh-frame-top-clearance`）；涨跌红绿这类**数据色**属于艺术色，可以直接写（但建议映射到 `--dsw-alias-state-error/success-primary` 以便跟随主题）。
   - 类名加自己前缀（`.swb-root`），不要复用宿主 CSS Modules 的哈希类名（`dsh-pet/src/client/nav-icon.ts:56-63` 记录了哈希前缀会随构建变）。
2. **组件内渲染 `<style>` 元素**：`return h(Fragment, null, h('style', null, CSS), h('div', ...))` —— 卸载即自动移除，无需 effect。适合"只在页面挂载时需要"的样式。（ui-plugin.md 明确允许："Component-local styles can render as React elements so unmounting removes them."）
3. **CSS Modules / 预处理器**：运行时**不存在**。只有走 tsdown/lightningcss 构建时才会生成 CSS Modules 对象（dshmarket 那样）。纯 JS 包不要考虑。
4. **内联 `style={{}}`**：只适合极少数动态值（宽度、进度），不要拿它做整页布局。

### 6.4 排版/视觉参照

- 同类"管理列表"页 → 抄 Plugin Manager 页（`references/practices.md:34`）。
- 页头：`font-size:15px; font-weight:600; line-height:22px`（dshmarket 的 `.title`）。
- 正文/次要文字：`12px/18px` + `--dsw-alias-label-tertiary`。
- 行高 28~32px，圆角 `--dsw-radius-sm`，hover `--dsw-alias-interactive-bg-hover`。

---

## 7. 完整可粘贴骨架清单（文件 → 职责）

| 文件 | 职责 | 关键点 |
|---|---|---|
| `bundle/package.json` | 包身份 + bundle 声明 + client 声明 + 展示资源导出 | `dsh.bundle.patch`、`dsh.client.platform:"web"`、`exports["./client"]`、`icon`、`files` |
| `bundle/cordis.patch.yml` | 把 Host 行插进 profile 层栈 | **只 1 行**；client 不出现在 patch 里 |
| `bundle/index.js` | Host：`inject:['webServer']`；`webServer.register({kind:'prefix'})`；TTL 缓存 + 单飞 + 上游 GBK 解码 | 所有资源用 `ctx.effect` 包裹并返回清理 |
| `bundle/client.js` | 浏览器：`__ModuleLoader__.load({id, factory})`；`inject:['slots','locale']`；注册 `main` + `sidebar.panellist`；整页表格；1s 轮询；样式注入 | **id === package name**；两处 slot 的 id/key 必须相同 |
| `bundle/locale/en.json` | 插件管理页英文 meta | `meta.title` / `meta.description` |
| `bundle/locale/zh.json` | 中文 meta | 同上 |
| `bundle/icon.svg` | 插件管理页图标 | ≤256 KiB，包内相对路径，真能渲染 |
| `bundle/README.md`（可选） | 自用说明 | 记录 TODO 与数据源 |

**最小内容骨架**见 §4.2–4.7（每个文件都可直接落盘）。

---

## 8. 风险与未确认点清单

### 8.1 阻断级（不解决就装不上/不生效）

| # | 风险 | 影响 | 处置 |
|---|---|---|---|
| R1 | **本会话无法执行 `plugin_manager`**（审批自动拒绝）与**无法改 profile** | 交付的是蓝图，不是可用插件 | 由有权限的会话执行 `install_bundle`，target = `D:\h5\stock-workbench\bundle` |
| R2 | `client.js` 的 `id` 与 `package.json.name` 不一致 | 模块图注册不到该行 → 插件静默不加载 | 两处写死同一字符串；改包名时同步改 |
| R3 | `sidebar.panellist.id` ≠ `main.key` | 点图标报错/不切换（"selecting a missing main entry throws"） | 用同一个 `PANEL_ID` 常量 |
| R4 | 只在 `main` 注册、没在 `sidebar.panellist` 注册（或反之） | 页在但点不进去 / 图标在但点开抛错 | 两个 `ctx.slots.inject` 必须成对出现 |
| R5 | `dsh.client.inject` 里写了不存在的包名 | 组合期拒绝（missing suppliers），整个插件不加载 | 只写 `dsh-client-ui-layout` / `dsh-client-ui-sidebar` / `dsh-client-locale`，或干脆 `[]` |
| R6 | 手写 profile / 手抄 patch | 越权且易损坏 profile | 只用 `install_bundle` |

### 8.2 高（会坏但可修）

| # | 风险 | 处置 |
|---|---|---|
| R7 | **顶部被标题栏压住**（macOS 48px / Windows 标题栏） | 根节点必须 `padding-top: calc(28px + var(--dsh-frame-top-clearance, 0px))`（§2.2） |
| R8 | 页面不滚动/被裁：`centerCol` 是 `overflow:hidden` 的 flex 列 | 根 `height:100%; display:flex; flex-direction:column`；内容区 `flex:1; min-height:0; overflow:auto` |
| R9 | 改完 `client.js` 页面没变 | 包内容变更不走热更：关/开插件，或重启（§5.1） |
| R10 | 上游行情乱码 | `arrayBuffer()` + `TextDecoder('gbk')`；**TODO** 在本机验证 Node 22 支持 gbk |
| R11 | 1 秒轮询把上游打爆 / 多标签页叠加 | Host 侧 900ms TTL + 单飞；Client 侧 `setInterval` 清理写进 `useEffect` 返回函数 |
| R12 | 自定义路由**没有鉴权**（`kind:'prefix'` 不经 `/api` 的 admit） | 只返回公开行情；不要在该路由暴露 token/账户；远程部署时视为公开端点 |
| R13 | 用了 primitives → 宿主升级后 `slot entry crashed`，整块槽位空白 | 0 依赖自写控件（§6.2） |
| R14 | 定时器/样式没清理 → 槽位来回切换后叠加请求、样式重复 | 一律 `ctx.effect` + 返回清理；样式带 `data-plugin-css` 去重 |

### 8.3 未确认点（需实测，不要当成结论）

| # | 未确认 | 验证方式 |
|---|---|---|
| U1 | 本机宿主是否**确实**声明 `sidebar.panellist` / `main` | 有页面的会话执行 `Slots.listSubTree`；或安装后直接看左栏 |
| U2 | `main` 组件是否**自动**注入 `t`（`locale: NS` 时） | 本蓝图用显式 `inject: () => ({ t })` 规避，不依赖该行为 |
| U3 | `main` 的 owner props 是否真的只有 `{}` | 同 U1，看 `Slots.listSubTree` 的 props 描述；`renderSlot("main", {}, …)` 已是很强证据 |
| U4 | `install_bundle` 首次安装是否**无需刷新** | 安装后不刷新观察；没有就 F5 一次再判断 |
| U5 | 收起态（rail）下 18px 图标的视觉重量 | 肉眼验收；必要时把 stroke 降到 1.2 |
| U6 | 上游接口字段下标（`parseRows` 里的 `f[3]/f[32]/…`） | 用真实响应核对；**改数据源必须改这里** |
| U7 | `document.baseURI` 在桌面壳里的实际值 | 断点/console 打印一次；若带子路径，`api()` 已兼容 |
| U8 | Linux/纯浏览器下的 `--dsh-frame-top-clearance` | 未定义即 0，28px 顶距仍在，可接受 |

### 8.4 明确"不要做"的事

- ❌ 用 iframe 承载页面（`references/practices.md:33`：iframe 拿不到主题 token / 明暗切换 / `ctx.locale`）。
- ❌ 替换 app root 或往 `document.body` 再挂一个应用。
- ❌ 读别的插件的 DOM / 样式 / 组件源码去"估位置"。
- ❌ 为 `sidebar.panellist` 发明 `icon` 选项（没有这个字段）。
- ❌ 把"排序/筛选"做成 agent tool（纯视图状态）。

---

## 8.5 与工作区已有实现 `D:\h5\stock-workbench\dsh-stock-workbench\` 的交叉核对

调研期间发现工作区里已有一份在做的 bundle。逐行核对结果：**机制选择完全一致**，可互相印证本文结论不是纸面推演。

| 项 | 已有 bundle | 本文蓝图 | 判定 |
|---|---|---|---|
| 左栏入口 | `sidebar.panellist`, `id: PANEL_ID`, `order: 30`, `label: () => t('nav')`, `locale: NS` | 同（`order: 20` 只是排序位） | ✅ 一致 |
| 整页 | `main`, `key: PANEL_ID`, `locale: NS` | 同 | ✅ 一致 |
| id 配对 | 两处同一个 `PANEL_ID` | 同 | ✅ 一致 |
| 模块 id | `window.__ModuleLoader__.load({ id: 'dsh-stock-workbench' })` = `package.json.name` | 要求 id === name | ✅ 一致 |
| 图标 props | `(owner = {}) => h(WorkbenchIcon, { size: owner.size ?? 16 })` | `{ size, active }` | ✅ 一致 |
| 数据 | 注释明写"All data comes from the Host half's same-origin JSON routes; the renderer never talks to a quote provider directly" | 同结论 | ✅ 一致 |
| `inject` | `['slots','locale']` | 同 | ✅ 一致 |

**需要补齐的两点（不阻断运行，但影响"能装得像个正经插件"）**

1. **缺 `locale/` 与 `exports["./locale/*.json"]`**：插件管理页会回落到 `package.json.name` + `description`；`references/host-plugin.md:31-53` 要求 `meta.title` / `meta.description` 本地化，中英各一份。
2. **`dsh.client.inject` 未列 `@deepseek-ai/dsh-client-ui-layout` / `...-sidebar`**：因为 `ctx.slots.inject` 是声明感知的，功能上无害；补上是把"排序意图"写明，也避免以后有人误以为可以删。另 `immediately: true` 非必需（dshmarket 没写），保留亦可。

其余差异（`order` 值、`main` 传 `{ ctx }` 而非 `{ t }`、`immediately`）都是风格选择，不影响正确性。

---

## 9. 一页速查（给实现者）

```js
// 左栏图标（list slot）
ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
  { name: 'sidebar.panellist', id: 'stock-workbench', order: 20, label: () => t('panel'), locale: NS },
  WorkbenchIcon,                      // props: { size: 16|18, active }
))

// 整页（keyed slot，key === 上面 id）
ctx.slots.inject('main', () => ctx.slots.register(
  { name: 'main', key: 'stock-workbench', locale: NS, inject: () => ({ t }) },
  WorkbenchPage,                      // props: { ...inject }；自己 height:100% + 自己滚动
))

// Host 数据通道
export const inject = ['webServer']
ctx.effect(() => ctx.webServer.register({
  kind: 'prefix', path: '/stock-workbench',
  handler: async (req, res) => { /* JSON */ },
}), 'stock-workbench: route')

// Client 取数（同源、带部署前缀）
fetch(new URL('stock-workbench/snapshot', document.baseURI), { cache: 'no-store' })
```

| 问题 | 答案 |
|---|---|
| 左栏入口 slot | **`sidebar.panellist`**（list, root）· options `{id, order, label, locale}` · props `{size, active}` |
| 整页 slot | **`main`**（keyed, root）· options `{key, locale, inject}` · props `{}` + inject |
| 配对规则 | `sidebar.panellist.id === main.key`，缺一即 throw |
| 是否占满 | 占满中心列，但无 padding/页头/滚动容器，需自处理 |
| 主题 | CSS 变量 `--dsw-alias-*`（31 个实测 token） |
| 数据 | Host `ctx.webServer` 路由 + Client 同源 fetch（浏览器直连第三方会撞 CORS） |
| 生效 | 安装走 HMR 图同步；改包内容需关/开或重启 |
| React | `require('react')` 来自平台模块表；primitives 不建议依赖 |
| 最大风险 | 本会话无法安装/无法 Client Inspect → 蓝图未在运行时验证；R7 顶部安全区、R3 配对 id 是最容易踩的实现坑 |
