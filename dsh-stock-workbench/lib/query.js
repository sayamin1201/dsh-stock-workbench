/**
 * 查询层：筛选 + 排序 + 格式化（纯函数，无网络、无 DSH 依赖，可在 Node 里直接测）
 */

// ---------------------------------------------------------------------------
// 列定义
// ---------------------------------------------------------------------------

export const COLUMNS = [
  { key: 'code', label: '代码', kind: 'text', width: 78, sticky: true },
  { key: 'name', label: '名称', kind: 'text', width: 92, sticky: true },
  { key: 'price', label: '最新价', kind: 'price', width: 78, align: 'right' },
  { key: 'pct', label: '涨跌幅', kind: 'pct', width: 82, align: 'right' },
  { key: 'amplitude', label: '振幅', kind: 'pctPlain', width: 72, align: 'right' },
  { key: 'amount', label: '成交额', kind: 'money', width: 88, align: 'right' },
  { key: 'turnover', label: '换手率', kind: 'pctPlain', width: 76, align: 'right' },
  { key: 'volumeRatio', label: '量比', kind: 'num', width: 66, align: 'right' },
  { key: 'speed', label: '涨速', kind: 'pct', width: 68, align: 'right' },
  { key: 'pct5d', label: '5日涨跌', kind: 'pct', width: 82, align: 'right' },
  { key: 'floatMcap', label: '流通市值', kind: 'mcap', width: 92, align: 'right' },
  { key: 'mainIn', label: '主力净流入', kind: 'moneySign', width: 100, align: 'right' },
  // 默认隐藏（v1.5 列开关），但排序/筛选已经可用
  { key: 'chg', label: '涨跌额', kind: 'signed', width: 76, align: 'right', hidden: true },
  { key: 'volLots', label: '成交量(手)', kind: 'lots', width: 96, align: 'right', hidden: true },
  { key: 'pe', label: '市盈率(动)', kind: 'num', width: 88, align: 'right', hidden: true },
  { key: 'pb', label: '市净率', kind: 'num', width: 76, align: 'right', hidden: true },
  { key: 'mcap', label: '总市值', kind: 'mcap', width: 92, align: 'right', hidden: true },
  { key: 'pct60d', label: '60日涨跌', kind: 'pct', width: 84, align: 'right', hidden: true },
  { key: 'pctYtd', label: '年初至今', kind: 'pct', width: 82, align: 'right', hidden: true },
  { key: 'mainInPct', label: '主力净占比', kind: 'pctPlain', width: 92, align: 'right', hidden: true },
  { key: 'industry', label: '行业', kind: 'text', width: 96, hidden: true },
];

export const DEFAULT_SORT = { key: 'pct', dir: 'desc' };

// ---------------------------------------------------------------------------
// 格式化
// ---------------------------------------------------------------------------

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function fmtPrice(v) {
  return isNum(v) ? v.toFixed(2) : '—';
}

/** 带符号百分比：+1.23% / -0.45% */
export function fmtPct(v) {
  if (!isNum(v)) return '—';
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
}

/** 不带符号百分比（振幅、换手率） */
export function fmtPctPlain(v) {
  return isNum(v) ? `${v.toFixed(2)}%` : '—';
}

