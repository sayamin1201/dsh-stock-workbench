// 数据层冒烟测试：node test/smoke.mjs
import { createMarketService, fetchUniverse, fetchSnapshot, summarizeRows } from '../lib/market.js';

const fmt = (n, d = 2) => (typeof n === 'number' ? n.toFixed(d) : '—');
const yi = (n) => (typeof n === 'number' ? (n / 1e8).toFixed(1) + '亿' : '—');

const svc = createMarketService({ ttlMs: 0 });

const t0 = performance.now();
const uni = await fetchUniverse();
const t1 = performance.now();
console.log(`[universe] ${uni.universe.length} 只 / total=${uni.total} / ${Math.round(t1 - t0)}ms`);

const boardCount = uni.universe.reduce((acc, r) => ((acc[r.board] = (acc[r.board] || 0) + 1), acc), {});
console.log('[universe] 板块分布:', boardCount);

const snap = await fetchSnapshot(uni.universe.map((r) => r.secid));
const t2 = performance.now();
console.log(`[snapshot] ${snap.rows.length} 只 / ${Math.round(t2 - t1)}ms / 失败批=${snap.failed.length}`);

const dash = await svc.getDashboard({ force: true });
const m = dash.meta;
console.log(`\n[dashboard] ${m.count}/${m.universeCount} 只  上游 ${m.upstreamMs}ms  交易日 ${m.tradingDay}`);
console.log('[indices]', dash.indices.map((i) => `${i.name} ${fmt(i.price)} ${fmt(i.pct)}%`).join(' | '));
console.log('[breadth 官方]', `涨 ${dash.breadth?.up} 跌 ${dash.breadth?.down} 平 ${dash.breadth?.flat} 涨停 ${dash.breadth?.limitUp} 跌停 ${dash.breadth?.limitDown}`);
console.log('[breadth 本地]', `涨 ${dash.stats.up} 跌 ${dash.stats.down} 平 ${dash.stats.flat} 成交额 ${yi(dash.stats.amount)}`);

const top = [...dash.rows].sort((a, b) => (b.pct ?? -999) - (a.pct ?? -999)).slice(0, 5);
console.log('\n[涨幅榜 top5]');
for (const r of top) {
  console.log(`  ${r.code} ${r.name}  ${fmt(r.price)}  ${fmt(r.pct)}%  额 ${yi(r.amount)}  换手 ${fmt(r.turnover, 2)}  量比 ${fmt(r.volumeRatio, 2)}  主力 ${yi(r.mainIn)}`);
}

const byRatio = [...dash.rows].filter((r) => (r.volumeRatio ?? 0) > 1).sort((a, b) => (b.volumeRatio ?? 0) - (a.volumeRatio ?? 0)).slice(0, 3);
console.log('\n[量比榜 top3]', byRatio.map((r) => `${r.name} 量比${fmt(r.volumeRatio)} 涨幅${fmt(r.pct)}%`).join(' | '));

const byMain = [...dash.rows].filter((r) => r.mainIn != null).sort((a, b) => (b.mainIn ?? 0) - (a.mainIn ?? 0)).slice(0, 3);
console.log('[主力净流入 top3]', byMain.map((r) => `${r.name} ${yi(r.mainIn)}`).join(' | '));

const nullCount = (k) => dash.rows.filter((r) => r[k] === null).length;
console.log('\n[空值检查]', ['price', 'pct', 'amount', 'turnover', 'pe', 'pb', 'mainIn', 'pct5d'].map((k) => `${k}:${nullCount(k)}`).join(' '));

// 缓存命中
const t3 = performance.now();
const dash2 = await svc.getDashboard();
console.log(`\n[cache] cached=${dash2.meta.cached} ${Math.round(performance.now() - t3)}ms`);
