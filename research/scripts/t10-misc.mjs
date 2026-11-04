import { probe, j, saveJson } from './lib.mjs';

const out = {};
const EM = 'https://push2.eastmoney.com/api/qt';

// --- 1) indices via ulist secid ---
const idx = '1.000001,0.399001,0.399006,1.000688,0.899050';
const ri = await probe(`${EM}/ulist.np/get?fltt=2&invt=2&fields=f1,f2,f3,f4,f5,f6,f12,f13,f14,f15,f16,f17,f18&secids=${idx}`);
out.indexUlist = { status: ri.status, ms: ri.ms, kb: ri.kb, data: j(ri.text)?.data };

// --- 2) index via clist fs=b:MK0010 (板块/指数列表) ---
for (const fs of ['b:MK0010', 'b:MK0011', 'm:1+s:2,m:0+t:5']) {
  const r = await probe(`${EM}/clist/get?pn=1&pz=100&po=1&np=1&fltt=2&invt=2&fid=f3&fs=${fs}&fields=f2,f3,f12,f13,f14`);
  const d = j(r.text);
  out[`clist_${fs}`] = { status: r.status, ms: r.ms, total: d?.data?.total, names: (d?.data?.diff ?? []).slice(0, 8).map(x => `${x.f13}.${x.f12} ${x.f14} ${x.f2} ${x.f3}%`) };
}

// --- 3) up/down counts: f104/f105/f106 on index secid ---
const rc = await probe(`${EM}/stock/get?secid=1.000001&fields=f43,f57,f58,f104,f105,f106,f107,f169,f170`);
out.indexCounts = { status: rc.status, ms: rc.ms, data: j(rc.text)?.data, raw: rc.text.slice(0, 400) };

// --- 4) trends2 (intraday) ---
const rt = await probe(`https://push2his.eastmoney.com/api/qt/stock/trends2/get?secid=1.600000&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13&fields2=f51,f52,f53,f54,f55,f56,f57,f58&iscr=0&ndays=1`);
const td = j(rt.text);
out.trends2 = {
  status: rt.status, ms: rt.ms, kb: rt.kb, code: td?.data?.code, name: td?.data?.name, preClose: td?.data?.preClose,
  n: td?.data?.trends?.length, first3: td?.data?.trends?.slice(0, 3), last2: td?.data?.trends?.slice(-2),
  head: rt.text.slice(0, 420),
};

// --- 5) minute kline klt=5 / 15 / 30 / 1 ---
out.minKline = {};
for (const klt of [1, 5, 15, 30, 60]) {
  const r = await probe(`https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=1.600000&klt=${klt}&fqt=1&lmt=6&end=20500101&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61`);
  const d = j(r.text);
  out.minKline[`klt${klt}`] = { status: r.status, ms: r.ms, kb: r.kb, n: d?.data?.klines?.length, klines: d?.data?.klines?.slice(-3) };
}

// --- 6) single stock detail get ---
const det = await probe(`${EM}/stock/get?secid=1.600000&fields=f43,f44,f45,f46,f47,f48,f49,f50,f51,f52,f57,f58,f59,f60,f62,f71,f84,f85,f86,f92,f107,f116,f117,f162,f167,f168,f169,f170,f171,f177`);
out.stockGet = { status: det.status, ms: det.ms, kb: det.kb, data: j(det.text)?.data, head: det.text.slice(0, 300) };

// --- 7) limit-up pool (涨停板) ---
const zt = await probe('https://push2ex.eastmoney.com/getTopicZTPool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&Pageindex=0&pagesize=10&sort=fbt%3Aasc&date=20261104', { headers: { Referer: 'https://quote.eastmoney.com/' } });
out.ztPool = { status: zt.status, ms: zt.ms, kb: zt.kb, head: zt.text.slice(0, 500) };
const dt = await probe('https://push2ex.eastmoney.com/getTopicDTPool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&Pageindex=0&pagesize=10&sort=fund%3Aasc&date=20261104');
out.dtPool = { status: dt.status, ms: dt.ms, kb: dt.kb, head: dt.text.slice(0, 400) };

saveJson('D:/h5/stock-workbench/research/scripts/out-11-misc.json', out);
console.log(JSON.stringify(out, null, 2));
