/**
 * 数据源：东方财富（当前主力源）
 *
 * 原 `lib/market.js` 的抓取实现整体迁移到这里，服务层只依赖 provider 接口。
 * 约束（实测见 research/data-sources.md）：
 *  - clist 的 pz 硬限 100，全A 需要 60 页 → 只用于「代码全集」，一天一次
 *  - 快照走 ulist.np，800 secid/批，8 个请求拿全量
 *  - f2 为字符串 "-" 的是退市/停牌占位，必须过滤
 *  - f9 亏损为负；f62 主力净流入 15% 恒为 0（视为无数据）
 *  - f11 = 5 分钟涨跌幅，f109 = 5 日涨跌幅（别混）
 */

const PUSH2 = 'https://push2.eastmoney.com/api/qt';
const PUSH2EX = 'https://push2ex.eastmoney.com';
const PUSH2HIS = 'https://push2his.eastmoney.com/api/qt';

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  Referer: 'https://quote.eastmoney.com/',
};

/** 全A 板块集合：沪主板+科创、深主板+创业板、北交所。'+' 不能 URL 编码。 */
export const FS_ALL_A = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048';

/** 快照字段（ulist 一次带回） */
export const SNAPSHOT_FIELDS = [
  'f12', 'f13', 'f14', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9',
  'f10', 'f11', 'f18', 'f20', 'f21', 'f22', 'f23', 'f24', 'f25', 'f62',
  'f100', 'f102', 'f103', 'f109', 'f184',
  // 基本面 / 防御属性（实测映射，2026-11-04 用招行/工行/茅台交叉核对）
  'f37', // 加权净资产收益率（报告期累计，非年化）
  'f41', // 营业收入同比 %
  'f46', // 净利润同比 %
  'f49', // 销售毛利率 %（银行等无此数据 → 0）
  'f57', // 资产负债率 %
  'f112', // 每股收益 EPS（报告期）
  'f113', // 每股净资产 BVPS
  'f130', // 市销率 TTM
].join(',');

export const INDEX_SECIDS = {
  '1.000001': '上证指数',
  '0.399001': '深证成指',
  '0.399006': '创业板指',
  '1.000688': '科创50',
  '0.899050': '北证50',
};

const BATCH = 800; // 绝对不能超过 800：950 → 502

// ---------------------------------------------------------------------------
// 基础 HTTP
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class UpstreamError extends Error {
  constructor(message, { status, url } = {}) {
    super(message);
    this.name = 'UpstreamError';
    this.status = status;
    this.url = url;
  }
}

async function getJson(url, { timeout = 8000, retries = 2 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: HEADERS,
        signal: AbortSignal.timeout(timeout),
      });
      if (res.status === 429 || res.status >= 500) {
        throw new UpstreamError(`HTTP ${res.status}`, { status: res.status, url });
      }
      if (!res.ok) throw new UpstreamError(`HTTP ${res.status}`, { status: res.status, url });
      const json = await res.json();
      if (json.rc !== 0 && json.rc !== undefined) {
        throw new UpstreamError(`上游返回 rc=${json.rc}`, { url });
      }
      return json;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(500 * 2 ** attempt); // 0.5s → 1s
    }
  }
  throw lastErr;
}

async function pool(items, concurrency, worker) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

export { pool };

// ---------------------------------------------------------------------------
// 代码全集（一天一次）
// ---------------------------------------------------------------------------

const PAGE_SIZE = 100; // 服务端硬限，别改

/**
 * 拉全 A 代码全集。约 60 页 / 250ms / 268KB，一天一次即可。
 * @returns {Promise<Array<{secid:string, code:string, market:number, name:string, board:string}>>}
 */
