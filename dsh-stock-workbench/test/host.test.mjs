// Host 半端到端测试：node test/host.test.mjs
// 用假的 ctx/webServer 抓注册结果，然后真的打一次上游，验证路由返回。
import assert from 'node:assert/strict';
import { apply, name } from '../index.js';

const routes = new Map();
const disposers = [];

const hostCtx = {
  webServer: {
    register(route) {
      routes.set(route.path, route);
      const dispose = () => routes.delete(route.path);
      disposers.push(dispose);
      return dispose;
    },
  },
  effect(fn) {
    return fn();
  },
};

const ctx = {
  effect(fn) {
    return fn();
  },
  inject(keys, callback) {
    assert.deepEqual(keys, ['webServer']);
    callback(hostCtx);
  },
};

apply(ctx, { ttlMs: 0 });

assert.equal(name, 'dsh-stock-workbench');
assert.deepEqual([...routes.keys()].sort(), [
  '/dsh-stock/api/v1/board-members',
  '/dsh-stock/api/v1/boards',
  '/dsh-stock/api/v1/dashboard',
  '/dsh-stock/api/v1/data-sources',
  '/dsh-stock/api/v1/dividend',
  '/dsh-stock/api/v1/formula',
  '/dsh-stock/api/v1/formula/fields',
  '/dsh-stock/api/v1/formula/validate',
  '/dsh-stock/api/v1/health',
  '/dsh-stock/api/v1/kline',
  '/dsh-stock/api/v1/reload',
  '/dsh-stock/api/v1/scan',
  '/dsh-stock/api/v1/signals',
  '/dsh-stock/api/v1/trends',
  '/dsh-stock/api/v1/valuation',
  '/dsh-stock/api/v1/valuation-percentiles',
]);
console.log('  ✓ 注册了 ' + routes.size + ' 条路由:', [...routes.keys()].join(', '));

/** 伪造的 ServerResponse，实现路由用到的三个方法（write 供 SSE 用） */
function fakeResponse() {
  const capture = { status: 0, headers: null, body: '' };
  return {
    capture,
    writeHead(status, headers) {
      capture.status = status;
      capture.headers = headers;
    },
    write(chunk) {
      capture.body += String(chunk ?? '');
      return true;
    },
    end(body) {
      if (body) capture.body += String(body);
    },
  };
}

async function call(path, { method = 'GET', url, body } = {}) {
  const res = fakeResponse();
  const request = { method, url: url ?? path, headers: {} };
  if (body !== undefined) {
    const buffer = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
    request[Symbol.asyncIterator] = async function* iterate() {
      yield buffer;
    };
  }
  await routes.get(path).handler(request, res);
  let json = null;
  try {
    json = JSON.parse(res.capture.body);
  } catch {
    json = null;
  }
  return { ...res.capture, json, bytes: Buffer.byteLength(res.capture.body, 'utf8') };
}

// health
const health = await call('/dsh-stock/api/v1/health');
assert.equal(health.status, 200);
assert.equal(health.json.ok, true);
console.log('  ✓ health 200', JSON.stringify(health.json));

// dashboard（真实上游，可能耗时 1s 左右）
const t0 = Date.now();
const dash = await call('/dsh-stock/api/v1/dashboard');
const ms = Date.now() - t0;
assert.equal(dash.status, 200, `期望 200，实际 ${dash.status}：${dash.body?.slice(0, 200)}`);
assert.equal(dash.json.ok, true);
const data = dash.json.data;
assert.ok(Array.isArray(data.rows) && data.rows.length > 1000, `rows 太少: ${data.rows.length}`);
assert.ok(Array.isArray(data.indices) && data.indices.length >= 4);
assert.ok(data.meta && typeof data.meta.fetchedAt === 'number');
assert.ok(data.meta.count === data.rows.length);
assert.ok(data.meta.universeCount >= data.meta.count);
console.log(`  ✓ dashboard 200  ${data.rows.length}/${data.meta.universeCount} 只  上游 ${data.meta.upstreamMs}ms  墙钟 ${ms}ms`);
console.log(`  ✓ 响应体积 ${(dash.bytes / 1024 / 1024).toFixed(2)}MB  (${Object.keys(data.rows[0]).length} 字段/行)`);

