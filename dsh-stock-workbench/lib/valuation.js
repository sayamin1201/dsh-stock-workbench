/**
 * 估值分位：东财数据中心 RPT_VALUEANALYSIS_DET（每交易日 PE_TTM / PB_MRQ）
 *
 * 只按需拉单只股票的历史（约 1200 个交易日 / 3 页），算「当前值在历史中的百分位」：
 * 分位越低 = 越便宜。分位只在有意义的正数区间内统计（PE 为负/缺失的交易日剔除）。
 */
const DATACENTER = 'https://datacenter-web.eastmoney.com/api/data/v1/get';
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  Referer: 'https://data.eastmoney.com/',
};

const PAGE_SIZE = 500;
const CONCURRENCY = 3;
const MAX_PAGES = 8;
const CACHE_MS = 6 * 3600 * 1000;
const DEFAULT_YEARS = 5;

function buildUrl({ code, page }) {
  const filter = `(SECURITY_CODE%3D%22${code}%22)`;
  return `${DATACENTER}?reportName=RPT_VALUEANALYSIS_DET`
    + '&columns=SECURITY_CODE,SECURITY_NAME_ABBR,TRADE_DATE,PE_TTM,PB_MRQ,PE_LAR'
    + `&filter=${filter}&pageNumber=${page}&pageSize=${PAGE_SIZE}`
    + '&sortColumns=TRADE_DATE&sortTypes=-1&source=WEB&client=WEB';
}

async function getJson(url, timeout = 20000) {
  const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error(`估值接口 HTTP ${response.status}`);
  const json = await response.json();
  if (json && json.success === false) throw new Error(`估值接口返回：${json.message ?? 'unknown'}`);
  return json;
}

function percentile(values, current) {
  const pool = values.filter((value) => Number.isFinite(value) && value > 0);
  if (!pool.length || !Number.isFinite(current) || current <= 0) return null;
  let below = 0;
  for (const value of pool) if (value <= current) below += 1;
  return Math.round((below / pool.length) * 1000) / 10; // 保留 1 位小数
}

/**
 * @param {string} code 6 位代码
 * @param {{years?: number, now?: number}} [options]
 */
export async function fetchValuation(code, { years = DEFAULT_YEARS, now = Date.now() } = {}) {
  const started = Date.now();
  const first = await getJson(buildUrl({ code, page: 1 }));
  const pages = Math.min(MAX_PAGES, Math.max(1, Number(first?.result?.pages) || 1));
  const raw = [...(first?.result?.data ?? [])];

  const rest = [];
  for (let page = 2; page <= pages; page += 1) rest.push(page);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rest.length) }, async () => {
    while (cursor < rest.length) {
      const page = rest[cursor];
      cursor += 1;
      try {
        const json = await getJson(buildUrl({ code, page }));
        if (Array.isArray(json?.result?.data)) raw.push(...json.result.data);
      } catch {
        /* 少一页不影响分位 */
      }
    }
  }));

  const from = now - years * 365 * 24 * 3600 * 1000;
  const rows = raw
    .map((item) => ({
      date: String(item.TRADE_DATE ?? '').slice(0, 10),
      pe: Number(item.PE_TTM),
      pb: Number(item.PB_MRQ),
      name: item.SECURITY_NAME_ABBR ?? null,
    }))
    .filter((item) => item.date && Date.parse(`${item.date}T00:00:00Z`) >= from)
    .sort((a, b) => (a.date < b.date ? 1 : -1)); // 新的在前

  const latest = rows[0] ?? null;
  return {
    code,
    name: latest?.name ?? null,
    latestDate: latest?.date ?? null,
    pe: Number.isFinite(latest?.pe) ? Math.round(latest.pe * 100) / 100 : null,
    pb: Number.isFinite(latest?.pb) ? Math.round(latest.pb * 100) / 100 : null,
    pePercentile: latest && Number.isFinite(latest.pe) ? percentile(rows.map((row) => row.pe), latest.pe) : null,
    pbPercentile: latest && Number.isFinite(latest.pb) ? percentile(rows.map((row) => row.pb), latest.pb) : null,
    sampleDays: rows.filter((row) => Number.isFinite(row.pe) && row.pe > 0).length,
    years,
    ms: Date.now() - started,
  };
}

export function createValuationSource({ ttlMs = CACHE_MS } = {}) {
  const cache = new Map();
  const inflight = new Map();
  return {
    async get(code) {
      const key = String(code);
      const hit = cache.get(key);
      if (hit && Date.now() - hit.at < ttlMs) return hit.data;
      if (inflight.has(key)) return inflight.get(key);
      const promise = fetchValuation(key)
        .then((data) => {
          cache.set(key, { at: Date.now(), data });
          return data;
        })
        .finally(() => inflight.delete(key));
      inflight.set(key, promise);
      return promise;
    },
  };
}
