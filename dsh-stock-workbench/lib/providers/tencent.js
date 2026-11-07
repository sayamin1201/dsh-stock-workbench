/**
 * 数据源：腾讯行情（备用 / 可切换）
 *
 * 能力（实测 2026-11-07）：
 *  - 快照：qt.gtimg.cn/q=sh600036,sz000001（GBK，~50 字段），含价格/涨跌幅/成交额/换手/量比/振幅/PE/PB/市值
 *  - 日K：web.ifzq.gtimg.cn/appstock/app/fqkline/get（前复权）
 *  - 分时：appstock/app/minute/query
 *  - 指数：同上快照接口
 *  - 不支持：主力净流入、ROE/毛利率等基本面、所属概念/地域板块、5日涨跌/涨速
 *
 * 字段下标（实测）：1 名称 2 代码 3 现价 4 昨收 5 今开 6 成交量(手) 30 时间
 * 31 涨跌额 32 涨跌幅 33 最高 34 最低 36 成交量(手) 37 成交额(万元) 38 换手%
 * 39 PE(TTM) 43 振幅% 44 流通市值(亿) 45 总市值(亿) 46 PB 49 量比
 */

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  Referer: 'https://gu.qq.com/',
};

const BATCH = 200;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class TencentError extends Error {
  constructor(message, { url } = {}) {
    super(message);
    this.name = 'TencentError';
    this.url = url;
  }
}

/** 东方财富 secid（1.600036 / 0.000001 / 0.920007）→ 腾讯代码（sh600036 / sz000001 / bj920007） */
export function secidToTencent(secid) {
  const [market, code] = String(secid ?? '').split('.');
  if (!code) return String(secid ?? '');
  if (market === '1') return `sh${code}`;
  if (/^(92|8|4)/.test(code)) return `bj${code}`;
  return `sz${code}`;
}

/** 腾讯代码 → 东方财富 secid */
export function tencentToSecid(symbol) {
  const match = /^(sh|sz|bj)(\d{6})$/.exec(String(symbol ?? ''));
  if (!match) return null;
  const [, prefix, code] = match;
  if (prefix === 'sh') return `1.${code}`;
  return `0.${code}`;
}

function classifyBoard(code, name = '') {
  if (!code) return 'unknown';
  if (/^68[89]/.test(code)) return 'star';
  if (/^30[012]/.test(code)) return 'chinext';
  if (/^(92|8|4)/.test(code)) return 'bse';
  if (/^60/.test(code)) return 'sh-main';
  if (/^00/.test(code)) return 'sz-main';
  return name.includes('ST') ? 'unknown' : 'unknown';
}

const num = (value) => {
  const parsed = Number.parseFloat(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
};

function decodeGbk(buffer) {
  try {
    return new TextDecoder('gbk').decode(buffer);
  } catch {
    return Buffer.from(buffer).toString('latin1');
  }
}

async function getText(url, { timeout = 10000, retries = 2 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(timeout) });
      if (!response.ok) throw new TencentError(`HTTP ${response.status}`, { url });
      return decodeGbk(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt < retries) await sleep(400 * 2 ** attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new TencentError(String(lastError), { url });
}

async function getJson(url, { timeout = 10000, retries = 2 } = {}) {
  const text = await getText(url, { timeout, retries });
  try {
    return JSON.parse(text);
  } catch {
    throw new TencentError('返回不是 JSON', { url });
  }
}

/** 解析一行腾讯快照 → 标准行（散字段为 null） */
export function parseTencentQuote(line, quoteTime = null) {
  const fields = String(line ?? '').split('~');
  const code = fields[2];
  if (!/^\d{6}$/.test(String(code ?? ''))) return null;
  const price = num(fields[3]);
  if (price === null) return null; // 停牌/退市占位
  const preClose = num(fields[4]);
  const pct = num(fields[32]);
  return {
    code,
    market: /^6/.test(code) ? 1 : 0,
    secid: tencentToSecid((fields[0] ?? '').replace(/^v_/, '').replace(/=.*$/, '')) ?? `${/^6/.test(code) ? 1 : 0}.${code}`,
    name: fields[1] ?? '',
    board: classifyBoard(code, fields[1] ?? ''),
    industry: '',
    regionBoard: '',
    concepts: '',
    price,
    pct,
    chg: num(fields[31]),
    volLots: num(fields[36]),
    amount: (num(fields[37]) ?? 0) * 1e4 || null,
    amplitude: num(fields[43]),
    turnover: num(fields[38]),
    pe: num(fields[39]),
    volumeRatio: num(fields[49]),
    pct5m: null,
    preClose,
    mcap: (num(fields[45]) ?? 0) * 1e8 || null,
    floatMcap: (num(fields[44]) ?? 0) * 1e8 || null,
    speed: null,
    pb: num(fields[46]),
    pct60d: null,
    pctYtd: null,
    mainIn: null,
    mainInPct: null,
    pct5d: null,
    roe: null,
    revenueYoy: null,
    profitYoy: null,
    grossMargin: null,
    debtRatio: null,
    eps: null,
    bvps: null,
    ps: null,
    open: num(fields[5]),
    high: num(fields[33]),
    low: num(fields[34]),
    quoteTime: quoteTime ?? fields[30] ?? null,
    dividendPerShare: null,
    dividendYield: null,
    dividendYears: 0,
    dividendConsecutive: 0,
    lastDividendDate: null,
  };
}

/** 解析腾讯快照文本（多行 v_xxx="..."） */
export function parseTencentSnapshot(text) {
  const rows = [];
  for (const rawLine of String(text ?? '').split(';')) {
    if (!rawLine.includes('~')) continue;
    const row = parseTencentQuote(rawLine);
    if (row) rows.push(row);
  }
  return rows;
}

export async function fetchSnapshot(secids, { concurrency = 4 } = {}) {
  const symbols = secids.map((secid) => secidToTencent(secid));
  const batches = [];
  for (let i = 0; i < symbols.length; i += BATCH) batches.push(symbols.slice(i, i + BATCH));

  const rows = [];
  const failed = [];
  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, async () => {
    while (batches.length) {
      const batch = batches.shift();
      try {
        const text = await getText(`https://qt.gtimg.cn/q=${batch.join(',')}`);
        rows.push(...parseTencentSnapshot(text));
      } catch (error) {
        failed.push({ size: batch.length, error: error.message });
      }
    }
  }));

  if (!rows.length) throw new TencentError(`腾讯快照全部失败：${failed[0]?.error ?? 'unknown'}`);

  // 去重（分页边界/重复代码）+ 过滤停牌占位（price<=0）
  const seen = new Set();
  const cleaned = [];
  for (const row of rows) {
    if (!row || !row.code || seen.has(row.code)) continue;
    if (!(row.price > 0)) continue;
    // 停牌/退市占位：当日无成交（价格为最后成交价）
    if (!(row.amount > 0) && !(row.volLots > 0)) continue;
    seen.add(row.code);
    cleaned.push(row);
  }
  cleaned.sort((a, b) => ((a.pct ?? -Infinity) < (b.pct ?? -Infinity) ? 1 : -1));
  return { rows: cleaned, failed };
}