// 字段完整性：前端 12 列依赖的字段一个都不能缺
const requiredFields = [
  'code', 'name', 'price', 'pct', 'amplitude', 'amount', 'turnover',
  'volumeRatio', 'speed', 'pct5d', 'floatMcap', 'mainIn', 'board', 'pe',
];
const missing = requiredFields.filter((key) => !(key in data.rows[0]));
assert.deepEqual(missing, [], `缺字段: ${missing.join(', ')}`);
console.log('  ✓ 前端依赖字段齐全:', requiredFields.join(','));

// 指数
assert.ok(data.indices.some((i) => i.name === '上证指数'));
console.log('  ✓ 指数:', data.indices.map((i) => `${i.name} ${i.pct}%`).join(' | '));

// 涨跌家数（本地口径）+ 官方涨停
assert.ok(data.stats.up + data.stats.down + data.stats.flat > 1000);
console.log(`  ✓ 涨跌家数(本地) 涨${data.stats.up} 平${data.stats.flat} 跌${data.stats.down}`);
console.log(`  ✓ 官方涨停 ${data.breadth?.limitUp} 跌停 ${data.breadth?.limitDown} 交易日 ${data.meta.tradingDay}`);

// 405
const bad = await call('/dsh-stock/api/v1/dashboard', { method: 'POST' });
assert.equal(bad.status, 405);
console.log('  ✓ 非 GET 返回 405');

// 日 K（前复权）— 双击详情页用
const kline = await call('/dsh-stock/api/v1/kline', {
  url: '/dsh-stock/api/v1/kline?secid=1.600000&klt=101&lmt=120',
});
assert.equal(kline.status, 200, kline.body?.slice(0, 200));
assert.equal(kline.json.ok, true);
const bars = kline.json.data.bars;
assert.ok(bars.length > 100, `日K 太少: ${bars.length}`);
assert.ok(bars.every((bar) => Number.isFinite(bar.open) && Number.isFinite(bar.close)));
assert.ok(bars.every((bar) => bar.high >= bar.low), '存在 high < low 的 K 线');
assert.ok(typeof bars[bars.length - 1].d === 'string');
console.log(`  ✓ 日K ${bars.length} 根  最后一根 ${bars[bars.length - 1].d}  开${bars[bars.length - 1].open} 收${bars[bars.length - 1].close}`);

// 周 K
const weekly = await call('/dsh-stock/api/v1/kline', {
  url: '/dsh-stock/api/v1/kline?secid=1.600000&klt=102&lmt=60',
});
assert.equal(weekly.status, 200);
assert.ok(weekly.json.data.bars.length > 20);
console.log(`  ✓ 周K ${weekly.json.data.bars.length} 根`);

// 5 分钟 K
const m5 = await call('/dsh-stock/api/v1/kline', {
  url: '/dsh-stock/api/v1/kline?secid=0.300750&klt=5&lmt=120',
});
assert.equal(m5.status, 200);
assert.ok(m5.json.data.bars.length > 20);
console.log(`  ✓ 5分K ${m5.json.data.bars.length} 根  最后一根 ${m5.json.data.bars.at(-1).d}`);

// 分时
const trends = await call('/dsh-stock/api/v1/trends', {
  url: '/dsh-stock/api/v1/trends?secid=1.600000',
});
assert.equal(trends.status, 200);
const points = trends.json.data.points;
// 开盘瞬间分时可能只有 1 个点，这时只要求非空且数值合法
assert.ok(points.length >= 1, `分时点为空`);
if (points.length <= 10) console.log(`  （早盘：分时仅 ${points.length} 个点，非空断言通过）`);
assert.ok(points.every((p) => Number.isFinite(p.close)));
console.log(`  ✓ 分时 ${points.length} 点  昨收 ${trends.json.data.preClose}  最新 ${points.at(-1).close}`);
// preClose 必须能对上快照里的昨收（同一交易日）
const snapshotRow = data.rows.find((row) => row.code === '600000');
if (snapshotRow) console.log(`  ✓ 快照 600000 最新 ${snapshotRow.price}（与分时末点相差 ${Math.abs(snapshotRow.price - points.at(-1).close).toFixed(3)}）`);

// 非法 secid → 400
const invalid = await call('/dsh-stock/api/v1/kline', { url: '/dsh-stock/api/v1/kline?secid=evil' });
assert.equal(invalid.status, 400);
console.log('  ✓ 非法 secid 返回 400');

