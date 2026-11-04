import { probe, j, saveJson, stat } from './lib.mjs';
import fs from 'node:fs';
import https from 'node:https';
import zlib from 'node:zlib';

const out = {};
const FS = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048';
const FULL = 'f12,f14,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f18,f20,f21,f22,f23,f62,f184';

// ---------- A) full snapshot once, cache in memory, count non-numeric ----------
const secids = JSON.parse(fs.readFileSync('D:/h5/stock-workbench/research/scripts/out-06-universe.json', 'utf8')).secids;
const batches = [];
for (let i = 0; i < secids.length; i += 800) batches.push(secids.slice(i, i + 800));
const t0 = performance.now();
const rs = await Promise.all(batches.map(b => probe(`https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=${FULL}&secids=${b.join(',')}`)));
const snapMs = Math.round(performance.now() - t0);
const rows = rs.flatMap(r => (j(r.text)?.data?.diff ?? []));
out.snapshot = { wallMs: snapMs, rows: rows.length, bytesKb: +rs.reduce((s, r) => s + r.kb, 0).toFixed(1) };

const bad = rows.filter(r => typeof r.f2 !== 'number');
out.nonNumeric = { count: bad.length, pct: +(bad.length / rows.length * 100).toFixed(1), samples: bad.slice(0, 6).map(r => `${r.f12} ${r.f14}`) };
const byMarketBad = bad.reduce((m, r) => { const k = String(r.f12).slice(0, 2); m[k] = (m[k] || 0) + 1; return m; }, {});
out.nonNumeric.byPrefix = byMarketBad;

// local up/down stats (excluding non-numeric)
const live = rows.filter(r => typeof r.f3 === 'number');
out.breadth = {
  live: live.length,
  up: live.filter(r => r.f3 > 0).length,
  down: live.filter(r => r.f3 < 0).length,
  flat: live.filter(r => r.f3 === 0).length,
  limitUp10: live.filter(r => r.f3 >= 9.8 && !/^(30|68|8|4|92)/.test(r.f12)).length,
  limitDown10: live.filter(r => r.f3 <= -9.8 && !/^(30|68|8|4|92)/.test(r.f12)).length,
  pctUp20: live.filter(r => r.f3 >= 19.5).length,
  limitUpAll: live.filter(r => r.f3 >= 9.8).length,
  limitDownAll: live.filter(r => r.f3 <= -9.8).length,
};

// ---------- B) secid mapping validation: same stocks via clist fs per board vs ulist secid ----------
const boards = [
  { name: '沪主板 m:1+t:2', fs: 'm:1+t:2', guess: r => `1.${r.f12}` },
  { name: '科创板 m:1+t:23', fs: 'm:1+t:23', guess: r => `1.${r.f12}` },
  { name: '深主板 m:0+t:6', fs: 'm:0+t:6', guess: r => `0.${r.f12}` },
  { name: '创业板 m:0+t:80', fs: 'm:0+t:80', guess: r => `0.${r.f12}` },
  { name: '北交所 m:0+t:81+s:2048', fs: 'm:0+t:81+s:2048', guess: r => `0.${r.f12}` },
];
out.secid = [];
for (const b of boards) {
  const rr = await probe(`https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=5&po=1&np=1&fltt=2&invt=2&fid=f12&fs=${b.fs}&fields=f2,f3,f12,f13,f14`);
  const sample = (j(rr.text)?.data?.diff ?? []).slice(0, 3);
  const map = sample.map(r => ({ code: r.f12, name: r.f14, f3_clist: r.f3, secid_guess: b.guess(r), f13: r.f13 }));
  const ids = map.map(m => m.secid_guess).join(',');
  const r2 = await probe(`https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f2,f3,f12,f13,f14&secids=${ids}`);
  const d2 = j(r2.text)?.data?.diff ?? [];
  map.forEach((m, i) => {
    const hit = d2.find(x => x.f12 === m.code);
    m.f3_ulist = hit?.f3 ?? null; m.name_ulist = hit?.f14 ?? null; m.f13_ulist = hit?.f13 ?? null;
    m.match = hit && Math.abs((hit.f3 ?? NaN) - m.f3_clist) < 0.02;
  });
  out.secid.push({ board: b.name, total: j(rr.text)?.data?.total, map });
}

