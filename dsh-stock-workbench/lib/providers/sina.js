/**
 * 数据源：新浪行情（备用 / 可切换）
 *
 * 能力（实测 2026-11-07）：
 *  - 快照：hq.sinajs.cn/list=sh600036（GBK），价格/昨收/开高低/成交量额；**无 PE/PB/市值/换手**
 *  - 日K/周K：quotes.sina.cn ... getKLineData（scale=240 日 / 1200 周）
 *  - 指数：hq.sinajs.cn/list=s_sh000001（名称/点位/涨跌幅/成交额）
 *  - 不支持：分时、主力净流入、基本面、概念板块
 */

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  Referer: 'https://finance.sina.com.cn/',
};

const BATCH = 80; // 新浪 list 参数有 URL 长度限制，80 个/批实测稳定

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class SinaError extends Error {
  constructor(message, { url } = {}) {
    super(message);
    this.name = 'SinaError';
    this.url = url;
  }
}

/** 东方财富 secid（1.600036 / 0.000001 / 0.920007）→ 新浪代码（sh600036 / sz000001 / bj920007） */
export function secidToSina(secid) {
  const [market, code] = String(secid ?? '').split('.');
  if (!code) return String(secid ?? '');
  if (market === '1') return `sh${code}`;
  if (/^(92|8|4)/.test(code)) return `bj${code}`;
  return `sz${code}`;
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
      if (!response.ok) throw new SinaError(`HTTP ${response.status}`, { url });
      return decodeGbk(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt < retries) await sleep(400 * 2 ** attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new SinaError(String(lastError), { url });
}

/** 解析一条新浪快照 → 标准行（新浪只有行情字段，估值/主力/基本面为 null） */
export function parseSinaQuote(symbol, body) {
  const parts = String(body ?? '').split(',');
  if (parts.length < 32) return null;
  const code = String(symbol ?? '').replace(/^(sh|sz|bj)/, '');
  if (!/^\d{6}$/.test(code)) return null;
  const price = num(parts[3]);
  const prevClose = num(parts[2]);
  if (price === null || prevClose === null) return null;
  const chg = price - prevClose;
  return {
    code,
    market: /^6/.test(code) ? 1 : 0,
    secid: `${/^6/.test(code) ? 1 : 0}.${code}`,
    name: parts[0] ?? '',
    board: classifyBoard(code, parts[0] ?? ''),
    industry: '',
    regionBoard: '',
    concepts: '',
    price,
    pct: prevClose > 0 ? Math.round((chg / prevClose) * 10000) / 100 : null,
    chg: Math.round(chg * 1000) / 1000,
    volLots: num(parts[8]) !== null ? Math.round(num(parts[8]) / 100) : null,
    amount: num(parts[9]),
    amplitude: prevClose > 0 && num(parts[4]) !== null && num(parts[5]) !== null
      ? Math.round(((num(parts[4]) - num(parts[5])) / prevClose) * 10000) / 100
      : null,
    turnover: null,
    pe: null,
    volumeRatio: null,
    pct5m: null,
    preClose: prevClose,
    mcap: null,
    floatMcap: null,
    speed: null,
    pb: null,
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
    open: num(parts[1]),
    high: num(parts[4]),
    low: num(parts[5]),
    quoteTime: parts[30] ? `${parts[30]} ${parts[31] ?? ''}`.trim() : null,
    dividendPerShare: null,
    dividendYield: null,
    dividendYears: 0,
    dividendConsecutive: 0,
    lastDividendDate: null,
  };
}

/** 解析新浪快照文本：var hq_str_sh600036="..."; */
export function parseSinaSnapshot(text) {
  const rows = [];
  const pattern = /var hq_str_(s?[a-z]{2}\d{6})="([^"]*)"/g;
  let match = pattern.exec(String(text ?? ''));
  while (match) {
    const [, symbol, body] = match;
    const row = parseSinaQuote(symbol, body);
    if (row) rows.push(row);
    match = pattern.exec(String(text ?? ''));
  }
  return rows;
}

