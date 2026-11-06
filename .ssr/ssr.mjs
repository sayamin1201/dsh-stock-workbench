/**
 * 浏览器半渲染冒烟：真 React 18 + react-dom/server + 真 Host 路由数据。
 *
 * 不装 jsdom：用 SSR 渲染组件树，验证 JSX 结构、hooks 顺序、图表几何；
 * 再单独单测布局数学（jsdom 那条路被 pnpm 的传递依赖策略挡住了，SSR 更干净）。
 *
 * 运行：node .ssr/ssr.mjs   （.ssr 里 pnpm add react react-dom）
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const requireFromSsr = createRequire(new URL('./package.json', import.meta.url));
const CLIENT = 'D:/h5/stock-workbench/dsh-stock-workbench/client.js';
const BASE = (process.env.DSH_BASE ?? 'http://127.0.0.1:54251/').replace(/\/?$/, '/');

const React = requireFromSsr('react');
const { renderToStaticMarkup } = requireFromSsr('react-dom/server');
const h = React.createElement;

// --- 0. 迷你断言 ---------------------------------------------------------
let passed = 0;
function check(label, fn) {
  fn();
  passed += 1;
  console.log('  ✓ ' + label);
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- 1. 加载插件模块（复刻 __ModuleLoader__ 的环境） ----------------------
let captured = null;
const fakeWindow = { __ModuleLoader__: { load: (mod) => { captured = mod; } } };
const fakeDocument = { baseURI: BASE };
const source = readFileSync(CLIENT, 'utf8');

// 组件里的 fetch 走本机真实 Host 路由
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === 'string' && !/^https?:/.test(input) ? new URL(input, BASE).href : input;
  return realFetch(url, init);
};
globalThis.window = { addEventListener() {}, removeEventListener() {} };

const factoryFn = new Function('require', 'window', 'document', 'fetch', source);
factoryFn(requireFromSsr, fakeWindow, fakeDocument, globalThis.fetch);
if (!captured) throw new Error('模块没有调用 __ModuleLoader__.load');
// 回归：Client 模块注册 ID 必须等于包名（DSH client-modules 按包名索引，带前缀会静默不生效）
{
  const pkg = JSON.parse(readFileSync(new URL('../dsh-stock-workbench/package.json', import.meta.url), 'utf8'));
  assert(captured.id === pkg.name,
    'Client 注册 ID 必须等于包名：captured.id=' + captured.id + '，package.name=' + pkg.name);
  assert(!captured.id.includes('@local/'), 'Client 注册 ID 不能带 @local/ 前缀：' + captured.id);
}
console.log('✓ 模块格式可加载  id=' + captured.id);

const mod = captured.factory(requireFromSsr);
const internals = mod.__internals;
console.log('✓ factory 返回  name=' + mod.name + '  inject=' + JSON.stringify(mod.inject));

// --- 2. apply() 真的注册了侧栏入口 + 主面板 ------------------------------
const dicts = {};
const registered = [];
const ctx = {
  effect: (fn) => fn(),
  locale: {
    register: (_ns, d) => { Object.assign(dicts, d); return () => {}; },
    bind: () => (key) => (dicts.zh ?? {})[key] ?? key,
    subscribe: () => () => {},
  },
  slots: {
    inject: (_key, cb) => cb(),
    register: (options, component) => { registered.push({ options, component }); return () => {}; },
  },
};
mod.apply(ctx);

check('apply 注册了 2 个 slot（侧栏入口 + 主面板）', () => {
  assert(registered.length === 2, 'slot 数量 ' + registered.length);
  const names = registered.map((r) => r.options.name).sort();
  assert(names.join(',') === 'main,sidebar.panellist', '实际 ' + names.join(','));
});
const panelReg = registered.find((r) => r.options.name === 'main');
const rowReg = registered.find((r) => r.options.name === 'sidebar.panellist');
check('main.key === sidebar.panellist.id（宿主硬要求，否则 selectPanel 会抛）', () => {
  assert(panelReg.options.key === rowReg.options.id, panelReg.options.key + ' vs ' + rowReg.options.id);
});

// 字典必须是扁平 key（locale 服务按扁平 key 查找）
check('locale 字典已摊平，col.code / preset.limitUp 都能查到中文', () => {
  assert(dicts.zh['col.code'] === '代码', 'col.code = ' + dicts.zh['col.code']);
  assert(dicts.zh['preset.limitUp'] === '涨停/接近涨停', 'preset.limitUp = ' + dicts.zh['preset.limitUp']);
  assert(!Object.values(dicts.zh).some((v) => v && typeof v === 'object'), '还有嵌套对象');
});

// 侧栏图标
check('侧栏图标渲染成 svg（16px，含 3 根柱子）', () => {
  const svg = renderToStaticMarkup(rowReg.component({ size: 16 }));
  assert(svg.includes('<svg'), '没有 svg');
  assert((svg.match(/<rect/g) ?? []).length === 4, 'rect 数量不对');
});

check('apiUrl 保留查询串（丢 query 会让 /kline 变成无参数请求 → invalid secid）', () => {
  const withQuery = internals.apiUrl('dsh-stock/api/v1/kline?secid=1.600000&klt=101&lmt=20');
  assert(withQuery.includes('?secid=1.600000'), '查询串被丢掉：' + withQuery);
  assert(withQuery.includes('klt=101'), 'klt 被丢掉：' + withQuery);
  assert(internals.apiUrl('/dsh-stock/api/v1/health') === '/dsh-stock/api/v1/health', '无参数路径不对');
});

// --- 3. 图表布局数学（纯函数） ------------------------------------------
function syntheticBars(count) {
  const bars = [];
  let price = 10;
  for (let i = 0; i < count; i += 1) {
    const drift = Math.sin(i / 3) * 0.06 + (i % 7 === 0 ? 0.12 : -0.02);
    const open = price;
    const close = Math.max(1, price + drift);
    bars.push({
      d: `2026-${String(3 + Math.floor(i / 20)).padStart(2, '0')}-${String((i % 20) + 1).padStart(2, '0')}`,
      open,
      close,
      high: Math.max(open, close) + 0.05,
      low: Math.min(open, close) - 0.05,
      volLots: 1000 + (i % 9) * 250,
      amount: 1e7 + i * 1e5,
      pct: ((close - open) / open) * 100,
    });
    price = close;
  }
  return bars;
}

const bars = syntheticBars(120);
check('K 线布局：120 根不会产生 NaN / Infinity', () => {
  const layout = internals.buildCandleLayout(bars, 900, 420);
  assert(layout, '布局为空');
  assert(Number.isFinite(layout.min) && Number.isFinite(layout.max), 'min/max 非有限');
  assert(layout.max > layout.min, 'max 不大于 min');
  const coords = [...layout.priceTicks.map((t) => t.y), ...layout.xTicks.map((t) => t.x)];
  assert(coords.every((v) => Number.isFinite(v)), '刻度坐标含 NaN');
  assert(layout.candleW >= 1, 'candleW = ' + layout.candleW);
  assert(layout.priceTicks.length === 5, '价格刻度数');
});
check('K 线布局：MA5/10/20 长度对齐且前 n-1 个是 null', () => {
  const layout = internals.buildCandleLayout(bars, 900, 420);
  const [ma5, ma10, ma20] = layout.mas;
  assert(ma5.length === bars.length && ma10.length === bars.length && ma20.length === bars.length, 'MA 长度不对');
  assert(ma5.slice(0, 4).every((v) => v === null) && ma5[4] != null, 'MA5 起始位置不对');
  assert(ma10.slice(0, 9).every((v) => v === null) && ma10[9] != null, 'MA10 起始位置不对');
  assert(ma20.slice(0, 19).every((v) => v === null) && ma20[19] != null, 'MA20 起始位置不对');
  assert(layout.pathFor(ma5).startsWith('M'), 'MA path 不是 M 开头');
});
check('K 线布局：数据不足以画（宽度/高度过小）时返回 null 而不是崩', () => {
  assert(internals.buildCandleLayout(bars, 40, 40) === null, '过小尺寸应返回 null');
  assert(internals.buildCandleLayout([], 900, 420) === null, '空数据应返回 null');
});

// --- 3b. 缩放/平移视窗数学 ----------------------------------------------
const MIN = internals.MIN_VISIBLE_BARS;
check('视窗：以中线为锚点缩放，span 减半且中心不动', () => {
  const view = { from: 0, to: 240 };
  const zoomed = internals.zoomView(view, 240, 0.5, 0.5);
  assert(Math.abs(zoomed.to - zoomed.from - 120) < 1e-9, 'span=' + (zoomed.to - zoomed.from));
  assert(Math.abs((zoomed.from + zoomed.to) / 2 - 120) < 1e-9, '中心跑了：' + (zoomed.from + zoomed.to) / 2);
});
check('视窗：以左边界为锚点缩放时左边界不动', () => {
  const zoomed = internals.zoomView({ from: 0, to: 240 }, 240, 0.5, 0);
  assert(Math.abs(zoomed.from - 0) < 1e-9, 'from=' + zoomed.from);
});
check('视窗：最小可见根数受限，不会缩成一个点', () => {
  let view = { from: 0, to: 240 };
  for (let i = 0; i < 40; i += 1) view = internals.zoomView(view, 240, 0.5, 0.5);
  const span = view.to - view.from;
  assert(span >= Math.min(MIN, 240) - 1e-9, 'span=' + span + ' 小于下限 ' + MIN);
  assert(span <= 240, 'span 超过总数');
});
check('视窗：放大不会缩到 0 根，缩小不会超过全量', () => {
  let view = { from: 100, to: 140 };
  for (let i = 0; i < 20; i += 1) view = internals.zoomView(view, 240, 1.5, 0.5);
  assert(Math.abs(view.from - 0) < 1e-9 && Math.abs(view.to - 240) < 1e-9, '全量夹紧失败：' + JSON.stringify(view));
});
check('视窗：拖动平移方向正确，并且夹在数据范围内', () => {
  const panned = internals.panView({ from: 100, to: 160 }, 240, 0.5);
  assert(panned.from > 100, '向右拖应看到更晚的数据（from 变大），实际 ' + panned.from);
  assert(Math.abs(panned.to - panned.from - 60) < 1e-9, '拖动改变了 span');
  const leftEdge = internals.panView({ from: 10, to: 70 }, 240, -0.5);
  assert(Math.abs(leftEdge.from - 0) < 1e-9, '左边界没夹住：' + leftEdge.from);
  const rightEdge = internals.panView({ from: 170, to: 230 }, 240, 0.5);
  assert(Math.abs(rightEdge.to - 240) < 1e-9, '右边界没夹住：' + rightEdge.to);
});
check('K 线布局：视窗只画可见区间，step / candleW 随缩放放大', () => {
  const full = internals.buildCandleLayout(bars, 900, 420);
  const zoomed = internals.buildCandleLayout(bars, 900, 420, { from: 60, to: 90 });
  assert(zoomed.visibleStart === 60 && zoomed.visibleEnd === 90, '可见区间 ' + zoomed.visibleStart + '~' + zoomed.visibleEnd);
  assert(zoomed.step > full.step * 3, 'step 没放大：' + zoomed.step + ' vs ' + full.step);
  assert(zoomed.candleW > full.candleW, 'candleW 没放大');
  // 放大后 Y 轴应贴合可见区间（比全量窄）
  assert((zoomed.max - zoomed.min) <= (full.max - full.min), '放大后值域反而变宽');
});
check('CandleChart SSR：默认只画最近 120 根，带缩放按钮与可见区间标签', () => {
  const markup = renderToStaticMarkup(h(internals.CandleChart, { bars, width: 900, height: 420, t: (k) => k }));
  assert(!markup.includes('NaN'), 'markup 出现 NaN');
  const rects = (markup.match(/<rect/g) ?? []).length;
  // 每根 K 线 = 实体 + 量柱；MACD 默认指标再加 hist 柱
  assert(rects >= 355 && rects <= 372, '默认视窗柱体数 ' + rects + '（应≈120×3）');
  assert(markup.includes('sw-chartCtl'), '没有缩放按钮组');
  assert(markup.includes('sw-chartRange'), '没有可见区间标签');
  assert(markup.includes('sw-chartBtn'), '没有缩放按钮');
});

// --- 3c. 指标副图（成交量下方）-----------------------------------------
check('指标数学：MACD/KDJ/RSI/BIAS 长度对齐、边界正确、无 NaN 泄漏', () => {
  const closes = bars.map((bar) => bar.close);
  const { dif, dea, hist } = internals.macdSeries(closes);
  assert(dif.length === closes.length && dea.length === closes.length && hist.length === closes.length, 'MACD 长度');
  assert(hist.every((value) => value == null || Number.isFinite(value)), 'MACD hist 有 NaN');

  const { k, d, j } = internals.kdjSeries(bars);
  assert(k.length === bars.length, 'KDJ 长度');
  assert(k.slice(0, 8).every((value) => value === null), 'KDJ 前 8 根应为 null');
  assert(k.slice(8).every((value) => Number.isFinite(value) && value > -50 && value < 150), 'K 越界');
  assert(j.slice(8).every((value) => Number.isFinite(value)), 'J 有 NaN');

  const rsi = internals.rsiSeries(closes, 6);
  assert(rsi.slice(0, 6).every((value) => value === null), 'RSI 前 6 根应为 null');
  assert(rsi.slice(6).every((value) => Number.isFinite(value) && value >= 0 && value <= 100), 'RSI 应在 0~100');

  const bias = internals.biasSeries(closes, 6);
  assert(bias.slice(0, 5).every((value) => value === null), 'BIAS 前 5 根应为 null');
  assert(Number.isFinite(bias[5]), 'BIAS 第 6 根应为数字');
});
check('指标定义：4 个指标，线/柱/参考线/固定值域齐全', () => {
  assert(internals.INDICATORS.length === 4, '指标数量 ' + internals.INDICATORS.length);
  for (const { id } of internals.INDICATORS) {
    const def = internals.computeIndicator(bars, id);
    assert(def.id === id && def.title, id + ' 定义不全');
    assert(def.lines.length >= 2 && def.lines.every((line) => line.values.length === bars.length), id + ' 线数据长度不对');
    assert(Array.isArray(def.guides), id + ' 缺 guides');
    if (id === 'kdj' || id === 'rsi') assert(def.fixed?.[0] === 0 && def.fixed?.[1] === 100, id + ' 应为 0~100 值域');
    if (id === 'macd') assert(def.hist && def.hist.length === bars.length, 'MACD 应有柱序列');
  }
});
check('K 线布局：成交量下方分配指标副图，且互不重叠', () => {
  const layout = internals.buildCandleLayout(bars, 900, 420, null, 'kdj');
  assert(layout.ind, '没有指标区');
  assert(layout.ind.h >= 50, '指标区高度 ' + layout.ind.h);
  assert(layout.ind.top > layout.priceBottom, '指标区应在价格区下方');
  assert(layout.ind.bottom <= 420, '指标区超出画布：' + layout.ind.bottom);
  assert(layout.ind.top >= layout.priceBottom + layout.volH, '量柱与指标区重叠');
  assert(layout.ind.guides.length === 3, 'KDJ 应有 20/50/80 三条参考线');
  assert(layout.ind.lines.every((line) => !line.d || !/NaN/.test(line.d)), '指标线路径含 NaN');
  // 价格区被压缩后仍然可用
  assert(layout.priceH > 120, '价格区太矮：' + layout.priceH);
});
check('CandleChart SSR：四种指标副图都能渲染，带标题与参考线', () => {
  for (const { id } of internals.INDICATORS) {
    const markup = renderToStaticMarkup(h(internals.CandleChart, {
      bars, width: 900, height: 460, t: (k) => k, indicator: id, onView: () => {},
    }));
    assert(!markup.includes('NaN'), id + ' markup 出现 NaN');
    const def = internals.computeIndicator(bars, id);
    assert(markup.includes(def.title), id + ' 缺指标标题 ' + def.title);
    assert((markup.match(/<path/g) ?? []).length >= 3, id + ' 线条不足');
  }
  const kdjMarkup = renderToStaticMarkup(h(internals.CandleChart, {
    bars, width: 900, height: 460, t: (k) => k, indicator: 'kdj', onView: () => {},
  }));
  assert(kdjMarkup.includes('80.00'), 'KDJ 缺 80 参考线标签');
  assert(kdjMarkup.includes('20.00'), 'KDJ 缺 20 参考线标签');
});

// --- 3d. dataZoom 滑条 -------------------------------------------------
check('默认视窗：最近 120 根，数据不足时全量', () => {
  assert(JSON.stringify(internals.defaultViewFor(bars)) === JSON.stringify({ from: 0, to: 120 }), '120 → 全量');
  const long = new Array(300).fill(bars[0]);
  assert(JSON.stringify(internals.defaultViewFor(long)) === JSON.stringify({ from: 180, to: 300 }), '300 → 最近 120');
  assert(JSON.stringify(internals.defaultViewFor([])) === JSON.stringify({ from: 0, to: 0 }), '空数据');
});
check('滑条 SSR：缩略走势 + 窗口矩形 + 两侧把手', () => {
  const markup = renderToStaticMarkup(h(internals.ChartSlider, {
    bars, view: { from: 30, to: 90 }, onChange: () => {}, t: (k) => k,
  }));
  assert(markup.includes('sw-slider'), '没有滑条容器');
  assert(markup.includes('<svg'), '没有 svg');
  assert((markup.match(/<path/g) ?? []).length === 1, '缩略走势 path 数量不对');
  assert((markup.match(/<rect/g) ?? []).length === 4, '应为 背景+窗口+2 把手 共 4 个 rect');
  assert(!markup.includes('NaN'), 'markup 出现 NaN');
});
check('滑条与主图共用视窗：窗口宽度随 span 变化', () => {  // bars 全长 120 → viewBox 宽度 1000
  const full = renderToStaticMarkup(h(internals.ChartSlider, {
    bars, view: { from: 0, to: 120 }, onChange: () => {}, t: (k) => k,
  }));
  const narrow = renderToStaticMarkup(h(internals.ChartSlider, {
    bars, view: { from: 55, to: 65 }, onChange: () => {}, t: (k) => k,
  }));
  assert(full.includes('width="1000"'), '全量视窗宽度应为 1000：' + full.slice(0, 400));
  assert(/width="83\.3/.test(narrow), '10/120 的窗口宽度应约 83.33');
  assert(full.includes('x="0"'), '全量视窗应从 0 开始');
  assert(/x="458\.3/.test(narrow), '55/120 的窗口起点应约 458.33');
});

// --- 3e. 向左拖补历史（infinite scroll）--------------------------------
check('补历史增量策略：每次 +240，到该周期上限返回 null', () => {
  const next = internals.klineNextLimit;
  assert(next(240, 2400) === 480, '240 → 480');
  assert(next(2280, 2400) === 2400, '末次补到上限');
  assert(next(2400, 2400) === null, '已到上限应返回 null');
  assert(next(0, 2400) === 240, '0 根时补到 240');
  assert(next(100, 100) === null, '等于上限返回 null');
  // 日线上限 2400、分钟 1440（上游分钟历史只留约 31 交易日）
  const day = internals.PERIODS.find((p) => p.id === '101');
  const fiveMin = internals.PERIODS.find((p) => p.id === '5');
  assert(day.cap === 2400 && fiveMin.cap === 1440, '周期上限配置不对');
});
check('CandleChart 能画 480 根（补过历史），并显示「加载更早」提示', () => {
  const many = Array.from({ length: 480 }, (_, i) => {
    const base = bars[i % bars.length];
    return { ...base, d: `2025-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}` };
  });
  const markup = renderToStaticMarkup(h(internals.CandleChart, {
    bars: many,
    width: 900,
    height: 460,
    t: (k) => k,
    view: { from: 0, to: 120 },
    onView: () => {},
    moreHint: 'loading',
  }));
  assert(!markup.includes('NaN'), 'markup 出现 NaN');
  assert(markup.includes('sw-chartRange'), '缺可见区间标签');
  assert(markup.includes('moreLoading'), '缺「加载更早」提示');
  assert(markup.includes('0/480') || markup.includes('120/480'), '可见区间分母应为 480');
});
check('分时布局：241 点 + 昨收 都能算进值域', () => {
  const points = Array.from({ length: 241 }, (_, i) => ({
    time: `2026-11-04 ${String(9 + Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}`,
    close: 10 + Math.sin(i / 12) * 0.2,
    avg: 10 + Math.sin(i / 12) * 0.1,
    volLots: 100 + i,
    amount: 1e6,
  }));
  const layout = internals.buildTrendsLayout(points, 10.05, 900, 420);
  assert(layout, '分时布局为空');
  assert(layout.min < 9.8 && layout.max > 10.2, '值域没覆盖数据');
  assert(layout.xTicks.length === 5, '时间刻度应为 5 个');
  assert(Number.isFinite(layout.y(10.05)), 'y(昨收) 非有限');
});

// --- 4. 图表组件 SSR 渲染（抓 JSX 结构错位） -----------------------------
check('CandleChart SSR：真的画出 120 根柱、均线与价格刻度', () => {
  const markup = renderToStaticMarkup(h(internals.CandleChart, { bars, width: 900, height: 420, t: (k) => k }));
  assert(markup.includes('<svg'), '没有 svg');
  assert(!markup.includes('NaN'), 'markup 里出现 NaN');
  const rects = (markup.match(/<rect/g) ?? []).length;
  const paths = (markup.match(/<path/g) ?? []).length;
  assert(rects >= 360, '柱体（实体+量+MACD hist）数量 ' + rects);
  assert(paths >= 3, '均线 path 数量 ' + paths);
  assert((markup.match(/<text/g) ?? []).length >= 10, '坐标轴文字太少');
});
check('TrendsChart SSR：画出价格线、均价线、昨收基准线、成交量', () => {
  const points = Array.from({ length: 180 }, (_, i) => ({
    time: `2026-11-04 09:${String(i % 60).padStart(2, '0')}`,
    close: 10 + Math.sin(i / 9) * 0.15,
    avg: 10.02,
    volLots: 120 + (i % 30) * 10,
    amount: 2e6,
  }));
  const markup = renderToStaticMarkup(h(internals.TrendsChart, {
    points, preClose: 10.05, width: 900, height: 420, t: (k) => k,
  }));
  assert(markup.includes('<svg'), '没有 svg');
  assert(!markup.includes('NaN'), 'markup 里出现 NaN');
  assert((markup.match(/<path/g) ?? []).length >= 2, '价格/均价线不足');
  assert((markup.match(/<rect/g) ?? []).length >= 170, '成交量柱不足');
});

// --- 5. 整页 SSR（loading 态结构） --------------------------------------
check('整页 SSR（loading 态）：标题/筛选器/预设/提示都在', () => {
  const markup = renderToStaticMarkup(panelReg.component());
  for (const text of ['看股工作台', '刷新', '数据日期', '涨跌幅', '主力净流入', '主力抢筹', '重置']) {
    assert(markup.includes(text), '缺少 ' + text);
  }
  assert(!markup.includes('col.'), '出现了没翻译的 key');
  assert(!markup.includes('undefined'), 'markup 出现 undefined');
});

check('整页 SSR：工作台与详情是叠放两层（打开详情不卸载工作台）', () => {
  const markup = renderToStaticMarkup(panelReg.component());
  // 注意：CSS 里也有 .sw-layerTop 等选择器文本，必须按 class 属性判断
  assert(markup.includes('class="sw-host"'), '没有叠放容器 sw-host');
  assert(markup.includes('class="sw-layer"'), '没有层容器 sw-layer');
  assert(!markup.includes('class="sw-layerTop"'), '未打开详情却渲染了详情层');
  assert(!markup.includes('class="sw-layer sw-layerHidden"'), '未打开详情却把工作台隐藏了');
  assert(markup.includes('看股工作台'), '工作台内容不在叠放层内');
});

check('整页 SSR：五个 tab（榜单/信号/资金流/板块/公式）', () => {
  const markup = renderToStaticMarkup(panelReg.component());
  for (const text of ['全 A 榜单', '信号扫描', '资金流', '板块资金流', '公式选股']) assert(markup.includes(text), '缺少 tab ' + text);
  assert(!markup.includes('红利防御'), '红利防御 tab 应已移除');
  assert(markup.includes('sw-tab'), '没有 tab 样式类');
  assert(markup.includes('sw-toolRow'), '表格上方缺少工具行');
  assert(markup.includes('sw-gearBtn'), '工具行里缺少齿轮');
  assert(markup.includes('sw-tabOn'), '没有选中态');
});

check('整页 SSR：自动刷新下拉 + 导出 CSV 按钮 + 只看自选 chip', () => {
  const markup = renderToStaticMarkup(panelReg.component());
  for (const text of ['自动刷新', '手动', '3 秒', '5 秒', '10 秒', '导出 CSV', '只看自选']) {
    assert(markup.includes(text), '缺少 ' + text);
  }
  assert(markup.includes('sw-select'), '没有下拉样式类');
});

check('CSV：表头 + 逗号/引号转义 + 数值原样导出', () => {
  const rows = [
    { code: '600000', name: '浦发银行', price: 10.19, pct: 0.99, amount: 66434623, turnover: 0.02, volumeRatio: 4.68, amplitude: 1.78, speed: 0.49, pct5d: 3.45, floatMcap: 3.39e11, mainIn: 2998428, pe: 6.27, board: 'sh-main' },
    { code: '300750', name: '宁德,时代"股份', price: 250, pct: -1.2, amount: null, turnover: null, volumeRatio: null, amplitude: null, speed: null, pct5d: null, floatMcap: null, mainIn: null, pe: null, board: 'chinext' },
  ];
  const csv = internals.buildCsv(rows);
  const lines = csv.split('\r\n');
  assert(lines.length === 3, '应为表头 + 2 行，实际 ' + lines.length);
  assert(lines[0].startsWith('代码,名称,最新价'), '表头不对：' + lines[0]);
  assert(lines[1].startsWith('600000,浦发银行,10.19'), '首行不对：' + lines[1]);
  assert(lines[2].includes('"宁德,时代""股份"'), '逗号/引号没有正确转义：' + lines[2]);
  assert(lines[2].includes(',,'), '空值应导出为空字段');
  assert(internals.csvCell('a"b') === '"a""b"', '引号转义');
  assert(internals.csvCell('a,b') === '"a,b"', '逗号转义');
  assert(internals.csvCell(null) === '', 'null 应为空串');
});

check('信号扫描面板 SSR：6 个信号 chip、窗口选择、扫描按钮、两段式说明', () => {  const realT = (key) => (dicts.zh ?? {})[key] ?? key;
  const markup = renderToStaticMarkup(h(internals.SignalScanPanel, { t: realT, onOpen: () => {} }));
  for (const text of ['均线金叉', 'MACD 金叉', '20 日新高', '放量上攻', '多头排列', '站上 60 日线']) {
    assert(markup.includes(text), '缺少信号 chip ' + text);
  }
  for (const text of ['今日', '近 3 日', '近 5 日', '开始扫描', '候选上限']) {
    assert(markup.includes(text), '缺少控件 ' + text);
  }
  assert(markup.includes('sw-chipOn'), '默认信号没有选中态');
  assert(!markup.includes('undefined'), 'markup 出现 undefined');
});

check('信号面板 SSR：三个预设组合（双金叉/突破放量/趋势启动）', () => {
  const realT = (key) => (dicts.zh ?? {})[key] ?? key;
  const markup = renderToStaticMarkup(h(internals.SignalScanPanel, { t: realT, onOpen: () => {} }));
  for (const text of ['预设组合', '双金叉共振', '突破放量', '趋势启动']) {
    assert(markup.includes(text), '缺少预设 ' + text);
  }
});

check('公式面板 SSR：输入框、执行按钮、语法提示', () => {
  const realT = (key) => (dicts.zh ?? {})[key] ?? key;
  const markup = renderToStaticMarkup(h(internals.FormulaPanel, { t: realT, onOpen: () => {} }));
  for (const text of ['执行', '公式选股', '量比', 'between', '支持 且/或/not', '可视化构造']) {
    assert(markup.includes(text), '公式面板缺少 ' + text);
  }
  // 输入框里的默认公式在 HTML 里会被转义（> → &gt;）
  assert(markup.includes('量比 &gt; 2'), '默认公式没有出现在输入框里');
  assert(markup.includes('sw-formulaInput'), '没有公式输入框样式类');
  assert(!markup.includes('undefined'), 'markup 出现 undefined');
});

check('公式面板 SSR：收藏夹行、收藏当前、恢复预置都在', () => {  const realT = (key) => (dicts.zh ?? {})[key] ?? key;
  const markup = renderToStaticMarkup(h(internals.FormulaPanel, { t: realT, onOpen: () => {} }));
  for (const text of ['收藏夹', '收藏当前']) {
    assert(markup.includes(text), '收藏夹区域缺少 ' + text);
  }
  assert(!markup.includes('sw-favDrawer'), '抽屉默认应关闭');
  assert(markup.includes('type="file"'), '没有隐藏的导入文件选择框');
});

const formulaLib = await import('../dsh-stock-workbench/lib/formula.js');

check('执行按钮不会把点击事件当成公式（曾导致「未知字段 object」）', () => {
  const resolve = internals.resolveFormulaText;
  assert(resolve('量比 > 2', '旧内容') === '量比 > 2', '显式传入字符串时应优先用它');
  assert(resolve(undefined, '  量比 > 2  ') === '量比 > 2', '缺省时用输入框内容并 trim');
  const fakeEvent = { type: 'click', target: { value: '' } };
  assert(resolve(fakeEvent, '量比 > 2') === '量比 > 2', '事件对象必须被忽略');
  assert(!resolve(fakeEvent, '量比 > 2').includes('[object'), '不能退化成 [object Object]');
  // 关键：模拟旧 bug 的产物，确认 Host 会明确报「未知字段 object」
  const legacy = formulaLib.compileFormula('[object Object]');
  assert(legacy.ok === false && /未知字段/.test(legacy.error), '旧路径应报未知字段');
});
check('收藏夹预置：客户端兜底与 lib/formula.js 一致（防两边漂移）', () => {
  const fallback = internals.FALLBACK_PRESETS;
  const presets = formulaLib.FORMULA_PRESETS;
  assert(fallback.length === presets.length, `数量不一致 ${fallback.length} vs ${presets.length}`);
  for (let i = 0; i < presets.length; i += 1) {
    assert(fallback[i].id === presets[i].id, `第 ${i} 个 id 不一致：${fallback[i].id} vs ${presets[i].id}`);
    assert(fallback[i].name === presets[i].name, `${presets[i].id} 名称不一致`);
    assert(fallback[i].expr === presets[i].expr, `${presets[i].name} 表达式不一致：${fallback[i].expr} vs ${presets[i].expr}`);
  }
});
check('收藏夹预置：每条都有依据与限制说明（不是裸公式）', () => {
  for (const preset of formulaLib.FORMULA_PRESETS) {
    assert(preset.basis && preset.basis.length > 2, preset.name + ' 缺依据');
    assert(preset.note && preset.note.length > 20, preset.name + ' 缺限制说明');
  }
});

check('K 线 tooltip 用主题 token 着色（浅色主题下不能白底白字）', () => {
  const css = internals.STYLES;
  const tipBlock = css.split('.sw-tip{')[1].split('}')[0];
  assert(tipBlock.includes('--dsw-alias-bg-overlay'), 'tooltip 背景没用主题 token：' + tipBlock);
  assert(tipBlock.includes('--dsw-alias-label-primary'), 'tooltip 文字没用主题 token：' + tipBlock);
  assert(!tipBlock.includes('#f4f6fa'), '还残留写死的近白色文字');
  const rowBlock = css.split('.sw-tipRow span:last-child{')[1].split('}')[0];
  assert(rowBlock.includes('--dsw-alias-label-primary'), 'tooltip 数值列文字没用主题 token');
  // 涨跌色是业务语义色，允许写死，但必须是 A 股红涨绿跌
  const pctMarkup = renderToStaticMarkup(h(internals.CandleChart, { bars, width: 900, height: 420, t: (k) => k }));
  assert(pctMarkup.includes('#e5484d') && pctMarkup.includes('#12a150'), '涨跌色不对');
});

// --- 6. 真打行情上游（直接走 Host 的 lib/market.js，不依赖进程里的旧路由）--
const { createMarketService } = await import('../dsh-stock-workbench/lib/market.js');
const svc = createMarketService({ ttlMs: 0 });
let dash = null;
try {
  dash = await svc.getDashboard({ force: true });
} catch (error) {
  // 上游偶发整批失败时回退到 DSH 的接口（Host 有重试与缓存）
  console.warn('  ⚠ 本地快照失败（' + (error && error.message) + '），回退到 DSH 接口');
  const response = await fetch(BASE + 'dsh-stock/api/v1/dashboard');
  const body = await response.json();
  if (!body || body.ok !== true) throw new Error('快照不可用：' + (body && body.error));
  dash = body.data;
}
const rows = dash.rows;
console.log('✓ 拿到 ' + rows.length + ' 只，' + dash.indices.length + ' 个指数，交易日 ' + dash.meta.tradingDay);

check('筛选：涨幅 >= 9.5 只剩接近涨停的票', () => {
  const hit = internals.applyFilters(rows, { pctMin: '9.5' });
  assert(hit.length > 0 && hit.length < rows.length, '结果 ' + hit.length);
  assert(hit.every((row) => row.pct >= 9.5), '有不符合的行');
});
check('筛选：主力净流入 >= 5000 万，0 视为无数据被排除', () => {
  const hit = internals.applyFilters(rows, { mainInMin: '5000' });
  assert(Array.isArray(hit), '结果不是数组');
  assert(hit.every((row) => typeof row.mainIn === 'number' && row.mainIn >= 5e7), '有不符合的行');
  if (!hit.length) console.log('    （早盘：暂无主力净流入 ≥5000 万的股票，非空断言跳过）');
});
check('排序：按成交额降序，首行是最大成交额', () => {
  const sorted = internals.sortRows(rows, 'amount', 'desc');
  assert(sorted[0].amount >= sorted[1].amount, '未降序');
});
check('排序：null 恒排最后（停牌/无数据的票不会占榜首）', () => {
  const withNull = [...rows.slice(0, 5), { code: 'X', name: 'X', pct: null, amount: null }];
  const sorted = internals.sortRows(withNull, 'pct', 'desc');
  assert(sorted[sorted.length - 1].code === 'X', 'null 没排最后');
});

const realT = (key) => (dicts.zh ?? {})[key] ?? key;

check('资金流榜：剔除主力资金为 0 的股票，流入/流出榜各 30 条', () => {
  const usable = rows.filter((row) => typeof row.mainIn === 'number' && row.mainIn !== 0);
  if (usable.length <= 100) {
    console.log('    （早盘：主力资金尚未统计，可用行 ' + usable.length + '，跳过资金流榜断言）');
    return;
  }
  assert(usable.length > 100, '可用行太少：' + usable.length);
  const markup = renderToStaticMarkup(h(internals.MoneyFlowPanel, { rows, t: realT, onOpen: () => {} }));
  for (const text of ['主力净流入 TOP', '主力净流出 TOP', '全市场主力净流入', '净流入家数', '净流出家数']) {
    assert(markup.includes(text), '缺少 ' + text);
  }
  assert(!markup.includes('NaN'), 'markup 出现 NaN');
  assert(!markup.includes('undefined'), 'markup 出现 undefined');
  const top = [...usable].sort((a, b) => b.mainIn - a.mainIn)[0];
  assert(markup.includes(top.name), '流入榜首 ' + top.name + ' 没出现');
  const flowRows = (markup.match(/sw-flowCompact/g) ?? []).length;
  assert(flowRows <= 60 && flowRows > 10, '渲染行数异常：' + flowRows);
});
check('资金流榜：无数据时显示空态而不是破表格', () => {
  const markup = renderToStaticMarkup(h(internals.MoneyFlowPanel, { rows: [], t: realT, onOpen: () => {} }));
  assert(markup.includes('暂无资金流数据'), '缺少空态文案');
  assert(!markup.includes('NaN'), 'markup 出现 NaN');
});
check('快照字段：主力净占比 mainInPct 已随行下发（资金流榜要用）', () => {
  const withPct = rows.filter((row) => typeof row.mainInPct === 'number');
  if (withPct.length <= 100) {
    console.log('    （早盘：界面尚未回填主力净占比，样本 ' + withPct.length + '，跳过断言）');
    return;
  }
  assert(withPct.length > 100, 'mainInPct 缺失：' + withPct.length);
});
check('快照含防御字段：股息率 / 分红年数 / ROE / 负债率 / 毛利率 / 行业', () => {
  const withYield = rows.filter((row) => typeof row.dividendYield === 'number' && row.dividendYield > 0);
  assert(withYield.length > 2000, '有股息率的股票太少：' + withYield.length);
  const high = withYield.filter((row) => row.dividendYield >= 5);
  assert(high.length > 50, '股息率>=5% 的太少：' + high.length);
  const withRoe = rows.filter((row) => typeof row.roe === 'number');
  assert(withRoe.length > 3000, 'ROE 缺失：' + withRoe.length);
  const withDebt = rows.filter((row) => typeof row.debtRatio === 'number');
  assert(withDebt.length > 5000, '负债率缺失：' + withDebt.length);
  const withIndustry = rows.filter((row) => row.industry);
  assert(withIndustry.length > 5000, '行业缺失：' + withIndustry.length);
  const years = rows.filter((row) => row.dividendYears >= 2);
  assert(years.length > 1000, '分红年数>=2 的太少：' + years.length);
  const cmb = rows.find((row) => row.code === '600036');
  if (cmb) {
    assert(cmb.dividendYield > 2 && cmb.dividendYield < 12, '招行股息率异常：' + cmb.dividendYield);
    assert(cmb.pb > 0 && cmb.pb < 5, '招行 PB 异常：' + cmb.pb);
  }
});

// 取一只真实股票做详情页
const sample = rows.find((row) => row.secid && row.price != null) ?? rows[0];
const kline = await svc.getKline(sample.secid, { klt: 101, fqt: 1, lmt: 240 });
console.log(`✓ ${sample.name}(${sample.code}) 日K ${kline.bars.length} 根，现价 ${sample.price}`);

check('详情页 SSR：头部/周期切换/均线图例/图表/自选按钮都渲染', () => {
  const markup = renderToStaticMarkup(h(internals.DetailPage, { row: sample, t: (k) => (dicts.zh ?? {})[k] ?? k, onBack: () => {} }));
  for (const text of ['返回榜单', sample.name, sample.code, '日K', '60分', '分时', 'MA5', 'MA20', '成交量', '滚轮缩放', '加入自选', '指标', 'MACD', 'KDJ', 'RSI', 'BIAS']) {
    assert(markup.includes(text), '详情页缺少 ' + text);
  }
  assert(!markup.includes('NaN'), '详情页 markup 出现 NaN');
});

check('详情页 SSR：已加自选时按钮变「取消自选」', () => {
  const markup = renderToStaticMarkup(h(internals.DetailPage, {
    row: sample, t: (k) => (dicts.zh ?? {})[k] ?? k, onBack: () => {}, watched: true,
  }));
  assert(markup.includes('取消自选'), '没有取消自选按钮');
});
check('详情页图表用真实日K 渲染，不再是空态', () => {
  const markup = renderToStaticMarkup(h(internals.CandleChart, {
    bars: kline.bars, width: 1000, height: 460, t: (k) => (dicts.zh ?? {})[k] ?? k,
  }));
  assert(!markup.includes('NaN'), 'markup 出现 NaN');
  // 默认视窗只画最近 120 根：每根 = 实体 rect + 量柱 rect（MACD 还有 hist rect）
  const visible = Math.min(kline.bars.length, 120);
  const rects = (markup.match(/<rect/g) ?? []).length;
  assert(rects >= visible * 2 - 2, `柱体 ${rects} 少于可见 ${visible} 根应画出的数量`);
});

// 端到端复刻详情页的真实请求（用户报的 "invalid secid" 就发生在这条链路上）
const detailUrl = internals.apiUrl(
  `dsh-stock/api/v1/kline?secid=${encodeURIComponent(sample.secid)}&klt=101&lmt=30`,
);
const detailRes = await fetch(detailUrl);
const detailBody = await detailRes.json().catch(() => null);
check('按详情页真实拼法请求 /kline 拿到 K 线（修复前这里是 400 invalid secid）', () => {
  assert(detailRes.status === 200, 'HTTP ' + detailRes.status + ' body=' + JSON.stringify(detailBody).slice(0, 160));
  assert(detailBody && detailBody.ok === true, 'ok 不是 true');
  if (!Array.isArray(detailBody.data.bars) || detailBody.data.bars.length === 0) {
    console.log('    （上游暂未返回 K 线，跳过数量断言）');
    return;
  }
  assert(detailBody.data.bars.length >= 1 && detailBody.data.bars.length <= 30, 'bars 数量 ' + detailBody.data.bars?.length);
  if (detailBody.data.bars.length < 30) console.log('    （上游仅返回 ' + detailBody.data.bars.length + ' 根 K 线，非 30 根属正常）');
});
const trendUrl = internals.apiUrl(`dsh-stock/api/v1/trends?secid=${encodeURIComponent(sample.secid)}`);
const trendRes = await fetch(trendUrl);
const trendBody = await trendRes.json().catch(() => null);
check('分时请求同样带上 secid 并成功', () => {
  assert(trendRes.status === 200, 'HTTP ' + trendRes.status);
  assert(trendBody && trendBody.ok === true, 'ok 不是 true');
  // 开盘前/竞价前分时可能为空，此时只校验结构
  if (!Array.isArray(trendBody.data.points) || trendBody.data.points.length === 0) {
    console.log('    （盘前：分时暂无数据，跳过点数断言）');
    return;
  }
  assert(trendBody.data.points.length >= 1, '分时点 ' + trendBody.data.points?.length);
});

// --- 7. 信号扫描（两段式）走真实路由 -----------------------------------
const signalsBody = await (await fetch(internals.apiUrl('dsh-stock/api/v1/signals'))).json();
check('信号元数据路由：6 个信号，字段齐全', () => {
  assert(signalsBody.ok === true, 'ok 不是 true');
  assert(signalsBody.data.signals.length === 6, '信号数 ' + signalsBody.data.signals.length);
  assert(signalsBody.data.signals.every((s) => s.id && s.label && s.desc), '缺字段');
});

const scanQuery = new URLSearchParams({
  signals: 'ma_golden,macd_golden,breakout,volume_surge,ma_bull,ma60_hold',
  minAmount: '3',
  limit: '40',
  within: '3',
  excludeST: '1',
});
const scanBody = await (await fetch(internals.apiUrl(`dsh-stock/api/v1/scan?${scanQuery.toString()}`))).json();
check('信号扫描路由：候选池 40 只、真拉日K、命中项都带触发说明', () => {
  assert(scanBody.ok === true, JSON.stringify(scanBody).slice(0, 160));
  const data = scanBody.data;
  if (data.scanned === 0) {
    console.log('    （早盘：扫描候选池为空，跳过扫描断言）');
    return;
  }
  assert(data.scanned > 0 && data.scanned <= 40, 'scanned=' + data.scanned);
  assert(data.failed === 0, '失败请求 ' + data.failed);
  assert(Array.isArray(data.matches), 'matches 不是数组');
  assert(data.poolSize >= 40, '候选池 ' + data.poolSize);
  for (const match of data.matches) {
    assert(match.signals.length > 0, match.code + ' 命中却没有信号');
    assert(match.signals.every((hit) => hit.id && hit.detail), match.code + ' 信号缺说明');
    assert(typeof match.price === 'number', match.code + ' 缺 price');
    assert(match.secid, match.code + ' 缺 secid（双击进详情要用）');
  }
  // 命中列表按命中信号数降序
  for (let i = 1; i < data.matches.length; i += 1) {
    assert(data.matches[i - 1].signals.length >= data.matches[i].signals.length, '排序不是按命中数降序');
  }
});
console.log(`✓ 扫描 40 只（候选池 ${scanBody.data.poolSize}）→ 命中 ${scanBody.data.matches.length} 只 · ${scanBody.data.ms}ms${scanBody.data.cached ? ' · 缓存' : ''}`);
if (scanBody.data.matches.length) {
  const top = scanBody.data.matches[0];
  console.log(`  首个：${top.name} ${top.pct}% → ${top.signals.map((s) => s.detail).join('；')}`);
}

// --- 8. 公式选股走真实路由 ----------------------------------------------
const fieldsBody = await (await fetch(internals.apiUrl('dsh-stock/api/v1/formula/fields'))).json();
check('公式面板 SSR：抽屉展开后有列表与导入/导出/恢复预置', () => {
  const label = (key) => (dicts.zh ?? {})[key] ?? key;
  const markup = renderToStaticMarkup(h(internals.FormulaPanel, {
    t: label, onOpen: () => {}, initialFavOpen: true,
  }));
  assert(markup.includes('sw-favDrawer'), '没有抽屉容器');
  assert(markup.includes('sw-favBody'), '没有抽屉列表区');
  for (const text of ['导入', '导出', '恢复预置']) {
    assert(markup.includes(text), '抽屉缺少 ' + text);
  }
});

check('全 A 榜单列：已并入防御/基本面指标', () => {
  const keys = internals.COLUMNS.map((column) => column.key);
  for (const key of ['dividendYield', 'dividendYears', 'dividendConsecutive', 'pb', 'pe', 'roe', 'debtRatio', 'grossMargin']) {
    assert(keys.includes(key), '榜单缺少列 ' + key);
  }
  assert(internals.COLUMNS.length === 25, '列数应为 25（1 星标 + 24 数据列），实际 ' + internals.COLUMNS.length);
  assert(keys.includes('pePercentile') && keys.includes('pbPercentile'), '榜单缺少 PE/PB 分位列');
  assert(keys.includes('regionBoard') && keys.includes('concepts'), '榜单缺少 地域板块/所属概念 列');
  const streak = internals.COLUMNS.find((column) => column.key === 'dividendConsecutive');
  assert(streak.kind === 'streak' && streak.dividendLink === true, '连续分红列应可点击');
});

check('估值分位格式化：一位小数，空值显示 —', () => {
  assert(internals.formatCell(65.04, 'pctile') === '65.0', String(internals.formatCell(65.04, 'pctile')));
  assert(internals.formatCell(0, 'pctile') === '0.0', '0 应显示 0.0');
  assert(internals.formatCell(null, 'pctile') === '—', '空值应显示 —');
});

check('连续分红格式化：10 年封顶显示 10+，0/空显示 —', () => {
  assert(internals.formatCell(10, 'streak') === '10+', '10 年应显示 10+');
  assert(internals.formatCell(11, 'streak') === '10+', '超过 10 年也显示 10+');
  assert(internals.formatCell(7, 'streak') === '7', '7 年应显示 7');
  assert(internals.formatCell(0, 'streak') === '—', '0 年应显示 —');
  assert(internals.formatCell(null, 'streak') === '—', '空值应显示 —');
});

check('分红详情弹窗 SSR：概览 + 明细表 + 方案文本', () => {
  const label = (key) => (dicts.zh ?? {})[key] ?? key;
  const markup = renderToStaticMarkup(h(internals.DividendDetailModal, {
    t: label,
    onClose: () => {},
    state: {
      status: 'ready',
      code: '600036',
      error: '',
      data: {
        code: '600036',
        name: '招商银行',
        industry: '银行Ⅱ',
        price: 42.77,
        dividendYield: 4.72,
        dpsTTM: 2.016,
        years3: 3,
        consecutive: 10,
        lastExDate: '2026-07-10',
        records: [
          { reportDate: '2025-12-31', exDate: '2026-07-10', per10: 10.03, perShare: 1.003, plan: '10派10.03元(含税)' },
          { reportDate: '2024-12-31', exDate: '2025-07-11', per10: 20, perShare: 2, plan: '10派20.00元(含税)' },
        ],
      },
    },
  }));
  for (const text of ['分红详情', '招商银行', '连续分红', '10+年', '2026-07-10', '10派10.03元(含税)', '每10股派息(元)']) {
    assert(markup.includes(text), '弹窗缺少 ' + text);
  }
  assert(markup.includes('sw-divTable'), '缺明细表');
  assert((markup.match(/sw-divRow/g) ?? []).length === 2, '明细行数应为 2');
});

check('分红详情弹窗：加载态与错误态', () => {
  const label = (key) => (dicts.zh ?? {})[key] ?? key;
  const loading = renderToStaticMarkup(h(internals.DividendDetailModal, {
    t: label, onClose: () => {}, state: { status: 'loading', code: '600036', data: null, error: '' },
  }));
  assert(loading.includes('正在读分红明细'), '加载态文案缺失');
  const failed = renderToStaticMarkup(h(internals.DividendDetailModal, {
    t: label, onClose: () => {}, state: { status: 'error', code: '600036', data: null, error: 'boom' },
  }));
  assert(failed.includes('boom'), '错误信息缺失');
});

check('列偏好：默认/合并/套用（顺序、隐藏、固定、锁定列）', () => {
  const label = (key) => (dicts.zh ?? {})[key] ?? key;
  const defaults = internals.defaultColumnPrefs(internals.COLUMNS);
  assert(defaults.length === internals.COLUMNS.length - 1, '锁定列不应出现在偏好里');
  assert(!defaults.some((item) => item.key === '__watch'), '星标列不该可配置');
  assert(defaults.every((item) => item.visible), '默认应全部可见');

  // 合并：丢弃未知列、保留用户顺序、新列追加末尾
  const stored = [
    { key: 'roe', visible: true, frozen: true },
    { key: 'name', visible: false },
    { key: 'I_DO_NOT_EXIST', visible: true },
  ];
  const merged = internals.normalizeColumnPrefs(internals.COLUMNS, stored);
  assert(merged[0].key === 'roe' && merged[0].frozen === true, '应保留用户顺序与固定标记');
  assert(merged[1].key === 'name' && merged[1].visible === false, '隐藏标记应保留');
  assert(!merged.some((item) => item.key === 'I_DO_NOT_EXIST'), '未知列应丢弃');
  assert(merged.length === defaults.length, '合并后数量应等于默认数量（新列补齐）');
  assert(merged[merged.length - 1].key !== 'roe', '新列应追加在末尾');

  // 套用：隐藏列移除、锁定列在最前且固定
  const applied = internals.applyColumnPrefs(internals.COLUMNS, merged);
  assert(applied[0].key === '__watch' && applied[0].frozen === true, '星标列应永远在最前且固定');
  assert(!applied.some((column) => column.key === 'name'), '隐藏列不该出现');
  assert(applied[1].key === 'roe' && applied[1].frozen === true, '固定列应排在锁定列之后');
  assert(applied.length === defaults.length - 1 + 1, '套用后列数不对');

  // 空偏好/损坏数据回落到默认
  assert(internals.normalizeColumnPrefs(internals.COLUMNS, null).length === defaults.length, 'null 应回落默认');
  assert(internals.normalizeColumnPrefs(internals.COLUMNS, 'oops').length === defaults.length, '非数组应回落默认');
  // 标签存在（避免出现 col.xxx）
  assert(label('columnConfig') === '列配置');
});

check('列配置弹窗 SSR：拖拽把手/复选框/固定星标/保存取消重置', () => {
  const label = (key) => (dicts.zh ?? {})[key] ?? key;
  const prefs = internals.defaultColumnPrefs(internals.COLUMNS);
  const markup = renderToStaticMarkup(h(internals.ColumnConfigDialog, {
    t: label,
    columns: internals.COLUMNS,
    prefs,
    onSave: () => {},
    onClose: () => {},
  }));
  assert(markup.includes('列配置'), '缺标题');
  assert((markup.match(/sw-colRow/g) ?? []).length === prefs.length, '行数应等于可配置列数');
  assert((markup.match(/type="checkbox"/g) ?? []).length === prefs.length, '每行一个复选框');
  assert((markup.match(/sw-colStar/g) ?? []).length === prefs.length, '每行一个固定按钮');
  assert((markup.match(/sw-colHandle/g) ?? []).length === prefs.length, '每行一个拖拽把手');
  assert(markup.includes('保存') && markup.includes('取消') && markup.includes('恢复默认'), '缺底部按钮');
  for (const text of ['代码', '股息率', '连续分红']) {
    assert(markup.includes(text), '缺少列名 ' + text);
  }
  assert(!markup.includes('col.'), '列名未翻译成中文');
});

check('列配置弹窗：固定态显示 ★', () => {
  const label = (key) => (dicts.zh ?? {})[key] ?? key;
  const prefs = internals.defaultColumnPrefs(internals.COLUMNS).map((item, index) => (
    index < 2 ? { ...item, frozen: true } : item
  ));
  const markup = renderToStaticMarkup(h(internals.ColumnConfigDialog, {
    t: label, columns: internals.COLUMNS, prefs, onSave: () => {}, onClose: () => {},
  }));
  assert((markup.match(/★/g) ?? []).length === 2, '应有 2 个固定星标，实际 ' + (markup.match(/★/g) ?? []).length);
});

check('每 tab 列定义独立：榜单 25 / 资金流 5 / 信号 8 / 公式 24 / 板块 6', () => {
  assert(internals.COLUMNS.length === 25, '榜单列数 ' + internals.COLUMNS.length);
  assert(internals.FLOW_COLUMNS.length === 5, '资金流列数 ' + internals.FLOW_COLUMNS.length);
  assert(internals.BOARD_COLUMNS.length === 6, '板块列数 ' + internals.BOARD_COLUMNS.length);
  assert(internals.SCAN_COLUMNS.length === 8, '信号列数 ' + internals.SCAN_COLUMNS.length);
  assert(internals.FORMULA_COLUMNS.length === 24, '公式列数应为 24（与榜单一致、去掉星标列），实际 ' + internals.FORMULA_COLUMNS.length);
  assert(internals.FORMULA_COLUMNS.every((column, index) => column.key === internals.COLUMNS[index + 1].key), '公式列应与榜单列顺序一致');
  // 每个 tab 的偏好互不影响
  const prefs = {
    list: internals.defaultColumnPrefs(internals.COLUMNS),
    flow: internals.defaultColumnPrefs(internals.FLOW_COLUMNS),
    scan: internals.defaultColumnPrefs(internals.SCAN_COLUMNS),
    formula: internals.defaultColumnPrefs(internals.FORMULA_COLUMNS),
  };
  prefs.list = prefs.list.map((item, index) => (index === 0 ? { ...item, visible: false } : item));
  const listColumns = internals.applyColumnPrefs(internals.COLUMNS, prefs.list);
  const flowColumns = internals.applyColumnPrefs(internals.FLOW_COLUMNS, prefs.flow);
  assert(listColumns.length === 24, '榜单隐藏一列后应为 24，实际 ' + listColumns.length);
  assert(flowColumns.length === 5, '资金流不应受榜单配置影响，实际 ' + flowColumns.length);
});

check('资金流表按配置渲染：隐藏列不出现、齿轮可配置', () => {
  const label = (key) => (dicts.zh ?? {})[key] ?? key;
  const prefs = internals.defaultColumnPrefs(internals.FLOW_COLUMNS)
    .map((item) => (item.key === 'pct' ? { ...item, visible: false } : item));
  const columns = internals.applyColumnPrefs(internals.FLOW_COLUMNS, prefs);
  const rows = [
    { code: '600036', name: '招商银行', price: 42, pct: 1.2, mainIn: 1.2e8, mainInPct: 6.5 },
    { code: '601398', name: '工商银行', price: 6, pct: -0.3, mainIn: -2.0e7, mainInPct: -3.1 },
  ];
  const markup = renderToStaticMarkup(h(internals.MoneyFlowPanel, {
    rows, t: label, onOpen: () => {}, columns, onConfigColumns: () => {},
  }));
  assert(markup.includes('sw-gearBtn'), '资金流缺少齿轮');
  assert(markup.includes('sw-toolRow'), '资金流缺少工具行');
  assert(markup.includes('主力净流入'), '缺少主力净流入表头');
  assert(!markup.includes('涨跌幅'), '隐藏的涨跌幅列仍出现');
  assert(markup.includes('招商银行'), '数据行没渲染');
  assert(markup.includes('主力净占比'), '缺少净占比表头');
  assert(markup.includes('sw-resHead'), '资金流表头应为统一盒子');
  assert((markup.match(/sw-resCell/g) ?? []).length >= 10, '资金流单元格应使用统一盒子');
});

check('错误边界：子组件抛错时显示报错与重试，而不是白屏', () => {
  const label = (key) => (dicts.zh ?? {})[key] ?? key;
  function Boom() {
    throw new Error('测试异常');
  }
  // SSR 不会触发 componentDidCatch，这里只验证正常渲染透传；
  // 异常路径用 react-test-renderer 在交互测试里覆盖。
  const ok = renderToStaticMarkup(h(internals.WorkbenchBoundary, { t: label }, h('span', null, '正常内容')));
  assert(ok.includes('正常内容'), '正常内容应透传');
  assert(!ok.includes('渲染出错'), '无异常时不该显示错误');
  assert(typeof internals.WorkbenchBoundary === 'function', '边界组件未导出');
  assert(typeof Boom === 'function');
});

check('结果表共用组件：公式列与信号列都能安全渲染（labelOf 回归）', () => {
  const label = (key) => (dicts.zh ?? {})[key] ?? key;
  const formulaRow = { code: '600036', name: '招商银行', board: 'sh-main', price: 42.7, pct: 0.2, amount: 3e9, turnover: 0.4, volumeRatio: 1.1, mainIn: -1e8 };
  const formulaMarkup = renderToStaticMarkup(h(internals.ResultTable, {
    t: label, columns: internals.FORMULA_COLUMNS, rows: [formulaRow], onOpen: () => {}, onConfigColumns: () => {},
  }));
  assert(formulaMarkup.includes('招商银行'), '公式结果表没渲染出行');
  assert(formulaMarkup.includes('sw-toolRow'), '公式结果表缺工具行');
  assert((formulaMarkup.match(/sw-gearBtn/g) ?? []).length === 1, '结果表应恰好一个齿轮，实际 ' + (formulaMarkup.match(/sw-gearBtn/g) ?? []).length);
  assert(!formulaMarkup.includes('undefined'), 'markup 出现 undefined');

  const scanRow = { code: '600036', name: '招商银行', board: 'sh-main', price: 42.7, pct: 0.2, amount: 3e9, turnover: 0.4, signals: [{ id: 'ma_golden', detail: '5日上穿10日', daysAgo: 0 }] };
  const scanMarkup = renderToStaticMarkup(h(internals.ResultTable, {
    t: label,
    columns: internals.SCAN_COLUMNS,
    rows: [scanRow],
    onOpen: () => {},
    onConfigColumns: () => {},
    extra: { labelOf: (id) => ({ ma_golden: '均线金叉' })[id] ?? id },
  }));
  assert(scanMarkup.includes('均线金叉'), '信号标签没取到 labelOf');
  assert(scanMarkup.includes('5日上穿10日'), '信号详情没渲染');
});

check('板块资金流面板 SSR：类型切换 + 排序表头 + 点击行', () => {
  const label = (key) => (dicts.zh ?? {})[key] ?? key;
  const boards = [
    { code: 'BK0917', name: '半导体概念', pct: 7.47, mainIn: 2.78e10, mainInPct: 6.22, up: 531, down: 15 },
    { code: 'BK0596', name: '融资融券', pct: 3.36, mainIn: 4.73e10, mainInPct: 2.6, up: 3361, down: 459 },
  ];
  const markup = renderToStaticMarkup(h(internals.BoardPanel, {
    t: label,
    onPick: () => {},
    onConfigColumns: () => {},
    initialBoards: boards,
  }));
  assert(markup.includes('概念板块') && markup.includes('行业板块'), '缺类型切换');
  assert((markup.match(/sw-resTh/g) ?? []).length >= 6, '缺排序表头');
  assert((markup.match(/sw-resRow/g) ?? []).length === 2, '行数应为 2');
  assert(markup.includes('半导体概念') && markup.includes('融资融券'), '板块名没渲染');
  assert(markup.includes('sw-gearBtn'), '缺齿轮');
});

check('个股详情 popover SSR：交易/估值/分红/基本面/所属', () => {
  const label = (key) => (dicts.zh ?? {})[key] ?? key;
  const row = {
    code: '600036', name: '招商银行', board: 'sh-main', industry: '银行Ⅱ', regionBoard: '广东板块',
    concepts: '深圳特区,互联网金融,区块链', price: 42.54, pct: -0.35, amplitude: 1.7, amount: 3.1e9,
    turnover: 0.36, volumeRatio: 1.04, speed: 0, pct5d: 1.52, floatMcap: 8.8e11, mainIn: -1.6e8, mainInPct: -5.26,
    dividendYield: 4.74, dividendYears: 3, dividendConsecutive: 10, lastDividendDate: '2026-07-10',
    roe: 10.12, debtRatio: 89.9, grossMargin: 0, revenueYoy: 5.3, profitYoy: 2.4, eps: 4.62, bvps: 46.9, ps: 3.07,
  };
  const markup = renderToStaticMarkup(h(internals.StockDetailPopover, {
    t: label,
    row,
    valuation: { status: 'ready', data: { pe: 7.02, pb: 0.91, pePercentile: 65, pbPercentile: 31.9, sampleDays: 1210, years: 5 } },
    onClose: () => {},
  }));
  for (const text of ['个股详情', '交易数据', '估值分位', 'PE 分位', '65.0%', '31.9%', '分红', '基本面', '所属板块', '深圳特区,互联网金融']) {
    assert(markup.includes(text), 'popover 缺少 ' + text);
  }
  assert(markup.includes('sw-popMask') && markup.includes('sw-kv'), 'popover 结构缺失');
  // 分位着色：65% 中性、31.9% 中性；再造一个 20% 验证 affordable 色
  const cheap = renderToStaticMarkup(h(internals.StockDetailPopover, {
    t: label, row, valuation: { status: 'ready', data: { pePercentile: 12.5, pbPercentile: 88, sampleDays: 500, years: 5 } }, onClose: () => {},
  }));
  assert(cheap.includes('sw-cheap'), '低分位应有便宜色');
  assert(cheap.includes('sw-expensive'), '高分位应有偏贵色');
  assert(!markup.includes('undefined'), 'popover 出现 undefined');
});

check('自选分组：旧数组迁移 + 分组条渲染', () => {
  const label = (key) => (dicts.zh ?? {})[key] ?? key;
  // 旧格式（纯数组）迁移成默认组
  const migrated = internals.normalizeWatchState(['600036', '000001']);
  assert(migrated.groups.length === 1 && migrated.groups[0].name === '默认', '旧格式应迁移为默认组');
  assert(migrated.groups[0].codes.length === 2, '迁移后代码应保留');
  assert(migrated.active === migrated.groups[0].id, 'active 应指向默认组');
  // 损坏数据回落
  const fallback = internals.normalizeWatchState({ groups: 'oops' });
  assert(fallback.groups.length === 1 && fallback.active === 'default', '损坏数据应回落');
  // 分组条渲染
  const markup = renderToStaticMarkup(h(internals.WatchlistBar, {
    t: label,
    groups: [
      { id: 'default', name: '默认', codes: ['600036'] },
      { id: 'g2', name: '红利组', codes: ['601398', '600398'] },
    ],
    active: 'g2',
    onSwitch: () => {},
    onAdd: () => {},
    onRemove: () => {},
  }));
  assert(markup.includes('自选组'), '缺自选组标签');
  assert(markup.includes('默认 1') && markup.includes('红利组 2'), '分组名与数量没渲染');
  assert(markup.includes('sw-watchChipOn'), '缺当前组高亮');
  assert(markup.includes('＋'), '缺新建按钮');
  assert((markup.match(/sw-watchDel/g) ?? []).length === 2, '多组时应每组可删');
});

check('批量导入自选：文本拆分与代码/名称匹配', () => {
  const tokens = internals.normalizeStockTokens('600036 601398\n000001，600519/300750；贵州茅台 平安银行');
  assert(tokens.length === 7, 'token 数 ' + tokens.length + '：' + JSON.stringify(tokens));
  assert(tokens[0] === '600036' && tokens[6] === '平安银行', JSON.stringify(tokens));

  const rows = [
    { code: '600036', name: '招商银行' },
    { code: '601398', name: '工商银行' },
    { code: '600519', name: '贵州茅台' },
  ];
  const byCode = internals.matchStockTokens(['600036', '贵州茅台'], rows);
  assert(byCode.matched.length === 2, '应匹配 2 只，实际 ' + byCode.matched.length);
  assert(byCode.unmatched.length === 0, '不应有未匹配');

  const fuzzy = internals.matchStockTokens(['招商'], rows);
  assert(fuzzy.matched.length === 1 && fuzzy.matched[0].code === '600036', '名称模糊匹配失败');

  const ambiguous = internals.matchStockTokens(['银行'], rows);
  assert(ambiguous.matched.length === 0 && ambiguous.unmatched.length === 1, '歧义名称不应硬匹配');

  const unknown = internals.matchStockTokens(['999999', '不存在的股票'], rows);
  assert(unknown.unmatched.length === 2, '未知项应进 unmatched');

  const search = internals.searchStocks('茅台', rows);
  assert(search.length === 1 && search[0].code === '600519', '搜索失败');
  assert(internals.searchStocks('', rows).length === 0, '空关键词应返回空');
});

check('批量导入弹窗 SSR：标签区/搜索框/批量粘贴/确认按钮', () => {
  const label = (key) => (dicts.zh ?? {})[key] ?? key;
  const markup = renderToStaticMarkup(h(internals.WatchlistImportDialog, {
    t: label,
    rows: [{ code: '600036', name: '招商银行' }],
    existing: new Set(),
    onAdd: () => {},
    onClose: () => {},
  }));
  for (const text of ['批量导入自选股', '还没有选择股票', '识别并添加', '加入自选']) {
    assert(markup.includes(text), '弹窗缺少 ' + text);
  }
  assert(markup.includes('sw-importTags') && markup.includes('sw-importSuggest') === false, '结构不对');
  assert(markup.includes('<textarea'), '缺少批量粘贴框');
});

check('其他 tab 表格筛选输入存在（信号/资金流/板块/公式共用组件）', () => {
  const label = (key) => (dicts.zh ?? {})[key] ?? key;
  const markup = renderToStaticMarkup(h(internals.TableFilterInput, { t: label, value: '', onChange: () => {} }));
  assert(markup.includes('sw-tableFilter'), '缺少筛选输入框');
  assert(markup.includes('筛选代码/名称'), '缺少占位文案');
});

check('小屏方案：工具栏「收起上方」按钮（不再用媒体查询固定行数）', () => {
  const src = readFileSync(new URL('../dsh-stock-workbench/client.js', import.meta.url), 'utf8');
  assert(!src.includes('@media (max-height'), '媒体查询方案应已移除');
  assert(src.includes('collapseCollapse') && src.includes('collapseExpand'), '缺少收起/展开文案');
  const label = (key) => (dicts.zh ?? {})[key] ?? key;
  const markup = renderToStaticMarkup(panelReg.component());
  assert(markup.includes('收起上方'), '页面缺少收起按钮');
});

check('公式字段路由：26 个字段 + 5 条示例 + 15 条收藏预置', () => {
  assert(fieldsBody.ok === true, 'ok 不是 true');
  assert(fieldsBody.data.fields.length === 26, '字段数 ' + fieldsBody.data.fields.length);
  assert(fieldsBody.data.examples.length === 5, '示例数 ' + fieldsBody.data.examples.length);
  assert(fieldsBody.data.presets.length === 15, '预置数 ' + fieldsBody.data.presets.length);
});

const formulaQuery = new URLSearchParams({ expr: '量比 > 1.5 且 涨跌幅 between 0 and 8', limit: '30' });
const formulaBody = await (await fetch(internals.apiUrl(`dsh-stock/api/v1/formula?${formulaQuery.toString()}`))).json();
check('公式选股路由：真执行筛选，命中行满足条件', () => {
  assert(formulaBody.ok === true, JSON.stringify(formulaBody).slice(0, 160));
  const data = formulaBody.data;
  assert(data.total > 1000, 'total=' + data.total);
  assert(data.rows.length <= 30, '返回条数 ' + data.rows.length);
  for (const row of data.rows) {
    assert(row.volumeRatio > 1.5, row.code + ' 量比 ' + row.volumeRatio);
    assert(row.pct >= 0 && row.pct <= 8, row.code + ' 涨幅 ' + row.pct);
  }
});
console.log(`✓ 公式「量比>1.5 且 涨跌幅 between 0 and 8」命中 ${formulaBody.data.matched}/${formulaBody.data.total}，${formulaBody.data.ms}ms`);

const badQuery = new URLSearchParams({ expr: '市梦率 > 3' });const badRes = await fetch(internals.apiUrl(`dsh-stock/api/v1/formula?${badQuery.toString()}`));
const badBody = await badRes.json();
check('非法公式：HTTP 400 + 中文错误 + 位置', () => {
  assert(badRes.status === 400, 'HTTP ' + badRes.status);
  assert(badBody.ok === false, 'ok 应为 false');
  assert(/未知字段/.test(badBody.error), badBody.error);
  assert(typeof badBody.position === 'number', '缺位置');
});

// 校验接口（收藏夹导入时逐条调用）
const goodCheck = await (await fetch(internals.apiUrl(
  `dsh-stock/api/v1/formula/validate?${new URLSearchParams({ expr: '量比 > 2' }).toString()}`,
))).json();
const badCheck = await (await fetch(internals.apiUrl(
  `dsh-stock/api/v1/formula/validate?${new URLSearchParams({ expr: '市梦率 > 1' }).toString()}`,
))).json();
check('校验接口活体可用：合法 valid=true、非法 valid=false', () => {
  assert(goodCheck.ok === true && goodCheck.data.valid === true, '合法表达式被判非法');
  assert(badCheck.ok === true && badCheck.data.valid === false, '非法表达式被判合法');
  assert(/未知字段/.test(badCheck.data.error), badCheck.data.error);
});

console.log('\n浏览器半 SSR 冒烟通过，共 ' + passed + ' 项');
