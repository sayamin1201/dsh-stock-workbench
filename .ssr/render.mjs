/**
 * 浏览器半渲染冒烟：真 React 18 + jsdom + 真 Host 路由数据。
 *
 * 目的不是"好看"，是抓住 JSX 结构错位 / hooks 顺序 / 组件内报错 / 双击进详情
 * 这类 `node --check` 抓不到的问题。图表用固定的可视区尺寸（jsdom 无布局），
 * 所以 SVG 里的元素也会真的生成。
 *
 * 运行：node .ssr/render.mjs   （需先在 .ssr 里 pnpm add react react-dom jsdom）
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';

const requireFromSsr = createRequire(new URL('./package.json', import.meta.url));
const CLIENT = 'D:/h5/stock-workbench/dsh-stock-workbench/client.js';
const BASE = 'http://127.0.0.1:54251/';

// --- 1. DOM 环境（必须在 import react-dom 之前） ---------------------------
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: BASE,
  pretendToBeVisual: true,
});
const { window } = dom;

// jsdom 没有布局：给所有元素一个固定可视区，让虚拟滚动与图表能算出尺寸
Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 920 });
Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 430 });

globalThis.window = window;
globalThis.document = window.document;
globalThis.navigator = window.navigator;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Element = window.Element;
globalThis.Node = window.Node;
globalThis.Event = window.Event;
globalThis.MouseEvent = window.MouseEvent;
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);

const React = requireFromSsr('react');
const { createRoot } = await import('react-dom/client');

// --- 2. 加载插件模块（模拟 __ModuleLoader__） ------------------------------
let captured = null;
window.__ModuleLoader__ = { load: (mod) => { captured = mod; } };

const source = readFileSync(CLIENT, 'utf8');
const factoryFn = new Function('require', 'window', 'document', source);
factoryFn(requireFromSsr, window, window.document);
if (!captured) throw new Error('模块没有调用 __ModuleLoader__.load');
console.log('✓ 模块格式可加载  id=' + captured.id);

const mod = captured.factory(requireFromSsr);
console.log('✓ factory 返回  name=' + mod.name + '  inject=' + JSON.stringify(mod.inject));

// --- 3. 假 ctx：捕获 slot 注册 + 真实查字典 --------------------------------
const dicts = {};
const registered = [];
const ctx = {
  effect: (fn) => fn(),
  locale: {
    register: (_ns, d) => {
      Object.assign(dicts, d);
      return () => {};
    },
    bind: () => (key) => {
      const dict = dicts.zh ?? {};
      return dict[key] ?? key;
    },
    subscribe: () => () => {},
  },
  slots: {
    inject: (_key, cb) => cb(),
    register: (options, component) => {
      registered.push({ options, component });
      return () => {};
    },
  },
};

mod.apply(ctx);
const names = registered.map((entry) => `${entry.options.name}${entry.options.key ? ':' + entry.options.key : entry.options.id ? ':' + entry.options.id : ''}`);
console.log('✓ 注册了 ' + registered.length + ' 个 slot：' + names.join(', '));

const panel = registered.find((entry) => entry.options.name === 'main');
const row = registered.find((entry) => entry.options.name === 'sidebar.panellist');
if (!panel) throw new Error('没有注册 main 面板');
if (!row) throw new Error('没有注册 sidebar.panellist 侧栏入口');
if (panel.options.key !== row.options.id) throw new Error('main.key 与 sidebar.panellist.id 不一致：' + panel.options.key + ' vs ' + row.options.id);
console.log('✓ main.key === sidebar.panellist.id = ' + panel.options.key);

// 侧栏图标能渲染成 svg
const iconRoot = createRoot(window.document.createElement('div'));
const iconHost = row.component({ size: 16 });
iconRoot.render(iconHost);
await sleep(60);
const iconSvg = window.document.querySelector('svg');
if (!iconSvg) throw new Error('侧栏图标没渲染出 svg');
console.log('✓ 侧栏图标渲染出 svg，' + iconSvg.querySelectorAll('rect').length + ' 个 rect');

// --- 4. 渲染整页（真打本机 Host 路由拿 5572 只） --------------------------
const root = createRoot(window.document.getElementById('root'));
root.render(panel.component());
await sleep(2600);

const html = window.document.body.innerHTML;
const must = [
  ['标题', '看股工作台'],
  ['刷新按钮', '刷新'],
  ['数据日期', '数据日期'],
  ['指数卡-上证', '上证指数'],
  ['涨跌家数', '涨停'],
  ['筛选-涨跌幅', '涨跌幅'],
  ['筛选-主力净流入', '主力净流入'],
  ['预设-主力抢筹', '主力抢筹'],
  ['表头-成交额', '成交额'],
  ['页脚提示', '双击任意一行'],
];
for (const [label, text] of must) {
  if (!html.includes(text)) throw new Error(`页面缺少「${label}」(${text})`);
}
console.log('✓ 页面关键文案齐全：' + must.map((item) => item[1]).join(' / '));

const rows = window.document.querySelectorAll('.sw-row');
if (rows.length < 5) throw new Error('榜单没有渲染出行：' + rows.length);
console.log('✓ 榜单渲染 ' + rows.length + ' 行（虚拟滚动窗口内），总高度 div 存在');
console.log('✓ 命中计数：' + (window.document.querySelector('.sw-foot')?.textContent ?? '').slice(0, 60));

// 排序：点一次「成交额」表头
const ths = [...window.document.querySelectorAll('.sw-th')];
const amountTh = ths.find((el) => el.textContent.includes('成交额'));
if (!amountTh) throw new Error('找不到成交额表头');
amountTh.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await sleep(120);
const sortedFirst = window.document.querySelector('.sw-row')?.textContent ?? '';
console.log('✓ 点表头排序后首行：' + sortedFirst.slice(0, 40));

// --- 5. 双击进详情 + 拉 K 线 ---------------------------------------------
const firstRow = window.document.querySelector('.sw-row');
const pickedName = firstRow.textContent.slice(6, 16);
firstRow.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
await sleep(1600);

const detailHtml = window.document.body.innerHTML;
if (!detailHtml.includes('返回榜单')) throw new Error('双击后没有进入详情页');
const svg = window.document.querySelector('.sw-chartBox svg');
if (!svg) throw new Error('详情页没有渲染 chart svg（' + (window.document.querySelector('.sw-chartEmpty')?.textContent ?? '无空态文案') + '）');
const paths = svg.querySelectorAll('path');
const rects = svg.querySelectorAll('rect');
const lines = svg.querySelectorAll('line');
console.log('✓ 双击行进入详情页，日K 图渲染：path=' + paths.length + ' rect=' + rects.length + ' line=' + lines.length);
console.log('✓ 详情页头部：' + (window.document.querySelector('.sw-detailHead')?.textContent ?? '').slice(0, 80));
if (paths.length < 3) throw new Error('K 线少了均线 path');
if (rects.length < 40) throw new Error('K 线柱体数量异常：' + rects.length);

// 周期切换：分时
const trendTab = [...window.document.querySelectorAll('.sw-period')].find((el) => el.textContent === '分时');
if (!trendTab) throw new Error('找不到分时周期按钮');
trendTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await sleep(1600);
if (!window.document.querySelector('.sw-chartBox svg path')) throw new Error('分时图没有渲染');
console.log('✓ 切到分时：path=' + window.document.querySelectorAll('.sw-chartBox svg path').length);

// Esc 返回
window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
await sleep(200);
if (!window.document.body.innerHTML.includes('看股工作台')) throw new Error('Esc 没有回到榜单');
console.log('✓ Esc 回到榜单');

console.log('\n浏览器半渲染冒烟通过（' + pickedName.trim() + '）');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
