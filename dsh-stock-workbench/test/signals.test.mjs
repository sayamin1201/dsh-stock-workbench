// 技术信号库单元测试：node test/signals.test.mjs
import assert from 'node:assert/strict';
import {
  SIGNALS, SIGNAL_IDS, sma, ema, macd, scanBars, normalizeSignals, signalLabel,
  detectMaGolden, detectMacdGolden, detectBreakout, detectVolumeSurge, detectMaBull, detectMa60Hold,
} from '../lib/signals.js';

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

/** 用收盘价序列造 bars（high/low 按 ±0.5% 展开，量默认 1000） */
function barsFrom(closes, { volume = () => 1000 } = {}) {
  return closes.map((close, index) => {
    const prev = index === 0 ? close : closes[index - 1];
    return {
      d: `2026-01-${String((index % 28) + 1).padStart(2, '0')}`,
      open: prev,
      close,
      high: Math.max(prev, close) * 1.005,
      low: Math.min(prev, close) * 0.995,
      volLots: volume(index),
      amount: 1e7,
      pct: ((close - prev) / prev) * 100,
    };
  });
}

const flat = barsFrom(new Array(120).fill(10));
// 40 根下跌 → 60 根上涨：金叉发生在反转初期（距末尾较远）
const vShape = barsFrom([
  ...Array.from({ length: 40 }, (_, i) => 14 - i * 0.08),
  ...Array.from({ length: 60 }, (_, i) => 10.8 + i * 0.06),
]);
// 长期阴跌后在末尾 5 根急拉：金叉就在最近几天，用来测 within 窗口
const steepReversal = barsFrom([
  ...Array.from({ length: 55 }, (_, i) => 10 - i * 0.05),
  8.0, 8.8, 9.6, 10.4, 11.2,
]);
const steadyRise = barsFrom(Array.from({ length: 90 }, (_, i) => 10 + i * 0.12));

console.log('基础数学：');
test('SMA 窗口与边界', () => {
  assert.deepEqual(sma([1, 2, 3, 4, 5], 5), [null, null, null, null, 3]);
  assert.deepEqual(sma([1, 2, 3], 2), [null, 1.5, 2.5]);
  assert.equal(sma([1, 2, 3], 0).every((v) => v === null), true);
});
test('EMA 长度一致且收敛到最新值附近', () => {
  const values = [10, 10, 10, 10, 10, 20];
  const out = ema(values, 3);
  assert.equal(out.length, values.length);
  assert.ok(out[5] > 14 && out[5] < 16, 'EMA = ' + out[5]);
});
test('MACD 三条线长度一致，上涨趋势里 DIF 为正', () => {
  const closes = steadyRise.map((bar) => bar.close);
  const { dif, dea, hist } = macd(closes);
  assert.equal(dif.length, closes.length);
  assert.equal(dea.length, closes.length);
  assert.equal(hist.length, closes.length);
  assert.ok(dif.at(-1) > 0, 'DIF = ' + dif.at(-1));
});

console.log('\n金叉：');
test('急拉反转里，均线金叉出现在最近几天（within 窗口生效）', () => {
  const result = detectMaGolden(steepReversal, { within: 10 });
  assert.equal(result.hit, true, '没抓到金叉');
  assert.ok(result.daysAgo <= 10, 'daysAgo = ' + result.daysAgo);
  assert.ok(result.detail.includes('上穿'), result.detail);
});
test('within 越小越严格：全窗口能抓到，只看今天可能抓不到', () => {
  const all = detectMaGolden(vShape, { within: vShape.length });
  assert.equal(all.hit, true, '全窗口应该能抓到历史金叉');
  assert.ok(all.daysAgo > 0, '这个金叉应该不在今天');
  const today = detectMaGolden(vShape, { within: 0 });
  assert.equal(today.hit, false, '历史金叉不该被算成今天');
});
test('横盘无趋势不产出均线金叉 / MACD 金叉', () => {
  assert.equal(detectMaGolden(flat, { within: 30 }).hit, false);
  assert.equal(detectMacdGolden(flat, { within: 30 }).hit, false);
});
test('急拉反转里存在 MACD 金叉（EMA 滞后，窗口放宽到 25）', () => {
  const result = detectMacdGolden(steepReversal, { within: 25 });
  assert.equal(result.hit, true, '没抓到 MACD 金叉');
  assert.ok(result.detail.includes('DIF'), result.detail);
});

