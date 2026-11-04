import { probe, j, saveJson } from './lib.mjs';

const FULL = 'f12,f14,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f18,f20,f21,f22,f23,f62,f184';
const out = {};

// header inspection (compression?) — use raw http.request-like via fetch and read headers
const u1 = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=${FULL}&secids=1.600000,0.000001,0.300750,0.920992,1.688981`;
const r1 = await fetch(u1, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://quote.eastmoney.com/' } });
const buf1 = Buffer.from(await r1.arrayBuffer());
out.headers = { status: r1.status, ce: r1.headers.get('content-encoding'), cl: r1.headers.get('content-length'), ct: r1.headers.get('content-type'), decompressedBytes: buf1.length, server: r1.headers.get('server') };
const d1 = JSON.parse(buf1.toString('utf8'));
out.ulistFull = d1;

// sina
const rs = await probe(`https://hq.sinajs.cn/list=sh600000,sz000001,sz300750,bj920992,sh688981`, {
  headers: { Referer: 'https://finance.sina.com.cn', 'User-Agent': 'Mozilla/5.0' },
});
out.sina = { status: rs.status, ms: rs.ms, kb: rs.kb, ctype: rs.ctype, raw: rs.text };
// decode gbk if needed
out.sinaGbk = (() => { try { const b = Buffer.from(rs.text, 'binary'); return new TextDecoder('gbk').decode(b); } catch (e) { return 'ERR ' + e.message; } })();

// tencent
const rt = await probe(`https://qt.gtimg.cn/q=sh600000,sz000001,sz300750,bj920992,sh688981`, {
  headers: { Referer: 'https://gu.qq.com/', 'User-Agent': 'Mozilla/5.0' },
});
out.tencent = { status: rt.status, ms: rt.ms, kb: rt.kb, ctype: rt.ctype, raw: rt.text };

saveJson('D:/h5/stock-workbench/research/scripts/out-08-fields.json', out);
console.log(JSON.stringify({ headers: out.headers, ulistFull: out.ulistFull, sina: { status: out.sina.status, ms: out.sina.ms, raw: out.sina.raw.slice(0, 600) }, tencent: { status: out.tencent.status, ms: out.tencent.ms, raw: out.tencent.raw.slice(0, 800) } }, null, 2));
