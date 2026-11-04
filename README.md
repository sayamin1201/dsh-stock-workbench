# DSH 看股工作台（dsh-stock-workbench）

DeepSeek Harness 的 A 股看盘 / 选股插件。左侧栏一个「看股」入口 → 整页工作台：全 A 行情快照、多指标排序、技术信号扫描、板块资金流、红利/估值指标、公式选股、K 线与分时、个股详情。

> 插件说明（数据口径 / 接口 / 安装）见 [`dsh-stock-workbench/README.md`](dsh-stock-workbench/README.md)
> 功能与路线图见 [`SPEC.md`](SPEC.md)，当前状态与自测命令见 [`STATUS.md`](STATUS.md)
> 调研：[竞品对比](research/competitor-analysis.md) · [回测机制](research/backtest-overview.md)

## 功能一览

| 模块 | 说明 |
|---|---|
| 全 A 榜单 | 5570+ 只、23 列可排序（含地域板块 / 所属概念 / 股息率 / 连续分红 / ROE 等）、11 项筛选、虚拟滚动、多分组自选、自动刷新、CSV 导出 |
| 个股详情 | 日/周/60/30/15/5 分 K 线（前复权，可向左补历史）+ 当日分时 + MA/MACD/KDJ/RSI/BIAS；右上角「ⓘ 详情」popover：全部指标 + **PE/PB 近 5 年估值分位** + 分红明细 |
| 技术信号 | 6 类信号 × 4 周期 × 3 窗口；两段式扫描（快照粗筛 → 候选池拉 K） |
| 板块资金流 | 概念 / 行业板块主力净流入排行；点击板块按**成分股代码**回榜单筛选 |
| 红利 / 估值 | 股息率、分红年数、连续分红年数、分红逐笔明细（10 年）；PE/PB/ROE/负债率/毛利率；估值分位 |
| 公式选股 | 26 字段条件表达式（容错全角 / 方括号 / between / contains）、可视化构造器、收藏夹 + 15 条预置策略 |
| 列配置 | 每个 tab 独立列配置：显示 / 隐藏、固定左侧、拖拽排序，localStorage 持久化 |

## 架构

```
index.js          Host 半：13 条 HTTP 路由（快照/K线/分时/信号/扫描/公式/分红/板块/成分股/估值）
client.js         浏览器半：左侧栏入口 + 整页工作台（React，无构建步骤）
lib/market.js     行情数据层（东财 push2，快照 8×800、3s TTL / 收盘 5min）
lib/query.js      筛选 / 排序 / 格式化
lib/signals.js    技术信号库（SMA/EMA/MACD + 6 检测器）
lib/formula.js    公式引擎（手写 tokenizer + 递归下降 parser，不 eval）
lib/dividend.js   分红数据（东财数据中心，10 年窗口，磁盘快照缓存）
lib/boards.js     板块资金流 + 成分股（push2，60s / 5min 缓存）
lib/valuation.js  估值分位（RPT_VALUEANALYSIS_DET，近 5 年 PE/PB 百分位）
```

## 开发与测试

```bash
git clone https://github.com/sayamin1201/dsh-stock-workbench.git
cd dsh-stock-workbench/dsh-stock-workbench

# 纯逻辑单测（无需网络）
node test/query.test.mjs
node test/signals.test.mjs
node test/formula.test.mjs

# Host 端到端（会真实访问东财公开接口）
node test/host.test.mjs
```

浏览器半的 SSR / 交互测试在仓库根 `.ssr/`（先 `cd .ssr && npm i`，再 `node ssr.mjs` / `node interaction.mjs`）。

## 数据来源与免责声明

- 数据来自东方财富公开接口，仅供学习 / 研究使用，**不构成投资建议**
- 插件不提供交易功能，不做行情数据再分发；接口口径与限制见插件 README
- 使用前请自行确认所在地区对行情数据使用的相关规定

## License

[MIT](LICENSE)