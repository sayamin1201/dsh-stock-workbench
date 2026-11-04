/**
 * 板块资金流：东财 push2 板块列表（概念 / 行业 / 地域）
 * - 概念板块 m:90+t:3，行业板块 m:90+t:2，地域板块 m:90+t:1
 * - 一次 clist 请求可拿 100 个板块，概念板块总数约 400~500（4~6 页）
 * - f62 主力净流入，f184 主力净占比，f104/f105 上涨/下跌家数
 */
const PUSH2 = 'https://push2.eastmoney.com/api/qt/clist/get';
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  Referer: 'https://quote.eastmoney.com/',
};

const PAGE_SIZE = 100;
const MAX_PAGES = 12;
const CONCURRENCY = 4;
const CACHE_MS = 60_000;

export const BOARD_TYPES = {
  concept: 'm:90+t:3',
  industry: 'm:90+t:2',
  region: 'm:90+t:1',
};

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildUrl({ fs, page }) {
  return `${PUSH2}?pn=${page}&pz=${PAGE_SIZE}&po=1&np=1&fltt=2&invt=2&fid=f62`
    + `&fs=${fs}&fields=f12,f14,f2,f3,f62,f184,f104,f105`;
}

async function getJson(url, timeout = 15000) {
  const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error(`板块接口 HTTP ${response.status}`);
  return response.json();
}

export async function fetchBoards(type = 'concept') {
  const fs = BOARD_TYPES[type];
  if (!fs) throw new Error(`未知板块类型：${type}`);
  const started = Date.now();
  const first = await getJson(buildUrl({ fs, page: 1 }));
  const pages = Math.min(MAX_PAGES, Math.max(1, Number(first?.data?.total ? Math.ceil(first.data.total / PAGE_SIZE) : 1)));
  const raw = [...(first?.data?.diff ?? [])];

  const rest = [];
  for (let page = 2; page <= pages; page += 1) rest.push(page);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rest.length) }, async () => {
    while (cursor < rest.length) {
      const page = rest[cursor];
      cursor += 1;
      try {
        const json = await getJson(buildUrl({ fs, page }));
        if (Array.isArray(json?.data?.diff)) raw.push(...json.data.diff);
      } catch {
        /* 少一页不影响整体 */
      }
    }
  }));

  const boards = raw
    .map((row) => ({
      code: row.f12 ?? '',
      name: row.f14 ?? '',
      price: num(row.f2),
      pct: num(row.f3),
      mainIn: num(row.f62),
      mainInPct: num(row.f184),
      up: num(row.f104),
      down: num(row.f105),
    }))
    .filter((board) => board.code && board.name);

  return { type, boards, pages, ms: Date.now() - started };
}

export function createBoardSource({ ttlMs = CACHE_MS } = {}) {
  const cache = new Map();
  const inflight = new Map();
  return {
    async get(type = 'concept') {
      const key = BOARD_TYPES[type] ? type : 'concept';
      const hit = cache.get(key);
      if (hit && Date.now() - hit.at < ttlMs) return hit.data;
      if (inflight.has(key)) return inflight.get(key);
      const promise = fetchBoards(key)
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

/** 板块成分股：fs=b:BKxxxx，分页拉代码列表（融资融券这类板块可达 39 页） */
export async function fetchBoardMembers(code) {
  const started = Date.now();
  const fsParam = `b:${code}`;
  const first = await getJson(`${PUSH2}?pn=1&pz=${PAGE_SIZE}&po=1&np=1&fltt=2&invt=2&fid=f12&fs=${fsParam}&fields=f12,f14`);
  const total = Number(first?.data?.total) || 0;
  const pages = Math.min(60, Math.max(1, Math.ceil(total / PAGE_SIZE)));
  const rows = [...(first?.data?.diff ?? [])];
  const rest = [];
  for (let page = 2; page <= pages; page += 1) rest.push(page);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(8, rest.length) }, async () => {
    while (cursor < rest.length) {
      const page = rest[cursor];
      cursor += 1;
      try {
        const json = await getJson(`${PUSH2}?pn=${page}&pz=${PAGE_SIZE}&po=1&np=1&fltt=2&invt=2&fid=f12&fs=${fsParam}&fields=f12,f14`);
        if (Array.isArray(json?.data?.diff)) rows.push(...json.data.diff);
      } catch {
        /* 少一页不影响整体 */
      }
    }
  }));
  const codes = [...new Set(rows.map((row) => row.f12).filter((item) => typeof item === 'string'))];
  return { code, total, pages, codes, ms: Date.now() - started };
}

export function createBoardMemberSource({ ttlMs = 5 * 60 * 1000 } = {}) {
  const cache = new Map();
  const inflight = new Map();
  return {
    async get(code) {
      const key = String(code);
      const hit = cache.get(key);
      if (hit && Date.now() - hit.at < ttlMs) return hit.data;
      if (inflight.has(key)) return inflight.get(key);
      const promise = fetchBoardMembers(key)
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
