/**
 * 数据层：行情源路由（多源自动故障切换）
 *
 * 约定：provider 实现下列可选能力（实现即声明在 capabilities 里）
 *   universe({})                       → { universe, total }
 *   snapshot(secids)                   → { rows, failed }
 *   indices()                          → Array<{code,name,price,pct,chg,...}>
 *   breadth()                          → { up, down, flat, limitUp, limitDown, tradingDay, ... }
 *   kline(secid, {klt,lmt})            → { name, preKPrice, bars[] }
 *   trends(secid, {ndays})             → { preClose, points[] }
 *
 * 路由器行为：
 *  - 按「首选源 → 其他源」顺序尝试，任一成功即返回，并记录 fallback 错误
 *  - 记录每个源的健康状况（成功/失败次数、最后一次错误）
 *  - 全部失败时抛出带 errors[] 的错误，便于 UI 展示到底哪个源、什么原因
 */
export class AllProvidersFailedError extends Error {
  constructor(method, errors) {
    super(`${method} 全部数据源失败：${errors.map((item) => `${item.provider}:${item.error}`).join(' | ')}`);
    this.name = 'AllProvidersFailedError';
    this.code = 'ALL_PROVIDERS_FAILED';
    this.method = method;
    this.errors = errors;
  }
}

/**
 * @param {{providers: object[], preferred?: string}} options
 */
export function createDataRouter({ providers, preferred = 'eastmoney' } = {}) {
  if (!Array.isArray(providers) || !providers.length) throw new Error('至少需要一个数据源');
  const registry = new Map(providers.map((provider) => [provider.id, provider]));
  if (!registry.has(preferred)) preferred = providers[0].id;
  const health = new Map(
    providers.map((provider) => [provider.id, { ok: 0, fail: 0, lastError: null, lastOkAt: null }]),
  );

  function order() {
    return [preferred, ...providers.map((provider) => provider.id).filter((id) => id !== preferred)];
  }

  function supports(provider, method) {
    return provider && typeof provider[method] === 'function';
  }

  async function attempt(method, args) {
    const errors = [];
    for (const id of order()) {
      const provider = registry.get(id);
      if (!supports(provider, method)) continue;
      try {
        const value = await provider[method](...args);
        const state = health.get(id);
        state.ok += 1;
        state.lastOkAt = Date.now();
        state.lastError = null;
        return { value, provider: id, label: provider.label, fallback: errors.length > 0, errors };
      } catch (error) {
        const state = health.get(id);
        state.fail += 1;
        state.lastError = error instanceof Error ? error.message : String(error);
        errors.push({ provider: id, label: provider.label, error: state.lastError });
      }
    }
    throw new AllProvidersFailedError(method, errors);
  }

  return {
    get preferred() {
      return preferred;
    },
    setPreferred(id) {
      if (!registry.has(id)) throw new Error(`未知数据源：${id}`);
      preferred = id;
      return id;
    },
    has: (id) => registry.has(id),
    /** 供 UI / 诊断用的数据源清单 */
    list() {
      return providers.map((provider) => ({
        id: provider.id,
        label: provider.label,
        capabilities: provider.capabilities ?? {},
        missingFields: provider.missingFields ?? [],
      }));
    },
    health() {
      return Object.fromEntries([...health.entries()].map(([id, state]) => [id, { ...state }]));
    },
    /** 只用指定源执行某能力（重载兜底：跳过首选源，直接问备用源） */
    async runWith(id, method, args = []) {
      const provider = registry.get(id);
      if (!provider || !supports(provider, method)) throw new Error(`数据源 ${id} 不支持 ${method}`);
      const value = await provider[method](...args);
      const state = health.get(id);
      state.ok += 1;
      state.lastOkAt = Date.now();
      state.lastError = null;
      return { value, provider: id, label: provider.label, fallback: true, errors: [] };
    },
    snapshot: (secids) => attempt('snapshot', [secids]),
    indices: () => attempt('indices', []),
    breadth: () => attempt('breadth', []),
    kline: (secid, options) => attempt('kline', [secid, options]),
    trends: (secid, options) => attempt('trends', [secid, options]),
    universe: (options) => attempt('universe', [options ?? {}]),
  };
}
