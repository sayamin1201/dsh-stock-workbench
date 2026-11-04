/**
 * A 股数据层（东财公开接口）
 *
 * 关键约束（均已实测，见 research/data-sources.md）：
 *  - clist 的 pz 被服务端硬限 100，全A 需 60 页 → 只用于「代码全集」，一天一次
 *  - 全A 快照走 ulist.np，800 secid/批（950 会 502），8 个请求拿全 5927 只
 *  - 5927 里约 355 条是退市/停牌占位（f2 === "-"），必须过滤
 *  - 涨跌家数 f104~f106 挂在指数上；涨跌停家数用 push2ex 的 ZT/DT 池 tc
 *  - f11 = 5 分钟涨跌幅，f109 = 5 日涨跌幅（别搞混）
 *  - f9 亏损为负数；f62 主力净流入 15% 恒为 0（视为无数据）
 *  - 北交所旧代码 0.8xxxxx 已失效，现行 0.920xxx
 */

import { createDividendSource } from './dividend.js';

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

class UpstreamError extends Error {
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

/**
 * 把分红数据关联到快照行上，并现算股息率（股息率 = 近 12 个月每股派息 / 现价）。
 * 拿不到分红数据时字段置 null（面板会显示"—"），不影响行情本身。
 */
function attachDividends(rows, dividend) {
  const map = dividend instanceof Map
    ? dividend
    : dividend && dividend.map instanceof Map
      ? dividend.map
      : null;
  for (const row of rows) {
    const info = map ? map.get(row.code) : null;
    if (!info) {
      row.dividendPerShare = null;
      row.dividendYield = null;
      row.dividendYears = 0;
      row.dividendConsecutive = 0;
      row.lastDividendDate = null;
      continue;
    }
    row.dividendPerShare = info.dpsTTM ?? null;
    row.dividendYears = info.years3 ?? 0;
    row.dividendConsecutive = Math.min(10, info.consecutive ?? 0);
    row.lastDividendDate = info.lastExDate ?? null;
    row.dividendYield = info.dpsTTM > 0 && row.price > 0 ? (info.dpsTTM / row.price) * 100 : 0;
  }
}

function tradingDateString(date = new Date()) {  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

// ---------------------------------------------------------------------------
// 服务层：缓存 + 组合拉取
// ---------------------------------------------------------------------------

/**
 * @param {{ttlMs?: number, universeTtlMs?: number, now?: () => number}} options
 */
export function createMarketService({ ttlMs = 3000, universeTtlMs = 6 * 3600 * 1000, now = Date.now } = {}) {
  let universeCache = null; // { universe, total, at }
  let dashboardCache = null; // { data, at }
  let lastGood = null;
  let inflight = null;
  const dividendSource = createDividendSource();

  async function getUniverse(force = false) {
    if (!force && universeCache && now() - universeCache.at < universeTtlMs) return universeCache;
    const { universe, total } = await fetchUniverse();
    universeCache = { universe, total, at: now() };
    return universeCache;
  }

  /** 收盘后数据不再变化，缓存拉长到 5 分钟 */
  function ttlForNow() {
    const d = new Date(now());
    const hhmm = d.getHours() * 100 + d.getMinutes();
    const isOpen = d.getDay() >= 1 && d.getDay() <= 5 && hhmm >= 915 && hhmm <= 1505;
    return isOpen ? ttlMs : Math.max(ttlMs, 5 * 60 * 1000);
  }

  async function load({ force = false } = {}) {
    if (!force && dashboardCache && now() - dashboardCache.at < ttlForNow()) {
      return { ...dashboardCache.data, meta: { ...dashboardCache.data.meta, cached: true } };
    }

    const t0 = now();
    const { universe, total } = await getUniverse(force);
    const secids = universe.map((item) => item.secid);

    const [snapshot, indices, breadth, dividend] = await Promise.all([
      fetchSnapshot(secids),
      fetchIndices().catch((err) => ({ error: err.message })),
      fetchBreadth().catch((err) => ({ error: err.message })),
      // 分红数据失败不影响行情：股息率留空，防御面板会提示
      dividendSource.get().catch((err) => ({ error: err.message })),
    ]);

    const rows = snapshot.rows;
    attachDividends(rows, dividend);
    const stats = summarizeRows(rows);
    const data = {
      rows,
      indices: Array.isArray(indices) ? indices : [],
      breadth: Array.isArray(breadth) ? null : breadth,
      stats,
      meta: {
        fetchedAt: now(),
        upstreamMs: Math.round(now() - t0),
        universeCount: total,
        count: rows.length,
        failedBatches: snapshot.failed,
        indexError: Array.isArray(indices) ? null : indices.error,
        breadthError: Array.isArray(breadth) ? null : breadth.error,
        dividendStocks: dividend && dividend.map instanceof Map ? dividend.map.size : 0,
        dividendError: dividend && dividend.map instanceof Map ? null : dividend?.error ?? 'unavailable',
        tradingDay: (Array.isArray(breadth) ? null : breadth?.tradingDay) ?? tradingDateString(),
        cached: false,
      },
    };

    dashboardCache = { data, at: now() };
    lastGood = data;
    return data;
  }

  return {
    async getDashboard({ force = false } = {}) {
      if (inflight) return inflight;
      inflight = load({ force })
        .catch((err) => {
          // 失败时保留上一次成功数据，并把错误交给上层展示
          if (lastGood) {
            return {
              ...lastGood,
              meta: { ...lastGood.meta, cached: true, stale: true, error: err.message },
            };
          }
          throw err;
        })
        .finally(() => {
          inflight = null;
        });
      return inflight;
    },

    /** 单只分红详情：明细记录 + 股息率/连续年数（供榜单「分红年数」点开的弹窗） */
    async getDividendDetail(code) {
      const dividend = await dividendSource.get().catch((error) => ({ error: error.message }));
      const map = dividend && dividend.map instanceof Map ? dividend.map : null;
      if (!map) throw new Error(dividend?.error ?? '分红数据暂不可用');
      const info = map.get(String(code)) ?? null;
      let row = null;
      try {
        const dash = await load({});
        row = dash.rows.find((item) => item.code === String(code)) ?? null;
      } catch {
        row = null;
      }
      return {
        code: String(code),
        name: row?.name ?? null,
        industry: row?.industry ?? null,
        price: row?.price ?? null,
        dividendYield: row?.dividendYield ?? null,
        dpsTTM: info?.dpsTTM ?? null,
        years3: info?.years3 ?? 0,
        consecutive: info?.consecutive ?? 0,
        lastExDate: info?.lastExDate ?? null,
        records: info?.records ?? [],
      };
    },

    /** 兜底：腾讯实时价格（GBK 解码），主源被限频时可用 */
    async getUniverse(force = false) {
      return getUniverse(force);
    },

    /** 单只分时（v2 详情页用） */
    async getTrends(secid, ndays = 1) {
      const json = await getJson(
        `${PUSH2HIS}/stock/trends2/get?secid=${secid}` +
          '&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13' +
          `&fields2=f51,f52,f53,f54,f55,f56,f57,f58&iscr=0&ndays=${ndays}`,
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
    },

    /** 单只日K/分钟K（v2 技术指标用） */
    async getKline(secid, { klt = 101, fqt = 1, lmt = 120 } = {}) {
      const json = await getJson(
        `${PUSH2HIS}/stock/kline/get?secid=${secid}&klt=${klt}&fqt=${fqt}&lmt=${lmt}&end=20500101` +
          '&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
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
    },
  };
}

export { UpstreamError };
