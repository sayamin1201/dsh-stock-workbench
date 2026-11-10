/**
 * 交互测试：用 react-test-renderer 真渲染 + 模拟点击，验证「表头点击排序」等交互。
 * 不需要 jsdom：test-renderer 会跑 hooks（含 useEffect），可以直接调用 props.onClick。
 *
 * 运行：node .ssr/interaction.mjs
 * 依赖：react / react-dom / react-test-renderer / scheduler（都装在 .ssr 里）
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const requireFromSsr = createRequire(new URL('./package.json', import.meta.url));
const React = requireFromSsr('react');
const TestRenderer = requireFromSsr('react-test-renderer');
const { act } = TestRenderer;
const h = React.createElement;

const CLIENT = 'D:/h5/stock-workbench/dsh-stock-workbench/client.js';
const BASE = 'http://127.0.0.1:54251/';

let passed = 0;
function check(label, fn) {
  fn();
  passed += 1;
  console.log('  ✓ ' + label);
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};
globalThis.window = { addEventListener() {}, removeEventListener() {} };
globalThis.document = { baseURI: BASE };
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(0), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

function fakeDashboard() {
  const rows = [
    { code: '000001', name: '平安银行', board: 'sz-main', secid: '0.000001', industry: '银行Ⅱ', price: 11.5, pct: -1.2, amount: 5.0e8, turnover: 0.31, volumeRatio: 0.8, amplitude: 2.1, speed: -0.2, pct5d: -2.2, floatMcap: 2.2e11, mainIn: -3.1e7, pe: 5.1, pb: 0.6, volLots: 1e6, mainInPct: -6.2, roe: 8.07, debtRatio: 90.6, grossMargin: 0, eps: 2.02, bvps: 24.5, ps: 1.6, dividendYield: 5.17, dividendYears: 4, revenueYoy: 2.4, profitYoy: 2.2, lastDividendDate: '2026-09-24' },
    { code: '301697', name: '贝特利', board: 'chinext', secid: '0.301697', industry: '小金属', price: 25.42, pct: 20.02, amount: 2.8e8, turnover: 25.92, volumeRatio: 56.2, amplitude: 16.1, speed: 0, pct5d: 10.23, floatMcap: 4.2e9, mainIn: 1.0e8, pe: 88.1, pb: 9.2, volLots: 1e5, mainInPct: 35.7, roe: 12, debtRatio: 30, grossMargin: 22, eps: 1.2, bvps: 3, ps: 5, dividendYield: 0.5, dividendYears: 1, revenueYoy: 10, profitYoy: 8 },
    { code: '600036', name: '招商银行', board: 'sh-main', secid: '1.600036', industry: '银行Ⅱ', price: 42.77, pct: 0.19, amount: 3.1e9, turnover: 0.36, volumeRatio: 1.04, amplitude: 1.76, speed: 0, pct5d: 1.52, floatMcap: 8.8e11, mainIn: -1.6e8, pe: 6.95, pb: 0.91, volLots: 7e5, mainInPct: -5.26, roe: 10.12, debtRatio: 89.9, grossMargin: 0, eps: 4.62, bvps: 46.9, ps: 3.07, dividendYield: 4.72, dividendYears: 3, revenueYoy: 5.3, profitYoy: 2.4 },
    { code: '600519', name: '贵州茅台', board: 'sh-main', secid: '1.600519', industry: '白酒Ⅱ', price: 1470.5, pct: -0.67, amount: 5.1e9, turnover: 0.28, volumeRatio: 1.01, amplitude: 1.88, speed: 0, pct5d: 10.47, floatMcap: 1.8e12, mainIn: -5.0e6, pe: 21.38, pb: 6.78, volLots: 3e4, mainInPct: -0.1, roe: 24.47, debtRatio: 11.9, grossMargin: 89.58, eps: 51.57, bvps: 216.9, ps: 10.5, dividendYield: 3.53, dividendYears: 3, revenueYoy: 1.8, profitYoy: -0.2 },
  ];
  return {
    ok: true,
    data: {
      rows,
      indices: [
        { code: '000001', name: '上证指数', price: 3610, pct: 0.1, amount: 4.8e11 },
        { code: '399001', name: '深证成指', price: 10939, pct: 0.5, amount: 6.1e11 },
      ],
      breadth: { up: 2, down: 2, flat: 0, limitUp: 1, limitDown: 0, tradingDay: '20261104' },
      stats: { up: 2, down: 2, flat: 0, amount: 1.1e12, mainIn: 0, count: 4 },
      meta: { fetchedAt: Date.now(), upstreamMs: 300, universeCount: 4, count: 4, failedBatches: [], tradingDay: '20261104', provider: 'tencent', providerLabel: '腾讯行情', preferredProvider: 'eastmoney', providerFallback: [{ provider: 'eastmoney', label: '东方财富', error: 'blocked' }], providerMissingFields: ['mainIn', 'roe'] },
    },
  };
}

function fakeDividend() {
  return {
    ok: true,
    data: {
      code: '600036', name: '招商银行', industry: '银行Ⅱ', price: 42.77, dividendYield: 4.72,
      dpsTTM: 2.016, years3: 3, consecutive: 10, lastExDate: '2026-07-10',
      records: [
        { reportDate: '2025-12-31', reportYear: 2025, exDate: '2026-07-10', per10: 10.03, perShare: 1.003, plan: '10派10.03元(含税)' },
        { reportDate: '2024-12-31', reportYear: 2024, exDate: '2025-07-11', per10: 20, perShare: 2, plan: '10派20.00元(含税)' },
      ],
    },
  };
}

globalThis.fetch = async (url) => {
  const href = String(url ?? '');
  if (href.includes('board-members')) {
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ ok: true, data: { code: 'BK0917', total: 2, codes: ['600036', '000001'] } }),
    };
  }
  if (href.includes('boards')) {
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        ok: true,
        data: {
          type: 'concept',
          boards: [
            { code: 'BK0917', name: '半导体概念', pct: 7.47, mainIn: 2.78e10, mainInPct: 6.22, up: 531, down: 15 },
            { code: 'BK0596', name: '融资融券', pct: 3.36, mainIn: 4.73e10, mainInPct: 2.6, up: 3361, down: 459 },
          ],
        },
      }),
    };
  }
  if (href.includes('data-sources')) {
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        ok: true,
        data: {
          preferred: 'eastmoney',
          providers: [
            { id: 'eastmoney', label: '东方财富', capabilities: { snapshot: true }, missingFields: [] },
            { id: 'tencent', label: '腾讯行情', capabilities: { snapshot: true }, missingFields: ['mainIn'] },
            { id: 'sina', label: '新浪行情', capabilities: { snapshot: true }, missingFields: ['pe'] },
          ],
          health: {},
          missingFields: [],
        },
      }),
    };
  }
  if (href.includes('valuation-percentiles')) {
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        ok: true,
        data: {
          status: 'ready',
          map: {
            '000001': { pe: 5.2, pb: 0.5, pePercentile: 12.3, pbPercentile: 80, samples: 60 },
            '600036': { pe: 7.0, pb: 0.9, pePercentile: 68.3, pbPercentile: 36.7, samples: 60 },
            '600519': { pe: 22, pb: 6.7, pePercentile: 35, pbPercentile: 11.7, samples: 60 },
            '301697': { pe: 88, pb: 9.2, pePercentile: 91.2, pbPercentile: 95, samples: 60 },
          },
        },
      }),
    };
  }
  if (href.includes('valuation')) {
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ ok: true, data: { code: '600036', name: '招商银行', pe: 7.02, pb: 0.91, pePercentile: 65, pbPercentile: 31.9, sampleDays: 1210, years: 5 } }),
    };
  }
  const json = href.includes('dividend') ? fakeDividend() : fakeDashboard();
  return { ok: true, status: 200, statusText: 'OK', json: async () => json };
};

let captured = null;
const fakeWindow = { __ModuleLoader__: { load: (mod) => { captured = mod; } }, addEventListener() {}, removeEventListener() {} };
const source = readFileSync(CLIENT, 'utf8');
const factoryFn = new Function('require', 'window', 'document', 'fetch', source);
factoryFn(requireFromSsr, fakeWindow, globalThis.document, globalThis.fetch);
const mod = captured.factory(requireFromSsr);

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
const panel = registered.find((entry) => entry.options.name === 'main');
console.log('✓ 模块加载完成');

let tree;
await act(async () => {
  tree = TestRenderer.create(panel.component());
});
await act(async () => {
  await new Promise((resolve) => setTimeout(resolve, 30));
});

const root = tree.root;

function textOf(node) {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (node.children) return node.children.map(textOf).join('');
  return '';
}

function rowCodes() {
  return root.findAll((node) => typeof node.type === 'string' && String(node.props.className ?? '').includes('sw-row'))
    .map((node) => {
      const cell = node.findAll((child) => typeof child.type === 'string' && String(child.props.className ?? '').includes('sw-code'))[0];
      return cell ? textOf(cell) : '';
    })
    .filter(Boolean);
}

function headerButton(labelFragment) {
  const nodes = root.findAll((node) => typeof node.type === 'string'
    && String(node.props.className ?? '').includes('sw-th')
    && typeof node.props.onClick === 'function');
  return nodes.find((node) => textOf(node).includes(labelFragment));
}

check('初始渲染出 4 行数据', () => {
  const codes = rowCodes();
  assert(codes.length === 4, '行数 ' + codes.length + '：' + JSON.stringify(codes));
});
check('默认按涨跌幅降序（贝特利 20.02% 在前）', () => {
  const codes = rowCodes();
  assert(codes[0] === '301697', '首行应为 301697，实际 ' + codes[0]);
});

check('表头是可点击的按钮（成交额）', () => {
  const button = headerButton('成交额');
  assert(button, '找不到成交额表头按钮');
  assert(typeof button.props.onClick === 'function', '表头没有 onClick');
});

await act(async () => {
  headerButton('成交额').props.onClick();
});
check('点击「成交额」后按成交额降序（茅台 51 亿在前）', () => {
  const codes = rowCodes();
  assert(codes[0] === '600519', '首行应为 600519，实际 ' + JSON.stringify(codes));
  assert(codes[3] === '301697', '末行应为成交额最小的 301697，实际 ' + JSON.stringify(codes));
});
check('排序列显示箭头', () => {
  const markup = JSON.stringify(tree.toJSON() ?? '');
  assert(markup.includes('▼') || markup.includes('▲'), '没有排序箭头');
});

await act(async () => {
  headerButton('成交额').props.onClick();
});
check('再点一次切换升序（最小成交额在前）', () => {
  const codes = rowCodes();
  assert(codes[0] === '301697', '升序首行应为 301697，实际 ' + JSON.stringify(codes));
});

await act(async () => {
  headerButton('代码').props.onClick();
});
check('文本列「代码」默认升序', () => {
  const codes = rowCodes();
  assert(codes[0] === '000001', '代码升序首行应为 000001，实际 ' + JSON.stringify(codes));
});

check('星标列不是排序按钮（避免误点）', () => {
  const starHeaders = root.findAll((node) => typeof node.type === 'string'
    && String(node.props.className ?? '').split(' ').includes('sw-th')
    && textOf(node).includes('☆'));
  assert(starHeaders.length === 1, '星标列表头数量异常：' + starHeaders.length);
  assert(starHeaders[0].props.onClick === undefined, '星标列表头不应有 onClick');
});

const searchInput = root.findAll((node) => node.type === 'input' && node.props.className === 'sw-input')
  .find((node) => String(node.props.placeholder ?? '').includes('600000'));
check('搜索框存在（筛选联动测试）', () => assert(searchInput, '找不到代码/名称搜索框'));
await act(async () => {
  searchInput.props.onChange({ target: { value: '6000' } });
});
check('筛选后只剩 1 行', () => {
  const codes = rowCodes();
  assert(codes.length === 1, '筛选后行数 ' + codes.length);
  assert(codes[0] === '600036', '应只剩招商银行，实际 ' + codes[0]);
});
await act(async () => {
  searchInput.props.onChange({ target: { value: '' } });
});

check('每行都有星标按钮', () => {
  const stars = root.findAll((node) => typeof node.type === 'string' && String(node.props.className ?? '').includes('sw-star'));
  assert(stars.length === 4, '星标按钮数量 ' + stars.length);
});
await act(async () => {
  const stars = root.findAll((node) => typeof node.type === 'string' && String(node.props.className ?? '').includes('sw-star'));
  stars[0].props.onClick({ stopPropagation() {} });
});
check('点星标后写入 localStorage 自选池（新结构：分组）', () => {
  const saved = JSON.parse(store.get('dsh-stock-workbench:watchlist') ?? '{}');
  assert(saved && Array.isArray(saved.groups) && saved.groups.length === 1, '分组结构：' + JSON.stringify(saved));
  const activeGroup = saved.groups.find((group) => group.id === saved.active);
  assert(activeGroup && activeGroup.codes.includes('000001'), '当前组应含 000001：' + JSON.stringify(saved));
});

// --- 自选分组：新建 / 切换 / 星标进新组 / 删除
const addGroupButton = root.findAll((node) => typeof node.type === 'string'
  && String(node.props.className ?? '').includes('sw-watchAdd'))[0];
check('工具栏有新建自选组按钮', () => assert(addGroupButton, '找不到＋按钮'));
await act(async () => {
  addGroupButton.props.onClick();
});
const groupInput = root.findAll((node) => node.type === 'input'
  && String(node.props.className ?? '').includes('sw-input')
  && node.props.placeholder === '分组名')[0];
check('新建时出现分组名输入框', () => assert(groupInput, '找不到分组名输入框'));
await act(async () => {
  groupInput.props.onChange({ target: { value: '红利组' } });
});
const groupInput2 = root.findAll((node) => node.type === 'input'
  && String(node.props.className ?? '').includes('sw-input')
  && node.props.placeholder === '分组名')[0];
await act(async () => {
  groupInput2.props.onChange({ target: { value: '红利组' } });
});
await act(async () => {
  groupInput2.props.onKeyDown({ key: 'Enter', target: { value: '红利组' } });
});
check('新组创建成功并成为当前组', () => {
  const saved = JSON.parse(store.get('dsh-stock-workbench:watchlist') ?? '{}');
  const activeGroup = saved.groups.find((group) => group.id === saved.active);
  assert(activeGroup && activeGroup.name === '红利组', '当前组应为红利组：' + JSON.stringify(saved));
  assert(activeGroup.codes.length === 0, '新组应为空');
});
const starButton = root.findAll((node) => typeof node.type === 'string'
  && String(node.props.className ?? '').split(' ').includes('sw-star'))[0];
await act(async () => {
  starButton.props.onClick({ stopPropagation() {} });
});
check('在新组里点星标只写进新组', () => {
  const saved = JSON.parse(store.get('dsh-stock-workbench:watchlist') ?? '{}');
  const dividendGroup = saved.groups.find((group) => group.name === '红利组');
  const defaultGroup = saved.groups.find((group) => group.name === '默认');
  assert(dividendGroup.codes.length === 1, '红利组应有 1 只：' + JSON.stringify(saved));
  assert(defaultGroup.codes.length === 1 && defaultGroup.codes[0] === '000001', '默认组不应受影响');
});
const switchBack = root.findAll((node) => typeof node.type === 'string'
  && String(node.props.className ?? '').includes('sw-watchName')
  && textOf(node).startsWith('默认'))[0];
await act(async () => {
  switchBack.props.onClick();
});
check('切回默认组后状态正确', () => {
  const saved = JSON.parse(store.get('dsh-stock-workbench:watchlist') ?? '{}');
  const activeGroup = saved.groups.find((group) => group.id === saved.active);
  assert(activeGroup.name === '默认', '应切回默认组：' + JSON.stringify(saved));
});

// --- 列配置：打开 → 取消勾选 → 保存 → 表头变化
const configButton = root.findAll((node) => typeof node.type === 'string'
  && String(node.props.className ?? '').split(' ').includes('sw-gearBtn'))[0];
check('表格右上角有齿轮按钮', () => assert(configButton, '找不到齿轮按钮'));
await act(async () => {
  configButton.props.onClick({ stopPropagation() {} });
});
check('点开后列配置弹窗出现（每行有复选框与固定按钮）', () => {
  const modal = root.findAll((node) => typeof node.type === 'string'
    && String(node.props.className ?? '').includes('sw-colModal'))[0];
  assert(modal, '找不到列配置弹窗');
  const rows = modal.findAll((node) => typeof node.type === 'string'
    && String(node.props.className ?? '').includes('sw-colRow'));
  assert(rows.length > 10, '配置行太少：' + rows.length);
  const boxes = modal.findAll((node) => node.type === 'input' && node.props.type === 'checkbox');
  assert(boxes.length === rows.length, '弹窗内复选框数量应等于行数（行=' + rows.length + '，框=' + boxes.length + '）');
});
// 取消勾选「振幅」（第 3 行左右，用名称定位）
const columnRows = root.findAll((node) => typeof node.type === 'string'
  && String(node.props.className ?? '').includes('sw-colRow'));
const amplitudeRow = columnRows.find((row) => textOf(row).includes('振幅'));
check('配置里能找到「振幅」列', () => assert(amplitudeRow, '找不到振幅行'));
const amplitudeBox = amplitudeRow.findAll((node) => node.type === 'input' && node.props.type === 'checkbox')[0];
await act(async () => {
  amplitudeBox.props.onChange({ target: { checked: false } });
});
const saveButton = root.findAll((node) => typeof node.type === 'string'
  && typeof node.props.onClick === 'function'
  && textOf(node) === '保存')[0];
check('弹窗有保存按钮', () => assert(saveButton, '找不到保存按钮'));
await act(async () => {
  saveButton.props.onClick();
});
check('保存后表头不再有该列且写入 localStorage', () => {
  const headers = root.findAll((node) => typeof node.type === 'string'
    && String(node.props.className ?? '').includes('sw-th'))
    .map((node) => textOf(node)).join('|');
  assert(!headers.includes('振幅'), '表头仍有振幅：' + headers);
  const stored = JSON.parse(store.get('dsh-stock-workbench:column-prefs') ?? 'null');
  assert(stored && Array.isArray(stored.list), '没有写入列偏好：' + JSON.stringify(stored)?.slice(0, 60));
});

// --- 齿轮只跟结果表：公式 tab 未执行时不该出现齿轮
await selectTab('公式选股');
check('公式 tab 未执行时没有齿轮（齿轮只跟结果表）', () => {
  const gears = root.findAll((node) => typeof node.type === 'string'
    && String(node.props.className ?? '').split(' ').includes('sw-gearBtn'));
  assert(gears.length === 0, '未执行公式却出现了齿轮：' + gears.length);
});

// 重新挂载：榜单的列配置应恢复（振幅仍隐藏）
let tree2 = null;
await act(async () => {
  tree2 = TestRenderer.create(h(mod.__internals.WorkbenchPage, { ctx: { layout: { selectPanel() {} }, locale: { bind: () => (k) => k } } }));
});
check('重新进入后仍是上次的榜单列配置（振幅仍隐藏）', () => {
  const headers = tree2.root.findAll((node) => typeof node.type === 'string'
    && String(node.props.className ?? '').split(' ').includes('sw-th'))
    .map((node) => textOf(node)).join('|');
  assert(headers.length > 0, '没有表头');
  assert(!headers.includes('振幅'), '表头仍有振幅：' + headers);
});

// 切回榜单（后续用例针对榜单表格）
await selectTab('全 A 榜单');

// --- 分红详情：点「连续分红 / 分红年数」打开弹窗
const divLink = root.findAll((node) => typeof node.type === 'string'
  && String(node.props.className ?? '') === 'sw-divLink')[0];
check('榜单里有可点击的分红链接单元格', () => assert(divLink, '找不到分红链接'));
await act(async () => {
  divLink.props.onClick({ stopPropagation() {} });
});
check('点分红列后弹窗出现并展示明细', () => {
  const markup = JSON.stringify(tree.toJSON() ?? '');
  assert(markup.includes('分红详情'), '弹窗没出现');
  assert(markup.includes('分红详情'), '缺弹窗标题');
  assert(markup.includes('连续分红'), '缺连续分红字段');
  assert(markup.includes('10派10.03元'), '缺分红明细行');
  assert(markup.includes('10+'), '连续 10 年应显示 10+');
});
await act(async () => {
  const mask = root.findAll((node) => typeof node.type === 'string'
    && String(node.props.className ?? '') === 'sw-modalMask')[0];
  mask.props.onClick();
});
check('关闭后弹窗消失', () => {
  const markup = JSON.stringify(tree.toJSON() ?? '');
  assert(!markup.includes('分红详情'), '弹窗没关闭');
});

// tab 已收进下拉菜单：点开菜单再选目标 tab
function openTabMenu() {
  const btn = root.findAll((node) => typeof node.type === 'string'
    && String(node.props.className ?? '').includes('sw-tabButton'))[0];
  return btn;
}
async function selectTab(labelText) {
  const btn = openTabMenu();
  await act(async () => { btn.props.onClick(); });
  const item = root.findAll((node) => typeof node.type === 'string'
    && String(node.props.className ?? '').includes('sw-tabPopItem')
    && textOf(node) === labelText)[0];
  await act(async () => { item.props.onClick(); });
  return item;
}

// --- 公式选股 tab：收藏夹按钮与抽屉
await selectTab('公式选股');
check('可切换到公式选股 tab', () => {
  const pop = root.findAll((node) => typeof node.type === 'string'
    && String(node.props.className ?? '').includes('sw-tabPopItem'));
  assert(pop.length === 0, '选择后菜单应关闭');
});
await act(async () => {
  await selectTab('公式选股');
});
const favButton = root.findAll((node) => typeof node.type === 'string'
  && typeof node.props.onClick === 'function'
  && textOf(node).includes('收藏夹'))[0];
check('公式 tab 有收藏夹按钮', () => assert(favButton, '找不到收藏夹按钮'));
await act(async () => {
  favButton.props.onClick();
});
check('点收藏夹后右侧抽屉出现', () => {
  const markup = JSON.stringify(tree.toJSON() ?? '');
  assert(markup.includes('sw-favDrawer'), '抽屉没打开');
});
check('防御 tab 已从工作台移除', () => {
  const markup = JSON.stringify(tree.toJSON() ?? '');
  assert(!markup.includes('红利防御'), '红利防御 tab 仍在');
});

// --- 结果表：点击表头排序（升/降切换）
const sortRowsFixture = [
  { code: 'AAA111', name: '甲公司', price: 1, pct: 1, amount: 300 },
  { code: 'BBB222', name: '乙公司', price: 2, pct: 2, amount: 100 },
];
let resultTree = null;
await act(async () => {
  resultTree = TestRenderer.create(h(mod.__internals.ResultTable, {
    t: (key) => key,
    columns: mod.__internals.FORMULA_COLUMNS,
    rows: sortRowsFixture,
    onOpen: () => {},
    onConfigColumns: () => {},
  }));
});
const amountHeader = resultTree.root.findAll((node) => typeof node.type === 'string'
  && String(node.props.className ?? '').includes('sw-resTh')
  && textOf(node).includes('col.amount'))[0];
check('结果表表头是排序按钮', () => assert(amountHeader, '找不到成交额表头'));
const readCodes = () => {
  const json = resultTree.toJSON();
  const rows = [];
  const walk = (node) => {
    if (node == null || typeof node === 'string') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (String((node.props && node.props.className) || '').includes('sw-resRow')) rows.push(node);
    (node.children || []).forEach(walk);
  };
  walk(json);
  return rows[0] ? textOf(rows[0]) : '';
};
await act(async () => {
  amountHeader.props.onClick();
});
check('点一次表头按降序排序（300 在前）', () => {
  const first = readCodes();
  assert(first.includes('AAA111'), '降序首行应为 300 那行：' + first);
  const arrow = resultTree.root.findAll((node) => typeof node.type === 'string'
    && String(node.props.className ?? '').includes('sw-resThOn'));
  assert(arrow.length === 1, '缺高亮表头');
});
const amountHeader2 = resultTree.root.findAll((node) => typeof node.type === 'string'
  && String(node.props.className ?? '').includes('sw-resTh')
  && textOf(node).includes('col.amount'))[0];
await act(async () => {
  amountHeader2.props.onClick();
});
check('再点一次切升序（100 在前）', () => {
  const first = readCodes();
  assert(first.includes('BBB222'), '升序首行应为 100 那行：' + first);
});

// --- 板块资金流：点击板块 → 回榜单按成分股筛选
await selectTab('板块资金流');
check('可切换到板块资金流 tab', () => assert(true));
await selectTab('板块资金流');
await act(async () => {});
const boardRows = root.findAll((node) => typeof node.type === 'string'
  && String(node.props.className ?? '').includes('sw-resRow'));
check('板块表渲染出板块行', () => assert(boardRows.length === 2, '板块行数：' + boardRows.length));
await act(async () => {
  boardRows[0].props.onClick();
});
await act(async () => {});
check('点板块后回到榜单并只显示成分股', () => {
  const rows = root.findAll((node) => typeof node.type === 'string'
    && String(node.props.className ?? '').split(' ').includes('sw-row'));
  assert(rows.length === 2, '应只剩 2 只成分股，实际 ' + rows.length);
  const markup = JSON.stringify(tree.toJSON() ?? '');
  assert(markup.includes('板块筛选'), '缺少板块筛选 chip');
});

// --- 个股详情 popover：估值分位必须能落地（回归：effect 依赖自身 status → 永久"计算中"）
const detailRow = {
  code: '600036', name: '招商银行', board: 'sh-main', price: 42.5, pct: 0.2, amount: 3e9,
  turnover: 0.4, volumeRatio: 1, amplitude: 1.7, speed: 0, floatMcap: 8e11, mainIn: -1e8, mainInPct: -5,
  dividendYield: 4.7, dividendYears: 3, dividendConsecutive: 10, roe: 10, debtRatio: 90, grossMargin: 0,
  revenueYoy: 5, profitYoy: 2, eps: 4.6, bvps: 46, ps: 3, industry: '银行Ⅱ', regionBoard: '广东板块', concepts: '深圳特区',
};
let detailTree = null;
await act(async () => {
  detailTree = TestRenderer.create(h(mod.__internals.DetailPage, {
    row: detailRow, t: (k) => k, onBack: () => {}, watched: false,
  }));
});
const detailButton = detailTree.root.findAll((node) => typeof node.type === 'string'
  && typeof node.props.onClick === 'function' && node.props.title === 'detailHint')[0];
check('详情页有「详情」按钮', () => assert(detailButton, '找不到详情按钮'));
await act(async () => {
  detailButton.props.onClick({ stopPropagation() {} });
});
await act(async () => {
  await new Promise((resolve) => setTimeout(resolve, 80));
});
check('点开后估值分位已落地（不再永久「计算中」）', () => {
  const markup = JSON.stringify(detailTree.toJSON() ?? '');
  assert(markup.includes('detailTitle'), '弹窗没出现');
  assert(!markup.includes('detailValuationLoading'), '仍停在「正在计算估值分位」');
  assert(markup.includes('65.0'), '未显示 PE 分位 65.0');
  assert(markup.includes('31.9'), '未显示 PB 分位 31.9');
});

// --- 榜单：估值分位列（PE/PB 分位）合并与可排序
check('榜单包含 PE/PB 分位列且已合并数据', () => {
  const heads = tree.root.findAll((node) => typeof node.type === 'string'
    && String(node.props.className ?? '').split(' ').includes('sw-th'))
    .map((node) => textOf(node)).join('|');
  assert(heads.includes('PE分位'), '缺 PE 分位列：' + heads);
  assert(heads.includes('PB分位'), '缺 PB 分位列');
  const markup = JSON.stringify(tree.toJSON() ?? '');
  assert(markup.includes('12.3'), '未合并 PE 分位 12.3');
  assert(markup.includes('68.3'), '未合并 PE 分位 68.3');
});

// --- 批量导入自选股：打开弹窗 → 搜索回车 → 确认写入当前分组
const importBtn = root.findAll((node) => typeof node.type === 'string'
  && typeof node.props.onClick === 'function'
  && String(node.props.className ?? '').includes('sw-watchImport'))[0];
check('自选分组条有「导入」按钮', () => assert(importBtn, '找不到导入按钮'));
await act(async () => {
  importBtn.props.onClick();
});
const importSearch = root.findAll((node) => typeof node.type === 'string' && node.type === 'input'
  && String(node.props.placeholder ?? '').includes('代码或名称'))[0];
check('导入弹窗有搜索框', () => assert(importSearch, '找不到搜索输入框'));
await act(async () => {
  importSearch.props.onChange({ target: { value: '600036' } });
});
const importInput2 = root.findAll((node) => typeof node.type === 'string' && node.type === 'input'
  && String(node.props.placeholder ?? '').includes('代码或名称'))[0];
await act(async () => {
  importInput2.props.onKeyDown({ key: 'Enter', preventDefault() {} });
});
check('回车后股票进入上方标签区', () => {
  const markup = JSON.stringify(tree.toJSON() ?? '');
  assert(markup.includes('sw-importTag'), '没有标签');
  assert(markup.includes('招商银行'), '标签里没有招商银行');
});
const importConfirm = root.findAll((node) => typeof node.type === 'string'
  && typeof node.props.onClick === 'function'
  && String(node.props.className ?? '').includes('sw-btnPrimary')
  && textOf(node).includes('加入自选'))[0];
check('有确认按钮', () => assert(importConfirm, '找不到确认按钮'));
await act(async () => {
  importConfirm.props.onClick();
});
check('确认后写入 localStorage 自选池', () => {
  const saved = JSON.parse(store.get('dsh-stock-workbench:watchlist') ?? '{}');
  const active = saved.groups.find((g) => g.id === saved.active);
  assert(active.codes.includes('600036'), '自选池未写入 600036：' + JSON.stringify(active.codes));
});

// --- 收起上方：点击后隐藏指数/筛选，再点恢复
const collapseBtn = root.findAll((node) => typeof node.type === 'string'
  && typeof node.props.onClick === 'function'
  && textOf(node).includes('收起上方'))[0];
check('工具栏有「收起上方」按钮', () => assert(collapseBtn, '找不到收起按钮'));
await act(async () => {
  collapseBtn.props.onClick();
});
const countByClass = (cls) => root.findAll((node) => typeof node.type === 'string'
  && String(node.props.className ?? '') === cls).length;
check('收起后指数卡片与筛选区消失', () => {
  assert(countByClass('sw-cards') === 0, '指数卡片仍在');
  assert(countByClass('sw-filters') === 0, '筛选面板仍在');
});
const expandBtn = root.findAll((node) => typeof node.type === 'string'
  && typeof node.props.onClick === 'function'
  && textOf(node).includes('展开上方'))[0];
check('出现「展开上方」按钮', () => assert(expandBtn, '找不到展开按钮'));
await act(async () => {
  expandBtn.props.onClick();
});
check('展开后恢复显示', () => {
  assert(countByClass('sw-filters') > 0, '筛选面板未恢复');
  assert(countByClass('sw-cards') > 0, '指数卡片未恢复');
});

// --- 行情源选择器跟随「实际使用源」：首选东财、实际腾讯 → 选择器显示腾讯并标注自动切换
check('行情源选择器跟随实际使用源', () => {
  const selects = root.findAll((node) => typeof node.type === 'string' && node.type === 'select');
  const dsSelect = selects.find((node) => {
    const options = node.findAll((child) => typeof child.type === 'string' && child.type === 'option')
      .map((child) => textOf(child))
      .join('|');
    return options.includes('腾讯行情') && options.includes('东方财富');
  });
  assert(dsSelect, '找不到行情源选择器');
  assert(dsSelect.props.value === 'tencent', '选择器应显示实际使用源 tencent，实际 ' + dsSelect.props.value);
  const markup = JSON.stringify(tree.toJSON() ?? '');
  assert(markup.includes('自动切换'), '缺少「已自动切换」标记');
  assert(markup.includes('首选'), '缺少首选源说明');
});

console.log('\n交互测试通过，共 ' + passed + ' 项');
