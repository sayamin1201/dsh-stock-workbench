import { probe, j, saveJson } from './lib.mjs';

const BASE = 'https://push2.eastmoney.com/api/qt/clist/get';
const FS = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048';
const F = 'f12,f14,f2,f3';
const FULL = 'f12,f14,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f18,f20,f21,f22,f23,f62,f184';

const cases = [
  ['pz6000 np1 full', `${BASE}?pn=1&pz=6000&po=1&np=1&fltt=2&invt=2&fid=f3&fs=${FS}&fields=${FULL}`],
  ['pz6000 np0 full', `${BASE}?pn=1&pz=6000&po=1&np=0&fltt=2&invt=2&fid=f3&fs=${FS}&fields=${FULL}`],
  ['pz6000 fewfields', `${BASE}?pn=1&pz=6000&po=1&np=1&fltt=2&invt=2&fid=f3&fs=${FS}&fields=${F}`],
  ['pz500 ut', `${BASE}?pn=1&pz=500&po=1&np=1&ut=b2884a393a59ad64002292a3e90d46a5&fltt=2&invt=2&fid=f3&fs=${FS}&fields=${FULL}`],
  ['pz3000 ut np0', `${BASE}?pn=1&pz=3000&po=1&np=0&ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&invt=2&fid=f3&fs=${FS}&fields=${FULL}`],
  ['pz200 wbp2u', `${BASE}?pn=1&pz=200&po=1&np=1&fltt=2&invt=2&fid=f3&fs=${FS}&fields=${FULL}&wbp2u=|0|0|0|web`],
  ['push2delay pz6000', `https://push2delay.eastmoney.com/api/qt/clist/get?pn=1&pz=6000&po=1&np=1&fltt=2&invt=2&fid=f3&fs=${FS}&fields=${FULL}`],
];

const out = [];
for (const [name, u] of cases) {
  const r = await probe(u);
  const d = j(r.text);
  out.push({ name, status: r.status, ms: r.ms, kb: r.kb, total: d?.data?.total, returned: (d?.data?.diff ?? []).length, err: r.err, head: r.text.slice(0, 120) });
}
saveJson('D:/h5/stock-workbench/research/scripts/out-02-pz-matrix.json', out);
console.log(JSON.stringify(out, null, 2));
