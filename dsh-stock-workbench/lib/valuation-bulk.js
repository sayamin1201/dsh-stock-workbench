/**
 * 全市场估值分位（批量）
 *
 * 单只股票算分位要拉 5 年逐日数据（3 页）；对全市场 5574 只不可行。
 * 这里改为「时间抽样」：近 5 年**每月取 1 个交易日**（默认 60 个日期），
 * 每个日期拉全市场 PE_TTM / PB_MRQ（约 12 页），得到每只股票约 60 个历史样本，
 * 再算当前值在样本中的百分位。
 *
 * 成本：60 日期 × 12 页 ≈ 720 请求 / 并发 8 → 约 20~30s；结果落盘 12h 有效。
 * 精度：60 个采样点 → 分位分辨率约 1.7%，用于排序/筛选足够，UI 需标注「抽样」。
 */
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATACENTER = 'https://datacenter-web.eastmoney.com/api/data/v1/get';
const CACHE_FILE = fileURLToPath(new URL('../state/valuation-percentiles.json', import.meta.url));
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  Referer: 'https://data.eastmoney.com/',
};

const PAGE_SIZE = 500;
const CONCURRENCY = 8;
const SAMPLE_MONTHS = 60;
const CACHE_MS = 12 * 3600 * 1000;

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 从今天往前按月取日期（同一天，避免月初假期；取不到数据会自动跳过） */
export function sampleDates(now = Date.now(), months = SAMPLE_MONTHS) {
  const out = [];
  const base = new Date(now);
  for (let i = 0; i < months; i += 1) {
    const date = new Date(base.getFullYear(), base.getMonth() - i, base.getDate());
    out.push(formatDate(date));
  }
  return [...new Set(out)];
}

/** 百分位：当前值在历史样本中的位置（0~100，越小越便宜），只统计正数样本 */
export function computePercentile(values, current) {
  const pool = values.filter((value) => Number.isFinite(value) && value > 0);
  if (!pool.length || !Number.isFinite(current) || current <= 0) return null;
  let below = 0;
  for (const value of pool) if (value <= current) below += 1;
  return Math.round((below / pool.length) * 1000) / 10;
}

async function getJson(url, timeout = 30000) {
  const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error(`估值批量接口 HTTP ${response.status}`);
  const json = await response.json();
  if (json && json.success === false) throw new Error(`估值批量接口返回：${json.message ?? 'unknown'}`);
  return json;
}

function buildUrl({ date, page }) {
  const filter = `(TRADE_DATE='${date}')`;
  return `${DATACENTER}?reportName=RPT_VALUEANALYSIS_DET`
    + '&columns=SECURITY_CODE,PE_TTM,PB_MRQ'
    + `&filter=${encodeURIComponent(filter)}`
    + `&pageNumber=${page}&pageSize=${PAGE_SIZE}`
    + '&sortColumns=SECURITY_CODE&sortTypes=1&source=WEB&client=WEB';
}

/** 某月内最后一个交易日：1 次请求拿到日期，避免撞周末/假期 */
export async function resolveTradingDay(monthDate) {
  const y = monthDate.getFullYear();
  const m = String(monthDate.getMonth() + 1).padStart(2, '0');
  const lastDay = new Date(y, monthDate.getMonth() + 1, 0).getDate();
  const filter = `(TRADE_DATE>='${y}-${m}-01')(TRADE_DATE<='${y}-${m}-${String(lastDay).padStart(2, '0')}')`;
  const url = `${DATACENTER}?reportName=RPT_VALUEANALYSIS_DET&columns=SECURITY_CODE,TRADE_DATE`
    + `&filter=${encodeURIComponent(filter)}&pageNumber=1&pageSize=1`
    + '&sortColumns=TRADE_DATE&sortTypes=-1&source=WEB&client=WEB';
  try {
    const json = await getJson(url, 20000);
    const row = json?.result?.data?.[0];
    return row ? String(row.TRADE_DATE).slice(0, 10) : null;
  } catch {
    return null;
  }
}

async function pool(items, concurrency, worker) {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  }));
}

/**
 * 抓取并计算全市场估值分位。
 * @param {{now?: number, months?: number, onProgress?: (done: number, total: number) => void}} [options]
 */