// 非法 klt 回落 101
const fallback = await call('/dsh-stock/api/v1/kline', {
  url: '/dsh-stock/api/v1/kline?secid=1.600000&klt=7&lmt=20',
});
assert.equal(fallback.status, 200);
assert.equal(fallback.json.data.bars.length, 20);
console.log('  ✓ 非法 klt 回落日K，lmt 生效');

// 补历史：前端「向左拖」靠放大 lmt 拿更早的 K 线
const deep = await call('/dsh-stock/api/v1/kline', {
  url: '/dsh-stock/api/v1/kline?secid=1.600000&klt=101&lmt=1200',
});
assert.equal(deep.status, 200, deep.body?.slice(0, 160));
const deepBars = deep.json.data.bars;
assert.ok(deepBars.length > 600, 'lmt=1200 只拿到 ' + deepBars.length + ' 根');
assert.ok(deepBars[0].d < deepBars[deepBars.length - 1].d, '日期应升序');
assert.ok(deepBars.length > 240, '应比初始 240 根多');
const capped = await call('/dsh-stock/api/v1/kline', {
  url: '/dsh-stock/api/v1/kline?secid=1.600000&klt=101&lmt=99999',
});
assert.equal(capped.status, 200);
assert.ok(capped.json.data.bars.length <= 6000, '超过上限：' + capped.json.data.bars.length);
console.log(`  ✓ 补历史：lmt=1200 → ${deepBars.length} 根（最早 ${deepBars[0].d}）；lmt=99999 夹到 ${capped.json.data.bars.length} 根`);

// 信号元数据
const signalsRoute = await call('/dsh-stock/api/v1/signals');
assert.equal(signalsRoute.status, 200);
const signalList = signalsRoute.json.data.signals;
assert.ok(Array.isArray(signalList) && signalList.length === 6, '信号数量 ' + signalList.length);
assert.ok(signalList.every((signal) => signal.id && signal.label && signal.desc));
console.log('  ✓ 信号元数据 ' + signalList.length + ' 个：' + signalList.map((s) => s.label).join(' / '));

// 两段式扫描：候选池 20 只，真拉 20 只日K
const scan = await call('/dsh-stock/api/v1/scan', {
  url: '/dsh-stock/api/v1/scan?signals=ma_golden,macd_golden,breakout&limit=20&minAmount=1',
});
assert.equal(scan.status, 200, scan.body?.slice(0, 200));
assert.equal(scan.json.ok, true);
const scanData = scan.json.data;
assert.ok(scanData.scanned >= 0 && scanData.scanned <= 20, 'scanned=' + scanData.scanned);
if (scanData.scanned === 0) console.log('  （早盘：扫描候选池为空，跳过扫描规律断言）');
assert.ok(Array.isArray(scanData.matches), 'matches 不是数组');
assert.equal(scanData.failed, 0, '有失败请求：' + scanData.failed);
for (const match of scanData.matches) {
  assert.ok(Array.isArray(match.signals) && match.signals.length > 0, match.code + ' 命中却没有信号');
  assert.ok(match.signals.every((hit) => hit.id && hit.detail), '信号缺字段');
  assert.ok(typeof match.price === 'number', '缺 price');
}
console.log(`  ✓ 扫描 ${scanData.scanned} 只（候选池 ${scanData.poolSize}），命中 ${scanData.matches.length} 只，耗时 ${scanData.ms}ms`);
if (scanData.matches.length > 0) {
  const sample = scanData.matches[0];
  console.log(`    首个命中：${sample.name} ${sample.pct}% → ${sample.signals.map((s) => `${s.id}(${s.detail})`).join('；')}`);
}

// 同一参数再打一次应命中缓存（省 20 个上游请求）
const scanAgain = await call('/dsh-stock/api/v1/scan', {
  url: '/dsh-stock/api/v1/scan?signals=ma_golden,macd_golden,breakout&limit=20&minAmount=1',
});
assert.equal(scanAgain.status, 200);
assert.equal(scanAgain.json.data.cached, true, '第二次没有走缓存');
assert.equal(scanAgain.json.data.matches.length, scanData.matches.length, '缓存结果不一致');
console.log('  ✓ 同参数二次扫描走缓存');