export async function fetchSnapshot(secids, { concurrency = 4 } = {}) {
  const symbols = secids.map((secid) => secidToSina(secid));
  const batches = [];
  for (let i = 0; i < symbols.length; i += BATCH) batches.push(symbols.slice(i, i + BATCH));
  const rows = [];
  const failed = [];
  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, async () => {
    while (batches.length) {
      const batch = batches.shift();
      try {
        const text = await getText(`https://hq.sinajs.cn/list=${batch.join(',')}`);
        rows.push(...parseSinaSnapshot(text));
      } catch (error) {
        failed.push({ size: batch.length, error: error.message });
      }
    }
  }));
  if (!rows.length) throw new SinaError(`新浪快照全部失败：${failed[0]?.error ?? 'unknown'}`);
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
  ['s_sh000001', '上证指数', '000001'],
  ['s_sz399001', '深证成指', '399001'],
  ['s_sz399006', '创业板指', '399006'],
  ['s_sh000688', '科创50', '000688'],
  ['s_bj899050', '北证50', '899050'],
];

export async function fetchIndices() {
  const text = await getText(`https://hq.sinajs.cn/list=${INDEX_SYMBOLS.map(([symbol]) => symbol).join(',')}`);
  return INDEX_SYMBOLS.map(([symbol, name, code]) => {
    const match = new RegExp(`var hq_str_${symbol}="([^"]*)"`).exec(text);
    const parts = (match?.[1] ?? '').split(',');
    const price = num(parts[1]);
    return {
      code,
      name,
      price,
      pct: num(parts[3]),
      chg: num(parts[2]),
      amount: (num(parts[5]) ?? 0) * 1e4 || null,
      high: null,
      low: null,
      open: null,
      preClose: price !== null && num(parts[2]) !== null ? Math.round((price - num(parts[2])) * 1000) / 1000 : null,
    };
  });
}

const SCALE = { 101: 240, 102: 1200, 103: 7200, 60: 60, 30: 30, 15: 15, 5: 5 };

export async function fetchKline(secid, { klt = 101, lmt = 120 } = {}) {
  const scale = SCALE[klt];
  if (!scale) throw new SinaError(`新浪源不支持该周期：klt=${klt}`);
  const symbol = secidToSina(secid);
  const text = await getText(
    `https://quotes.sina.cn/cn/api/json_v2.php/CN_MarketDataService.getKLineData?symbol=${symbol}&scale=${scale}&datalen=${Math.min(lmt, 1023)}`,
  );
  let rows;
  try {
    rows = JSON.parse(text);
  } catch {
    throw new SinaError('返回不是 JSON');
  }
  if (!Array.isArray(rows)) throw new SinaError('K 线返回结构异常');
  return {
    name: null,
    preKPrice: null,
    bars: rows.map((row) => ({
      d: row.day,
      open: +row.open,
      close: +row.close,
      high: +row.high,
      low: +row.low,
      volLots: Math.round((+row.volume || 0) / 100),
      amount: null,
      amplitude: null,
      pct: null,
      chg: null,
      turnover: null,
    })),
  };
}

export const sinaProvider = {
  id: 'sina',
  label: '新浪行情',
  capabilities: {
    universe: false,
    snapshot: true,
    indices: true,
    breadth: false,
    kline: true,
    trends: false,
    fundamentals: false,
    mainIn: false,
    concepts: false,
  },
  missingFields: [
    'mainIn', 'mainInPct', 'roe', 'revenueYoy', 'profitYoy', 'grossMargin',
    'debtRatio', 'eps', 'bvps', 'ps', 'pe', 'pb', 'mcap', 'floatMcap',
    'turnover', 'volumeRatio', 'pct5d', 'speed', 'pct5m',
    'industry', 'regionBoard', 'concepts',
  ],
  snapshot: fetchSnapshot,
  indices: fetchIndices,
  kline: fetchKline,
};
