import { probe, j, saveJson, stat } from './lib.mjs';

const FS = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048';
const FULL = 'f12,f14,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f18,f20,f21,f22,f23,f62,f184';
const out = {};

// A) exact ulist cap bisect
const bis = [];
for (const n of [850, 900, 950]) {
  const secids = Array.from({ length: n }, (_, i) => `1.${600000 + i}`).join(',');
  const r = await probe(`https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f12,f14,f2,f3&secids=${secids}`);
  bis.push({ n, status: r.status, ms: r.ms, urlLen: `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f12,f14,f2,f3&secids=${secids}`.length });
}
out.ulistBisect = bis;

// B) full 60-page clist crawl, concurrency 6, low fields -> universe
async function pool(items, worker, conc) {
  const res = new Array(items.length);
  let idx = 0;
  await Promise.all(Array.from({ length: conc }, async () => {
    while (idx < items.length) { const i = idx++; res[i] = await worker(items[i], i); }
  }));
  return res;
}

const t0 = performance.now();
const pages = await pool(Array.from({ length: 60 }, (_, i) => i + 1), async (pn) => {
  const r = await probe(`https://push2.eastmoney.com/api/qt/clist/get?pn=${pn}&pz=100&po=1&np=1&fltt=2&invt=2&fid=f12&fs=${FS}&fields=f12,f13,f14`);
  const d = j(r.text);
  return { pn, status: r.status, ms: r.ms, kb: r.kb, rows: d?.data?.diff ?? [], total: d?.data?.total };
}, 6);
const crawlMs = Math.round(performance.now() - t0);
const all = pages.flatMap(p => p.rows);
const uniq = new Set(all.map(r => `${r.f13}.${r.f12}`));
out.universeCrawl = {
  pages: pages.length, ms: crawlMs, totalBytesKb: +pages.reduce((s, p) => s + p.kb, 0).toFixed(1),
  rawRows: all.length, uniqSecids: uniq.size, total: pages[0]?.total,
  statuses: [...new Set(pages.map(p => p.status))], msStat: stat(pages.map(p => p.ms)),
  markets: all.reduce((m, r) => (m[r.f13] = (m[r.f13] || 0) + 1, m), {}),
  prefix3: [...new Set(all.map(r => `${r.f13}.${String(r.f12).slice(0, 3)}`))].sort(),
};
const secids = [...uniq];
saveJson('D:/h5/stock-workbench/research/scripts/out-06-universe.json', { summary: out.universeCrawl, secids });

// C) full snapshot via ulist batches (800) with 19 fields, concurrency 4
const batches = [];
for (let i = 0; i < secids.length; i += 800) batches.push(secids.slice(i, i + 800));
const t1 = performance.now();
const bres = await pool(batches, async (b, i) => {
  const r = await probe(`https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=${FULL}&secids=${b.join(',')}`);
  const d = j(r.text);
  return { i, status: r.status, ms: r.ms, kb: r.kb, n: (d?.data?.diff ?? []).length };
}, 4);
const ulistMs = Math.round(performance.now() - t1);
out.ulistSnapshot = {
  batches: batches.length, ms: ulistMs, totalBytesKb: +bres.reduce((s, b) => s + b.kb, 0).toFixed(1),
  statuses: [...new Set(bres.map(b => b.status))], rows: bres.reduce((s, b) => s + b.n, 0),
  msStat: stat(bres.map(b => b.ms)),
};

// D) clist full snapshot (60 pages, 19 fields) concurrency 6
const t2 = performance.now();
const fres = await pool(Array.from({ length: 60 }, (_, i) => i + 1), async (pn) => {
  const r = await probe(`https://push2.eastmoney.com/api/qt/clist/get?pn=${pn}&pz=100&po=1&np=1&fltt=2&invt=2&fid=f12&fs=${FS}&fields=${FULL}`);
  const d = j(r.text);
  return { pn, status: r.status, ms: r.ms, kb: r.kb, n: (d?.data?.diff ?? []).length };
}, 6);
const clistMs = Math.round(performance.now() - t2);
out.clistSnapshot = {
  ms: clistMs, totalBytesKb: +fres.reduce((s, f) => s + f.kb, 0).toFixed(1),
  statuses: [...new Set(fres.map(f => f.status))], rows: fres.reduce((s, f) => s + f.n, 0),
  msStat: stat(fres.map(f => f.ms)),
};

saveJson('D:/h5/stock-workbench/research/scripts/out-07-fetchcost.json', out);
console.log(JSON.stringify(out, null, 2));
