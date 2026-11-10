/** 回测用技术指标（纯函数，输入升序数组） */

export function sma(values, window) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i] ?? 0;
    if (i >= window) sum -= values[i - window] ?? 0;
    if (i >= window - 1) out[i] = sum / window;
  }
  return out;
}

export function ema(values, window) {
  const out = new Array(values.length).fill(null);
  const k = 2 / (window + 1);
  let prev = null;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (value == null) continue;
    prev = prev == null ? value : value * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function macd(closes, fast = 12, slow = 26, signal = 9) {
  const fastEma = ema(closes, fast);
  const slowEma = ema(closes, slow);
  const dif = closes.map((_, i) => (fastEma[i] != null && slowEma[i] != null ? fastEma[i] - slowEma[i] : null));
  const dea = ema(dif.map((v) => v ?? 0), signal);
  const hist = dif.map((v, i) => (v != null && dea[i] != null ? (v - dea[i]) * 2 : null));
  return { dif, dea, hist };
}

/** Wilder RSI */
export function rsi(closes, window = 14) {
  const out = new Array(closes.length).fill(null);
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i < closes.length; i += 1) {
    const change = closes[i] - closes[i - 1];
    const gain = Math.max(0, change);
    const loss = Math.max(0, -change);
    if (i <= window) {
      avgGain += gain;
      avgLoss += loss;
      if (i === window) {
        avgGain /= window;
        avgLoss /= window;
        out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
      }
    } else {
      avgGain = (avgGain * (window - 1) + gain) / window;
      avgLoss = (avgLoss * (window - 1) + loss) / window;
      out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
  }
  return out;
}

/** KDJ(9,3,3) */
export function kdj(bars, window = 9, kSmooth = 3, dSmooth = 3) {
  const k = new Array(bars.length).fill(null);
  const d = new Array(bars.length).fill(null);
  const j = new Array(bars.length).fill(null);
  let prevK = 50;
  let prevD = 50;
  for (let i = 0; i < bars.length; i += 1) {
    if (i < window - 1) continue;
    let high = -Infinity;
    let low = Infinity;
    for (let n = i - window + 1; n <= i; n += 1) {
      high = Math.max(high, bars[n].high);
      low = Math.min(low, bars[n].low);
    }
    const rsv = high === low ? 50 : ((bars[i].close - low) / (high - low)) * 100;
    prevK = ((kSmooth - 1) * prevK + rsv) / kSmooth;
    prevD = ((dSmooth - 1) * prevD + prevK) / dSmooth;
    k[i] = prevK;
    d[i] = prevD;
    j[i] = 3 * prevK - 2 * prevD;
  }
  return { k, d, j };
}

/** 布林带(20, 2) */
export function boll(closes, window = 20, mult = 2) {
  const mid = sma(closes, window);
  const upper = new Array(closes.length).fill(null);
  const lower = new Array(closes.length).fill(null);
  for (let i = 0; i < closes.length; i += 1) {
    if (mid[i] == null) continue;
    let variance = 0;
    for (let n = i - window + 1; n <= i; n += 1) variance += (closes[n] - mid[i]) ** 2;
    const sd = Math.sqrt(variance / window);
    upper[i] = mid[i] + mult * sd;
    lower[i] = mid[i] - mult * sd;
  }
  return { mid, upper, lower };
}

/** ATR(14) */
export function atr(bars, window = 14) {
  const out = new Array(bars.length).fill(null);
  let prev = null;
  for (let i = 1; i < bars.length; i += 1) {
    const tr = Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - bars[i - 1].close),
      Math.abs(bars[i].low - bars[i - 1].close),
    );
    prev = prev == null ? tr : (prev * (window - 1) + tr) / window;
    if (i >= window) out[i] = prev;
  }
  return out;
}

/** 当前值在过去 values 中的分位（0~100，只统计正数），窗口不足返回 null */
export function percentileOf(values, current, window = 250) {
  if (current == null || !(current > 0)) return null;
  const start = Math.max(0, values.length - window);
  const pool = [];
  for (let i = start; i < values.length; i += 1) {
    const v = values[i];
    if (v != null && v > 0) pool.push(v);
  }
  if (pool.length < 20) return null;
  let below = 0;
  for (const v of pool) if (v <= current) below += 1;
  return Math.round((below / pool.length) * 1000) / 10;
}