/** 金额：元 → 亿/万 */
export function fmtMoney(v) {
  if (!isNum(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e8) return `${(v / 1e8).toFixed(2)}亿`;
  if (abs >= 1e4) return `${(v / 1e4).toFixed(1)}万`;
  return `${Math.round(v)}`;
}

/** 带符号金额（主力净流入）：+1.23亿 */
export function fmtMoneySign(v) {
  if (!isNum(v) || v === 0) return '—'; // 0 = 东财未覆盖，视为无数据
  const s = fmtMoney(v);
  return v > 0 ? `+${s}` : s;
}

export function fmtMcap(v) {
  if (!isNum(v)) return '—';
  const yi = v / 1e8;
  // 1 万亿 = 10000 亿；低于 1 万亿一律用「亿」，避免 3390 亿显示成 3.39 万亿
  return yi >= 10000 ? `${(yi / 10000).toFixed(2)}万亿` : `${yi.toFixed(1)}亿`;
}

export function fmtLots(v) {
  if (!isNum(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e8) return `${(v / 1e8).toFixed(2)}亿手`;
  if (abs >= 1e4) return `${(v / 1e4).toFixed(1)}万手`;
  return `${Math.round(v)}`;
}

export function fmtNum(v) {
  return isNum(v) ? v.toFixed(2) : '—';
}

export function fmtSigned(v) {
  if (!isNum(v)) return '—';
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}`;
}

const FORMATTERS = {
  text: (v) => (v == null || v === '' ? '—' : String(v)),
  price: fmtPrice,
  pct: fmtPct,
  pctPlain: fmtPctPlain,
  money: fmtMoney,
  moneySign: fmtMoneySign,
  mcap: fmtMcap,
  lots: fmtLots,
  num: fmtNum,
  signed: fmtSigned,
};

export function formatCell(value, kind) {
  return (FORMATTERS[kind] ?? FORMATTERS.text)(value);
}

// ---------------------------------------------------------------------------
// 筛选
// ---------------------------------------------------------------------------

export const EMPTY_FILTERS = Object.freeze({
  search: '',
  boardCode: '',
  boardName: '',
  boardCodes: null,
  pctMin: null,
  pctMax: null,
  amountMin: null, // 亿元
  turnoverMin: null,
  turnoverMax: null,
  volumeRatioMin: null,
  amplitudeMin: null,
  floatMcapMin: null, // 亿元
  floatMcapMax: null,
  mainInMin: null, // 万元
  excludeST: true,
  excludeStar: false,
  excludeBse: false,
});

const has = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));

function toNum(v) {
  return has(v) ? Number(v) : null;
}

/** 是否为 ST / 退市整理股（名称判定） */
export function isST(row) {
  return /ST|退/i.test(row.name ?? '');
}

/**
 * 内存筛选。所有区间均为闭区间；null 表示不限。
 * @param {Array<object>} rows
 * @param {Partial<typeof EMPTY_FILTERS>} filters
 */
export function applyFilters(rows, filters = {}) {
  const f = { ...EMPTY_FILTERS, ...filters };
  const search = String(f.search ?? '').trim().toLowerCase();
  const boardCodeSet = Array.isArray(f.boardCodes) && f.boardCodes.length ? new Set(f.boardCodes) : null;
  const pctMin = toNum(f.pctMin);
  const pctMax = toNum(f.pctMax);
  const amountMin = toNum(f.amountMin);
  const turnoverMin = toNum(f.turnoverMin);
  const turnoverMax = toNum(f.turnoverMax);
  const volumeRatioMin = toNum(f.volumeRatioMin);
  const amplitudeMin = toNum(f.amplitudeMin);
  const floatMcapMin = toNum(f.floatMcapMin);
  const floatMcapMax = toNum(f.floatMcapMax);
  const mainInMin = toNum(f.mainInMin);

  const out = [];
  for (const row of rows) {
    if (f.excludeST && isST(row)) continue;
    if (f.excludeStar && row.board === 'star') continue;
    if (f.excludeBse && row.board === 'bse') continue;

    if (boardCodeSet && !boardCodeSet.has(row.code)) continue;
    if (search) {
      const haystack = `${row.code ?? ''} ${row.name ?? ''} ${row.industry ?? ''} ${row.regionBoard ?? ''} ${row.concepts ?? ''}`.toLowerCase();
      const hit = haystack.includes(search);
      if (!hit) continue;
    }

    const pct = row.pct;
    if (pctMin !== null && !(pct !== null && pct >= pctMin)) continue;
    if (pctMax !== null && !(pct !== null && pct <= pctMax)) continue;

    if (amountMin !== null && !((row.amount ?? 0) >= amountMin * 1e8)) continue;

    if (turnoverMin !== null && !(row.turnover !== null && row.turnover >= turnoverMin)) continue;
    if (turnoverMax !== null && !(row.turnover !== null && row.turnover <= turnoverMax)) continue;

    if (volumeRatioMin !== null && !(row.volumeRatio !== null && row.volumeRatio >= volumeRatioMin)) continue;
    if (amplitudeMin !== null && !(row.amplitude !== null && row.amplitude >= amplitudeMin)) continue;

    if (floatMcapMin !== null && !((row.floatMcap ?? 0) >= floatMcapMin * 1e8)) continue;
    if (floatMcapMax !== null && !((row.floatMcap ?? 0) <= floatMcapMax * 1e8)) continue;

    // 主力净流入：0 视为无数据，正阈值下自然被排除
    if (mainInMin !== null && !((row.mainIn ?? -Infinity) >= mainInMin * 1e4)) continue;

    out.push(row);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 排序
// ---------------------------------------------------------------------------

function sortValue(row, key) {
  const v = row[key];
  if (v === null || v === undefined) return null;
  return v;
}

/**
 * 稳定排序：null 永远排在最后（升序降序都一样），避免"无数据"占据榜首。
 * @param {Array<object>} rows
 * @param {string} key
 * @param {'asc'|'desc'} dir
 */
export function sortRows(rows, key, dir = 'desc') {
  const indexed = rows.map((row, index) => ({ row, index }));
  const sign = dir === 'asc' ? 1 : -1;

  indexed.sort((a, b) => {
    const av = sortValue(a.row, key);
    const bv = sortValue(b.row, key);

    const aNull = av === null;
    const bNull = bv === null;
    if (aNull && bNull) return a.index - b.index;
    if (aNull) return 1; // 无数据恒在最后
    if (bNull) return -1;

    if (typeof av === 'number' && typeof bv === 'number') {
      if (av !== bv) return (av - bv) * sign;
      return a.index - b.index;
    }
    const cmp = String(av).localeCompare(String(bv), 'zh-CN');
    if (cmp !== 0) return cmp * sign;
    return a.index - b.index;
  });

  return indexed.map((item) => item.row);
}

/** 筛选 + 排序一次完成 */
export function runQuery(rows, filters, sort) {
  const filtered = applyFilters(rows, filters);
  const s = sort ?? DEFAULT_SORT;
  return sortRows(filtered, s.key, s.dir);
}

// ---------------------------------------------------------------------------
// 快捷预设（v1 的"一键选股"入口）
// ---------------------------------------------------------------------------

export const PRESETS = [
  {
    id: 'limit-up',
    label: '涨停/接近涨停',
    filters: { pctMin: 9.5, pctMax: null },
    sort: { key: 'pct', dir: 'desc' },
  },
  {
    id: 'heavy-turnover',
    label: '高换手活跃',
    filters: { turnoverMin: 10, amountMin: 5 },
    sort: { key: 'turnover', dir: 'desc' },
  },
  {
    id: 'volume-surge',
    label: '放量异动',
    filters: { volumeRatioMin: 2, amountMin: 2 },
    sort: { key: 'volumeRatio', dir: 'desc' },
  },
  {
    id: 'main-inflow',
    label: '主力抢筹',
    filters: { mainInMin: 5000 },
    sort: { key: 'mainIn', dir: 'desc' },
  },
  {
    id: 'big-cap-up',
    label: '大盘蓝筹走强',
    filters: { floatMcapMin: 300, pctMin: 0 },
    sort: { key: 'pct', dir: 'desc' },
  },
  {
    id: 'low-pe',
    label: '低估值(PE 0~15)',
    filters: {},
    sort: { key: 'pe', dir: 'asc' },
  },
];

// ---------------------------------------------------------------------------
// 汇总统计（与榜单同口径）
// ---------------------------------------------------------------------------

export function summarize(rows) {
  let up = 0;
  let down = 0;
  let flat = 0;
  let amount = 0;
  let mainIn = 0;
  for (const row of rows) {
    const pct = row.pct;
    if (pct === null) continue;
    if (pct > 0) up += 1;
    else if (pct < 0) down += 1;
    else flat += 1;
    amount += row.amount ?? 0;
    if (typeof row.mainIn === 'number') mainIn += row.mainIn;
  }
  return { up, down, flat, amount, mainIn, count: rows.length };
}

/** 涨幅分布直方图（-10% 以下 … +10% 以上），给概览条用 */
export function pctHistogram(rows, buckets = [-10, -7, -5, -3, -1, 0, 1, 3, 5, 7, 10]) {
  const counts = new Array(buckets.length + 1).fill(0);
  for (const row of rows) {
    const pct = row.pct;
    if (pct === null) continue;
    let i = buckets.findIndex((edge) => pct < edge);
    if (i === -1) i = buckets.length;
    counts[i] += 1;
  }
  return { buckets, counts };
}
