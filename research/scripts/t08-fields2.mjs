import { probe, j, saveJson } from './lib.mjs';

const out = {};
const EM = 'https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2';

// 1) f11/f22/f109/f24/f25/f15/f16/f17 disambiguation
const f = 'f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f14,f15,f16,f17,f18,f20,f21,f22,f23,f24,f25,f62,f109,f184';
const r = await probe(`${EM}&fields=${f}&secids=1.600000,0.000001,0.300750`);
out.multiField = j(r.text)?.data?.diff;

// 2) daily kline for 600000 last 10 days -> compute 5d change to compare f109
const kl = await probe(`https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=1.600000&klt=101&fqt=1&lmt=10&end=20500101&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61`);
const kd = j(kl.text);
out.kline600000 = { status: kl.status, ms: kl.ms, kb: kl.kb, name: kd?.data?.name, code: kd?.data?.code, preKPrice: kd?.data?.preKPrice, n: kd?.data?.klines?.length, klines: kd?.data?.klines };

// 3) suspended/no-quote detection: scan a few pages for f2 === '-'
const FS = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048';
let dash = [];
for (const pn of [1, 20, 40, 55]) {
  const rr = await probe(`https://push2.eastmoney.com/api/qt/clist/get?pn=${pn}&pz=100&po=1&np=1&fltt=2&invt=2&fid=f12&fs=${FS}&fields=f2,f3,f12,f14,f5,f6`);
  const rows = j(rr.text)?.data?.diff ?? [];
  rows.forEach(x => { if (typeof x.f2 !== 'number') dash.push(x); });
}
out.nonNumeric = { count: dash.length, samples: dash.slice(0, 5) };

// 4) raw (fltt absent) to see scaling conventions
const raw = await probe(`https://push2.eastmoney.com/api/qt/ulist.np/get?invt=2&fields=f2,f3,f4,f5,f6,f8,f9,f23&secids=1.600000`);
out.rawNoFltt = j(raw.text)?.data?.diff;

saveJson('D:/h5/stock-workbench/research/scripts/out-09-fields2.json', out);
console.log(JSON.stringify(out, null, 2));
