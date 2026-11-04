import { probe, j, saveJson } from './lib.mjs';
import fs from 'node:fs';

const out = {};
const secids = JSON.parse(fs.readFileSync('D:/h5/stock-workbench/research/scripts/out-06-universe.json', 'utf8')).secids;

// A) BSE old-code secids
const bse = secids.filter(s => s.startsWith('0.8')).slice(0, 6);
out.bseSecids = bse;
const rb = await probe(`https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f2,f3,f12,f13,f14,f62&secids=${bse.join(',')}`);
out.bseRows = j(rb.text)?.data?.diff;

// B) coverage stats from one full snapshot
const FULL = 'f12,f14,f2,f3,f9,f10,f62,f184,f20,f21';
const batches = [];
for (let i = 0; i < secids.length; i += 800) batches.push(secids.slice(i, i + 800));
const rs = await Promise.all(batches.map(b => probe(`https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=${FULL}&secids=${b.join(',')}`)));
const rows = rs.flatMap(r => (j(r.text)?.data?.diff ?? []));
const live = rows.filter(r => typeof r.f2 === 'number');
out.coverage = {
  total: rows.length, live: live.length,
  f62_zero: live.filter(r => r.f62 === 0).length,
  f62_zero_pct: +(live.filter(r => r.f62 === 0).length / live.length * 100).toFixed(1),
  f184_zero: live.filter(r => r.f184 === 0).length,
  f9_missing: live.filter(r => typeof r.f9 !== 'number').length,
  f9_negative: live.filter(r => typeof r.f9 === 'number' && r.f9 < 0).length,
  f10_missing: live.filter(r => typeof r.f10 !== 'number').length,
  f20_zero: live.filter(r => r.f20 === 0).length,
  bse_f62_zero: live.filter(r => /^(8|4|92)/.test(r.f12) && r.f62 === 0).length,
  bse_live: live.filter(r => /^(8|4|92)/.test(r.f12)).length,
  sample: live.filter(r => typeof r.f9 !== 'number').slice(0, 3),
};

saveJson('D:/h5/stock-workbench/research/scripts/out-16-coverage.json', out);
console.log(JSON.stringify(out, null, 2));