export async function fetchUniverse({ concurrency = 6 } = {}) {
  const pages = [];
  let total = Infinity;

  // 第一页先拿 total，再决定要翻多少页
  const first = await getJson(
    `${PUSH2}/clist/get?pn=1&pz=${PAGE_SIZE}&po=1&np=1&fltt=2&invt=2&fid=f12&fs=${FS_ALL_A}&fields=f12,f13,f14`,
  );
  total = first.data?.total ?? 0;
  const firstRows = first.data?.diff ?? [];
  const pageCount = Math.ceil(total / PAGE_SIZE);

  const collected = [...firstRows];
  for (let pn = 2; pn <= pageCount; pn += 1) pages.push(pn);

  const buffers = new Map();
  await pool(pages, concurrency, async (pn) => {
    const json = await getJson(
      `${PUSH2}/clist/get?pn=${pn}&pz=${PAGE_SIZE}&po=1&np=1&fltt=2&invt=2&fid=f12&fs=${FS_ALL_A}&fields=f12,f13,f14`,
    );
    // rc=102 / data=null 表示翻到底（正常现象，不重试）
    if (json.data?.diff) buffers.set(pn, json.data.diff);
  });

  for (let pn = 2; pn <= pageCount; pn += 1) {
    const rows = buffers.get(pn);
    if (rows) collected.push(...rows);
  }

  const seen = new Set();
  const universe = [];
  for (const row of collected) {
    if (!row || !row.f12) continue;
    const secid = `${row.f13}.${row.f12}`;
    if (seen.has(secid)) continue;
    seen.add(secid);
    universe.push({
      secid,
      code: row.f12,
      market: row.f13,
      name: row.f14 ?? '',
      board: classifyBoard(row.f12, row.f14),
    });
  }

  return { universe, total: total ?? 0 };
}

/** 按代码段判定板块（用于筛选器「排除科创板/北交所」等） */
export function classifyBoard(code, name = '') {
  if (!code) return 'unknown';
  if (/^68[89]/.test(code)) return 'star'; // 科创板
  if (/^30[012]/.test(code)) return 'chinext'; // 创业板
  if (/^920/.test(code)) return 'bse'; // 北交所（现行）
  if (/^[48]/.test(code)) return 'bse'; // 北交所旧段（已失效，靠过滤剔除）
  if (/^(60[0135]|605|601)/.test(code) || /^60/.test(code)) return 'sh-main';
  if (/^(00[0123])/.test(code)) return 'sz-main';
  return name.includes('ST') ? 'unknown' : 'unknown';
}

// ---------------------------------------------------------------------------
// 全A 快照（每次刷新）
// ---------------------------------------------------------------------------

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function normalizeRow(row) {
  return {
    code: row.f12,
    market: row.f13,
    secid: `${row.f13}.${row.f12}`,
    name: row.f14 ?? '',
    industry: row.f100 ?? '',
    regionBoard: row.f102 ?? '',
    concepts: row.f103 ?? '',
    board: classifyBoard(row.f12, row.f14 ?? ''),
    price: num(row.f2),
    pct: num(row.f3),
    chg: num(row.f4),
    volLots: num(row.f5),
    amount: num(row.f6),
    amplitude: num(row.f7),
    turnover: num(row.f8),
    pe: num(row.f9),
    volumeRatio: num(row.f10),
    pct5m: num(row.f11),
    preClose: num(row.f18),
    mcap: num(row.f20),
    floatMcap: num(row.f21),
    speed: num(row.f22),
    pb: num(row.f23),
    pct60d: num(row.f24),
    pctYtd: num(row.f25),
    mainIn: num(row.f62),
    mainInPct: num(row.f184),
    pct5d: num(row.f109),
    // 基本面 / 防御属性
    roe: num(row.f37),
    revenueYoy: num(row.f41),
    profitYoy: num(row.f46),
    grossMargin: num(row.f49),
    debtRatio: num(row.f57),
    eps: num(row.f112),
    bvps: num(row.f113),
    ps: num(row.f130),
    // 分红（由 fetchDividendData 关联，见 createMarketService）
    dividendPerShare: null,
    dividendYield: null,
    dividendYears: 0,
    dividendConsecutive: 0,
    lastDividendDate: null,
  };
}

/**
 * 拉全 A 快照。8 请求 / 300-500ms / gzip ~400KB。
 * @param {string[]} secids
 */