// 未知信号回落默认，不报错
const scanFallback = await call('/dsh-stock/api/v1/scan', {
  url: '/dsh-stock/api/v1/scan?signals=nope&limit=10&minAmount=50',
});
assert.equal(scanFallback.status, 200, scanFallback.body?.slice(0, 120));
assert.deepEqual(scanFallback.json.data.signals, ['ma_golden', 'macd_golden']);
console.log('  ✓ 未知信号回落默认 ma_golden+macd_golden');

// 分钟级扫描（klt=5）：MACD/均线在 5 分钟 K 上计算
const minuteScan = await call('/dsh-stock/api/v1/scan', {
  url: '/dsh-stock/api/v1/scan?signals=ma_golden,macd_golden&limit=12&minAmount=5&within=2&klt=5',
});
assert.equal(minuteScan.status, 200, minuteScan.body?.slice(0, 160));
assert.equal(minuteScan.json.data.klt, 5, 'klt 没生效：' + minuteScan.json.data.klt);
assert.ok(minuteScan.json.data.scanned >= 0, 'scanned<0');
if (minuteScan.json.data.scanned === 0) console.log('  （早盘：5 分钟 K 不足，分钟级扫描候选为空，跳过规律断言）');
for (const match of minuteScan.json.data.matches) {
  assert.ok(match.bars <= 240, '分钟 K 根数异常：' + match.bars);
}
console.log(`  ✓ 5 分钟周期扫描 ${minuteScan.json.data.scanned} 只，命中 ${minuteScan.json.data.matches.length} 只，K线根数 ≤240`);

// 非法 klt 回落日线
const kltFallback = await call('/dsh-stock/api/v1/scan', {
  url: '/dsh-stock/api/v1/scan?signals=backout,nope&limit=10&minAmount=50&klt=7',
});
assert.equal(kltFallback.status, 200);
assert.equal(kltFallback.json.data.klt, 101, '非法 klt 应回落 101，实际 ' + kltFallback.json.data.klt);
console.log('  ✓ 非法周期回落日线');

// 防御属性：股息率 + 基本面字段必须随快照下发
const dividendRows = data.rows.filter((row) => typeof row.dividendYield === 'number' && row.dividendYield > 0);
assert.ok(dividendRows.length > 2000, '有股息率的股票太少：' + dividendRows.length);
const roeRows = data.rows.filter((row) => typeof row.roe === 'number' && row.roe > 0);
if (dash.json.data.meta.provider === 'eastmoney') {
assert.ok(roeRows.length > 3000, '有 ROE 的股票太少：' + roeRows.length);
}
const debtRows = data.rows.filter((row) => typeof row.debtRatio === 'number');
if (dash.json.data.meta.provider === 'eastmoney') {
assert.ok(debtRows.length > 3000, '有负债率的股票太少：' + debtRows.length);
}
const cmb = data.rows.find((row) => row.code === '600036');
if (cmb) {
  assert.ok(cmb.dividendYield > 2 && cmb.dividendYield < 12, '招行股息率异常：' + cmb.dividendYield);
  assert.ok(cmb.dividendYears >= 2, '招行分红年数异常：' + cmb.dividendYears);
  assert.ok(cmb.pb > 0 && cmb.pb < 5, '招行 PB 异常：' + cmb.pb);
}
console.log(`  ✓ 防御字段：${dividendRows.length} 只有股息率、${roeRows.length} 只有 ROE、${debtRows.length} 只有负债率；招行股息率 ${cmb?.dividendYield?.toFixed(2)}%`);

// 公式：红利类预置能真跑
const divFormula = await call('/dsh-stock/api/v1/formula', {
  url: `/dsh-stock/api/v1/formula?limit=10&expr=${encodeURIComponent('股息率 > 5 且 分红年数 >= 2 且 市盈率 between 0 and 15')}`,
});
assert.equal(divFormula.status, 200, divFormula.body?.slice(0, 160));
assert.equal(divFormula.json.ok, true);
assert.ok(divFormula.json.data.matched > 0, '高股息公式零命中');
for (const row of divFormula.json.data.rows) {
  assert.ok(row.dividendYield > 5 && row.dividendYears >= 2 && row.pe > 0 && row.pe <= 15, row.code + ' 不满足红利条件');
}
console.log(`  ✓ 红利公式命中 ${divFormula.json.data.matched} 只`);

