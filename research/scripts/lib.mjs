import fs from 'node:fs';

export const HDRS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  'Accept': '*/*',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Referer': 'https://quote.eastmoney.com/',
};

export async function probe(url, opts = {}) {
  const t0 = performance.now();
  let res, text, err = null;
  try {
    res = await fetch(url, { headers: { ...HDRS, ...(opts.headers || {}) }, signal: AbortSignal.timeout(opts.timeout ?? 20000) });
    const buf = await res.arrayBuffer();
    const dt = performance.now() - t0;
    const b = Buffer.from(buf);
    text = b.toString('utf8');
    return { url, status: res.status, ms: Math.round(dt), bytes: b.length, kb: +(b.length / 1024).toFixed(1), ctype: res.headers.get('content-type'), text, err: null };
  } catch (e) {
    return { url, status: 0, ms: Math.round(performance.now() - t0), bytes: 0, kb: 0, ctype: null, text: '', err: String(e && e.message || e) };
  }
}

export function j(text) {
  try { return JSON.parse(text); } catch { return null; }
}

export function brief(r, n = 900) {
  return { u: r.url, status: r.status, ms: r.ms, kb: r.kb, err: r.err, head: r.text.slice(0, n), tail: r.text.length > n ? r.text.slice(-200) : '' };
}

export function saveJson(p, obj) {
  fs.mkdirSync(p.replace(/[\\/][^\\/]+$/, ''), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8');
}

export function stat(arr) {
  const a = arr.filter(x => typeof x === 'number').sort((x, y) => x - y);
  if (!a.length) return null;
  const sum = a.reduce((s, x) => s + x, 0);
  return { n: a.length, min: a[0], max: a[a.length - 1], avg: +(sum / a.length).toFixed(1), p50: a[Math.floor(a.length / 2)] };
}
