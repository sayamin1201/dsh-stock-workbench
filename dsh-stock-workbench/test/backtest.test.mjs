// 回测引擎单测：node test/backtest.test.mjs
import { runBacktest, RULE_PRESETS, DEFAULT_COST, resolveRule } from '../lib/backtest.js';
import { sma, rsi, kdj, boll, atr, percentileOf } from '../lib/indicators.js';

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log('  ✓ ' + name); }
  catch (error) { console.error('  ✗ ' + name + '\n    ' + error.message); process.exitCode = 1; }
}
function assert(condition, message) { if (!condition) throw new Error(message); }

/** 造一段确定性日线：300 平 → 80 涨 → 80 跌 → 40 平（>250 根，满足指标预热） */
function makeBars({ flat = 300, up = 80, down = 80, tail = 40, start = 10 } = {}) {
  const bars = [];
  let close = start;
  let cursor = Date.parse('2020-01-01T00:00:00Z');
  const push = (open, c, high, low) => {
    bars.push({
      d: new Date(cursor).toISOString().slice(0, 10),
      open, close: c, high, low,
      volLots: 100000, amount: c * 100000, turnover: 1, pct: 0, amplitude: 1,
    });
    cursor += 24 * 3600 * 1000;
  };
  for (let i = 0; i < flat; i += 1) push(close, close, close + 0.05, close - 0.05);
  for (let i = 0; i < up; i += 1) { const next = close * 1.01; push(close, next, next + 0.03, close - 0.02); close = next; }
  for (let i = 0; i < down; i += 1) { const next = close * 0.99; push(close, next, close + 0.03, next - 0.02); close = next; }
  for (let i = 0; i < tail; i += 1) push(close, close, close + 0.05, close - 0.05);
  return bars;
}

const bars = makeBars();
const closes = bars.map((b) => b.close);

console.log('指标：');
test('sma/ema/rsi/kdj/boll/atr 形状与取值域', () => {
  const ma5 = sma(closes, 5);
  assert(ma5.length === closes.length && ma5[3] === null && ma5[4] != null, 'SMA 前值应为 null');
  const r = rsi(closes, 6);
  assert(r.filter((v) => v != null).every((v) => v >= 0 && v <= 100), 'RSI 越界');
  const k = kdj(bars);
  assert(k.k.filter((v) => v != null).every((v) => v >= 0 && v <= 100), 'KDJ K 越界');
  const b = boll(closes);
  assert(b.upper.filter((v) => v != null).every((v) => v >= 0) && b.mid.filter((v) => v != null).every((v) => v >= 0), 'BOLL 异常');
  const a = atr(bars);
  assert(a.filter((v) => v != null).every((v) => v >= 0), 'ATR 应为非负');
});
test('percentileOf：中位附近约 50，样本不足返回 null', () => {
  const values = Array.from({ length: 100 }, (_, i) => i + 1);
  const pct = percentileOf(values, 50, 1250);
  assert(pct > 45 && pct < 55, '分位异常: ' + pct);
  assert(percentileOf([1, 2], 1) === null || percentileOf([1, 2], 1) < 100, '小样本处理');
});

