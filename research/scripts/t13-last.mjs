import { probe, saveJson } from './lib.mjs';

const out = {};

// A) correct GBK decoding (raw bytes, not utf8 round-trip)
async function fetchRaw(url, headers) {
  const t0 = performance.now();
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', ...headers } });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, ms: Math.round(performance.now() - t0), bytes: buf.length, buf };
}
const s = await fetchRaw('https://hq.sinajs.cn/list=sh600000,sz300750', { Referer: 'https://finance.sina.com.cn' });
const sTxt = new TextDecoder('gbk').decode(s.buf);
out.sina = { status: s.status, ms: s.ms, bytes: s.bytes, text: sTxt, parts: (sTxt.split('\n')[0].split('"')[1] || '').split(',').map((p, i) => `${i}=${p}`) };

const t = await fetchRaw('https://qt.gtimg.cn/q=sh600000', { Referer: 'https://gu.qq.com/' });
const tTxt = new TextDecoder('gbk').decode(t.buf);
const tp = (tTxt.split('"')[1] || '').split('~');
out.tencent = { status: t.status, ms: t.ms, bytes: t.bytes, text: tTxt.slice(0, 300), n: tp.length, parts: tp.map((p, i) => `${i}=${p}`) };

// B) breadth attempts
for (const [k, u] of [
  ['ulist f104-106 index', 'https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f104,f105,f106,f12,f14&secids=1.000001,0.399001'],
  ['stock/get f104-106 sh', 'https://push2.eastmoney.com/api/qt/stock/get?secid=1.000001&fields=f104,f105,f106,f12,f14&fltt=2'],
  ['stock/get f104-106 sz', 'https://push2.eastmoney.com/api/qt/stock/get?secid=0.399001&fields=f104,f105,f106&fltt=2'],
]) {
  const r = await probe(u);
  out[k] = { status: r.status, body: r.text.slice(0, 260) };
}

// C) ZT/DT pool: total field + pagesize cap
for (const ps of [10, 200, 500]) {
  const r = await probe(`https://push2ex.eastmoney.com/getTopicZTPool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&Pageindex=0&pagesize=${ps}&sort=fbt%3Aasc&date=20261104`);
  const d = JSON.parse(r.text);
  out[`zt_ps${ps}`] = { status: r.status, ms: r.ms, kb: r.kb, tc: d?.data?.tc, n: d?.data?.pool?.length, qdate: d?.data?.qdate };
}
// wrong date behaviour
const bad = await probe('https://push2ex.eastmoney.com/getTopicZTPool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&Pageindex=0&pagesize=10&sort=fbt%3Aasc&date=20261101');
out.zt_baddate = { status: bad.status, body: bad.text.slice(0, 200) };

saveJson('D:/h5/stock-workbench/research/scripts/out-14-last.json', out);
console.log(JSON.stringify(out, null, 2));
