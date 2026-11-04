import { probe, j, saveJson, stat } from './lib.mjs';

const BASE = 'https://push2.eastmoney.com/api/qt/clist/get';
const FS = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048';
const FIELDS = 'f12,f14,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f18,f20,f21,f22,f23,f62,f184';

function url({ pn = 1, pz = 6000, fid = 'f3', po = 1, fs = FS, fields = FIELDS, extra = '' } = {}) {
  return `${BASE}?pn=${pn}&pz=${pz}&po=${po}&np=1&fltt=2&invt=2&fid=${fid}&fs=${fs}&fields=${fields}${extra}`;
}

const out = { generatedAt: new Date().toISOString(), tests: [] };

// T1: pz=6000 single request
const t1 = await probe(url());
const d1 = j(t1.text);
const rows1 = d1?.data?.diff ?? [];
out.tests.push({
  name: 'T1 pz=6000 single',
  url: t1.url, status: t1.status, ms: t1.ms, kb: t1.kb,
  total: d1?.data?.total, returned: rows1.length,
  sampleHead: t1.text.slice(0, 700),
  firstRow: rows1[0], lastRow: rows1[rows1.length - 1],
});

// T2: pz=10000
const t2 = await probe(url({ pz: 10000 }));
const d2 = j(t2.text);
out.tests.push({ name: 'T2 pz=10000', status: t2.status, ms: t2.ms, kb: t2.kb, total: d2?.data?.total, returned: (d2?.data?.diff ?? []).length });

// T3: pz=200
const t3 = await probe(url({ pz: 200 }));
const d3 = j(t3.text);
out.tests.push({ name: 'T3 pz=200', status: t3.status, ms: t3.ms, kb: t3.kb, total: d3?.data?.total, returned: (d3?.data?.diff ?? []).length });

// T4: pz=6000 page 2 (what happens past end)
const t4 = await probe(url({ pz: 6000, pn: 2 }));
const d4 = j(t4.text);
out.tests.push({ name: 'T4 pz=6000 pn=2', status: t4.status, ms: t4.ms, kb: t4.kb, data: d4?.data === null ? null : { total: d4?.data?.total, returned: (d4?.data?.diff ?? []).length } });

saveJson('D:/h5/stock-workbench/research/scripts/out-01-snapshot.json', out);
console.log(JSON.stringify(out.tests.map(t => ({ name: t.name, status: t.status, ms: t.ms, kb: t.kb, total: t.total, returned: t.returned ?? t.data?.returned, err: t.err })), null, 2));
