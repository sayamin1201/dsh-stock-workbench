// 查询层单元测试：node --test test/  （或 node test/query.test.mjs）
import assert from 'node:assert/strict';
import {
  applyFilters, sortRows, runQuery, formatCell, summarize, pctHistogram,
  EMPTY_FILTERS, DEFAULT_SORT, PRESETS, fmtMoneySign, isST,
} from '../lib/query.js';

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}\n    ${err.message}`);
    process.exitCode = 1;
  }
}

const rows = [
  { code: '600000', name: '浦发银行', board: 'sh-main', price: 10.19, pct: 0.99, amount: 6.6e7, turnover: 0.02, volumeRatio: 4.68, amplitude: 1.78, floatMcap: 3.39e11, mainIn: 2.99e6, pe: 6.27, pct5d: 3.45 },
  { code: '301697', name: '贝特利', board: 'chinext', price: 25.42, pct: 20.02, amount: 2.8e8, turnover: 25.92, volumeRatio: 56.2, amplitude: 12.3, floatMcap: 4.2e9, mainIn: 1.0e8, pe: 88.1, pct5d: 31.2 },
  { code: '000001', name: '平安银行', board: 'sz-main', price: 11.5, pct: -1.2, amount: 5.0e8, turnover: 0.31, volumeRatio: 0.8, amplitude: 2.1, floatMcap: 2.2e11, mainIn: -3.1e7, pe: 5.1, pct5d: -2.2 },
  { code: '688981', name: '中芯国际', board: 'star', price: 88.0, pct: 2.4, amount: 4.0e9, turnover: 1.2, volumeRatio: 1.4, amplitude: 4.4, floatMcap: 1.7e11, mainIn: 0, pe: 120.5, pct5d: 6.1 },
  { code: '920992', name: '中科美菱', board: 'bse', price: 10.43, pct: 0.5, amount: 3.5e5, turnover: 0.07, volumeRatio: 2.0, amplitude: 1.7, floatMcap: 5.1e8, mainIn: 0, pe: 73.6, pct5d: -8.11 },
  { code: '600991', name: 'ST广道退', board: 'sh-main', price: 1.1, pct: 5.0, amount: 1.0e6, turnover: 0.5, volumeRatio: 1.0, amplitude: 6.0, floatMcap: 2.0e8, mainIn: 0, pe: -3.2, pct5d: 0 },
  { code: '300750', name: '宁德时代', board: 'chinext', price: 250.0, pct: null, amount: null, turnover: null, volumeRatio: null, amplitude: null, floatMcap: null, mainIn: null, pe: null, pct5d: null },
];

console.log('筛选：');
test('默认排除 ST，命中 6 只', () => {
  assert.equal(applyFilters(rows, EMPTY_FILTERS).length, 6);
});
test('不排除 ST 时命中 7 只', () => {
  assert.equal(applyFilters(rows, { excludeST: false }).length, 7);
});
test('涨跌幅 >= 9.5 只剩贝特利', () => {
  const r = applyFilters(rows, { pctMin: 9.5 });
  assert.deepEqual(r.map((x) => x.code), ['301697']);
});
test('成交额 >= 5 亿 过滤掉小票', () => {
  const r = applyFilters(rows, { amountMin: 5 });
  assert.deepEqual(r.map((x) => x.code), ['000001', '688981']);
});
test('排除科创板与北交所', () => {
  const r = applyFilters(rows, { excludeStar: true, excludeBse: true });
  assert.deepEqual(r.map((x) => x.code), ['600000', '301697', '000001', '300750']);
});
test('搜索代码与名称', () => {
  assert.deepEqual(applyFilters(rows, { search: '6000' }).map((x) => x.code), ['600000']);
  assert.deepEqual(applyFilters(rows, { search: '银行' }).map((x) => x.code), ['600000', '000001']);
});
test('主力净流入 >= 5000 万 只留贝特利（0 视为无数据被排除）', () => {
  const r = applyFilters(rows, { mainInMin: 5000 });
  assert.deepEqual(r.map((x) => x.code), ['301697']);
});
test('流通市值区间 100~4000 亿', () => {
  const r = applyFilters(rows, { floatMcapMin: 100, floatMcapMax: 4000 });
  assert.deepEqual(r.map((x) => x.code), ['600000', '000001', '688981']);
});
test('空筛选条件不影响结果数量（null 表示不限）', () => {
  const r = applyFilters(rows, { pctMin: null, amountMin: null, turnoverMin: null, floatMcapMin: null });
  assert.equal(r.length, 6);
});

console.log('\n排序：');
test('按涨跌幅降序，null 排最后', () => {
  const r = sortRows(rows, 'pct', 'desc');
  assert.deepEqual(r.map((x) => x.code), ['301697', '600991', '688981', '600000', '920992', '000001', '300750']);
});
test('按涨跌幅升序，null 仍在最后', () => {
  const r = sortRows(rows, 'pct', 'asc');
  assert.equal(r[r.length - 1].code, '300750');
  assert.equal(r[0].code, '000001');
});
test('按成交额降序', () => {
  const r = sortRows(rows, 'amount', 'desc');
  assert.equal(r[0].code, '688981');
  assert.equal(r[r.length - 1].code, '300750');
});
test('数值全等时保持原顺序（稳定）', () => {
  const same = [{ code: 'a', pct: 1 }, { code: 'b', pct: 1 }, { code: 'c', pct: 1 }];
  assert.deepEqual(sortRows(same, 'pct', 'desc').map((x) => x.code), ['a', 'b', 'c']);
});
test('文本列按拼音排序', () => {
  const r = sortRows(rows, 'name', 'asc');
  assert.equal(r.length, 7);
});

console.log('\n取消排序 / 组合：');
test('默认排序为涨跌幅降序', () => {
  assert.deepEqual(DEFAULT_SORT, { key: 'pct', dir: 'desc' });
});
test('runQuery = 先筛后排', () => {
  const r = runQuery(rows, { amountMin: 1 }, { key: 'amount', dir: 'desc' });
  assert.deepEqual(r.map((x) => x.code), ['688981', '000001', '301697']);
});

console.log('\n格式化：');
test('百分比带符号', () => {
  assert.equal(formatCell(1.234, 'pct'), '+1.23%');
  assert.equal(formatCell(-1.239, 'pct'), '-1.24%');
  assert.equal(formatCell(null, 'pct'), '—');
});
test('金额亿/万', () => {
  assert.equal(formatCell(1.234e8, 'money'), '1.23亿');
  assert.equal(formatCell(5.6e4, 'money'), '5.6万');
  assert.equal(formatCell(999, 'money'), '999');
});
test('主力净流入 0 显示为破折号（东财未覆盖）', () => {
  assert.equal(fmtMoneySign(0), '—');
  assert.equal(fmtMoneySign(1.23e8), '+1.23亿');
  assert.equal(fmtMoneySign(-4.5e7), '-4500.0万');
});
test('市值亿/万亿', () => {
  assert.equal(formatCell(3.39e11, 'mcap'), '3390.0亿');
  assert.equal(formatCell(1.2e13, 'mcap'), '12.00万亿');
});
test('价格两位小数', () => {
  assert.equal(formatCell(10.1, 'price'), '10.10');
});

console.log('\n统计与预设：');
test('summarize 涨跌家数与成交额', () => {
  const s = summarize(rows);
  assert.equal(s.up, 5);
  assert.equal(s.down, 1);
  assert.equal(s.flat, 0);
  assert.equal(s.count, 7);
});
test('涨幅直方图分桶总数正确', () => {
  const { counts } = pctHistogram(rows);
  assert.equal(counts.reduce((a, b) => a + b, 0), 6); // 6 只有 pct
});
test('预设条件都是可执行的合法筛选', () => {
  for (const preset of PRESETS) {
    const r = applyFilters(rows, { ...EMPTY_FILTERS, ...preset.filters });
    assert.ok(Array.isArray(r), preset.id);
  }
});
test('ST 判定', () => {
  assert.equal(isST({ name: 'ST广道退' }), true);
  assert.equal(isST({ name: '*ST海航' }), true);
  assert.equal(isST({ name: '浦发银行' }), false);
});

test('板块成员筛选：boardCodes 只保留集合内代码', () => {
  const rows = [
    { code: '600036', name: '招商银行', pct: 1 },
    { code: '000001', name: '平安银行', pct: 2 },
    { code: '600519', name: '贵州茅台', pct: 3 },
  ];
  const out = applyFilters(rows, { boardCodes: ['600036', '600519'] });
  assert(out.length === 2, '应剩 2 只，实际 ' + out.length);
  assert(out.map((row) => row.code).join(',') === '600036,600519', '内容不对');
  const empty = applyFilters(rows, { boardCodes: [] });
  assert(empty.length === 3, '空集合不应过滤');
});

console.log(`\n通过 ${passed} 项${process.exitCode ? '，存在失败项' : ''}`);
