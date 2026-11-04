/**
 * Host half of the 看股工作台 (stock workbench) bundle.
 *
 * Owns the only network access: the browser half never talks to 东方财富
 * directly (CORS/Referer/证书 in the renderer), it calls these two same-origin
 * routes and renders the JSON.
 *
 *   GET /dsh-stock/api/v1/dashboard[?force=1]  → 全 A 快照 + 指数 + 涨跌家数
 *   GET /dsh-stock/api/v1/health               → liveness of this mount
 */

import { createMarketService, pool } from './lib/market.js';
import { scanBars, normalizeSignals, SIGNALS } from './lib/signals.js';
import { compileFormula, getFieldCatalog, getFormulaPresets, FORMULA_EXAMPLES } from './lib/formula.js';
import { createBoardSource, createBoardMemberSource } from './lib/boards.js';
import { createValuationSource } from './lib/valuation.js';

export const name = 'dsh-stock-workbench';

const API_BASE = '/dsh-stock/api/v1';


/** `1.600000` / `0.300750` — 市场前缀.6位代码 */
const SECID_RE = /^[01]\.\d{6}$/;
const ALLOWED_KLT = new Set([5, 15, 30, 60, 101, 102, 103]);

const SCAN_CACHE_MS = 60_000;
const SCAN_MAX_LIMIT = 400;
const SCAN_CONCURRENCY = 6;
/** 信号扫描支持的 K 线周期：日线 + 分钟线（分钟 K 上游只保留约 31 个交易日） */
const SCAN_KLTS = new Set([5, 15, 30, 60, 101]);
const NAME_EXCLUDED = /ST|退/i;

function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

/**
 * 两段式选股：先用快照粗筛候选池（成交额/ST），再只对候选池拉日K算信号。
 * 全市场逐个拉 K 线是 5500+ 请求，不可行。
 */
async function runScan(service, { signals, minAmount, limit, excludeST, within, klt }) {
  const started = Date.now();
  const dashboard = await service.getDashboard();

  let candidates = dashboard.rows.filter((row) => (row.amount ?? 0) >= minAmount * 1e8);
  if (excludeST) candidates = candidates.filter((row) => !NAME_EXCLUDED.test(row.name ?? ''));
  candidates.sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));
  const picked = candidates.slice(0, limit);
  const barCount = klt === 101 ? 180 : 240;

  const matches = [];
  const failed = [];
  await pool(picked, SCAN_CONCURRENCY, async (row) => {
    try {
      const kline = await service.getKline(row.secid, { klt, fqt: 1, lmt: barCount });
      const { hits } = scanBars(kline.bars, signals, { within });
      if (hits.length > 0) matches.push({ ...row, signals: hits, bars: kline.bars.length });
    } catch {
      failed.push(row.code);
    }
  });

  matches.sort((a, b) => b.signals.length - a.signals.length || (b.pct ?? 0) - (a.pct ?? 0));
  return {
    matches,
    signals,
    within,
    klt,
    scanned: picked.length,
    poolSize: candidates.length,
    failed: failed.length,
    ms: Date.now() - started,
    tradingDay: dashboard.meta.tradingDay,
  };
}

function readKlineParams(url) {
  const secid = url.searchParams.get('secid') ?? '';
  if (!SECID_RE.test(secid)) return { error: 'invalid secid' };
  const kltRaw = Number(url.searchParams.get('klt') ?? 240);
  const klt = ALLOWED_KLT.has(kltRaw) ? kltRaw : 101;
  // 上限从 1000 放宽到 6000：日线全历史约 6420 根，前端 "向左拖补历史" 要能一次多拿
  const lmtRaw = Number(url.searchParams.get('lmt') ?? 240);
  const lmt = Number.isFinite(lmtRaw) ? Math.min(6000, Math.max(20, Math.round(lmtRaw))) : 240;
  return { secid, klt, lmt };
}

/**
 * 只把渲染与排序真正用到的字段发到浏览器。
 * 完整行（行业/市值/60日/年初至今…）留在 Host 侧，v2 详情页再用。
 * 26 字段 ≈ 2.2MB，裁到 14 字段 ≈ 0.7MB，localhost 上差别不大但没必要发。
 */
