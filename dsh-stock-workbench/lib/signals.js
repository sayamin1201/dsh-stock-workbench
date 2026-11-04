/**
 * 技术信号库（纯函数，无网络、无 IO）
 *
 * 输入统一是 lib/market.js getKline() 返回的 bars：
 * [{ d, open, close, high, low, volLots, amount, amplitude, pct, chg, turnover }]
 *
 * 所有 detector 返回 { id, hit, daysAgo?, detail, values? }。
 * "金叉"一律用「上一根还在下方、这一根穿到上方」判定，避免把持续多日的多头
 * 排列误报成当日金叉。
 */

export const SIGNALS = [
  { id: 'ma_golden', label: '均线金叉', desc: 'MA5 上穿 MA10' },
  { id: 'macd_golden', label: 'MACD 金叉', desc: 'DIF 上穿 DEA' },
  { id: 'breakout', label: '20 日新高', desc: '收盘价突破前 20 日最高价' },
  { id: 'volume_surge', label: '放量上攻', desc: '成交量 > 1.5×5日均量 且 涨幅 > 3%' },
  { id: 'ma_bull', label: '多头排列', desc: 'MA5 > MA10 > MA20 > MA60' },
  { id: 'ma60_hold', label: '站上 60 日线', desc: '收盘价在 MA60 上方且 MA60 向上' },
];

export const SIGNAL_IDS = SIGNALS.map((signal) => signal.id);

/** 简单移动平均；不足窗口的位置是 null */
export function sma(values, window) {
  const out = new Array(values.length).fill(null);
  if (window <= 0) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= window) sum -= values[i - window];
    if (i >= window - 1) out[i] = sum / window;
  }
  return out;
}

