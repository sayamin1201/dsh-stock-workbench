# 看股工作台 · 项目现状（交接 / 上下文压缩用）

> 一句话：DSH 插件，左侧栏「看股」图标 → 整页 A 股工作台。数据来自东财公开接口，Host 抓取、Client 渲染。
> 最后更新：2026-11-04（AI 侧栏功能已整体移除）

## 安装与运行

- 包目录：`D:\h5\stock-workbench\dsh-stock-workbench`（profile 里是软链）
- 已装入 profile：`include:dsh-stock-workbench`
- 改 Host（`index.js` / `lib/*.js`）→ 用 `plugin_manager set_plugin` 关一次再开（热重载，不用重启 DSH）
- 改 Client（`client.js`）→ 页面 Ctrl+F5
- 规格：`D:\h5\stock-workbench\SPEC.md`；数据源实测报告：`research/data-sources.md`；dsh llm 协议笔记：`research/dsh-llm-api.md`（AI 功能已删，保留作参考）

## 文件

```
index.js             Host 半：9 条 HTTP 路由（见下）
client.js            浏览器半：侧栏入口 + 整页面板（约 178KB）
lib/market.js        数据层：全集/快照/指数/涨跌家数/K线/分时 + 缓存重试
lib/boards.js        板块资金流（概念/行业/地域，push2，60s 缓存）
lib/valuation.js     估值分位（RPT_VALUEANALYSIS_DET 近 5 年 PE/PB 百分位，6h 缓存）
lib/dividend.js      分红数据：东财 RPT_SHAREBONUS_DET 10 年窗口（明细+连续年数），6h 缓存 + 磁盘快照 state/dividend-cache.json
lib/signals.js       信号库：SMA/EMA/MACD + 6 个检测器
lib/formula.js       公式引擎：tokenizer + 递归下降 parser + 26 字段 + 14 条预置（不 eval）
lib/query.js         筛选/排序/格式化/预设
test/                query 25 / signals 15 / formula 34 / host 端到端（含真实上游）/ smoke
.ssr/                浏览器半测试环境（React SSR 61 项 + react-test-renderer 交互 15 项）
```

## Host 路由（9 条）

`GET /dsh-stock/api/v1/` → `health`、`dashboard[?force=1]`、`kline?secid&klt&lmt`、`trends?secid`、`signals`、`scan?signals&minAmount&limit&within&klt`、`formula/fields`、`formula/validate?expr`、`formula?expr&limit`、`dividend?code`、`boards?type`、`board-members?code`、`valuation?code`（**13 条**）

## 能力清单

| tab | 能力 |
|---|---|
| 全 A 榜单 | 5572 行（虚拟滚动）、**22 数据列**（含地域板块/所属概念/股息率/分红年数/连续分红/PB/PE/ROE/负债率/毛利率）、可排序、11 项筛选、6 个快捷预设、**多分组自选**（分组条在表格工具行左侧，星标写入当前组）、只看自选、自动刷新（手动/3/5/10s）、导出 CSV；点「分红年数/连续分红」开分红明细弹窗；详情页右上角「ⓘ 详情」popover 展示全部指标 + 估值分位；表格上方工具行最右侧「⚙」按 tab 独立配置列（显示/隐藏、固定到左、拖拽排序），localStorage 按 tab 持久化 |
| 个股详情（双击行） | 日/周/60/30/15/5 分 K（前复权）+ 当日分时；MA5/10/20；成交量；指标副图 MACD/KDJ/RSI/BIAS；滚轮缩放/拖动平移/双击复位/底部 dataZoom 滑条；向左拖到边界自动补历史（+240/次，日线≤2400、分钟≤1440）；Esc 返回且**不丢筛选与滚动位置**（工作台/详情叠放层） |
| 信号扫描 | 6 信号（均线金叉/MACD 金叉/20 日新高/放量上攻/多头排列/站上 60 日线）× 4 周期（日线/60/15/5 分）× 窗口（今日/近 3 日/近 5 日）；3 个预设组合；两段式：快照粗筛候选池 → 只对候选池拉日 K |
| 资金流榜 | 主力净流入/流出 TOP 30 并排 + 净占比 + 合计与家数 |
| 公式选股 | 手写条件（且/或/not/between/contains，容错全角/方括号/&&/~/逗号）；可视化构造器；**收藏夹 = 右侧抽屉**（15 条预置含 5 条红利策略：高股息核心/破净高股息/银行保险红利/现金牛/低波红利；支持保存/排序/导入导出 JSON/恢复预置） |

## 关键数据口径（别踩坑）

- 东财 `clist` 的 `pz` 硬限 100 → 代码全集 60 页；快照走 `ulist.np` 800 secid/批 × 8
- 5927 个代码里约 355 条 `f2 === "-"` 是退市占位，过滤后 5572
- `f11` 是 5 分钟涨跌幅，5 日是 `f109`；`f62` 主力资金约 15% 恒为 0（视为无数据）
- 涨停/跌停用 push2ex 池的 `tc`，不用阈值法；北交所 secid 必须 `0.920xxx`
- 股息率 = 近 12 个月已实施税前每股派息 / 现价；分红年数 = 近 3 年有分红的报告年度数；连续分红 = 从最新报告年度回数、窗口 10 年（10+ 表示至少 10 年）
- ROE / 负债率 / 毛利率 取最近一期报告、**未年化**（银行负债率天然 90%+）

## 自测（全绿基线）

```powershell
$node = "C:\Users\10932\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
$root = "D:\h5\stock-workbench\dsh-stock-workbench"
& $node "$root\test\query.test.mjs"     # 25
& $node "$root\test\signals.test.mjs"   # 15
& $node "$root\test\formula.test.mjs"   # 34
& $node "$root\test\host.test.mjs"      # 端到端 + 真实上游（10 路由）
cd D:\h5\stock-workbench\.ssr
& $node ssr.mjs                         # 74
& $node interaction.mjs                 # 34（真渲染 + 模拟点击）
```

## 已移除（避免重复开发）

- **AI 侧栏**（2026-11-04 应用户要求整体删除）：聊天抽屉、`/chat` SSE、`/models` 模型列表与切换、`/page-context` 页面上下文上报与落盘、`lib/chat.js`、`test/chat.test.mjs`、`state/`、Markdown 渲染、回答里的股票快捷操作、聊天历史 localStorage
- **「红利防御」独立 tab**（同日移除，能力已并入）：指标并入全 A 榜单列，5 条策略并入公式收藏夹预置；不再有独立面板与专用筛选器
- 若以后要恢复 AI：协议细节在 `research/dsh-llm-api.md`（`GenerateOptions = {provider, model, sessionId, system, messages[content 块数组]}`；chunk 文本在 `text-delta`；失败在 `finish.reason.kind==='error'`）

## 已知限制

- 分钟 K 上游只留约 31 交易日；公式只跑快照字段（无历史序列）
- 无自动刷新时的推送，均为轮询/手动
- 单机单用户，自选（分组结构）/公式/刷新间隔/列配置存 localStorage（列配置键：`dsh-stock-workbench:column-prefs`）
- 列配置：四个 tab 各自独立（list 21 / scan 8 / flow 5 / formula 8 列），键 `dsh-stock-workbench:column-prefs`；列宽暂不可拖拽