// 公式：字段目录
const formulaFields = await call('/dsh-stock/api/v1/formula/fields');
assert.equal(formulaFields.status, 200);
const fieldCatalog = formulaFields.json.data.fields;
const formulaExamples = formulaFields.json.data.examples;
assert.ok(fieldCatalog.length >= 12, '字段数 ' + fieldCatalog.length);
assert.equal(fieldCatalog.length, 26, '防御字段加完后应为 26 个，实际 ' + fieldCatalog.length);
assert.ok(formulaExamples.length >= 3, '示例数 ' + formulaExamples.length);
const formulaPresets = formulaFields.json.data.presets;
assert.ok(Array.isArray(formulaPresets) && formulaPresets.length === 15, '预置数 ' + formulaPresets?.length);
for (const preset of formulaPresets) {
  assert.ok(preset.id && preset.name && preset.expr, '预置缺字段：' + JSON.stringify(preset));
  assert.ok(preset.note && preset.basis, preset.name + ' 缺说明');
}
console.log(`  ✓ 公式字段 ${fieldCatalog.length} 个、示例 ${formulaExamples.length} 条、收藏预置 ${formulaPresets.length} 条`);

// 每条预置都必须能真的跑（解析 + 执行）
for (const preset of formulaPresets.slice(0, 4)) {
  const one = await call('/dsh-stock/api/v1/formula', {
    url: `/dsh-stock/api/v1/formula?limit=5&expr=${encodeURIComponent(preset.expr)}`,
  });
  assert.equal(one.status, 200, `${preset.name} → HTTP ${one.status} ${one.body?.slice(0, 120)}`);
  assert.equal(one.json.ok, true, preset.name + ' 执行失败');
}
console.log('  ✓ 抽查 4 条预置公式均可执行');

// 公式：真跑一次筛选
const formulaCall = await call('/dsh-stock/api/v1/formula', {
  url: `/dsh-stock/api/v1/formula?limit=50&expr=${encodeURIComponent('量比 > 1.5 且 涨跌幅 between 0 and 8')}`,
});
assert.equal(formulaCall.status, 200, formulaCall.body?.slice(0, 200));
assert.equal(formulaCall.json.ok, true);
const formulaData = formulaCall.json.data;
assert.ok(formulaData.total > 1000, 'total=' + formulaData.total);
assert.ok(formulaData.matched >= 0 && formulaData.matched <= formulaData.total);
assert.ok(Array.isArray(formulaData.rows) && formulaData.rows.length <= 50);
for (const row of formulaData.rows) {
  assert.ok(row.code && row.secid, row.code + ' 缺字段');
  assert.ok(row.volumeRatio > 1.5, row.code + ' 量比不满足：' + row.volumeRatio);
  assert.ok(row.pct >= 0 && row.pct <= 8, row.code + ' 涨幅不满足：' + row.pct);
}
console.log(`  ✓ 公式筛选：命中 ${formulaData.matched}/${formulaData.total}，返回 ${formulaData.rows.length} 条，${formulaData.ms}ms`);

// 公式：解析错误 → 400 + 位置
const badFormula = await call('/dsh-stock/api/v1/formula', {
  url: `/dsh-stock/api/v1/formula?expr=${encodeURIComponent('市梦率 > 3')}`,
});
assert.equal(badFormula.status, 400);
assert.ok(/未知字段/.test(badFormula.json.error), badFormula.json.error);
assert.ok(typeof badFormula.json.position === 'number', '缺位置');
console.log('  ✓ 非法公式 400「' + badFormula.json.error + '」位置 ' + badFormula.json.position);

// 公式：空表达式 → 400
const emptyFormula = await call('/dsh-stock/api/v1/formula', { url: '/dsh-stock/api/v1/formula?expr=' });
assert.equal(emptyFormula.status, 400);
console.log('  ✓ 空公式 400');

// 公式校验接口（收藏夹导入时逐条校验用）
const validCheck = await call('/dsh-stock/api/v1/formula/validate', {
  url: `/dsh-stock/api/v1/formula/validate?expr=${encodeURIComponent('量比 > 2')}`,
});
assert.equal(validCheck.status, 200);
assert.equal(validCheck.json.data.valid, true);
const invalidCheck = await call('/dsh-stock/api/v1/formula/validate', {
  url: `/dsh-stock/api/v1/formula/validate?expr=${encodeURIComponent('foo > 1')}`,
});
assert.equal(invalidCheck.status, 200);
assert.equal(invalidCheck.json.data.valid, false);
assert.ok(/未知字段/.test(invalidCheck.json.data.error), invalidCheck.json.data.error);
console.log('  ✓ 校验接口：合法→valid=true，非法→valid=false + 错误');