// ---------- C) f24/f25 verification with kline ----------
const kl = await probe(`https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=1.600000&klt=101&fqt=1&lmt=250&end=20500101&fields1=f1,f2,f3&fields2=f51,f53`);
const klRows = (j(kl.text)?.data?.klines ?? []).map(s => s.split(','));
const last = klRows[klRows.length - 1];
const close = Number(last[1]);
const ago60 = klRows[klRows.length - 61];
const ytdBase = klRows.filter(r => r[0].startsWith('2025-12-31'));
out.f24f25 = {
  n: klRows.length, firstDate: klRows[0]?.[0], lastDate: last?.[0], close,
  close60ago: ago60?.[0] + ' ' + ago60?.[1],
  calc60: ago60 ? +(((close - Number(ago60[1])) / Number(ago60[1])) * 100).toFixed(2) : null,
  calcYtd: ytdBase[0] ? +(((close - Number(ytdBase[0][1])) / Number(ytdBase[0][1])) * 100).toFixed(2) : null,
  baseYtdDate: ytdBase[0]?.[0],
  fieldValues: rows.find(r => r.f12 === '600000') ? { f24: rows.find(r => r.f12 === '600000').f24, f25: rows.find(r => r.f12 === '600000').f25, f109: rows.find(r => r.f12 === '600000').f109 } : null,
};

// ---------- D) freshness: em vs sina vs tencent in same second ----------
const fresh = [];
for (let k = 0; k < 2; k++) {
  const [e, s, tt] = await Promise.all([
    probe(`https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f2,f3,f5,f6,f12&secids=1.600000,0.000001`),
    probe(`https://hq.sinajs.cn/list=sh600000,sz000001`, { headers: { Referer: 'https://finance.sina.com.cn' } }),
    probe(`https://qt.gtimg.cn/q=sh600000,sz000001`, { headers: { Referer: 'https://gu.qq.com/' } }),
  ]);
  const ed = j(e.text)?.data?.diff ?? [];
  const sinaGbk = new TextDecoder('gbk').decode(Buffer.from(s.text, 'binary'));
  const tenGbk = new TextDecoder('gbk').decode(Buffer.from(tt.text, 'binary'));
  fresh.push({
    i: k,
    em: ed.map(x => `${x.f12} p=${x.f2} vol=${x.f5} amt=${x.f6}`),
    sina: sinaGbk.split('\n').filter(Boolean).map(l => l.split('"')[1]),
    tencent: tenGbk.split('\n').filter(Boolean).map(l => l.split('"')[1]).map(v => v.split('~').filter((_, i) => [3, 6, 31, 37].includes(i)).join('|')),
  });
  await new Promise(r => setTimeout(r, 1500));
}
out.freshness = fresh;

// ---------- E) gzip wire size ----------
function wireSize(url) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = https.request({ host: u.host, path: u.pathname + u.search, headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://quote.eastmoney.com/', 'Accept-Encoding': 'gzip' } }, (res) => {
      let raw = 0; const chunks = [];
      res.on('data', c => { raw += c.length; chunks.push(c); });
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const plain = res.headers['content-encoding'] === 'gzip' ? zlib.gunzipSync(buf).length : buf.length;
        resolve({ encoding: res.headers['content-encoding'] || 'none', wireBytes: raw, plainBytes: plain, ratio: +(plain / raw).toFixed(2) });
      });
    });
    req.on('error', e => resolve({ error: e.message }));
    req.end();
  });
}
const u1 = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=${FULL}&secids=${batches[0].join(',')}`;
out.gzip = { ulist800: await wireSize(u1) };
out.gzip.clist100 = await wireSize(`https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=100&po=1&np=1&fltt=2&invt=2&fid=f12&fs=${FS}&fields=${FULL}`);

saveJson('D:/h5/stock-workbench/research/scripts/out-12-validate.json', out);
console.log(JSON.stringify(out, null, 2));
