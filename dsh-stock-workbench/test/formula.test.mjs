// 公式选股引擎单元测试：node test/formula.test.mjs
import {
  compileFormula, filterByFormula, getFieldCatalog, getFormulaPresets, FORMULA_EXAMPLES, FORMULA_PRESETS,
} from '../lib/formula.js';

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.error(`  ✗ ${name}\n    ${error.message}`);
    process.exitCode = 1;
  }
}

const rows = [
  { code: '600000', name: '浦发银行', price: 10.19, pct: 0.99, amount: 6.6e7, turnover: 0.02, volumeRatio: 4.68, amplitude: 1.78, speed: 0.49, pct5d: 3.45, floatMcap: 3.39e11, mcap: 3.39e11, mainIn: 2.99e6, mainInPct: 4.51, pe: 6.27, pb: 0.45, industry: '银行Ⅱ', dividendYield: 4.72, dividendYears: 3, roe: 10.12, debtRatio: 89.9, grossMargin: 0 },
  { code: '301697', name: '贝特利', price: 25.42, pct: 20.02, amount: 2.8e8, turnover: 25.92, volumeRatio: 56.2, amplitude: 16.1, speed: 0, pct5d: 10.23, floatMcap: 4.2e9, mcap: 5e9, mainIn: 1.0e8, mainInPct: 35.7, pe: 88.1, pb: 9.2, industry: '小金属', dividendYield: 0.5, dividendYears: 1, roe: 12, debtRatio: 30, grossMargin: 22 },
  { code: '000001', name: '平安银行', price: 11.5, pct: -1.2, amount: 5.0e8, turnover: 0.31, volumeRatio: 0.8, amplitude: 2.1, speed: -0.2, pct5d: -2.2, floatMcap: 2.2e11, mcap: 2.2e11, mainIn: -3.1e7, mainInPct: -6.2, pe: 5.1, pb: 0.6, industry: '银行Ⅱ', dividendYield: 5.17, dividendYears: 4, roe: 8.07, debtRatio: 90.6, grossMargin: 0 },
  { code: '920992', name: '中科美菱', price: 10.43, pct: 0.5, amount: 3.5e5, turnover: 0.07, volumeRatio: 2.0, amplitude: 1.7, speed: 0.19, pct5d: -8.11, floatMcap: 5.1e8, mcap: 1.0e9, mainIn: 0, mainInPct: 0, pe: 73.6, pb: 1.61, industry: '医疗器械', dividendYield: 0, dividendYears: 0, roe: 5, debtRatio: 20, grossMargin: 40 },
  { code: '300750', name: '宁德时代', price: null, pct: null, amount: null, turnover: null, volumeRatio: null, amplitude: null, speed: null, pct5d: null, floatMcap: null, mcap: null, mainIn: null, mainInPct: null, pe: null, pb: null },
];

const codes = (expr) => {
  const result = filterByFormula(rows, expr);
  if (!result.ok) throw new Error(`解析失败：${result.error}`);
  return result.rows.map((row) => row.code);
};

console.log('数值比较：');
test('量比 > 2（正好 2.0 不算大于）', () => {
  if (JSON.stringify(codes('量比 > 2')) !== JSON.stringify(['600000', '301697'])) {
    throw new Error(JSON.stringify(codes('量比 > 2')));
  }
});
test('涨跌幅 > 10（百分比字段不用换算）', () => {
  if (JSON.stringify(codes('涨跌幅 > 10')) !== JSON.stringify(['301697'])) throw new Error('bad');
});
test('支持英文别名与比较符 >= <= !=', () => {
  if (JSON.stringify(codes('volr >= 56')) !== JSON.stringify(['301697'])) throw new Error('volr');
  if (JSON.stringify(codes('换手率 != 0.02')) !== JSON.stringify(['301697', '000001', '920992'])) throw new Error('!=');
});
test('无数据（null）不命中任何数值比较', () => {
  const r = codes('涨跌幅 > -100');
  if (r.includes('300750')) throw new Error('null 行不应命中：' + r);
  if (r.length !== 4) throw new Error('应为 4 行，实际 ' + r.length);
});

