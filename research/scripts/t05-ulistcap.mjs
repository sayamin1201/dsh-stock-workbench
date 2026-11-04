import { probe, j, saveJson } from './lib.mjs';

const out = [];
function gen(n, fieldsPerRow) {
  // real-ish secids: 1.600000.. increase, plus 0.000001..
  const a = [];
  for (let i = 0; i < n; i++) {
    const code = String(600000 + i);
    a.push(`1.${code}`);
  }
  return a.join(',');
}
const FULL = 'f12,f14,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f18,f20,f21,f22,f23,f62,f184';

for (const n of [1000, 1500, 2000, 3000]) {
  const r = await probe(`https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f12,f14,f2,f3&secids=${gen(n)}`);
  const d = j(r.text);
  out.push({ k: `ulist n=${n} few`, status: r.status, ms: r.ms, kb: r.kb, total: d?.data?.total, err: r.err, head: r.text.slice(0, 90) });
}
for (const n of [800, 1500]) {
  const r = await probe(`https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=${FULL}&secids=${gen(n)}`);
  const d = j(r.text);
  out.push({ k: `ulist n=${n} full19`, status: r.status, ms: r.ms, kb: r.kb, total: d?.data?.total, err: r.err, head: r.text.slice(0, 90) });
}

// does clist pn=61 return data null + what rc?
const r61 = await probe(`https://push2.eastmoney.com/api/qt/clist/get?pn=61&pz=100&po=1&np=1&fltt=2&invt=2&fid=f12&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048&fields=f12,f13,f14`);
out.push({ k: 'clist pn=61 raw', status: r61.status, body: r61.text.slice(0, 300) });

saveJson('D:/h5/stock-workbench/research/scripts/out-05-ulist-cap.json', out);
console.log(JSON.stringify(out, null, 2));
