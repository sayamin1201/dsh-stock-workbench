import { probe, j, saveJson } from './lib.mjs';
import fs from 'node:fs';

const out = {};
const EM = 'https://push2.eastmoney.com/api/qt';

// A) rich single row: 25 fields for 4 representative stocks
const RICH = 'f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13,f14,f15,f16,f17,f18,f20,f21,f22,f23,f24,f25,f62,f100,f109,f184';
const rr = await probe(`${EM}/ulist.np/get?fltt=2&invt=2&fields=${RICH}&secids=1.600000,0.000001,0.300750,0.920992,1.688981`);
out.rich = { status: rr.status, ms: rr.ms, kb: rr.kb, diff: j(rr.text)?.data?.diff };

// B) tencent full field dump (gbk)
const tt = await probe('https://qt.gtimg.cn/q=sh600000,sz300750', { headers: { Referer: 'https://gu.qq.com/' } });
const dec = new TextDecoder('gbk').decode(Buffer.from(tt.text, 'binary'));
out.tencent = { status: tt.status, ms: tt.ms, kb: tt.kb, raw: dec, fields: dec.split('\n').filter(l => l.includes('=')).map(l => {
  const v = l.split('"')[1] || '';
  const parts = v.split('~');
  return { n: parts.length, indexed: parts.map((p, i) => `${i}=${p}`).slice(0, 50) };
}) };

// C) sina full field dump
const ss = await probe('https://hq.sinajs.cn/list=sh600000', { headers: { Referer: 'https://finance.sina.com.cn' } });
const decc = new TextDecoder('gbk').decode(Buffer.from(ss.text, 'binary'));
out.sina = { status: ss.status, ms: ss.ms, raw: decc, parts: (decc.split('"')[1] || '').split(',').map((p, i) => `${i}=${p}`) };

// D) trends2 ndays variants
out.trends2ndays = {};
for (const nd of [1, 2, 5]) {
  const r = await probe(`https://push2his.eastmoney.com/api/qt/stock/trends2/get?secid=1.600000&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13&fields2=f51,f52,f53,f54,f55,f56,f57,f58&iscr=0&ndays=${nd}`);
  const d = j(r.text);
  out.trends2ndays[`nd${nd}`] = { status: r.status, ms: r.ms, kb: r.kb, n: d?.data?.trends?.length, trendsTotal: d?.data?.trendsTotal, first: d?.data?.trends?.[0], last: d?.data?.trends?.slice(-1)[0] };
}

// E) kline lmt ceiling + fqt variants
out.kline = {};
for (const [klt, lmt, fqt] of [[101, 10000, 1], [101, 120, 0], [101, 120, 2], [5, 10000, 1]]) {
  const r = await probe(`https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=1.600000&klt=${klt}&fqt=${fqt}&lmt=${lmt}&end=20500101&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61`);
  const d = j(r.text);
  const kl = d?.data?.klines ?? [];
  out.kline[`klt${klt}_lmt${lmt}_fqt${fqt}`] = { status: r.status, ms: r.ms, kb: r.kb, n: kl.length, first: kl[0], last: kl.slice(-1)[0] };
}

// F) 1-2s cadence stress: 8 rounds x 8 parallel at 1s
const secids = JSON.parse(fs.readFileSync('D:/h5/stock-workbench/research/scripts/out-06-universe.json', 'utf8')).secids;
const batches = [];
for (let i = 0; i < secids.length; i += 800) batches.push(secids.slice(i, i + 800));
const FULL = 'f12,f14,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f18,f20,f21,f22,f23,f62,f184';
const stress = [];
for (let k = 0; k < 8; k++) {
  const t0 = performance.now();
  const rs = await Promise.all(batches.map(b => probe(`https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=${FULL}&secids=${b.join(',')}`)));
  stress.push({ k, wallMs: Math.round(performance.now() - t0), codes: [...new Set(rs.map(r => r.status))].join('/'), rows: rs.reduce((s, r) => s + ((j(r.text)?.data?.diff ?? []).length), 0) });
  if (k < 7) await new Promise(r => setTimeout(r, 1000));
}
out.stress1s = stress;

saveJson('D:/h5/stock-workbench/research/scripts/out-13-final.json', out);
console.log(JSON.stringify({ rich: out.rich.diff, tencentN: out.tencent.fields?.map(f => f.n), tencentIdx: out.tencent.fields?.[0]?.indexed, sina: out.sina.parts, trends2ndays: out.trends2ndays, kline: out.kline, stress1s: stress }, null, 2));
