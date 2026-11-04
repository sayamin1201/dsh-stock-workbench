for (const [k,u,h] of [
 ["sina-no-referer","https://hq.sinajs.cn/list=sh600000",{"User-Agent":"Mozilla/5.0"}],
 ["sina-with-referer","https://hq.sinajs.cn/list=sh600000",{"User-Agent":"Mozilla/5.0","Referer":"https://finance.sina.com.cn"}],
 ["tencent-no-referer","https://qt.gtimg.cn/q=sh600000",{"User-Agent":"Mozilla/5.0"}],
]) {
  try { const r = await fetch(u,{headers:h}); const b=Buffer.from(await r.arrayBuffer());
    console.log(k, r.status, b.length, JSON.stringify(new TextDecoder("gbk").decode(b).slice(0,60))); }
  catch(e){ console.log(k,"ERR",e.message); }
}