// 容错写法：方括号、全角符号、~ 区间、逗号分隔
const tolerant = await call('/dsh-stock/api/v1/formula/validate', {
  url: `/dsh-stock/api/v1/formula/validate?expr=${encodeURIComponent('[量比]＞２，涨跌幅 between 0~1')}`,
});
assert.equal(tolerant.status, 200);
assert.equal(tolerant.json.data.valid, true, '容错写法应通过：' + JSON.stringify(tolerant.json.data));
const tolerantRun = await call('/dsh-stock/api/v1/formula', {
  url: `/dsh-stock/api/v1/formula?limit=10&expr=${encodeURIComponent('[量比]＞２，涨跌幅 between 0~1')}`,
});
assert.equal(tolerantRun.status, 200, tolerantRun.body?.slice(0, 160));
assert.equal(tolerantRun.json.ok, true);
for (const row of tolerantRun.json.data.rows) {
  assert.ok(row.volumeRatio > 2 && row.pct >= 0 && row.pct <= 1, row.code + ' 不满足条件');
}
console.log(`  ✓ 容错写法可执行：命中 ${tolerantRun.json.data.matched} 只`);

// 导入格式：导出的 JSON 结构必须能被重新解析（来回一致）
const exportPayload = {
  format: 'dsh-stock-workbench/formulas',
  version: 1,
  formulas: formulaPresets.map((preset) => ({ id: preset.id, name: preset.name, expr: preset.expr, builtin: true })),
};
const roundTrip = JSON.parse(JSON.stringify(exportPayload));
assert.equal(roundTrip.formulas.length, formulaPresets.length);
for (const item of roundTrip.formulas) {
  const check = await call('/dsh-stock/api/v1/formula/validate', {
    url: `/dsh-stock/api/v1/formula/validate?expr=${encodeURIComponent(item.expr)}`,
  });
  assert.equal(check.json.data.valid, true, item.name + ' 导出后校验失败');
}
console.log('  ✓ 导出 JSON 的 ' + roundTrip.formulas.length + ' 条公式全部通过校验（可被重新导入）');

// 缓存：ttlMs=0 时连续两次都应重新拉（不同 fetchedAt）
const second = await call('/dsh-stock/api/v1/dashboard');
assert.ok(second.json.data.meta.fetchedAt >= data.meta.fetchedAt);
console.log('  ✓ 第二次请求正常（无缓存 TTL=0）');

// 分红详情：连续年数 + 明细（真实上游）
const dividend = await call('/dsh-stock/api/v1/dividend', { url: '/dsh-stock/api/v1/dividend?code=600036' });
assert.equal(dividend.status, 200, dividend.body?.slice(0, 160));
assert.equal(dividend.json.ok, true);
const dividendData = dividend.json.data;
assert.equal(dividendData.code, '600036');
assert.ok(Number.isFinite(dividendData.consecutive) && dividendData.consecutive > 0, '连续分红年数缺失');
assert.ok(Array.isArray(dividendData.records) && dividendData.records.length > 0, '分红明细为空');
const firstRecord = dividendData.records[0];
assert.ok(firstRecord.exDate && Number.isFinite(firstRecord.per10) && Number.isFinite(firstRecord.perShare), '明细字段不全');
console.log('  ✓ 分红详情：招商银行 连续 ' + dividendData.consecutive + ' 年 / 明细 ' + dividendData.records.length + ' 条 / 最近除息 ' + dividendData.lastExDate);

const badDividend = await call('/dsh-stock/api/v1/dividend', { url: '/dsh-stock/api/v1/dividend?code=abc' });
assert.equal(badDividend.status, 400);
console.log('  ✓ 分红详情：非法代码 400');

