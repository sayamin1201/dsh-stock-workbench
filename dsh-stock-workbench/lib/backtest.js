/**
 * 单股日线回测引擎（事件驱动）
 *
 * 设计要点：
 *  - 信号在 T 日收盘后确认，默认 T+1 开盘成交（避免未来函数）；也可显式选当日收盘（会警告收益偏高）
 *  - A 股规则：T+1（买入当日不可卖）、涨停不可买、跌停不可卖、停牌跳过、前复权价格
 *  - 费用：佣金（默认万 2.5，最低 5 元）、卖出印花税 0.05%、过户费 0.001%、滑点 0.1%
 *  - 规则两种：预置信号（均线金叉/MACD 金叉/20 日新高/放量上攻/多头排列/站上 60 日线）
 *    或公式表达式（复用 lib/formula.js 的解析器，逐 bar 求值）
 */

import { compileFormula } from './formula.js';
import { sma, ema, macd, rsi, kdj, boll, atr, percentileOf } from './indicators.js';

export const DEFAULT_COST = {
  commission: 0.00025, // 万 2.5
  minCommission: 5,
  stampDuty: 0.0005, // 仅卖出
  transferFee: 0.00001,
  slippage: 0.001,
};

export const EXEC_MODES = {
  nextOpen: '次日开盘（推荐，无未来函数）',
  close: '当日收盘（同 bar 成交，收益可能偏高）',
};

/** 预置信号规则（UI 下拉 + 引擎求值共用） */
export const RULE_PRESETS = {
  ma_golden: {
    label: '均线金叉',
    desc: 'MA5 上穿 MA10',
    params: { fast: 5, slow: 10 },
    buy(ctx, i, p) { return crossUp(ctx.series[`ma${p.fast}`], ctx.series[`ma${p.slow}`], i); },
    sell(ctx, i, p) { return crossDown(ctx.series[`ma${p.fast}`], ctx.series[`ma${p.slow}`], i); },
  },
  macd_golden: {
    label: 'MACD 金叉',
    desc: 'DIF 上穿 DEA',
    params: {},
    buy(ctx, i) { return crossUp(ctx.series.macd_dif, ctx.series.macd_dea, i); },
    sell(ctx, i) { return crossDown(ctx.series.macd_dif, ctx.series.macd_dea, i); },
  },
  breakout: {
    label: '20 日新高',
    desc: '收盘价突破前 N 日最高价',
    params: { lookback: 20 },
    buy(ctx, i, p) { return isBreakout(ctx.bars, i, p.lookback); },
    sell(ctx, i) { return crossDown(ctx.bars.map((b) => b.close), ctx.series.ma20, i); },
  },
  volume_surge: {
    label: '放量上攻',
    desc: '成交量 > 1.5×5日均量 且 涨幅 > 3%',
    params: {},
    buy(ctx, i) { return isVolumeSurge(ctx.bars, ctx.series, i); },
    sell(ctx, i) { return crossDown(ctx.bars.map((b) => b.close), ctx.series.ma20, i); },
  },
  ma_bull: {
    label: '多头排列',
    desc: 'MA5 > MA10 > MA20 > MA60',
    params: {},
    buy(ctx, i) {
      const { ma5, ma10, ma20, ma60 } = ctx.series;
      return [ma5, ma10, ma20, ma60].every((arr) => arr[i] != null)
        && ma5[i] > ma10[i] && ma10[i] > ma20[i] && ma20[i] > ma60[i];
    },
    sell(ctx, i) { return crossDown(ctx.bars.map((b) => b.close), ctx.series.ma20, i); },
  },
  ma60_hold: {
    label: '站上 60 日线',
    desc: '收盘价在 MA60 上方且 MA60 向上',
    params: {},
    buy(ctx, i) {
      const { ma60 } = ctx.series;
      const close = ctx.bars[i].close;
      return ma60[i] != null && ma60[i - 1] != null && close > ma60[i] && ma60[i] > ma60[i - 1];
    },
    sell(ctx, i) { return crossDown(ctx.bars.map((b) => b.close), ctx.series.ma60, i); },
  },
};

