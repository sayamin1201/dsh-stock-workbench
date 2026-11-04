import { probe, j, saveJson } from './lib.mjs';
import fs from 'node:fs';
import zlib from 'node:zlib';
import https from 'node:https';

const out = {};
const secids = JSON.parse(fs.readFileSync('D:/h5/stock-workbench/research/scripts/out-06-universe.json', 'utf8')).secids;

function wire(url) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = https.request({ host: u.host, path: u.pathname + u.search, headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://quote.eastmoney.com/', 'Accept-Encoding': 'gzip' } }, res => {
      let raw = 0, plain = 0;
      res.on('data', c => { raw += c.length; plain += res.headers['content-encoding'] === 'gzip' ? 0 : c.length; });
      res.on('end', () => resolve({ wire: raw }));
    });
    req.on('error', e => resolve({ err: e.message }));
    req.end();
  });
}

// A) lean vs full payload (800-code batch)
const LEAN = 'f12,f14,f2,f3,f4,f5,f6,f8,f9,f10,f20,f21,f23,f62,f184';
const FULL = 'f12,f14,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f18,f20,f21,f22,f23,f62,f184';
const batch800 = secids.slice(0, 800);
for (const [k, f] of [['lean', LEAN], ['full', FULL]]) {
  const r = await probe(`https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=${f}&secids=${batch800.join(',')}`);
  const w = await wire(`https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=${f}&secids=${batch800.join(',')}`);
  out[k] = { plainKb: r.kb, wireKb: +(w.wire / 1024).toFixed(1), ms: r.ms, rows: (j(r.text)?.data?.diff ?? []).length };
}

// B) BSE breadth via 0.899050
const bse = await probe('https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f12,f14,f104,f105,f106&secids=1.000001,0.399001,0.899050');
out.breadth3 = { status: bse.status, ms: bse.ms, kb: bse.kb, body: bse.text };

// C) sina / tencent batch caps
const samples = secids.slice(0, 900).map(s => { const [m, c] = s.split('.'); return (m === '1' ? 'sh' : (c.startsWith('8') || c.startsWith('4') || c.startsWith('92') ? 'bj' : 'sz')) + c; });
for (const n of [100, 400, 800]) {
  const list = samples.slice(0, n).join(',');
  const rs = await probe(`https://hq.sinajs.cn/list=${list}`, { headers: { Referer: 'https://finance.sina.com.cn' } });
  const txt = new TextDecoder('gbk').decode(Buffer.from(rs.text, 'utf8'));
  out[`sina${n}`] = { status: rs.status, ms: rs.ms, kb: rs.kb, lines: (rs.text.match(/var hq_str_/g) || []).length, urlLen: (`https://hq.sinajs.cn/list=${list}`).length };
  const rt = await probe(`https://qt.gtimg.cn/q=${list}`, { headers: { Referer: 'https://gu.qq.com/' } });
  out[`tencent${n}`] = { status: rt.status, ms: rt.ms, kb: rt.kb, lines: (rt.text.match(/v_/g) || []).length, urlLen: (`https://qt.gtimg.cn/q=${list}`).length, head: rt.text.slice(0, 80) };
}

saveJson('D:/h5/stock-workbench/research/scripts/out-15-batch.json', out);
console.log(JSON.stringify(out, null, 2));