export async function buildValuationPercentiles({ now = Date.now(), months = SAMPLE_MONTHS, onProgress } = {}) {
  const started = Date.now();
  const monthDates = sampleDates(now, months).map((value) => new Date(value + 'T00:00:00'));
  const resolved = [];
  for (const monthDate of monthDates) {
    const day = await resolveTradingDay(monthDate);
    if (day) resolved.push(day);
  }
  const dates = [...new Set(resolved)];
  const history = new Map(); // code -> { pe: number[], pb: number[] }
  const latest = new Map(); // code -> { pe, pb }
  let done = 0;
  let failedPages = 0;

  for (const date of dates) {
    let pages = 1;
    try {
      const first = await getJson(buildUrl({ date, page: 1 }));
      pages = Math.max(1, Math.min(20, Math.ceil((Number(first?.result?.pages) || 1))));
      const rows = [...(first?.result?.data ?? [])];
      const rest = [];
      for (let page = 2; page <= pages; page += 1) rest.push(page);
      await pool(rest, CONCURRENCY, async (page) => {
        try {
          const json = await getJson(buildUrl({ date, page }));
          if (Array.isArray(json?.result?.data)) rows.push(...json.result.data);
        } catch {
          failedPages += 1;
        }
      });
      for (const row of rows) {
        const code = row?.SECURITY_CODE;
        if (!code) continue;
        const entry = history.get(code) ?? { pe: [], pb: [] };
        const pe = Number(row.PE_TTM);
        const pb = Number(row.PB_MRQ);
        if (Number.isFinite(pe)) entry.pe.push(pe);
        if (Number.isFinite(pb)) entry.pb.push(pb);
        history.set(code, entry);
        if (!latest.has(code)) latest.set(code, { pe, pb }); // dates 由新到旧，首次即最新
      }
    } catch {
      failedPages += 1;
    }
    done += 1;
    if (onProgress) {
      try {
        onProgress(done, dates.length);
      } catch {
        /* 进度回调异常不影响主流程 */
      }
    }
  }

  const out = {};
  for (const [code, entry] of history) {
    const current = latest.get(code) ?? {};
    out[code] = {
      pe: Number.isFinite(current.pe) ? Math.round(current.pe * 100) / 100 : null,
      pb: Number.isFinite(current.pb) ? Math.round(current.pb * 100) / 100 : null,
      pePercentile: computePercentile(entry.pe, current.pe),
      pbPercentile: computePercentile(entry.pb, current.pb),
      samples: entry.pe.filter((v) => v > 0).length,
    };
  }

  return {
    at: Date.now(),
    months,
    dates: dates.length,
    failedPages,
    ms: Date.now() - started,
    map: out,
  };
}

export function createBulkValuationSource({ ttlMs = CACHE_MS } = {}) {
  let cache = null; // { at, data }
  let diskLoaded = false;
  let building = null;
  let progress = { done: 0, total: 0 };

  function reviveDisk() {
    if (diskLoaded) return;
    diskLoaded = true;
    try {
      const parsed = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
      if (parsed && parsed.map && Number.isFinite(parsed.at)) {
        cache = { at: parsed.at, data: parsed };
      }
    } catch {
      /* 首次运行没有快照 */
    }
  }

  function persist(data) {
    try {
      mkdirSync(dirname(CACHE_FILE), { recursive: true });
      writeFileSync(CACHE_FILE, JSON.stringify(data), 'utf8');
    } catch {
      /* 落盘失败只影响下次启动速度 */
    }
  }

  function startBuild() {
    if (building) return;
    progress = { done: 0, total: 0 };
    building = buildValuationPercentiles({
      onProgress: (done, total) => {
        progress = { done, total };
      },
    })
      .then((data) => {
        cache = { at: Date.now(), data };
        persist(data);
        return data;
      })
      .catch(() => null)
      .finally(() => {
        building = null;
      });
  }

  return {
    /** 立即返回当前状态；没有缓存时触发后台构建，不阻塞 */
    async get() {
      reviveDisk();
      if (cache && Date.now() - cache.at < ttlMs) {
        return { status: 'ready', ...cache.data, building: false };
      }
      if (cache) {
        // 有旧快照：先返回旧的，后台刷新
        startBuild();
        return { status: 'ready', ...cache.data, building: true };
      }
      startBuild();
      return { status: 'building', progress, building: true };
    },
    /** 重载用：清空内存并删除磁盘快照（下次请求重新抽样构建） */
    clear({ clearDisk = true } = {}) {
      cache = null;
      diskLoaded = true;
      building = null;
      if (clearDisk) {
        try {
          unlinkSync(CACHE_FILE);
        } catch {
          /* 没有快照文件 */
        }
      }
      return ['valuation-percentiles'];
    },
    /** 测试用：手动触发一次完整构建 */
    async buildNow(options) {
      const data = await buildValuationPercentiles(options);
      cache = { at: Date.now(), data };
      persist(data);
      return data;
    },
  };
}
