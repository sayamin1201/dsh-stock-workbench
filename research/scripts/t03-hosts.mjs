import { probe, j, saveJson } from './lib.mjs';

const FS = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048';
const Q = `pn=1&pz=6000&po=1&np=1&fltt=2&invt=2&fid=f3&fs=${FS}&fields=f12,f14,f2,f3`;
const hosts = [
  'https://push2.eastmoney.com',
  'https://1.push2.eastmoney.com',
  'https://7.push2.eastmoney.com',
  'https://82.push2.eastmoney.com',
  'https://push2delay.eastmoney.com',
  'http://push2.eastmoney.com',
];
const out = [];
for (const h of hosts) {
  const r = await probe(`${h}/api/qt/clist/get?${Q}`);
  const d = j(r.text);
  out.push({ host: h, status: r.status, ms: r.ms, kb: r.kb, total: d?.data?.total, returned: (d?.data?.diff ?? []).length, err: r.err });
}

// ulist batching: how many secids per request?
const secids20 = Array.from({ length: 20 }, (_, i) => `1.60${String(1 + i).padStart(4, '0')}`).join(',');
const u20 = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f12,f14,f2,f3&secids=${secids20}`;
const r20 = await probe(u20);
const d20 = j(r20.text);
out.push({ name: 'ulist 20 secids', status: r20.status, ms: r20.ms, kb: r20.kb, returned: (d20?.data?.diff ?? []).length, total: d20?.data?.total });

const secids100 = Array.from({ length: 100 }, (_, i) => `1.60${String(1 + i).padStart(4, '0')}`).join(',');
const r100 = await probe(`https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f12,f14,f2,f3&secids=${secids100}`);
const d100 = j(r100.text);
out.push({ name: 'ulist 100 secids', status: r100.status, ms: r100.ms, kb: r100.kb, returned: (d100?.data?.diff ?? []).length, err: r100.err, head: r100.text.slice(0, 200) });

saveJson('D:/h5/stock-workbench/research/scripts/out-03-hosts-ulist.json', out);
console.log(JSON.stringify(out, null, 2));