/** 指数移动平均；第一个值作为种子 */
export function ema(values, window) {
  const out = new Array(values.length).fill(null);
  if (values.length === 0) return out;
  const k = 2 / (window + 1);
  let prev = values[0];
  out[0] = prev;
  for (let i = 1; i < values.length; i += 1) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** MACD(12,26,9)：返回 dif / dea / hist */
export function macd(closes, fast = 12, slow = 26, signal = 9) {
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const dif = closes.map((_, i) =>
    emaFast[i] == null || emaSlow[i] == null ? null : emaFast[i] - emaSlow[i]);
  const dea = ema(dif.map((value) => value ?? 0), signal);
  const hist = dif.map((value, i) => (value == null || dea[i] == null ? null : (value - dea[i]) * 2));
  return { dif, dea, hist };
}

const round = (value, digits = 2) =>
  typeof value === 'number' && Number.isFinite(value) ? Number(value.toFixed(digits)) : null;

/** 在第 index 根是否发生 a 上穿 b */
function isCrossAbove(a, b, index) {
  if (index < 1) return false;
  const a0 = a[index];
  const b0 = b[index];
  const a1 = a[index - 1];
  const b1 = b[index - 1];
  if (a0 == null || b0 == null || a1 == null || b1 == null) return false;
  return a1 <= b1 && a0 > b0;
}

/**
 * 从最后一根往前找 within 天内的金叉。
 * within = 0 表示只看今天。
 */
function findCross(a, b, within) {
  const last = a.length - 1;
  for (let offset = 0; offset <= within; offset += 1) {
    const index = last - offset;
    if (index < 1) break;
    if (isCrossAbove(a, b, index)) return { index, daysAgo: offset };
  }
  return null;
}

function pctChange(bars, index) {
  const bar = bars[index];
  const prev = bars[index - 1];
  if (!bar || !prev || !prev.close) return null;
  return ((bar.close - prev.close) / prev.close) * 100;
}

// ---------------------------------------------------------------------------
// Detectors
// ---------------------------------------------------------------------------

export function detectMaGolden(bars, { fast = 5, slow = 10, within = 0 } = {}) {
  const closes = bars.map((bar) => bar.close);
  const fastMa = sma(closes, fast);
  const slowMa = sma(closes, slow);
  const cross = findCross(fastMa, slowMa, within);
  if (!cross) return { id: 'ma_golden', hit: false };
  return {
    id: 'ma_golden',
    hit: true,
    daysAgo: cross.daysAgo,
    detail: `MA${fast} 上穿 MA${slow}（${round(fastMa[cross.index])} > ${round(slowMa[cross.index])}）`,
    values: { fast: round(fastMa[cross.index]), slow: round(slowMa[cross.index]) },
  };
}

export function detectMacdGolden(bars, { within = 0 } = {}) {
  const closes = bars.map((bar) => bar.close);
  const { dif, dea } = macd(closes);
  const cross = findCross(dif, dea, within);
  if (!cross) return { id: 'macd_golden', hit: false };
  return {
    id: 'macd_golden',
    hit: true,
    daysAgo: cross.daysAgo,
    detail: `DIF ${round(dif[cross.index], 3)} 上穿 DEA ${round(dea[cross.index], 3)}`,
    values: { dif: round(dif[cross.index], 3), dea: round(dea[cross.index], 3) },
  };
}

export function detectBreakout(bars, { lookback = 20 } = {}) {
  const last = bars.length - 1;
  if (last < lookback) return { id: 'breakout', hit: false };
  const bar = bars[last];
  let priorHigh = -Infinity;
  for (let i = last - lookback; i < last; i += 1) {
    if (bars[i].high > priorHigh) priorHigh = bars[i].high;
  }
  if (!(bar.close > priorHigh)) return { id: 'breakout', hit: false };
  return {
    id: 'breakout',
    hit: true,
    daysAgo: 0,
    detail: `收盘 ${round(bar.close)} 突破前 ${lookback} 日高点 ${round(priorHigh)}`,
    values: { close: round(bar.close), priorHigh: round(priorHigh) },
  };
}

export function detectVolumeSurge(bars, { ratio = 1.5, minPct = 3, window = 5 } = {}) {
  const last = bars.length - 1;
  if (last < window + 1) return { id: 'volume_surge', hit: false };
  const bar = bars[last];
  let sum = 0;
  for (let i = last - window; i < last; i += 1) sum += bars[i].volLots ?? 0;
  const avg = sum / window;
  const pct = pctChange(bars, last);
  if (!(avg > 0) || !(pct != null && pct >= minPct)) return { id: 'volume_surge', hit: false };
  const multiple = (bar.volLots ?? 0) / avg;
  if (multiple < ratio) return { id: 'volume_surge', hit: false };
  return {
    id: 'volume_surge',
    hit: true,
    daysAgo: 0,
    detail: `量能 ${round(multiple)}× 5日均量，涨幅 ${round(pct)}%`,
    values: { multiple: round(multiple), pct: round(pct) },
  };
}

export function detectMaBull(bars) {
  const last = bars.length - 1;
  const closes = bars.map((bar) => bar.close);
  const [ma5, ma10, ma20, ma60] = [5, 10, 20, 60].map((window) => sma(closes, window));
  if (last < 60 || ma60[last] == null) return { id: 'ma_bull', hit: false };
  const ok = ma5[last] > ma10[last] && ma10[last] > ma20[last] && ma20[last] > ma60[last];
  if (!ok) return { id: 'ma_bull', hit: false };
  return {
    id: 'ma_bull',
    hit: true,
    daysAgo: 0,
    detail: `MA5 ${round(ma5[last])} > MA10 ${round(ma10[last])} > MA20 ${round(ma20[last])} > MA60 ${round(ma60[last])}`,
    values: { ma5: round(ma5[last]), ma10: round(ma10[last]), ma20: round(ma20[last]), ma60: round(ma60[last]) },
  };
}

export function detectMa60Hold(bars, { lookback = 5 } = {}) {
  const last = bars.length - 1;
  if (last < 60 + lookback) return { id: 'ma60_hold', hit: false };
  const closes = bars.map((bar) => bar.close);
  const ma60 = sma(closes, 60);
  const bar = bars[last];
  if (ma60[last] == null || !(bar.close > ma60[last])) return { id: 'ma60_hold', hit: false };
  // MA60 本身要向上，避免"下跌趋势里反抽到均线"被当成强势
  if (!(ma60[last] > ma60[last - lookback])) return { id: 'ma60_hold', hit: false };
  return {
    id: 'ma60_hold',
    hit: true,
    daysAgo: 0,
    detail: `收盘 ${round(bar.close)} 站上 MA60 ${round(ma60[last])}，MA60 向上`,
    values: { close: round(bar.close), ma60: round(ma60[last]) },
  };
}

const DETECTORS = {
  ma_golden: detectMaGolden,
  macd_golden: detectMacdGolden,
  breakout: detectBreakout,
  volume_surge: detectVolumeSurge,
  ma_bull: detectMaBull,
  ma60_hold: detectMa60Hold,
};

/** 支持「最近 N 日」窗口的信号（趋势/突破/量能天然只有当日） */
const WINDOWED = new Set(['ma_golden', 'macd_golden']);

/**
 * 对一只股票的 bars 跑指定信号。
 * @param {Array<object>} bars
 * @param {string[]} signalIds
 * @param {{within?: number}} [options] within = 金叉允许出现在最近几天（0=今天）
 * @returns {{ hits: Array<object>, checked: string[] }}
 */
export function scanBars(bars, signalIds, options = {}) {
  const ids = signalIds && signalIds.length ? signalIds : SIGNAL_IDS;
  const within = Math.max(0, Math.min(10, Math.round(Number(options.within) || 0)));
  const hits = [];
  const checked = [];
  for (const id of ids) {
    const detector = DETECTORS[id];
    if (!detector) continue;
    checked.push(id);
    try {
      const result = WINDOWED.has(id) ? detector(bars, { within }) : detector(bars);
      if (result && result.hit) hits.push(result);
    } catch {
      // 单只股票的数据异常不该让整次扫描失败
    }
  }
  return { hits, checked };
}

/** 信号 id → 展示用名称（客户端也会用同一份定义） */
export function signalLabel(id) {
  return SIGNALS.find((signal) => signal.id === id)?.label ?? id;
}

/** 校验并归一化信号列表：未知 id 丢掉，空则回落默认两个 */
export function normalizeSignals(raw) {
  const list = Array.isArray(raw)
    ? raw
    : String(raw ?? '').split(',').map((item) => item.trim()).filter(Boolean);
  const ids = [];
  for (const id of list) {
    if (DETECTORS[id] && !ids.includes(id)) ids.push(id);
  }
  return ids.length ? ids : ['ma_golden', 'macd_golden'];
}
