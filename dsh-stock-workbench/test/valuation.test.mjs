// 估值分位纯逻辑单测：node test/valuation.test.mjs
import { sampleDates, computePercentile } from '../lib/valuation-bulk.js';

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log('  ✓ ' + name); }
  catch (error) { console.error('  ✗ ' + name + '\n    ' + error.message); process.exitCode = 1; }
}
function assert(condition, message) { if (!condition) throw new Error(message); }

console.log('采样日期：');
test('默认 60 个日期、唯一、格式 YYYY-MM-DD', () => {
  const dates = sampleDates(Date.parse('2026-11-05T09:00:00+08:00'));
  assert(dates.length === 60, '数量 ' + dates.length);
  assert(new Set(dates).size === 60, '存在重复');
  assert(dates.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)), '格式不对');
  assert(dates[0] === '2026-11-05', '首个日期 ' + dates[0]);
});
test('月份往前推跨年正确', () => {
  const dates = sampleDates(Date.parse('2026-02-15T00:00:00Z'), 3);
  assert(dates[0] === '2026-02-15' && dates[1] === '2026-01-15' && dates[2] === '2025-12-15', dates.join(','));
});

console.log('百分位计算：');
test('中位数 → 50', () => {
  assert(computePercentile([1, 2, 3, 4, 5], 3) === 60, String(computePercentile([1, 2, 3, 4, 5], 3)));
});
test('最小值 → 最低分位、最大值 → 100', () => {
  assert(computePercentile([5, 6, 7, 8], 1) === 0, '最小值');
  assert(computePercentile([5, 6, 7, 8], 100) === 100, '最大值');
});
test('负数/零样本剔除，当前值非正返回 null', () => {
  assert(computePercentile([-5, 0, 10, 20], 15) !== null, '应能算');
  assert(computePercentile([-5, 0], 10) === null, '无正样本应为 null');
  assert(computePercentile([1, 2, 3], -1) === null, '当前值非正应为 null');
  assert(computePercentile([1, 2, 3], null) === null, '当前值 null 应为 null');
});
test('空数组返回 null', () => {
  assert(computePercentile([], 10) === null);
});

console.log('\n通过 ' + passed + ' 项');