console.log('\n金额单位：');
test('裸数字默认按亿：成交额 > 1亿 等价 成交额 > 1', () => {
  if (JSON.stringify(codes('成交额 > 1')) !== JSON.stringify(['301697', '000001'])) throw new Error(JSON.stringify(codes('成交额 > 1')));
});
test('显式「亿」「万」后缀都能用', () => {
  if (JSON.stringify(codes('成交额 > 1亿')) !== JSON.stringify(['301697', '000001'])) throw new Error('亿');
  if (JSON.stringify(codes('成交额 > 10000万')) !== JSON.stringify(['301697', '000001'])) throw new Error('万');
  // 600000 成交额 6600 万，低于 1 亿
  if (codes('成交额 > 1亿').includes('600000')) throw new Error('6600 万不应过 1 亿线');
});
test('流通市值 < 100亿', () => {
  if (JSON.stringify(codes('流通市值 < 100亿')) !== JSON.stringify(['301697', '920992'])) throw new Error(JSON.stringify(codes('流通市值 < 100亿')));
});
test('主力净流入 > 5000万（0 视为无数据不命中）', () => {
  const r = codes('主力净流入 > 5000万');
  if (JSON.stringify(r) !== JSON.stringify(['301697'])) throw new Error(JSON.stringify(r));
});

console.log('\n区间与逻辑：');
test('between 闭区间：涨跌幅 between 0 and 1', () => {
  if (JSON.stringify(codes('涨跌幅 between 0 and 1')) !== JSON.stringify(['600000', '920992'])) throw new Error('bad');
});
test('and 优先级高于 or（不是左到右）', () => {
  // A or B and C 应等价于 A or (B and C)
  const r = codes('量比 > 50 或 涨跌幅 < 0 且 换手率 < 1');
  if (JSON.stringify(r) !== JSON.stringify(['301697', '000001'])) throw new Error(JSON.stringify(r));
});
test('括号能强制结合：(量比>50 或 涨跌幅>10) 且 换手率<1 → 0 行', () => {
  const r = codes('(量比 > 50 或 涨跌幅 > 10) 且 换手率 < 1');
  if (r.length !== 0) throw new Error(JSON.stringify(r));
});
test('中文「且」「或」与 not 都支持', () => {
  if (JSON.stringify(codes('换手率 > 10 且 量比 > 2')) !== JSON.stringify(['301697'])) throw new Error('且');
  // 量比 > 2：600000(4.68)、301697(56.2)；920992 正好 2.0 不算大于
  if (JSON.stringify(codes('换手率 > 10 或 量比 > 2')) !== JSON.stringify(['600000', '301697'])) throw new Error('或');
  // not 是纯逻辑取反，会把无数据的行也翻成命中，这是已知语义
  if (codes('not 涨跌幅 > 5').length !== 4) throw new Error('not');
});

console.log('\n文本字段：');
test('名称 contains', () => {
  if (JSON.stringify(codes('名称 contains "银行"')) !== JSON.stringify(['600000', '000001'])) throw new Error(JSON.stringify(codes('名称 contains "银行"')));
});
test('代码 == 与 contains', () => {
  if (JSON.stringify(codes('代码 == "920992"')) !== JSON.stringify(['920992'])) throw new Error('eq');
  // 600000 / 000001 / 300750 都含 "00"
  if (codes('代码 contains "00"').length !== 3) throw new Error('contains');
});
test('文本字段用数值比较符要报错', () => {
  const r = compileFormula('名称 > 3');
  if (r.ok) throw new Error('应该报错');
  if (!/只支持/.test(r.error)) throw new Error(r.error);
});

