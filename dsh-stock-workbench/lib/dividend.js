/**
 * 分红数据（东财数据中心 RPT_SHAREBONUS_DET）
 *
 * 抓一个 10 年窗口的「已实施」分红记录，产出：
 *  - dpsTTM      近 12 个月税前每股派息（Σ PRETAX_BONUS_RMB / 10）
 *  - years3      近 3 年里有分红的报告年度数（0~4）→ 榜单「分红年数」列
 *  - consecutive 截至最新报告年度的**连续分红年数**（0~10）→ 榜单「连续分红」列
 *  - lastExDate  最近一次除权除息日
 *  - records     明细（报告期/除息日/每 10 股派息/每股派息/方案），供详情弹窗
 *
 * 成本：约 36k 条 / 73 页 / ~5s（并发 10）；进程内缓存 6 小时，并落盘快照
 * `state/dividend-cache.json`，重启后秒开、过期时后台刷新。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATACENTER = 'https://datacenter-web.eastmoney.com/api/data/v1/get';const CACHE_FILE = fileURLToPath(new URL('../state/dividend-cache.json', import.meta.url));
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  Referer: 'https://data.eastmoney.com/',
};

const PAGE_SIZE = 500; // 服务端硬上限
const CONCURRENCY = 10;
const MAX_PAGES = 200;
const CACHE_MS = 6 * 3600 * 1000;
const YEARS_BACK = 10;
const MAX_RECORDS_PER_STOCK = 24;

function formatDate(ms) {
  const date = new Date(ms);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
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

async function getJson(url, timeout = 20000) {
  const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error(`分红接口 HTTP ${response.status}`);
  const json = await response.json();
  if (json && json.success === false) throw new Error(`分红接口返回：${json.message ?? 'unknown'}`);
  return json;
}

function buildUrl({ pageNumber, from, to }) {
  const filter = `(EX_DIVIDEND_DATE>=%27${from}%27)(EX_DIVIDEND_DATE<=%27${to}%27)(ASSIGN_PROGRESS%3D%22%E5%AE%9E%E6%96%BD%E5%88%86%E9%85%8D%22)`;
  return `${DATACENTER}?reportName=RPT_SHAREBONUS_DET`
    + '&columns=SECURITY_CODE,SECURITY_NAME_ABBR,PRETAX_BONUS_RMB,EX_DIVIDEND_DATE,REPORT_DATE,ASSIGN_PROGRESS,IMPL_PLAN_PROFILE'
    + `&filter=${filter}`
    + `&pageNumber=${pageNumber}&pageSize=${PAGE_SIZE}`
    + '&sortColumns=EX_DIVIDEND_DATE&sortTypes=-1';
}

/**
 * 连续分红年数：从最新报告年度往回数，逐年连续才累加。
 * 最新报告年度太旧（早于「今年-1」）视为已中断，返回 0。
 * @param {number[]} reportYears 有分红的报告年度（可重复）
 * @param {number} currentYear 当前年份
 */
export function computeConsecutiveYears(reportYears, currentYear) {
  const years = new Set((reportYears ?? []).filter((year) => Number.isFinite(year)));
  if (!years.size) return 0;
  const latest = Math.max(...years);
  if (latest < currentYear - 1) return 0; // 最近一年（含上一年）都没分，算中断
  let count = 0;
  let year = latest;
  while (years.has(year)) {
    count += 1;
    year -= 1;
  }
  return count;
}

/**
 * 抓取并聚合分红数据。
 * @param {{now?: number, yearsBack?: number}} [options]
 */
