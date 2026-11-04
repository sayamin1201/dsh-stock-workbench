import { probe, j, saveJson, stat } from './lib.mjs';

const FS = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048';
const FULL = 'f12,f14,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f18,f20,f21,f22,f23,f62,f184';
const out = {};

// --- A) 12 sequential full-field clist pages, back to back ---
const seq = [];
for (let i = 1; i <= 12; i++) {
  const r = await probe(`https://push2.eastmoney.com/api/qt/clist/get?pn=${i}&pz=100&po=1&np=1&fltt=2&invt=2&fid=f12&fs=${FS}&fields=${FULL}`);
  const d = j(r.text);
  seq.push({ i, status: r.status, ms: r.ms, kb: r.kb, ok: !!d?.data, n: (d?.data?.diff ?? []).length });
}
out.sequential12 = { statuses: [...new Set(seq.map(s => s.status))], msStat: stat(seq.map(s => s.ms)), rows: seq.map(s => s.n), detail: seq };

// --- B) 8 parallel ulist batches (full snapshot) x 3 rounds, no pause ---
const secids = JSON.parse((await import('node:fs')).readFileSync('D:/h5/stock-workbench/research/scripts/out-06-universe.json', 'utf8')).secids;
const batches = [];
for (let i = 0; i < secids.length; i += 800) batches.push(secids.slice(i, i + 800));
const rounds = [];
for (let round = 1; round <= 3; round++) {
  const t0 = performance.now();
  const rs = await Promise.all(batches.map(b => probe(`https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=${FULL}&secids=${b.join(',')}`)));
  const ms = Math.round(performance.now() - t0);
  const ds = rs.map(r => j(r.text));
  rounds.push({ round, wallMs: ms, kb: +rs.reduce((s, r) => s + r.kb, 0).toFixed(1), statuses: rs.map(r => r.status), rows: ds.reduce((s, d) => s + (d?.data?.diff ?? []).length, 0), maxMs: Math.max(...rs.map(r => r.ms)), minMs: Math.min(...rs.map(r => r.ms)) });
}
out.burst3x8 = rounds;

// --- C) sustained 6 rounds at 5s cadence (simulating 5s auto refresh) ---
const sus = [];
for (let k = 0; k < 6; k++) {
  const t0 = performance.now();
  const rs = await Promise.all(batches.map(b => probe(`https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=${FULL}&secids=${b.join(',')}`)));
  const ds = rs.map(r => j(r.text));
  sus.push({ k, wallMs: Math.round(performance.now() - t0), statuses: rs.map(r => r.status), rows: ds.reduce((s, d) => s + (d?.data?.diff ?? []).length, 0) });
  if (k < 5) await new Promise(r => setTimeout(r, 5000));
}
out.sustained5s = sus;

saveJson('D:/h5/stock-workbench/research/scripts/out-10-ratelimit.json', out);
console.log(JSON.stringify({ sequential12: { statuses: out.sequential12.statuses, msStat: out.sequential12.msStat }, burst3x8: rounds, sustained5s: sus }, null, 2));