console.log('\n突破 / 量能 / 排列：');
test('20 日新高：收盘破前高命中，未破不命中', () => {
  const base = new Array(25).fill(10);
  const hitBars = barsFrom([...base, 10.8]);
  const missBars = barsFrom([...base, 10.01]);
  assert.equal(detectBreakout(hitBars, { lookback: 20 }).hit, true);
  assert.equal(detectBreakout(missBars, { lookback: 20 }).hit, false);
  assert.equal(detectBreakout(barsFrom(base), { lookback: 20 }).hit, false, '数据不足应为 false');
});
test('放量上攻：量 4 倍 + 涨 5% 命中，只放量不涨则不命中', () => {
  const closes = [...new Array(10).fill(10), 10.5];
  const upBars = barsFrom(closes, { volume: (i) => (i === 10 ? 4000 : 1000) });
  const flatClose = barsFrom([...new Array(10).fill(10), 10.01], { volume: (i) => (i === 10 ? 4000 : 1000) });
  const surge = detectVolumeSurge(upBars);
  assert.equal(surge.hit, true, '没命中');
  assert.ok(surge.values.multiple >= 3.9, '倍数 ' + surge.values.multiple);
  assert.equal(detectVolumeSurge(flatClose).hit, false, '不涨不该命中');
});
test('多头排列：持续上涨 90 根命中，横盘不命中', () => {
  assert.equal(detectMaBull(steadyRise).hit, true);
  assert.equal(detectMaBull(flat).hit, false);
});
test('站上 60 日线：上升趋势命中，数据不足不命中', () => {
  assert.equal(detectMa60Hold(steadyRise).hit, true);
  assert.equal(detectMa60Hold(barsFrom(new Array(30).fill(10))).hit, false);
});

console.log('\n组合与容错：');
test('scanBars 只跑请求的信号，并汇总命中', () => {
  const { hits, checked } = scanBars(steadyRise, ['ma_bull', 'breakout']);
  assert.deepEqual(checked.sort(), ['breakout', 'ma_bull']);
  assert.ok(hits.some((hit) => hit.id === 'ma_bull'), '多头排列应命中');
  assert.ok(!hits.some((hit) => hit.id === 'macd_golden'), '不该跑未请求的信号');
});
test('scanBars 遇到坏数据不抛异常', () => {
  const broken = [{ close: null }, { close: 'x' }, {}];
  const { hits } = scanBars(broken, SIGNAL_IDS);
  assert.equal(Array.isArray(hits), true);
});
test('normalizeSignals：过滤未知 id、去重、空值回落默认', () => {
  assert.deepEqual(normalizeSignals('ma_golden,unknown,macd_golden,ma_golden'), ['ma_golden', 'macd_golden']);
  assert.deepEqual(normalizeSignals(''), ['ma_golden', 'macd_golden']);
  assert.deepEqual(normalizeSignals(['nope']), ['ma_golden', 'macd_golden']);
});
test('信号元数据完整（id/label/desc 都不缺）', () => {
  assert.equal(SIGNALS.length, SIGNAL_IDS.length);
  for (const signal of SIGNALS) {
    assert.ok(signal.id && signal.label && signal.desc, JSON.stringify(signal));
    assert.equal(signalLabel(signal.id), signal.label);
  }
});

console.log(`\n通过 ${passed} 项${process.exitCode ? '，存在失败项' : ''}`);