function crossUp(a, b, i) {
  return i > 0 && a[i] != null && b[i] != null && a[i - 1] != null && b[i - 1] != null
    && a[i - 1] <= b[i - 1] && a[i] > b[i];
}

function crossDown(a, b, i) {
  return i > 0 && a[i] != null && b[i] != null && a[i - 1] != null && b[i - 1] != null
    && a[i - 1] >= b[i - 1] && a[i] < b[i];
}

function isBreakout(bars, i, lookback) {
  if (i < lookback) return false;
  let priorHigh = -Infinity;
  for (let n = i - lookback; n < i; n += 1) priorHigh = Math.max(priorHigh, bars[n].high);
  return bars[i].close > priorHigh;
}

function isVolumeSurge(bars, series, i) {
  if (i < 5) return false;
  let sum = 0;
  for (let n = i - 5; n < i; n += 1) sum += bars[n].volLots ?? 0;
  const avg = sum / 5;
  return avg > 0 && (bars[i].volLots ?? 0) > avg * 1.5 && (bars[i].pct ?? 0) > 3;
}

/** 指标序列 + 逐 bar 上下文行（用于公式表达式） */
export function buildSeries(bars, valuationRows = []) {
  const closes = bars.map((bar) => bar.close);
  const series = {
    ma5: sma(closes, 5),
    ma10: sma(closes, 10),
    ma20: sma(closes, 20),
    ma60: sma(closes, 60),
    ma120: sma(closes, 120),
    ma250: sma(closes, 250),
    ema12: ema(closes, 12),
    ema26: ema(closes, 26),
  };
  const macdResult = macd(closes);
  series.macd_dif = macdResult.dif;
  series.macd_dea = macdResult.dea;
  series.macd_hist = macdResult.hist;
  series.rsi6 = rsi(closes, 6);
  series.rsi12 = rsi(closes, 12);
  series.rsi24 = rsi(closes, 24);
  const kdjResult = kdj(bars);
  series.kdj_k = kdjResult.k;
  series.kdj_d = kdjResult.d;
  series.kdj_j = kdjResult.j;
  const bollResult = boll(closes);
  series.boll_upper = bollResult.upper;
  series.boll_mid = bollResult.mid;
  series.boll_lower = bollResult.lower;
  series.atr14 = atr(bars);

  // 估值：按日期对齐（缺失向前填充）
  const valuationByDate = new Map();
  for (const row of valuationRows) valuationByDate.set(row.date, row);
  const peValues = [];
  const pbValues = [];
  const peByBar = [];
  const pbByBar = [];
  let lastPe = null;
  let lastPb = null;
  for (const bar of bars) {
    const hit = valuationByDate.get(bar.d);
    if (hit) {
      lastPe = Number.isFinite(hit.pe) && hit.pe > 0 ? hit.pe : lastPe;
      lastPb = Number.isFinite(hit.pb) && hit.pb > 0 ? hit.pb : lastPb;
    }
    peByBar.push(lastPe);
    pbByBar.push(lastPb);
    peValues.push(lastPe);
    pbValues.push(lastPb);
  }
  series.pe = peByBar;
  series.pb = pbByBar;
  series.pe_pct = peByBar.map((value, i) => percentileOf(peValues.slice(0, i + 1), value, 1250));
  series.pb_pct = pbByBar.map((value, i) => percentileOf(pbValues.slice(0, i + 1), value, 1250));

  const rows = bars.map((bar, i) => ({
    d: bar.d,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volLots,
    amount: bar.amount,
    turnover: bar.turnover,
    pct: bar.pct,
    ma5: series.ma5[i],
    ma10: series.ma10[i],
    ma20: series.ma20[i],
    ma60: series.ma60[i],
    ma120: series.ma120[i],
    ma250: series.ma250[i],
    ema12: series.ema12[i],
    ema26: series.ema26[i],
    macd_dif: series.macd_dif[i],
    macd_dea: series.macd_dea[i],
    macd_hist: series.macd_hist[i],
    rsi6: series.rsi6[i],
    rsi12: series.rsi12[i],
    rsi24: series.rsi24[i],
    kdj_k: series.kdj_k[i],
    kdj_d: series.kdj_d[i],
    kdj_j: series.kdj_j[i],
    boll_upper: series.boll_upper[i],
    boll_mid: series.boll_mid[i],
    boll_lower: series.boll_lower[i],
    atr14: series.atr14[i],
    pe: series.pe[i],
    pb: series.pb[i],
    pe_pct: series.pe_pct[i],
    pb_pct: series.pb_pct[i],
    hold_days: null,
    pnl_pct: null,
  }));

  return { series, rows };
}