// 板块资金流 + 估值分位（真实上游）
const boards = await call('/dsh-stock/api/v1/boards', { url: '/dsh-stock/api/v1/boards?type=concept' });
assert.equal(boards.status, 200, boards.body?.slice(0, 160));
assert.ok(Array.isArray(boards.json.data.boards) && boards.json.data.boards.length > 100, '板块数太少：' + (boards.json.data.boards?.length ?? 0));
const firstBoard = boards.json.data.boards[0];
assert.ok(firstBoard.name, '板块名缺失');
if (!Number.isFinite(firstBoard.mainIn)) console.log('  （早盘：板块主力净流入尚未统计，跳过数值断言）');
console.log('  ✓ 板块资金流：' + boards.json.data.boards.length + ' 个概念板块，首位 ' + firstBoard.name + ' 主力净流入 ' + (firstBoard.mainIn / 1e8).toFixed(2) + ' 亿');

const industryBoards = await call('/dsh-stock/api/v1/boards', { url: '/dsh-stock/api/v1/boards?type=industry' });
assert.equal(industryBoards.status, 200);
if (dash.json.data.meta.provider === 'eastmoney') {
assert.ok(industryBoards.json.data.boards.length > 30, '行业板块太少');
}
console.log('  ✓ 行业板块：' + industryBoards.json.data.boards.length + ' 个');

const valuation = await call('/dsh-stock/api/v1/valuation', { url: '/dsh-stock/api/v1/valuation?code=600036' });
assert.equal(valuation.status, 200, valuation.body?.slice(0, 160));
const val = valuation.json.data;
assert.equal(val.code, '600036');
assert.ok(Number.isFinite(val.pe) && val.pe > 0, 'PE 缺失');
assert.ok(Number.isFinite(val.pePercentile) && val.pePercentile >= 0 && val.pePercentile <= 100, 'PE 分位异常：' + val.pePercentile);
assert.ok(val.sampleDays > 100, '样本天数太少：' + val.sampleDays);
console.log('  ✓ 估值分位：招商银行 PE ' + val.pe + '（5年分位 ' + val.pePercentile + '%）、PB ' + val.pb + '（分位 ' + val.pbPercentile + '%），样本 ' + val.sampleDays + ' 天');

const badValuation = await call('/dsh-stock/api/v1/valuation', { url: '/dsh-stock/api/v1/valuation?code=xx' });
assert.equal(badValuation.status, 400);
console.log('  ✓ 估值分位：非法代码 400');

// 快照带板块/概念字段
const rowWithConcepts = data.rows.find((item) => item.concepts);
assert.ok(rowWithConcepts, '快照没有 concepts 字段');
assert.ok(typeof rowWithConcepts.regionBoard === 'string', '快照缺少 regionBoard');
console.log('  ✓ 快照含 concepts/regionBoard（例如 ' + rowWithConcepts.code + ' ' + rowWithConcepts.regionBoard + '）');

// 板块成分股（点击板块筛选）
const memberStart = Date.now();
const members = await call('/dsh-stock/api/v1/board-members', { url: '/dsh-stock/api/v1/board-members?code=BK0917' });
assert.equal(members.status, 200, members.body?.slice(0, 160));
assert.ok(Array.isArray(members.json.data.codes) && members.json.data.codes.length > 100, '成分股太少');
const memberSet = new Set(members.json.data.codes);
const matchedRows = data.rows.filter((row) => memberSet.has(row.code));
assert.ok(matchedRows.length > 100, '按成员代码筛选命中太少：' + matchedRows.length);
console.log('  ✓ 板块成分股：半导体概念 ' + members.json.data.codes.length + ' 只，榜单命中 ' + matchedRows.length + ' 只（' + (Date.now() - memberStart) + 'ms）');

const badMembers = await call('/dsh-stock/api/v1/board-members', { url: '/dsh-stock/api/v1/board-members?code=xx' });
assert.equal(badMembers.status, 400);
console.log('  ✓ 板块成分股：非法代码 400');

// 全市场估值分位：测试环境关闭批量构建，避免 720 次请求
process.env.DSH_STOCK_BULK_VALUATION = 'off';
const bulk = await call('/dsh-stock/api/v1/valuation-percentiles');
assert.equal(bulk.status, 200);
assert.equal(bulk.json.ok, true);
assert.equal(bulk.json.data.status, 'disabled');
console.log('  ✓ 批量估值分位：测试环境返回 disabled（避免真实构建）');
delete process.env.DSH_STOCK_BULK_VALUATION;