export async function fetchDividendData({ now = Date.now(), yearsBack = YEARS_BACK } = {}) {
  const started = Date.now();
  const from = formatDate(now - yearsBack * 365 * 24 * 3600 * 1000);
  const to = formatDate(now);

  const first = await getJson(buildUrl({ pageNumber: 1, from, to }));
  const pages = Math.min(MAX_PAGES, Number(first?.result?.pages) || 1);
  const records = [];
  if (Array.isArray(first?.result?.data)) records.push(...first.result.data);

  const rest = [];
  for (let page = 2; page <= pages; page += 1) rest.push(page);
  let failedPages = 0;
  await pool(rest, CONCURRENCY, async (page) => {
    try {
      const json = await getJson(buildUrl({ pageNumber: page, from, to }));
      if (Array.isArray(json?.result?.data)) records.push(...json.result.data);
    } catch {
      failedPages += 1; // 少几页好过整块不可用
    }
  });

  const currentYear = new Date(now).getFullYear();
  const ttmFrom = now - 365 * 24 * 3600 * 1000;
  const years3From = currentYear - 3;

  const grouped = new Map();
  for (const record of records) {
    const code = record?.SECURITY_CODE;
    const bonus = Number(record?.PRETAX_BONUS_RMB);
    if (!code || !Number.isFinite(bonus) || bonus <= 0) continue;
    const exRaw = record?.EX_DIVIDEND_DATE;
    const exMs = exRaw ? Date.parse(String(exRaw).replace(' ', 'T')) : NaN;
    if (!Number.isFinite(exMs)) continue;
    const reportRaw = String(record?.REPORT_DATE ?? '');
    const reportYear = Number(reportRaw.slice(0, 4));
    const entry = grouped.get(code) ?? { records: [], yearSet: new Set(), ttm: 0, lastExDate: null };
    entry.records.push({
      reportDate: reportRaw.slice(0, 10),
      reportYear: Number.isFinite(reportYear) ? reportYear : null,
      exDate: String(exRaw).slice(0, 10),
      per10: Math.round(bonus * 10000) / 10000,
      perShare: Math.round((bonus / 10) * 10000) / 10000,
      plan: record?.IMPL_PLAN_PROFILE ?? null,
    });
    if (Number.isFinite(reportYear) && reportYear > 1900) entry.yearSet.add(reportYear);
    if (exMs >= ttmFrom) entry.ttm += bonus / 10;
    const exDate = String(exRaw).slice(0, 10);
    if (!entry.lastExDate || exDate > entry.lastExDate) entry.lastExDate = exDate;
    grouped.set(code, entry);
  }

  const map = new Map();
  for (const [code, entry] of grouped) {
    const reportYears = [...entry.yearSet];
    const years3 = reportYears.filter((year) => year >= years3From).length;
    entry.records.sort((a, b) => (a.exDate < b.exDate ? 1 : -1));
    map.set(code, {
      dpsTTM: Math.round(entry.ttm * 10000) / 10000,
      years3,
      // 窗口只有 10 年，上限就报 10（前端显示 10+）
      consecutive: Math.min(10, computeConsecutiveYears(reportYears, currentYear)),
      lastExDate: entry.lastExDate,
      records: entry.records.slice(0, MAX_RECORDS_PER_STOCK),
    });
  }

  return { map, records: records.length, pages, failedPages, ms: Date.now() - started };
}

/** 给市场服务用的带缓存的版本：内存 → 磁盘快照 → 网络，并支持后台刷新 */
export function createDividendSource({ ttlMs = CACHE_MS } = {}) {
  let cache = null;        // { at, data }
  let diskLoaded = false;
  let inflight = null;
  let refreshing = null;

  function reviveDisk() {
    if (diskLoaded) return;
    diskLoaded = true;
    try {
      const raw = readFileSync(CACHE_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.entries) && Number.isFinite(parsed.at)) {
        cache = {
          at: parsed.at,
          data: {
            map: new Map(parsed.entries),
            records: parsed.records ?? 0,
            pages: parsed.pages ?? 0,
            failedPages: parsed.failedPages ?? 0,
            ms: 0,
            fromDisk: true,
          },
        };
      }
    } catch {
      // 首次运行没有快照，正常
    }
  }

  function persist(data) {
    try {
      mkdirSync(dirname(CACHE_FILE), { recursive: true });
      writeFileSync(CACHE_FILE, JSON.stringify({
        at: Date.now(),
        records: data.records,
        pages: data.pages,
        failedPages: data.failedPages,
        entries: [...data.map.entries()],
      }), 'utf8');
    } catch {
      // 落盘失败只是下次启动慢一点
    }
  }

  function refreshInBackground() {
    if (refreshing) return;
    refreshing = fetchDividendData()
      .then((data) => {
        cache = { at: Date.now(), data };
        persist(data);
        return data;
      })
      .catch(() => {
        // 后台刷新失败保留旧快照
      })
      .finally(() => {
        refreshing = null;
      });
  }

  return {
    async get() {
      reviveDisk();
      if (cache && Date.now() - cache.at < ttlMs) return cache.data;
      if (cache) {
        // 有（过期）快照：立即返回旧数据，同时后台刷新
        refreshInBackground();
        return cache.data;
      }
      if (inflight) return inflight;
      inflight = fetchDividendData()
        .then((data) => {
          cache = { at: Date.now(), data };
          persist(data);
          return data;
        })
        .finally(() => {
          inflight = null;
        });
      return inflight;
    },
    /** 重载用：丢掉内存/磁盘缓存，下次 get() 直接从接口重新拉 */
    clear() {
      cache = null;
      diskLoaded = true; // 不再读磁盘快照
      return ['dividend'];
    },
  };
}