export async function fetchSnapshot(secids, { concurrency = 4 } = {}) {
  const batches = [];
  for (let i = 0; i < secids.length; i += BATCH) batches.push(secids.slice(i, i + BATCH));

  const rows = [];
  const failed = [];
  await pool(batches, concurrency, async (batch, index) => {
    try {
      const json = await getJson(
        `${PUSH2}/ulist.np/get?fltt=2&invt=2&fields=${SNAPSHOT_FIELDS}&secids=${batch.join(',')}`,
      );
      const diff = json.data?.diff ?? [];
      for (const row of diff) {
        // 退市/停牌占位：f2 是字符串 "-"，不是数字
        if (typeof row.f2 !== 'number') continue;
        rows.push(normalizeRow(row));
      }
    } catch (err) {
      failed.push({ batch: index, size: batch.length, error: err.message });
    }
  });

  if (rows.length === 0) {
    throw new UpstreamError(`快照请求全部失败：${failed[0]?.error ?? 'unknown'}`);
  }

  // 部分批次失败（限频/瞬时错误）时顺序重试一次，避免"半份快照"被当成成功
  if (failed.length) {
    const retryBatches = failed.map((item) => batches[item.batch]).filter(Boolean);
    failed.length = 0;
    for (const batch of retryBatches) {
      try {
        const json = await getJson(
          `${PUSH2}/ulist.np/get?fltt=2&invt=2&fields=${SNAPSHOT_FIELDS}&secids=${batch.join(',')}`,
        );
        const diff = json.data?.diff ?? [];
        for (const row of diff) {
          if (typeof row.f2 !== 'number') continue;
          rows.push(normalizeRow(row));
        }
      } catch (err) {
        failed.push({ size: batch.length, error: err.message });
      }
    }
    rows.sort((a, b) => ((a.pct ?? -Infinity) < (b.pct ?? -Infinity) ? 1 : -1));
  }

  rows.sort((a, b) => (a.pct ?? -Infinity) < (b.pct ?? -Infinity) ? 1 : -1);
  return { rows, failed };
}

// ---------------------------------------------------------------------------
// 指数 / 涨跌家数 / 涨跌停
// ---------------------------------------------------------------------------

export async function fetchIndices() {
  const secids = Object.keys(INDEX_SECIDS).join(',');
  const json = await getJson(
    `${PUSH2}/ulist.np/get?fltt=2&invt=2&fields=f1,f2,f3,f4,f5,f6,f12,f14,f15,f16,f17,f18&secids=${secids}`,
  );
  return (json.data?.diff ?? []).map((row) => ({
    code: row.f12,
    name: row.f14,
    price: num(row.f2),
    pct: num(row.f3),
    chg: num(row.f4),
    volLots: num(row.f5),
    amount: num(row.f6),
    high: num(row.f15),
    low: num(row.f16),
    open: num(row.f17),
    preClose: num(row.f18),
  }));
}

/**
 * 涨跌家数（f104~f106，1 请求 0.3KB）+ 涨停/跌停家数（push2ex 池 tc，2 请求 5KB）。
 * 口径说明：f104~f106 是「指数所在市场」口径，与自建全A 列表差约 1.4%；
 * 为让页面数字与榜单对得上，服务层以「本地快照统计」为准，此处数值仅作备查。
 */
export async function fetchBreadth() {
  const breadthJson = await getJson(
    `${PUSH2}/ulist.np/get?fltt=2&invt=2&fields=f12,f14,f104,f105,f106&secids=1.000001,0.399001,0.899050`,
  );
  const perMarket = (breadthJson.data?.diff ?? []).map((row) => ({
    code: row.f12,
    name: row.f14,
    up: num(row.f104) ?? 0,
    down: num(row.f105) ?? 0,
    flat: num(row.f106) ?? 0,
  }));
  const up = perMarket.reduce((a, r) => a + r.up, 0);
  const down = perMarket.reduce((a, r) => a + r.down, 0);
  const flat = perMarket.reduce((a, r) => a + r.flat, 0);

  const date = tradingDateString();
  const ut = '7eea3edcaed734bea9cbfc24409ed989';
  const [zt, dt] = await Promise.all([
    getJson(
      `${PUSH2EX}/getTopicZTPool?ut=${ut}&dpt=wz.ztzt&Pageindex=0&pagesize=200&sort=fbt%3Aasc&date=${date}`,
    ).catch(() => null),
    getJson(
      `${PUSH2EX}/getTopicDTPool?ut=${ut}&dpt=wz.ztzt&Pageindex=0&pagesize=200&sort=fund%3Aasc&date=${date}`,
    ).catch(() => null),
  ]);

  // 非交易日时 qdate 会回落到最近交易日，正好可当「数据日期」
  const tradingDay = String(zt?.data?.qdate ?? dt?.data?.qdate ?? date);

  return {
    perMarket,
    up,
    down,
    flat,
    limitUp: num(zt?.data?.tc) ?? 0,
    limitDown: num(dt?.data?.tc) ?? 0,
    limitUpList: zt?.data?.pool ?? [],
    limitDownList: dt?.data?.pool ?? [],
    tradingDay,
  };
}

