const u="https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f2,f3,f12,f14&secids=1.600000";
for (const [k,h] of [["no-referer",{"User-Agent":"Mozilla/5.0"}],["no-headers-at-all",{}],["ua-only-node",{"User-Agent":"node"}]]) {
  try {
    const r = await fetch(u,{headers:h});
    const t = await r.text();
    console.log(k, r.status, t.slice(0,120));
  } catch(e) { console.log(k,"ERR",e.message); }
}