console.log('\n书写习惯容忍：');
test('方括号包裹字段：[量比] > 2', () => {
  if (JSON.stringify(codes('[量比] > 2')) !== JSON.stringify(['600000', '301697'])) throw new Error(JSON.stringify(codes('[量比] > 2')));
});
test('全角比较符与全角数字：量比＞２', () => {
  if (JSON.stringify(codes('量比＞２')) !== JSON.stringify(['600000', '301697'])) throw new Error(JSON.stringify(codes('量比＞２')));
  if (JSON.stringify(codes('涨跌幅≤０')) !== JSON.stringify(['000001'])) throw new Error(JSON.stringify(codes('涨跌幅≤０')));
});
test('数学符号 ≥ ≤ ≠', () => {
  if (JSON.stringify(codes('量比 ≥ 4.68')) !== JSON.stringify(['600000', '301697'])) throw new Error('≥');
  if (JSON.stringify(codes('量比 ≠ 4.68')) !== JSON.stringify(['301697', '000001', '920992'])) throw new Error('≠');
});
test('between 用 ~ 或「到」分隔：between 3~7 / between 3 到 7', () => {
  if (JSON.stringify(codes('涨跌幅 between 3~7')) !== JSON.stringify([])) throw new Error('~ 应命中 0 行');
  if (JSON.stringify(codes('涨跌幅 between 0~1')) !== JSON.stringify(['600000', '920992'])) throw new Error('~');
  if (JSON.stringify(codes('涨跌幅 between 0 到 1')) !== JSON.stringify(['600000', '920992'])) throw new Error('到');
});
test('&& / || 与全角逗号（逗号当「且」）', () => {
  if (JSON.stringify(codes('量比 > 2 && 涨跌幅 > 10')) !== JSON.stringify(['301697'])) throw new Error('&&');
  if (codes('量比 > 50 || 涨跌幅 < 0').length !== 2) throw new Error('||');
  if (JSON.stringify(codes('量比 > 2，涨跌幅 > 10')) !== JSON.stringify(['301697'])) throw new Error('全角逗号');
});
test('全角括号与反引号/星号装饰', () => {
  if (JSON.stringify(codes('（量比 > 50 或 涨跌幅 > 10）且 换手率 > 10')) !== JSON.stringify(['301697'])) throw new Error('全角括号');
  if (JSON.stringify(codes('`量比` > 2')) !== JSON.stringify(['600000', '301697'])) throw new Error('反引号');
  if (JSON.stringify(codes('**量比** > 2')) !== JSON.stringify(['600000', '301697'])) throw new Error('星号');
});
test('归一化不破坏字符串字面量：全角逗号留在字符串里', () => {
  const r = compileFormula('名称 contains "银行，保险"');
  if (!r.ok) throw new Error('应该可以编译：' + r.error);
  if (r.test({ name: '某银行，保险' }) !== true) throw new Error('字符串内容被改动了');
  if (r.test({ name: '某银行,保险' }) !== false) throw new Error('半角逗号不该匹配');
});
test('归一化不破坏报错位置：位置指向原文', () => {
  const r = compileFormula('量比＞abc');
  if (r.ok) throw new Error('应该报错');
  // 「abc」从第 3 个字符开始（量比＞ = 3 个字符）
  if (r.position !== 3) throw new Error('位置应为 3，实际 ' + r.position);
});

console.log('\n错误处理：');
test('未知字段报错并给出位置', () => {
  const r = compileFormula('市梦率 > 3');
  if (r.ok) throw new Error('应该报错');
  if (!r.error.includes('未知字段')) throw new Error(r.error);
  if (typeof r.position !== 'number' || r.position < 0) throw new Error('没有位置信息');
});
test('缺少比较符 / 缺少右值 / 缺右括号 / 多余内容 都报错', () => {
  for (const [expr, pattern] of [
    ['量比', /缺少比较符/],
    ['量比 >', /数字/],
    ['(量比 > 2', /右括号/],
    ['量比 > 2 涨跌幅 > 1', /多余的内容/],
    ['量比 between 1', /and/],
    ['', /空的/],
  ]) {
    const r = compileFormula(expr);
    if (r.ok) throw new Error(`${expr} 应该报错`);
    if (!pattern.test(r.error)) throw new Error(`${expr} → ${r.error}`);
  }
});
test('超长公式被拒绝', () => {
  const r = compileFormula('量比 > 2 且 '.repeat(200));
  if (r.ok) throw new Error('应该拒绝');
  if (!/太长/.test(r.error)) throw new Error(r.error);
});
test('非法字符报错', () => {
  const single = compileFormula('量比 & 2');
  if (single.ok) throw new Error('单个 & 应该报错');
  if (!/请写/.test(single.error)) throw new Error(single.error);

  const dollar = compileFormula('量比 $ 2');
  if (dollar.ok) throw new Error('$ 应该报错');
  if (!/无法识别/.test(dollar.error)) throw new Error(dollar.error);
});