const WIRE_FIELDS = [
  'code', 'name', 'board', 'secid', 'industry', 'regionBoard', 'concepts',
  'price', 'pct', 'amount', 'turnover', 'volumeRatio',
  'amplitude', 'speed', 'pct5d', 'floatMcap', 'mainIn', 'pe', 'pb', 'volLots', 'mainInPct',
  // 基本面 / 防御属性
  'roe', 'revenueYoy', 'profitYoy', 'grossMargin', 'debtRatio', 'eps', 'bvps', 'ps',
  'dividendYield', 'dividendPerShare', 'dividendYears', 'dividendConsecutive', 'lastDividendDate',
];

function projectRows(rows) {
  return rows.map((row) => {
    const out = {};
    for (const key of WIRE_FIELDS) out[key] = row[key];
    return out;
  });
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(payload));
}

function methodNotAllowed(response, allow) {
  response.writeHead(405, { allow, 'cache-control': 'no-store' });
  response.end();
}

/**
 * @param {object} ctx
 * @param {{ttlMs?: number}} [config]
 */
export function apply(ctx, config = {}) {
  const ttlMs = Number(config?.ttlMs);
  const service = createMarketService({
    ttlMs: Number.isFinite(ttlMs) && ttlMs >= 0 ? ttlMs : 3000,
  });

  // webServer may arrive after this plugin: ctx.inject keeps us inactive
  // (instead of throwing) on a profile that has no web server at all.
  ctx.inject(['webServer'], (hostCtx) => {
    hostCtx.effect(() => {
      const disposers = [];

      disposers.push(
        hostCtx.webServer.register({
          kind: 'exact',
          path: `${API_BASE}/health`,
          handler: (request, response) => {
            if (request.method !== 'GET') return methodNotAllowed(response, 'GET');
            sendJson(response, 200, { ok: true, service: name, api: 1 });
          },
        }),
      );

      disposers.push(
        hostCtx.webServer.register({
          kind: 'exact',
          path: `${API_BASE}/dashboard`,
          handler: async (request, response) => {
            if (request.method !== 'GET') return methodNotAllowed(response, 'GET');
            let force = false;
            try {
              const url = new URL(request.url ?? '/', 'http://localhost');
              force = url.searchParams.get('force') === '1';
            } catch {
              // a malformed URL is not worth failing the request over
            }
            try {
              const data = await service.getDashboard({ force });
              sendJson(response, 200, {
                ok: true,
                data: { ...data, rows: projectRows(data.rows) },
              });
            } catch (error) {
              sendJson(response, 502, {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          },
        }),
      );

      disposers.push(
        hostCtx.webServer.register({
          kind: 'exact',
          path: `${API_BASE}/kline`,
          handler: async (request, response) => {
            if (request.method !== 'GET') return methodNotAllowed(response, 'GET');
            let params;
            try {
              params = readKlineParams(new URL(request.url ?? '/', 'http://localhost'));
            } catch {
              return sendJson(response, 400, { ok: false, error: 'bad request' });
            }
            if (params.error) return sendJson(response, 400, { ok: false, error: params.error });
            try {
              const data = await service.getKline(params.secid, {
                klt: params.klt,
                fqt: 1, // 前复权：均线/MACD 需要连续价格
                lmt: params.lmt,
              });
              sendJson(response, 200, { ok: true, data });
            } catch (error) {
              sendJson(response, 502, {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          },
        }),
      );

      disposers.push(
        hostCtx.webServer.register({
          kind: 'exact',
          path: `${API_BASE}/trends`,
          handler: async (request, response) => {
            if (request.method !== 'GET') return methodNotAllowed(response, 'GET');
            let secid = '';
            try {
              secid = new URL(request.url ?? '/', 'http://localhost').searchParams.get('secid') ?? '';
            } catch {
              // fall through to the 400 below
            }
            if (!SECID_RE.test(secid)) return sendJson(response, 400, { ok: false, error: 'invalid secid' });
            try {
              const data = await service.getTrends(secid, 1);
              sendJson(response, 200, { ok: true, data });
            } catch (error) {
              sendJson(response, 502, {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          },
        }),
      );

      disposers.push(
        hostCtx.webServer.register({
          kind: 'exact',
          path: `${API_BASE}/signals`,
          handler: (request, response) => {
            if (request.method !== 'GET') return methodNotAllowed(response, 'GET');
            sendJson(response, 200, { ok: true, data: { signals: SIGNALS } });
          },
        }),
      );

      const scanCache = new Map();      disposers.push(
        hostCtx.webServer.register({
          kind: 'exact',
          path: `${API_BASE}/scan`,
          handler: async (request, response) => {
            if (request.method !== 'GET') return methodNotAllowed(response, 'GET');
            let url;
            try {
              url = new URL(request.url ?? '/', 'http://localhost');
            } catch {
              return sendJson(response, 400, { ok: false, error: 'bad request' });
            }
            const kltRaw = Math.round(clampNumber(url.searchParams.get('klt'), 5, 101, 101));
            const params = {
              signals: normalizeSignals(url.searchParams.get('signals')),
              minAmount: clampNumber(url.searchParams.get('minAmount'), 0, 1000, 1),
              limit: Math.round(clampNumber(url.searchParams.get('limit'), 10, SCAN_MAX_LIMIT, 150)),
              excludeST: url.searchParams.get('excludeST') !== '0',
              within: Math.round(clampNumber(url.searchParams.get('within'), 0, 10, 0)),
              klt: SCAN_KLTS.has(kltRaw) ? kltRaw : 101,
            };
            const cacheKey = `${params.signals.join('+')}|${params.minAmount}|${params.limit}|${params.excludeST}|${params.within}|${params.klt}`;
            const cached = scanCache.get(cacheKey);
            if (cached && Date.now() - cached.at < SCAN_CACHE_MS) {
              return sendJson(response, 200, { ok: true, data: { ...cached.data, cached: true } });
            }
            try {
              const data = await runScan(service, params);
              scanCache.set(cacheKey, { at: Date.now(), data });
              if (scanCache.size > 20) {
                const oldest = [...scanCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
                scanCache.delete(oldest[0]);
              }
              sendJson(response, 200, { ok: true, data });
            } catch (error) {
              sendJson(response, 502, {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          },
        }),
      );

      disposers.push(
        hostCtx.webServer.register({
          kind: 'exact',
          path: `${API_BASE}/formula/validate`,
          handler: (request, response) => {
            if (request.method !== 'GET') return methodNotAllowed(response, 'GET');
            let url;
            try {
              url = new URL(request.url ?? '/', 'http://localhost');
            } catch {
              return sendJson(response, 400, { ok: false, error: 'bad request' });
            }
            const compiled = compileFormula(url.searchParams.get('expr') ?? '');
            if (compiled.ok) {
              return sendJson(response, 200, { ok: true, data: { valid: true } });
            }
            sendJson(response, 200, {
              ok: true,
              data: { valid: false, error: compiled.error, position: compiled.position ?? 0 },
            });
          },
        }),
      );

      disposers.push(
        hostCtx.webServer.register({
          kind: 'exact',
          path: `${API_BASE}/formula/fields`,
          handler: (request, response) => {
            if (request.method !== 'GET') return methodNotAllowed(response, 'GET');
            sendJson(response, 200, {
              ok: true,
              data: {
                fields: getFieldCatalog(),
                examples: FORMULA_EXAMPLES,
                presets: getFormulaPresets(),
              },
            });
          },
        }),
      );

      disposers.push(
        hostCtx.webServer.register({
          kind: 'exact',
          path: `${API_BASE}/formula`,
          handler: async (request, response) => {
            if (request.method !== 'GET') return methodNotAllowed(response, 'GET');
            let url;
            try {
              url = new URL(request.url ?? '/', 'http://localhost');
            } catch {
              return sendJson(response, 400, { ok: false, error: 'bad request' });
            }
            const expr = url.searchParams.get('expr') ?? '';
            const limit = Math.round(clampNumber(url.searchParams.get('limit'), 10, 500, 200));
            const started = Date.now();
            const compiled = compileFormula(expr);
            if (!compiled.ok) {
              return sendJson(response, 400, {
                ok: false,
                error: compiled.error,
                position: compiled.position ?? 0,
                expr,
              });
            }
            try {
              const dashboard = await service.getDashboard();
              const matched = dashboard.rows.filter((row) => compiled.test(row));
              sendJson(response, 200, {
                ok: true,
                data: {
                  rows: projectRows(matched.slice(0, limit)),
                  matched: matched.length,
                  total: dashboard.rows.length,
                  expr,
                  ms: Date.now() - started,
                  tradingDay: dashboard.meta.tradingDay,
                },
              });
            } catch (error) {
              sendJson(response, 502, {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          },
        }),
      );

      // 单只分红详情（榜单里点「分红年数 / 连续分红」打开弹窗）
      disposers.push(
        hostCtx.webServer.register({
          kind: 'exact',
          path: `${API_BASE}/dividend`,
          handler: async (request, response) => {
            if (request.method !== 'GET') return methodNotAllowed(response, 'GET');
            let code = '';
            try {
              code = new URL(request.url ?? '/', 'http://localhost').searchParams.get('code') ?? '';
            } catch {
              code = '';
            }
            if (!/^\d{6}$/.test(code)) {
              return sendJson(response, 400, { ok: false, error: 'code 需为 6 位数字' });
            }
            try {
              const data = await service.getDividendDetail(code);
              sendJson(response, 200, { ok: true, data });
            } catch (error) {
              sendJson(response, 502, {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          },
        }),
      );

      // 板块资金流（概念 / 行业 / 地域）
      const boardSource = createBoardSource();
      disposers.push(
        hostCtx.webServer.register({
          kind: 'exact',
          path: `${API_BASE}/boards`,
          handler: async (request, response) => {
            if (request.method !== 'GET') return methodNotAllowed(response, 'GET');
            let type = 'concept';
            try {
              type = new URL(request.url ?? '/', 'http://localhost').searchParams.get('type') ?? 'concept';
            } catch {
              type = 'concept';
            }
            if (!['concept', 'industry', 'region'].includes(type)) type = 'concept';
            try {
              const data = await boardSource.get(type);
              sendJson(response, 200, { ok: true, data });
            } catch (error) {
              sendJson(response, 502, { ok: false, error: error instanceof Error ? error.message : String(error) });
            }
          },
        }),
      );

      // 估值分位（PE/PB 近 5 年百分位）
      const valuationSource = createValuationSource();
      disposers.push(
        hostCtx.webServer.register({
          kind: 'exact',
          path: `${API_BASE}/valuation`,
          handler: async (request, response) => {
            if (request.method !== 'GET') return methodNotAllowed(response, 'GET');
            let code = '';
            try {
              code = new URL(request.url ?? '/', 'http://localhost').searchParams.get('code') ?? '';
            } catch {
              code = '';
            }
            if (!/^\d{6}$/.test(code)) return sendJson(response, 400, { ok: false, error: 'code 需为 6 位数字' });
            try {
              const data = await valuationSource.get(code);
              sendJson(response, 200, { ok: true, data });
            } catch (error) {
              sendJson(response, 502, { ok: false, error: error instanceof Error ? error.message : String(error) });
            }
          },
        }),
      );

      // 板块成分股（点击板块 → 按成员代码筛选）
      const boardMemberSource = createBoardMemberSource();
      disposers.push(
        hostCtx.webServer.register({
          kind: 'exact',
          path: `${API_BASE}/board-members`,
          handler: async (request, response) => {
            if (request.method !== 'GET') return methodNotAllowed(response, 'GET');
            let code = '';
            try {
              code = new URL(request.url ?? '/', 'http://localhost').searchParams.get('code') ?? '';
            } catch {
              code = '';
            }
            if (!/^BK\d{4}$/.test(code)) return sendJson(response, 400, { ok: false, error: 'code 需为 BKxxxx' });
            try {
              const data = await boardMemberSource.get(code);
              sendJson(response, 200, { ok: true, data });
            } catch (error) {
              sendJson(response, 502, { ok: false, error: error instanceof Error ? error.message : String(error) });
            }
          },
        }),
      );

      return () => {
        for (const dispose of disposers) {
          try {
            dispose?.();
          } catch {
            /* teardown of an already-gone route is not an error */
          }
        }
      };
    }, 'dsh-stock-workbench: api routes');
  });
}