/** 规则归一化：{ type:'signal', id, params } 或 { type:'expr', expr } */
export function resolveRule(rule, side) {
  const raw = rule ?? {};
  const type = raw.type === 'expr' ? 'expr' : 'signal';
  if (type === 'expr') {
    const expr = String(raw.expr ?? '').trim();
    if (!expr) throw new Error(`${side === 'buy' ? '买入' : '卖出'}表达式为空`);
    const compiled = compileFormula(expr);
    if (!compiled.ok) throw new Error(`表达式错误：${compiled.error}`);
    return { type, expr, test: (row) => compiled.test(row), describe: expr };
  }
  const id = String(raw.id ?? 'macd_golden');
  const preset = RULE_PRESETS[id];
  if (!preset) throw new Error(`未知信号：${id}`);
  const params = { ...preset.params, ...(raw.params ?? {}) };
  const key = side === 'buy' ? 'buy' : 'sell';
  return {
    type,
    id,
    params,
    test: (ctx, i) => preset[key](ctx, i, params),
    describe: `${preset.label}${params.fast ? `(${params.fast},${params.slow})` : ''}`,
  };
}

function round(value, digits = 4) {
  const base = 10 ** digits;
  return Math.round(value * base) / base;
}

/** 买入成本（含佣金/过户费/滑点） */
function buyCost(amount, cost) {
  const commission = Math.max(cost.minCommission, amount * cost.commission);
  const transfer = amount * cost.transferFee;
  return commission + transfer;
}

/** 卖出净收入（含佣金/印花税/过户费/滑点） */
function sellNet(amount, cost) {
  const commission = Math.max(cost.minCommission, amount * cost.commission);
  const stamp = amount * cost.stampDuty;
  const transfer = amount * cost.transferFee;
  return amount - commission - stamp - transfer;
}

/**
 * 执行回测。
 * @param {{bars: object[], valuationRows?: object[], buy?: object, sell?: object, capital?: number,
 *          cost?: object, exec?: 'nextOpen'|'close', years?: number, stopLossPct?: number,
 *          takeProfitPct?: number, maxHoldDays?: number}} options
 */