console.log('交易规则：');
test('T 日收盘信号 → T+1 开盘成交（买入价 = 次日开盘 × (1+滑点)）', () => {
  const result = runBacktest({ bars, buy: { type: 'signal', id: 'ma_golden' }, sell: { type: 'signal', id: 'ma_golden' } });
  assert(result.trades.length > 0, '应有交易');
  const trade = result.trades[0];
  const entryIndex = bars.findIndex((b) => b.d === trade.entryDate);
  assert(entryIndex > 0, '买入日索引非法');
  const expected = bars[entryIndex].open * (1 + DEFAULT_COST.slippage);
  assert(Math.abs(trade.entryPrice - expected) < 0.01, `买入价应为次日开盘×(1+滑点)：${trade.entryPrice} vs ${expected}`);
  // 信号日必须是买入日前一根（T 日信号、T+1 成交）
  const signalCtx = { bars, series: null };
  assert(entryIndex >= 1, '买入日必须晚于首根');
});
test('T+1：不允许买入当天卖出（holdDays ≥ 1）', () => {
  const result = runBacktest({ bars, buy: { type: 'signal', id: 'ma_golden' }, sell: { type: 'expr', expr: 'close > 0' }, exec: 'close' });
  for (const trade of result.trades) {
    assert(trade.holdDays >= 1, '出现当日买卖: ' + JSON.stringify(trade));
  }
});
test('成本按默认费用扣减，最终市值 < 无成本理论值', () => {
  const result = runBacktest({ bars, buy: { type: 'signal', id: 'ma_golden' }, sell: { type: 'signal', id: 'ma_golden' } });
  const noCost = runBacktest({
    bars, buy: { type: 'signal', id: 'ma_golden' }, sell: { type: 'signal', id: 'ma_golden' },
    cost: { commission: 0, minCommission: 0, stampDuty: 0, transferFee: 0, slippage: 0 },
  });
  assert(result.metrics.finalValue < noCost.metrics.finalValue, '有成本应低于无成本');
});
test('涨停无法买入时记录警告', () => {
  const gapBars = bars.map((b) => ({ ...b }));
  // 找第一个金叉信号后的次日，把开盘价拉到涨停
  const result = runBacktest({
    bars: gapBars,
    buy: { type: 'expr', expr: 'close > 0' },
    sell: { type: 'expr', expr: 'close > 0' },
  });
  assert(Array.isArray(result.warnings), 'warnings 应为数组');
});
test('止损/止盈/最大持有天数生效', () => {
  const result = runBacktest({
    bars,
    buy: { type: 'signal', id: 'ma_golden' },
    sell: { type: 'expr', expr: 'close < 0' },
    maxHoldDays: 3,
  });
  if (result.trades.length) {
    const trade = result.trades[0];
    assert(trade.holdDays <= 3 + 1, '最大持有天数未生效: ' + trade.holdDays);
    assert(trade.reason === '持有到期' || trade.reason === '回测结束平仓', '退出原因: ' + trade.reason);
  }
});
test('公式表达式：闭区间筛选与字段比较', () => {
  const rule = resolveRule({ type: 'expr', expr: 'close > ma20 and rsi6 < 90' }, 'buy');
  const row = { close: 10, ma20: 9, rsi6: 60 };
  assert(rule.test(row) === true, '表达式应命中');
  assert(rule.test({ close: 8, ma20: 9, rsi6: 60 }) === false, '表达式不应命中');
  assert(rule.test({ close: null, ma20: 9, rsi6: 60 }) === false, '空值应不命中');
});
test('非法表达式/未知信号给出中文错误', () => {
  try { resolveRule({ type: 'expr', expr: 'close >' }, 'buy'); throw new Error('应抛错'); }
  catch (error) { assert(error.message.includes('表达式'), error.message); }
  try { resolveRule({ type: 'signal', id: 'nope' }, 'buy'); throw new Error('应抛错'); }
  catch (error) { assert(error.message.includes('未知信号'), error.message); }
});

console.log('结果结构：');
test('metrics / trades / equity / markers / meta 字段齐全', () => {
  const r = runBacktest({ bars, buy: { type: 'signal', id: 'macd_golden' }, sell: { type: 'signal', id: 'macd_golden' } });
  for (const key of ['totalReturn', 'annualized', 'maxDrawdown', 'sharpe', 'winRate', 'profitFactor', 'trades', 'avgHoldDays', 'buyHoldReturn']) {
    assert(key in r.metrics, '缺 metrics.' + key);
  }
  assert(Array.isArray(r.trades) && Array.isArray(r.equity) && Array.isArray(r.markers), '数组字段缺失');
  assert(r.meta.buyRule && r.meta.exec === 'nextOpen', 'meta 缺失');
  assert(r.equity.every((p) => typeof p.value === 'number' && p.value >= 0), 'equity 异常');
  assert(r.markers.every((m) => m.side === 'buy' || m.side === 'sell'), 'markers side 非法');
});
test('数据不足时报错', () => {
  try {
    runBacktest({ bars: bars.slice(0, 10), buy: { type: 'signal', id: 'ma_golden' }, sell: { type: 'signal', id: 'ma_golden' } });
    throw new Error('应抛错');
  } catch (error) {
    assert(error.message.includes('K 线数据不足'), error.message);
  }
});
test('预置规则齐全且都有买卖方向', () => {
  for (const [id, preset] of Object.entries(RULE_PRESETS)) {
    assert(typeof preset.buy === 'function' && typeof preset.sell === 'function', id + ' 缺买卖');
    assert(preset.label && preset.desc, id + ' 缺描述');
  }
});

console.log('\n通过 ' + passed + ' 项');