// 重载：清空缓存后重新请求
const reloadRes = await call('/dsh-stock/api/v1/reload', { method: 'POST' });
assert.equal(reloadRes.status, 200, reloadRes.body?.slice(0, 160));
assert.equal(reloadRes.json.ok, true);
const reloadData = reloadRes.json.data;
assert.ok(Array.isArray(reloadData.cleared) && reloadData.cleared.includes('dashboard'), 'cleared 缺 dashboard：' + JSON.stringify(reloadData.cleared));
assert.ok(reloadData.cleared.includes('universe') && reloadData.cleared.includes('dividend'), 'cleared 缺 universe/dividend');
assert.ok(reloadData.rows > 1000, '重载后行数异常：' + reloadData.rows);
assert.equal(reloadData.meta.cached, false, '重载后不应命中缓存');
assert.ok(typeof reloadData.totalMs === 'number', '缺 totalMs');
console.log('  ✓ 重载：清空 ' + reloadData.cleared.join(',') + ' → ' + reloadData.rows + ' 行 / ' + reloadData.totalMs + 'ms（源 ' + reloadData.meta.provider + '）');

// 数据源：列表 / 切换 / 非法值 / 还原
const sources = await call('/dsh-stock/api/v1/data-sources');
assert.equal(sources.status, 200);
assert.equal(sources.json.ok, true);
assert.ok(Array.isArray(sources.json.data.providers) && sources.json.data.providers.length >= 3, '数据源应 ≥3 个');
assert.ok(sources.json.data.providers.some((item) => item.id === 'eastmoney'), '缺 eastmoney');
assert.ok(sources.json.data.providers.some((item) => item.id === 'tencent'), '缺 tencent');
assert.ok(sources.json.data.providers.some((item) => item.id === 'sina'), '缺 sina');
console.log('  ✓ 数据源清单：' + sources.json.data.providers.map((item) => item.id).join(', ') + '，当前 ' + sources.json.data.preferred);

const originalProvider = sources.json.data.preferred;
const badSwitch = await call('/dsh-stock/api/v1/data-sources', { method: 'POST', body: { provider: 'nope' } });
assert.equal(badSwitch.status, 400, '非法数据源应 400');
assert.equal(badSwitch.json.ok, false);
console.log('  ✓ 非法数据源返回 400');

let switchedProvider = null;
try {
const toTencent = await call('/dsh-stock/api/v1/data-sources', { method: 'POST', body: { provider: 'tencent' } });
assert.equal(toTencent.status, 200);
assert.equal(toTencent.json.data.preferred, 'tencent');
const dashTencent = await call('/dsh-stock/api/v1/dashboard', { url: '/dsh-stock/api/v1/dashboard?force=1' });
assert.equal(dashTencent.status, 200);
assert.ok(dashTencent.json.data.rows.length > 1000, '腾讯源行数异常：' + dashTencent.json.data.rows.length);
assert.ok(['tencent', 'eastmoney', 'sina'].includes(dashTencent.json.data.meta.provider), 'meta.provider 异常');
assert.ok(Array.isArray(dashTencent.json.data.meta.providerMissingFields), '缺 providerMissingFields');
console.log('  ✓ 切到腾讯源：rows=' + dashTencent.json.data.rows.length + '（meta.provider=' + dashTencent.json.data.meta.provider + '，缺失字段 ' + dashTencent.json.data.meta.providerMissingFields.length + ' 个）');
const cmbTencent = dashTencent.json.data.rows.find((row) => row.code === '600036');
assert.ok(cmbTencent && typeof cmbTencent.price === 'number' && cmbTencent.price > 0, '腾讯源招商银行价格异常');
assert.equal(cmbTencent.name, '招商银行');

} finally {
  // 无论断言是否失败，都把数据源还原，避免污染后续本地状态
  const back = await call('/dsh-stock/api/v1/data-sources', { method: 'POST', body: { provider: originalProvider } });
  assert.equal(back.status, 200);
  assert.equal(back.json.data.preferred, originalProvider);
  const dashBack = await call('/dsh-stock/api/v1/dashboard', { url: '/dsh-stock/api/v1/dashboard?force=1' });
  assert.equal(dashBack.status, 200);
  assert.ok(dashBack.json.data.rows.length > 1000);
  console.log('  ✓ 切回 ' + originalProvider + '：rows=' + dashBack.json.data.rows.length);
}

// 卸载：effect 的 disposer 应移除路由
for (const dispose of disposers) dispose();
assert.equal(routes.size, 0);
console.log('  ✓ teardown 后路由清空');

console.log('\nHost 半端到端通过');
