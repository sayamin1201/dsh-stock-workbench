import { probe, j, saveJson } from './lib.mjs';

const FS = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048';
const out = [];

// 1) pz edge values with minimal fields
for (const pz of [100, 101, 150, 500, 1000, 6000]) {
  const u = `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=${pz}&po=1&np=1&fltt=2&invt=2&fid=f3&fs=${FS}&fields=f12,f13,f14`;
  const r = await probe(u);
  const d = j(r.text);
  out.push({ k: `pz=${pz}`, status: r.status, ms: r.ms, kb: r.kb, total: d?.data?.total, returned: (d?.data?.diff ?? []).length });
}

// 2) last page: pn=60,61 with pz=100
for (const pn of [59, 60, 61]) {
  const u = `https://push2.eastmoney.com/api/qt/clist/get?pn=${pn}&pz=100&po=1&np=1&fltt=2&invt=2&fid=f3&fs=${FS}&fields=f12,f13,f14`;
  const r = await probe(u);
  const d = j(r.text);
  out.push({ k: `pn=${pn} pz=100`, status: r.status, ms: r.ms, kb: r.kb, total: d?.data?.total, returned: (d?.data?.diff ?? []).length, dataNull: d?.data === null });
}

// 3) ulist big batches (valid secids: use real codes gathered from page1)
const page1 = await probe(`https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=100&po=1&np=1&fltt=2&invt=2&fid=f12&fs=${FS}&fields=f12,f13,f14`);
const rows = j(page1.text)?.data?.diff ?? [];
out.push({ k: 'page1 codes sample', n: rows.length, first5: rows.slice(0, 5) });

// build 300 fake-but-valid-ish secids by scanning many pages is expensive; instead use synthetic 6-digit codes across sh/sz
function gen(n) {
  const a = [];
  for (let i = 0; i < n; i++) {
    const code = String(600000 + i);
    a.push(`1.${code}`);
  }
  return a.join(',');
}
for (const n of [200, 400, 800]) {
  const r = await probe(`https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f12,f14,f2,f3&secids=${gen(n)}`);
  const d = j(r.text);
  out.push({ k: `ulist n=${n}`, status: r.status, ms: r.ms, kb: r.kb, returned: (d?.data?.diff ?? []).length, total: d?.data?.total, err: r.err, head: r.text.slice(0, 100) });
}

saveJson('D:/h5/stock-workbench/research/scripts/out-04-pz-edge.json', out);
console.log(JSON.stringify(out, null, 2));
