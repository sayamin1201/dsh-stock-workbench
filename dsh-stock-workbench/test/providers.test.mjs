// 数据层路由单测：node test/providers.test.mjs
import { createDataRouter, AllProvidersFailedError } from '../lib/providers/registry.js';

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log('  ✓ ' + name); }
  catch (error) { console.error('  ✗ ' + name + '\n    ' + error.message); process.exitCode = 1; }
}
function assert(condition, message) { if (!condition) throw new Error(message); }

function fakeProvider(id, label, behaviour) {
  return {
    id,
    label,
    capabilities: { snapshot: true },
    missingFields: [],
    ...behaviour,
  };
}

function routerOf(providers, preferred = providers[0].id) {
  return createDataRouter({ providers, preferred });
}

console.log('故障切换：');
test('首选源正常时直接返回，不触发回退', async () => {
  const calls = [];
  const router = routerOf([
    fakeProvider('a', 'A', { async snapshot() { calls.push('a'); return { rows: [{ code: '600036' }] }; } }),
    fakeProvider('b', 'B', { async snapshot() { calls.push('b'); return { rows: [{ code: '000001' }] }; } }),
  ]);
  const result = await router.snapshot(['1.600036']);
  assert(calls.join(',') === 'a', '不应调用 B：' + calls.join(','));
  assert(result.provider === 'a' && result.fallback === false, 'provider/fallback 不对');
  assert(result.value.rows[0].code === '600036', '数据不对');
});
test('首选源失败时自动切到下一个，并记录回退链路', async () => {
  const router = routerOf([
    fakeProvider('a', 'A', { async snapshot() { throw new Error('A 挂了'); } }),
    fakeProvider('b', 'B', { async snapshot() { return { rows: [{ code: '000001' }] }; } }),
  ]);
  const result = await router.snapshot(['1.600036']);
  assert(result.provider === 'b', '应切到 B，实际 ' + result.provider);
  assert(result.fallback === true, 'fallback 应为 true');
  assert(result.errors.length === 1 && result.errors[0].provider === 'a', '回退链路不对');
});
test('切换首选源后顺序跟着变', async () => {
  const router = routerOf([
    fakeProvider('a', 'A', { async snapshot() { return { rows: [{ code: 'A' }] }; } }),
    fakeProvider('b', 'B', { async snapshot() { return { rows: [{ code: 'B' }] }; } }),
  ]);
  router.setPreferred('b');
  const result = await router.snapshot([]);
  assert(result.provider === 'b' && result.value.rows[0].code === 'B', '切换后应优先 B');
});
test('全部失败时抛出 AllProvidersFailedError，带 errors', async () => {
  const router = routerOf([
    fakeProvider('a', 'A', { async snapshot() { throw new Error('A 挂了'); } }),
    fakeProvider('b', 'B', { async snapshot() { throw new Error('B 挂了'); } }),
  ]);
  try {
    await router.snapshot([]);
    throw new Error('应该抛错');
  } catch (error) {
    assert(error instanceof AllProvidersFailedError, '类型不对：' + error.name);
    assert(error.code === 'ALL_PROVIDERS_FAILED', 'code 不对');
    assert(error.errors.length === 2, 'errors 数量不对');
    assert(error.message.includes('A 挂了') && error.message.includes('B 挂了'), '错误信息缺源名');
  }
});
test('未实现某能力的源会被跳过（如新浪没有分时）', async () => {
  const router = routerOf([
    fakeProvider('a', 'A', {}), // 无 trends
    fakeProvider('b', 'B', { async trends() { return { points: [] }; } }),
  ]);
  const result = await router.trends('1.600036');
  assert(result.provider === 'b', '应跳过 A 用 B');
});

console.log('状态与元信息：');
test('health 记录成功/失败次数与最后错误', async () => {
  const router = routerOf([
    fakeProvider('a', 'A', { async snapshot() { throw new Error('boom'); } }),
    fakeProvider('b', 'B', { async snapshot() { return { rows: [] }; } }),
  ]);
  await router.snapshot([]);
  const health = router.health();
  assert(health.a.fail === 1 && health.a.lastError === 'boom', 'A 健康记录不对：' + JSON.stringify(health.a));
  assert(health.b.ok === 1, 'B 应记 1 次成功');
});
test('list() 返回能力与缺失字段，switch 校验非法 id', async () => {
  const router = routerOf([
    fakeProvider('a', 'A', { async snapshot() { return { rows: [] }; } }),
  ]);
  const list = router.list();
  assert(list.length === 1 && list[0].id === 'a' && list[0].capabilities.snapshot, 'list 不对');
  assert(router.has('a') && !router.has('zzz'), 'has 判断不对');
  try {
    router.setPreferred('zzz');
    throw new Error('应该抛错');
  } catch (error) {
    assert(error.message.includes('未知数据源'), '错误信息不对：' + error.message);
  }
});
test('初始 preferred 不存在时回落到第一个', () => {
  const router = createDataRouter({ providers: [fakeProvider('a', 'A', {})], preferred: 'nope' });
  assert(router.preferred === 'a', '应回落到 a');
});

console.log('\n通过 ' + passed + ' 项');
