/**
 * A 股数据层（服务层）
 *
 * 职责：
 *  - 选择/切换行情源（东方财富 / 腾讯 / 新浪），失败自动切换
 *  - 缓存（交易时段 3s / 收盘后 5min）、失败时回退上一次成功快照（stale）
 *  - 组合快照 + 指数 + 涨跌家数 + 分红，产出 dashboard
 *  - 代码全集落盘（东财不可用时仍可用旧全集继续抓其他源快照）
 *
 * 抓取实现全部在 lib/providers/*，这里不再直接访问具体行情接口。
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDividendSource } from './dividend.js';
import { createDataRouter } from './providers/registry.js';
import {
  eastmoneyProvider,
  summarizeRows,
  tradingDateString,
  UpstreamError,
  classifyBoard,
  fetchUniverse,
  fetchSnapshot,
  fetchIndices,
  fetchBreadth,
  FS_ALL_A,
  SNAPSHOT_FIELDS,
  INDEX_SECIDS,
  pool,
} from './providers/eastmoney.js';
import { tencentProvider } from './providers/tencent.js';
import { sinaProvider } from './providers/sina.js';

// 兼容旧引用：抓取函数仍在 market.js 上可用（内部已迁到 providers/eastmoney.js）
export {
  classifyBoard,
  fetchUniverse,
  fetchSnapshot,
  fetchIndices,
  fetchBreadth,
  FS_ALL_A,
  SNAPSHOT_FIELDS,
  INDEX_SECIDS,
  pool,
  summarizeRows,
  UpstreamError,
};

/** 内置数据源（顺序即默认回退顺序） */
export const PROVIDERS = [eastmoneyProvider, tencentProvider, sinaProvider];

const STATE_DIR = fileURLToPath(new URL('../state/', import.meta.url));
const PREFER_FILE = `${STATE_DIR}data-source.json`;
const UNIVERSE_FILE = `${STATE_DIR}universe.json`;

function readStateFile(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function writeStateFile(path, value) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(value), 'utf8');
  } catch {
    /* 落盘失败只影响下次启动，不影响本次请求 */
  }
}