const INDEX_SYMBOLS = [
  ['sh000001', '上证指数', '000001'],
  ['sz399001', '深证成指', '399001'],
  ['sz399006', '创业板指', '399006'],
  ['sh000688', '科创50', '000688'],
  ['bj899050', '北证50', '899050'],
];

export async function fetchIndices() {
  const symbols = INDEX_SYMBOLS.map(([symbol]) => symbol).join(',');
  const text = await getText(`https://qt.gtimg.cn/q=${symbols}`);
  const bySymbol = new Map();
  for (const line of text.split(';')) {
    const fields = line.split('~');
    const raw = (fields[0] ?? '').replace(/^v_/, '').replace(/=.*$/, '');
    if (raw) bySymbol.set(raw, fields);
  }
  return INDEX_SYMBOLS.map(([symbol, name, code]) => {
    const fields = bySymbol.get(symbol) ?? [];
    return {
      code,
      name,
      price: num(fields[3]),
      pct: num(fields[32]),
      chg: num(fields[31]),
      amount: (num(fields[37]) ?? 0) * 1e4 || null,
      high: num(fields[33]),
      low: num(fields[34]),
      open: num(fields[5]),
      preClose: num(fields[4]),
    };
  });
}

const KLINE_TYPE = { 101: 'day', 102: 'week', 103: 'month' };

export async function fetchKline(secid, { klt = 101, lmt = 120 } = {}) {
  const type = KLINE_TYPE[klt];
  if (!type) throw new TencentError(`腾讯源不支持该周期：klt=${klt}`);
  const symbol = secidToTencent(secid);
  const json = await getJson(
    `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${symbol},${type},,,${Math.min(lmt, 640)},qfq`,
  );
  const payload = json?.data?.[symbol] ?? {};
  const bars = payload[`qfq${type}`] ?? payload[type] ?? [];
  return {
    name: payload?.qt?.[symbol]?.[1] ?? null,
    preKPrice: num(payload?.prec),
    bars: bars.map((bar) => {
      const [d, open, close, high, low, volLots] = bar;
      return {
        d,
        open: +open,
        close: +close,
        high: +high,
        low: +low,
        volLots: +volLots,
        amount: null,
        amplitude: null,
        pct: null,
        chg: null,
        turnover: null,
      };
    }),
  };
}

export async function fetchTrends(secid, { ndays = 1 } = {}) {
  const symbol = secidToTencent(secid);
  const json = await getJson(`https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=${symbol}&ndays=${ndays}`);
  const payload = json?.data?.[symbol] ?? {};
  const rows = payload?.data?.data ?? [];
  const qt = payload?.qt?.[symbol];
  return {
    preClose: num(qt?.[4]),
    points: rows.map((line) => {
      const [time, price, volLots, amount] = String(line).split(' ');
      return {
        time: `${time.slice(0, 2)}:${time.slice(2)}`,
        open: +price,
        close: +price,
        high: +price,
        low: +price,
        volLots: +volLots || 0,
        amount: +amount || 0,
        avg: null,
      };
    }),
  };
}

export const tencentProvider = {
  id: 'tencent',
  label: '腾讯行情',
  capabilities: {
    universe: false,
    snapshot: true,
    indices: true,
    breadth: false,
    kline: true,
    trends: true,
    fundamentals: false,
    mainIn: false,
    concepts: false,
  },
  missingFields: [
    'mainIn', 'mainInPct', 'roe', 'revenueYoy', 'profitYoy', 'grossMargin',
    'debtRatio', 'eps', 'bvps', 'ps', 'pct5d', 'speed', 'pct5m',
    'industry', 'regionBoard', 'concepts',
  ],
  snapshot: fetchSnapshot,
  indices: fetchIndices,
  kline: fetchKline,
  trends: fetchTrends,
};