console.log('\n防御 / 基本面字段：');
test('股息率 / 分红年数 / 行业 / ROE / 负债率 都可筛选', () => {
  if (JSON.stringify(codes('股息率 > 4')) !== JSON.stringify(['600000', '000001'])) throw new Error('股息率：' + JSON.stringify(codes('股息率 > 4')));
  if (JSON.stringify(codes('分红年数 >= 3')) !== JSON.stringify(['600000', '000001'])) throw new Error('分红年数');
  if (JSON.stringify(codes('行业 contains "银行"')) !== JSON.stringify(['600000', '000001'])) throw new Error('行业');
  if (JSON.stringify(codes('ROE > 11')) !== JSON.stringify(['301697'])) throw new Error('ROE：' + JSON.stringify(codes('ROE > 11')));
  if (JSON.stringify(codes('负债率 > 90')) !== JSON.stringify(['000001'])) throw new Error('负债率');
});
test('红利类预置在构造数据上语义正确', () => {
  const core = codes('股息率 > 5 且 分红年数 >= 2 且 市盈率 between 0 and 15');
  if (JSON.stringify(core) !== JSON.stringify(['000001'])) throw new Error('高股息核心：' + JSON.stringify(core));
  const belowBook = codes('股息率 > 4 且 市净率 < 1');
  if (JSON.stringify(belowBook) !== JSON.stringify(['600000', '000001'])) throw new Error('破净高股息：' + JSON.stringify(belowBook));
  const bank = codes('行业 contains "银行" 且 股息率 > 3');
  if (JSON.stringify(bank) !== JSON.stringify(['600000', '000001'])) throw new Error('银行红利');
});

console.log('\n元数据：');
test('字段目录完整且可解析', () => {
  const catalog = getFieldCatalog();
  if (catalog.length < 12) throw new Error('字段太少 ' + catalog.length);
  for (const field of catalog) {
    if (!field.key || !field.label || !Array.isArray(field.aliases)) throw new Error(JSON.stringify(field));
  }
});
test('所有示例公式都能编译并执行', () => {
  for (const example of FORMULA_EXAMPLES) {
    const compiled = compileFormula(example.expr);
    if (!compiled.ok) throw new Error(`${example.expr} → ${compiled.error}`);
    const hit = rows.filter((row) => compiled.test(row));
    if (!Array.isArray(hit)) throw new Error('test 返回值不对');
  }
});
test('收藏夹预置全部可编译、可执行、有依据与限制说明', () => {
  if (FORMULA_PRESETS.length < 8) throw new Error('预置太少：' + FORMULA_PRESETS.length);
  const ids = new Set();
  for (const preset of FORMULA_PRESETS) {
    if (!preset.id || !preset.name || !preset.expr) throw new Error('缺字段：' + JSON.stringify(preset));
    if (ids.has(preset.id)) throw new Error('id 重复：' + preset.id);
    ids.add(preset.id);
    if (!preset.basis) throw new Error(preset.name + ' 缺依据说明');
    if (!preset.note || preset.note.length < 10) throw new Error(preset.name + ' 缺限制说明');
    const compiled = compileFormula(preset.expr);
    if (!compiled.ok) throw new Error(`${preset.name}「${preset.expr}」→ ${compiled.error}`);
    // 必须能对行求值（允许 0 命中，但不能抛）
    const hit = rows.filter((row) => compiled.test(row));
    if (!Array.isArray(hit)) throw new Error(preset.name + ' 求值异常');
  }
  const catalog = getFormulaPresets();
  if (catalog.length !== FORMULA_PRESETS.length) throw new Error('目录长度不一致');
  if (!catalog.every((preset) => preset.builtin === true && preset.id && preset.expr)) throw new Error('目录结构不对');
});
test('预置公式在真实字段上能筛出结果（用构造数据验证语义）', () => {
  // 主力资金共振：301697 主力净流入 1e8、净占比 35.7、涨幅 20.02
  const r = codes('主力净流入 > 5000万 且 主力净占比 > 5 且 涨跌幅 > 0');
  if (!r.includes('301697')) throw new Error('主力资金共振没命中贝特利：' + JSON.stringify(r));
  // 小盘活跃：301697 流通市值 42亿、换手 25.92、成交额 2.8亿（<3亿，应不命中）
  const small = codes('流通市值 between 20 and 80 亿 且 换手率 > 8 且 成交额 > 3亿');
  if (small.includes('301697')) throw new Error('成交额 2.8 亿不该过 3 亿线');
  // 低估值大盘：600000 流通市值 3390 亿、PE 6.27、PB 0.45 → 命中
  const value = codes('市盈率 between 0 and 12 且 市净率 between 0 and 1.5 且 流通市值 > 100亿');
  if (!value.includes('600000')) throw new Error('低估值大盘没命中浦发：' + JSON.stringify(value));
});
test('复杂组合公式：多条件混合', () => {
  const r = codes('(量比 > 20 且 换手率 > 10) 或 (流通市值 < 10亿 且 涨跌幅 > 0)');
  if (JSON.stringify(r) !== JSON.stringify(['301697', '920992'])) throw new Error(JSON.stringify(r));
});

console.log(`\n通过 ${passed} 项${process.exitCode ? '，存在失败项' : ''}`);