export function runBacktest(options) {
  const {
    bars = [],
    valuationRows = [],
    buy,
    sell,
    capital = 100000,
    cost = {},
    exec = 'nextOpen',
    stopLossPct = null,
    takeProfitPct = null,
    maxHoldDays = null,
  } = options ?? {};

  if (!Array.isArray(bars) || bars.length < 60) {
    throw new Error(`K 线数据不足（${bars.length} 根），回测至少需要 60 根`);
  }

  const warnings = [];
  if (exec === 'close') {
    warnings.push('当前为「当日收盘成交」假设：信号依赖当日收盘价，收益可能偏高（建议用次日开盘）');
  }

  const buyRule = resolveRule(buy, 'buy');
  const sellRule = resolveRule(sell, 'sell');
  const ctx = buildSeries(bars, valuationRows);
  const rows = ctx.rows;
  const costModel = { ...DEFAULT_COST, ...(cost ?? {}) };
  const slip = costModel.slippage;

  let cash = capital;
  let position = null; // { entryIndex, entryDate, entryPrice, qty, entryCost }
  const trades = [];
  const markers = [];
  const equity = [];
  let limitUpSkipped = 0;
  let limitDownSkipped = 0;
  let exposureBars = 0;

  const limitRate = 0.098; // 主板 10%，创业板/科创板 20% 这里保守用 9.8% 判断"一字板附近"

  function execIndexFor(i) {
    if (exec === 'nextOpen') return i + 1;
    return i;
  }

  function isLimitUp(bar, prevBar) {
    return prevBar && bar.open >= prevBar.close * (1 + limitRate) - 1e-6;
  }

  function isLimitDown(bar, prevBar) {
    return prevBar && bar.open <= prevBar.close * (1 - limitRate) + 1e-6;
  }

  const firstIndex = 250; // 需要 250 日均线预热
  if (bars.length <= firstIndex + 2) {
    warnings.push('历史数据不足 250 根，指标预热期会占用大部分样本');
  }
  const startIndex = Math.min(firstIndex, Math.max(1, bars.length - 2));

  for (let i = startIndex; i < rows.length; i += 1) {
    const row = rows[i];
    const prevBar = bars[i];
    // 更新持仓上下文，供表达式（hold_days / pnl_pct）使用
    if (position) {
      row.hold_days = i - position.entryIndex;
      row.pnl_pct = (row.close - position.entryPrice) / position.entryPrice;
    }

    // ① 持仓 → 卖出判定
    if (position) {
      const exitByRule = sellRule.type === 'expr' ? sellRule.test(row) : sellRule.test(ctx, i);
      const pnlPct = row.pnl_pct;
      const exitByStop = (stopLossPct != null && pnlPct <= stopLossPct)
        || (takeProfitPct != null && pnlPct >= takeProfitPct);
      const exitByHold = maxHoldDays != null && row.hold_days >= maxHoldDays;
      if (exitByRule || exitByStop || exitByHold) {
        const exIndex = execIndexFor(i);
        // T+1：卖出日必须晚于买入日
        if (exIndex <= position.entryIndex) continue;
        const exBar = bars[exIndex];
        if (!exBar) continue;
        if (isLimitDown(exBar, bars[exIndex - 1])) {
          limitDownSkipped += 1;
          continue;
        }
        const price = exec === 'nextOpen' ? exBar.open : exBar.close;
        const execPrice = price * (1 - slip);
        const gross = execPrice * position.qty;
        const net = sellNet(gross, costModel);
        cash += net;
        const pnl = net - position.entryCost;
        trades.push({
          entryDate: position.entryDate,
          entryPrice: round(position.entryPrice, 3),
          exitDate: exBar.d,
          exitPrice: round(execPrice, 3),
          qty: position.qty,
          holdDays: exIndex - position.entryIndex,
          pnl: round(pnl, 2),
          pnlPct: round(pnl / position.entryCost, 4),
          reason: exitByStop ? '止损/止盈' : exitByHold ? '持有到期' : '卖出信号',
        });
        markers.push({ date: exBar.d, side: 'sell', price: round(execPrice, 3) });
        position = null;
      }
    }

    // ② 空仓 → 买入判定
    if (!position) {
      const buyHit = buyRule.type === 'expr' ? buyRule.test(row) : buyRule.test(ctx, i);
      if (buyHit) {
        const entryIndex = execIndexFor(i);
        if (entryIndex <= i && exec === 'nextOpen') { /* 不可能 */ }
        const entryBar = bars[entryIndex];
        if (!entryBar) continue;
        if (isLimitUp(entryBar, bars[entryIndex - 1])) {
          limitUpSkipped += 1;
          continue;
        }
        const price = exec === 'nextOpen' ? entryBar.open : entryBar.close;
        const execPrice = price * (1 + slip);
        // 预留 2% 现金给费用，A 股 100 股整数倍
        const budget = cash * 0.98;
        const qty = Math.floor(budget / (execPrice * 100)) * 100;
        if (qty < 100) continue;
        const gross = execPrice * qty;
        const fee = buyCost(gross, costModel);
        if (gross + fee > cash) continue;
        cash -= gross + fee;
        position = {
          entryIndex,
          entryDate: entryBar.d,
          entryPrice: execPrice,
          qty,
          entryCost: gross + fee,
        };
        markers.push({ date: entryBar.d, side: 'buy', price: round(execPrice, 3) });
        i = entryIndex; // 直接跳到成交日，避免同一根重复判定
        exposureBars += 1;
      }
    }

    // ③ 权益曲线（收盘市值）
    if (position) exposureBars += 1;
    const marketValue = position ? rows[i].close * position.qty : 0;
    equity.push({ date: row.d, value: round(cash + marketValue, 2) });
  }

  // 期末强制平仓（按最后收盘价，计入费用）
  if (position) {
    const lastIndex = rows.length - 1;
    const lastBar = bars[lastIndex];
    const execPrice = lastBar.close * (1 - slip);
    const gross = execPrice * position.qty;
    const net = sellNet(gross, costModel);
    cash += net;
    trades.push({
      entryDate: position.entryDate,
      entryPrice: round(position.entryPrice, 3),
      exitDate: lastBar.d,
      exitPrice: round(execPrice, 3),
      qty: position.qty,
      holdDays: lastIndex - position.entryIndex,
      pnl: round(net - position.entryCost, 2),
      pnlPct: round((net - position.entryCost) / position.entryCost, 4),
      reason: '回测结束平仓',
    });
    markers.push({ date: lastBar.d, side: 'sell', price: round(execPrice, 3) });
    equity[equity.length - 1] = { date: lastBar.d, value: round(cash, 2) };
    position = null;
  }

  // ---- 指标 ----
  const startValue = equity[0]?.value ?? capital;
  const endValue = cash;
  const totalReturn = endValue / capital - 1;
  const firstDate = new Date(`${bars[Math.min(firstIndex, bars.length - 1)].d}T00:00:00Z`).getTime();
  const lastDate = new Date(`${bars[bars.length - 1].d}T00:00:00Z`).getTime();
  const years = Math.max(1 / 365, (lastDate - firstDate) / (365 * 24 * 3600 * 1000));
  const annualized = (1 + totalReturn) ** (1 / years) - 1;

  let peak = -Infinity;
  let maxDrawdown = 0;
  for (const point of equity) {
    peak = Math.max(peak, point.value);
    maxDrawdown = Math.min(maxDrawdown, point.value / peak - 1);
  }

  const dailyReturns = [];
  for (let i = 1; i < equity.length; i += 1) {
    dailyReturns.push(equity[i].value / equity[i - 1].value - 1);
  }
  const mean = dailyReturns.length ? dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length : 0;
  const variance = dailyReturns.length > 1
    ? dailyReturns.reduce((acc, r) => acc + (r - mean) ** 2, 0) / (dailyReturns.length - 1)
    : 0;
  const sharpe = variance > 0 ? (mean / Math.sqrt(variance)) * Math.sqrt(252) : 0;

  const wins = trades.filter((trade) => trade.pnl > 0);
  const grossProfit = wins.reduce((acc, trade) => acc + trade.pnl, 0);
  const grossLoss = Math.abs(trades.filter((trade) => trade.pnl <= 0).reduce((acc, trade) => acc + trade.pnl, 0));
  const buyHold = bars[bars.length - 1].close / bars[Math.min(firstIndex, bars.length - 1)].open - 1;
  const exposureDays = exposureBars;

  if (limitUpSkipped) warnings.push(`有 ${limitUpSkipped} 次买入信号因次日开盘涨停未能成交`);
  if (limitDownSkipped) warnings.push(`有 ${limitDownSkipped} 次卖出信号因次日开盘跌停未能成交`);
  if (trades.length === 0) warnings.push('回测期内没有产生任何交易，请放宽买入条件或延长区间');

  return {
    ok: true,
    metrics: {
      initialCapital: capital,
      finalValue: round(endValue, 2),
      totalReturn: round(totalReturn, 4),
      annualized: round(annualized, 4),
      maxDrawdown: round(maxDrawdown, 4),
      sharpe: round(sharpe, 2),
      winRate: trades.length ? round(wins.length / trades.length, 4) : null,
      profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss, 2) : null,
      trades: trades.length,
      avgHoldDays: trades.length
        ? round(trades.reduce((acc, trade) => acc + trade.holdDays, 0) / trades.length, 1)
        : null,
      buyHoldReturn: round(buyHold, 4),
      exposureDays,
    },
    trades,
    markers,
    equity,
    warnings,
    meta: {
      buyRule: buyRule.describe,
      sellRule: sellRule.describe,
      exec,
      cost: costModel,
      bars: bars.length,
      from: bars[0].d,
      to: bars[bars.length - 1].d,
    },
  };
}