/** 本地快照统计（与榜单同口径） */
export function summarizeRows(rows) {
  let up = 0;
  let down = 0;
  let flat = 0;
  let limitUp = 0;
  let limitDown = 0;
  let amount = 0;
  for (const row of rows) {
    const pct = row.pct;
    if (pct === null) continue;
    if (pct > 0) up += 1;
    else if (pct < 0) down += 1;
    else flat += 1;
    amount += row.amount ?? 0;
    if (pct >= 9.8) limitUp += 1; // 粗略；官方口径见 fetchBreadth().limitUp
    if (pct <= -9.8) limitDown += 1;
  }
  return { up, down, flat, limitUp, limitDown, amount, count: rows.length };
}
/** 交易日期 YYYYMMDD（东财涨停池按日期查询用） */
export function tradingDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

// ---------------------------------------------------------------------------
// K 线 / 分时（原服务层方法，提为 provider 能力）
// ---------------------------------------------------------------------------

const PUSH2HIS_URL = PUSH2HIS;

/** 单只分时 */
export async function fetchTrends(secid, { ndays = 1 } = {}) {
  const json = await getJson(
    `${PUSH2HIS_URL}/stock/trends2/get?secid=${secid}`
      + '&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13'
      + `&fields2=f51,f52,f53,f54,f55,f56,f57,f58&iscr=0&ndays=${ndays}`,
  );
  const trends = json.data?.trends ?? [];
  return {
    preClose: num(json.data?.preClose),
    points: trends.map((line) => {
      const [time, open, close, high, low, volLots, amount, avg] = line.split(',');
      return {
        time,
        open: +open || +close,
        close: +close,
        high: +high,
        low: +low,
        volLots: +volLots,
        amount: +amount,
        avg: +avg,
      };
    }),
  };
}

/** 单只日K/分钟K */
export async function fetchKline(secid, { klt = 101, fqt = 1, lmt = 120, end = '20500101' } = {}) {
  const json = await getJson(
    `${PUSH2HIS_URL}/stock/kline/get?secid=${secid}&klt=${klt}&fqt=${fqt}&lmt=${lmt}&end=${end}`
      + '&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
  );
  const klines = json.data?.klines ?? [];
  return {
    name: json.data?.name,
    preKPrice: num(json.data?.preKPrice),
    // 顺序是 开、收、高、低（不是 OHLC）
    bars: klines.map((line) => {
      const [d, open, close, high, low, volLots, amount, amplitude, pct, chg, turnover] = line.split(',');
      return {
        d,
        open: +open,
        close: +close,
        high: +high,
        low: +low,
        volLots: +volLots,
        amount: +amount,
        amplitude: +amplitude,
        pct: +pct,
        chg: +chg,
        turnover: +turnover,
      };
    }),
  };
}

/** provider 适配器：数据层通过这个对象调用东财 */
export const eastmoneyProvider = {
  id: 'eastmoney',
  label: '东方财富',
  capabilities: {
    universe: true,
    snapshot: true,
    indices: true,
    breadth: true,
    kline: true,
    trends: true,
    fundamentals: true, // ROE / 毛利率 / 负债率 / EPS / BVPS / PS / 同比
    mainIn: true, // 主力净流入
    concepts: true, // 所属概念 / 地域板块
  },
  missingFields: [],
  universe: fetchUniverse,
  snapshot: fetchSnapshot,
  indices: fetchIndices,
  breadth: fetchBreadth,
  kline: fetchKline,
  trends: fetchTrends,
};