function readPreferredProvider() {
  const saved = readStateFile(PREFER_FILE);
  const id = saved && typeof saved.provider === 'string' ? saved.provider : 'eastmoney';
  return PROVIDERS.some((provider) => provider.id === id) ? id : 'eastmoney';
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

/**
 * @param {{ttlMs?: number, universeTtlMs?: number, now?: () => number, provider?: string}} options
 */
export function createMarketService({ ttlMs = 3000, universeTtlMs = 6 * 3600 * 1000, now = Date.now, provider } = {}) {
  let universeCache = null; // { universe, total, at, provider }
  let dashboardCache = null; // { data, at }
  let lastGood = null;
  let inflight = null;
  const dividendSource = createDividendSource();

  const router = createDataRouter({
    providers: PROVIDERS,
    preferred: provider && PROVIDERS.some((item) => item.id === provider) ? provider : readPreferredProvider(),
  });

  function providerInfo() {
    const info = router.list().find((item) => item.id === router.preferred);
    return { id: router.preferred, label: info?.label ?? router.preferred, missingFields: info?.missingFields ?? [] };
  }

  async function getUniverse(force = false) {
    if (!force && universeCache && now() - universeCache.at < universeTtlMs) return universeCache;

    try {
      const { value, provider: usedBy } = await router.universe();
      universeCache = { universe: value.universe, total: value.total, at: now(), provider: usedBy };
      writeStateFile(UNIVERSE_FILE, {
        at: now(),
        provider: usedBy,
        total: value.total,
        universe: value.universe,
      });
      return universeCache;
    } catch (error) {
      // 全市场代码全集只有东财提供：失败时用上次落盘的副本，仍可让其他源继续工作
      const saved = readStateFile(UNIVERSE_FILE);
      if (saved && Array.isArray(saved.universe) && saved.universe.length) {
        universeCache = { universe: saved.universe, total: saved.total ?? saved.universe.length, at: now(), stale: true, provider: saved.provider ?? 'cache' };
        return universeCache;
      }
      throw error;
    }
  }

  /** 收盘后数据不再变化，缓存拉长到 5 分钟 */
  function ttlForNow() {
    const d = new Date(now());
    const hhmm = d.getHours() * 100 + d.getMinutes();
    const isOpen = d.getDay() >= 1 && d.getDay() <= 5 && hhmm >= 915 && hhmm <= 1505;
    return isOpen ? ttlMs : Math.max(ttlMs, 5 * 60 * 1000);
  }

  /** 把各路结果组装成 dashboard（load 与 reload 兜底共用） */
  async function composeData({ snapshot, indices, breadth, dividend, universeTotal, universeStale }) {
    const rows = snapshot.value.rows;
    attachDividends(rows, dividend);
    const stats = summarizeRows(rows);
    const usedProvider = snapshot.provider;
    const usedMeta = router.list().find((item) => item.id === usedProvider);
    const data = {
      rows,
      indices: indices.value ?? [],
      breadth: Array.isArray(breadth) ? null : breadth.value ?? null,
      stats,
      meta: {
        fetchedAt: now(),
        upstreamMs: 0,
        universeCount: universeTotal,
        count: rows.length,
        failedBatches: snapshot.value.failed ?? [],
        provider: usedProvider,
        providerLabel: usedMeta?.label ?? usedProvider,
        preferredProvider: router.preferred,
        providerFallback: snapshot.errors ?? [],
        providerMissingFields: usedMeta?.missingFields ?? [],
        universeStale: Boolean(universeStale),
        indexError: indices.error ?? null,
        breadthError: breadth.error ?? null,
        dividendStocks: dividend && dividend.map instanceof Map ? dividend.map.size : 0,
        dividendError: dividend && dividend.map instanceof Map ? null : dividend?.error ?? 'unavailable',
        tradingDay: (breadth.error ? null : breadth.value?.tradingDay) ?? tradingDateString(),
        cached: false,
      },
    };
    return data;
  }

  async function load({ force = false } = {}) {
    if (!force && dashboardCache && now() - dashboardCache.at < ttlForNow()) {
      return { ...dashboardCache.data, meta: { ...dashboardCache.data.meta, cached: true } };
    }

    const t0 = now();
    const { universe, total, stale: universeStale } = await getUniverse(force);
    const secids = universe.map((item) => item.secid);

    const [snapshot, indices, breadth, dividend] = await Promise.all([
      router.snapshot(secids),
      router.indices().catch((error) => ({ error: error.message })),
      router.breadth().catch((error) => ({ error: error.message })),
      // 分红数据失败不影响行情：股息率留空，防御面板会提示
      dividendSource.get().catch((error) => ({ error: error.message })),
    ]);

    const data = await composeData({ snapshot, indices, breadth, dividend, universeTotal: total, universeStale });
    data.meta.upstreamMs = Math.round(now() - t0);
    data.meta.cached = false;

    dashboardCache = { data, at: now() };
    lastGood = data;
    return data;
  }

  return {
    async getDashboard({ force = false } = {}) {
      if (inflight) return inflight;
      inflight = load({ force })
        .catch((err) => {
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

    /** 单只分红详情 */
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

    async getUniverse(force = false) {
      return getUniverse(force);
    },

    /** 重载用：清空服务层全部缓存（快照/全集/上一次成功数据/分红） */
    clearCaches() {
      dashboardCache = null;
      universeCache = null;
      lastGood = null;
      const cleared = ['dashboard', 'universe', 'lastGood'];
      try {
        cleared.push(...dividendSource.clear());
      } catch {
        /* 分红源未提供 clear 时忽略 */
      }
      return cleared;
    },

    /**
     * 重载：清空缓存 → 重新走一遍真实请求。
     * 主源限频/超时（partial 或 >预算）时，直接改用备用源重抓，保证「重载可用」。
     */
    async reload({ budgetMs = 12000 } = {}) {
      const t0 = now();
      const cleared = this.clearCaches();
      const preferredHealth = router.health()[router.preferred];
      // 主源最近失败过（限频/超时）→ 不在重载时再等它，直接用备用源；成功一次后自动恢复
      const skipPrimary = Boolean(preferredHealth && preferredHealth.lastError);
      let universeRes;
      let universeStale = false;
      if (skipPrimary) {
        const saved = readStateFile(UNIVERSE_FILE);
        if (saved && Array.isArray(saved.universe) && saved.universe.length) {
          universeStale = true;
          universeRes = { universe: saved.universe, total: saved.total ?? saved.universe.length, stale: true };
        }
      }
      if (!universeRes) try {
        universeRes = await Promise.race([
          getUniverse(true),
          new Promise((_, reject) => setTimeout(() => reject(new Error('代码全集超时')), 6000)),
        ]);
      } catch {
        const saved = readStateFile(UNIVERSE_FILE);
        if (saved && Array.isArray(saved.universe) && saved.universe.length) {
          universeStale = true;
          universeRes = { universe: saved.universe, total: saved.total ?? saved.universe.length, stale: true };
        } else {
          universeRes = await getUniverse(false);
        }
      }
      const { universe, total } = universeRes;
      const secids = universe.map((item) => item.secid);

      let data = null;
      let fallbackReason = skipPrimary ? '主源最近失败，直接使用备用源' : null;
      try {
        if (skipPrimary) throw new Error('skip-primary');
        data = await Promise.race([
          load({ force: true }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('主源超预算')), budgetMs)),
        ]);
        // 行数明显不足（部分批次失败）也视为不完整
        if (data.rows.length < Math.floor(total * 0.9)) {
          fallbackReason = `主源仅返回 ${data.rows.length}/${total} 行`;
          data = null;
        }
      } catch (error) {
        fallbackReason = error instanceof Error ? error.message : String(error);
        data = null;
      }

      if (!data) {
        for (const id of ['tencent', 'sina']) {
          try {
            const snapshot = await router.runWith(id, 'snapshot', [secids]);
            if (!snapshot.value.rows.length) throw new Error('空快照');
            const [indices, breadth, dividend] = await Promise.all([
              router.indices().catch((error) => ({ error: error.message })),
              router.breadth().catch((error) => ({ error: error.message })),
              dividendSource.get().catch((error) => ({ error: error.message })),
            ]);
            data = await composeData({ snapshot, indices, breadth, dividend, universeTotal: total, universeStale });
            data.meta.fallbackReason = fallbackReason;
            data.meta.upstreamMs = Math.round(now() - t0);
            break;
          } catch (error) {
            fallbackReason = (fallbackReason ? fallbackReason + '；' : '') + id + ':' + (error instanceof Error ? error.message : String(error));
          }
        }
        if (!data) throw new Error('重载失败：所有数据源均不可用（' + fallbackReason + '）');
        dashboardCache = { data, at: now() };
        lastGood = data;
      }

      return {
        cleared,
        ms: Math.round(now() - t0),
        meta: data.meta,
        rows: data.rows.length,
        fallbackReason,
      };
    },

    /** 数据源清单 / 当前选择 / 健康状态（供 UI 切换与诊断） */
    getDataSources() {
      return {
        preferred: router.preferred,
        providers: router.list(),
        health: router.health(),
        missingFields: providerInfo().missingFields,
      };
    },

    /** 切换行情源；持久化到 state/data-source.json，重启后保持 */
    setPreferredProvider(id) {
      const next = String(id ?? '').trim();
      if (!router.has(next)) throw new Error(`未知数据源：${next}，可选：${PROVIDERS.map((p) => p.id).join('/')}`);
      router.setPreferred(next);
      writeStateFile(PREFER_FILE, { provider: next, at: now() });
      dashboardCache = null; // 换源后必须重新拉
      return this.getDataSources();
    },

    /** 单只分时（v2 详情页用） */
    async getTrends(secid, ndays = 1) {
      const { value } = await router.trends(secid, { ndays });
      return value;
    },

    /**
     * 单只日线历史（回测用）：按 `end` 翻页回溯，最多取 years 年，去重后升序返回。
     */
    async getKlineHistory(secid, { years = 10, klt = 101, pageBars = 640 } = {}) {
      const target = Math.max(250, Math.ceil(years * 250));
      const byDate = new Map();
      let end = '';
      for (let page = 0; page < 40 && byDate.size < target; page += 1) {
        const { value } = await router.kline(secid, {
          klt,
          fqt: 1,
          lmt: pageBars,
          ...(end ? { end } : {}),
        });
        const bars = value?.bars ?? [];
        if (!bars.length) break;
        let added = 0;
        for (const bar of bars) {
          if (!byDate.has(bar.d)) {
            byDate.set(bar.d, bar);
            added += 1;
          }
        }
        const earliest = bars[0].d;
        if (!added || end === earliest) break;
        end = earliest.replace(/-/g, '');
      }
      const bars = [...byDate.values()].sort((a, b) => (a.d < b.d ? -1 : 1));
      return { name: null, bars };
    },

    /** 单只日K/分钟K（v2 技术指标用） */
    async getKline(secid, { klt = 101, fqt = 1, lmt = 120 } = {}) {
      const { value } = await router.kline(secid, { klt, fqt, lmt });
      return value;
    },
  };
}
