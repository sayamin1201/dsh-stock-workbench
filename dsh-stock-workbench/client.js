/**
 * Client half of the 看股工作台 (stock workbench).
 *
 * Adds one sidebar icon (`sidebar.panellist`) and one full-page panel
 * (`main`, keyed by PANEL_ID — the shell selects it by the same id). All data
 * comes from the Host half's same-origin JSON routes; the renderer never talks
 * to a quote provider directly.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-stock-workbench',
  factory: (require) => {
    const React = require('react');
    const h = React.createElement;

    const NS = 'dsh-stock-workbench';
    const PANEL_ID = 'stock-workbench';
    const API_PATH = 'dsh-stock/api/v1/dashboard';

    // ---------------------------------------------------------------------
    // Formatters — mirrors lib/query.js (the browser module cannot import it)
    // ---------------------------------------------------------------------

    const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

    function fmtPrice(v) { return isNum(v) ? v.toFixed(2) : '—'; }
    function fmtPct(v) { return isNum(v) ? `${v > 0 ? '+' : ''}${v.toFixed(2)}%` : '—'; }
    function fmtPctPlain(v) { return isNum(v) ? `${v.toFixed(2)}%` : '—'; }
    function fmtNum(v) { return isNum(v) ? v.toFixed(2) : '—'; }
    function fmtSigned(v) { return isNum(v) ? `${v > 0 ? '+' : ''}${v.toFixed(2)}` : '—'; }

    function fmtMoney(v) {
      if (!isNum(v)) return '—';
      const abs = Math.abs(v);
      if (abs >= 1e8) return `${(v / 1e8).toFixed(2)}亿`;
      if (abs >= 1e4) return `${(v / 1e4).toFixed(1)}万`;
      return `${Math.round(v)}`;
    }
    function fmtMoneySign(v) {
      if (!isNum(v) || v === 0) return '—'; // 0 = 东财未覆盖
      const s = fmtMoney(v);
      return v > 0 ? `+${s}` : s;
    }
    function fmtMcap(v) {
      if (!isNum(v)) return '—';
      const yi = v / 1e8;
      return yi >= 10000 ? `${(yi / 10000).toFixed(2)}万亿` : `${yi.toFixed(1)}亿`;
    }
    function fmtLots(v) {
      if (!isNum(v)) return '—';
      const abs = Math.abs(v);
      if (abs >= 1e8) return `${(v / 1e8).toFixed(2)}亿手`;
      if (abs >= 1e4) return `${(v / 1e4).toFixed(1)}万手`;
      return `${Math.round(v)}`;
    }

    function formatCell(value, kind) {
      switch (kind) {
        case 'price': return fmtPrice(value);
        case 'pct': return fmtPct(value);
        case 'pctPlain': return fmtPctPlain(value);
        case 'money': return fmtMoney(value);
        case 'moneySign': return fmtMoneySign(value);
        case 'mcap': return fmtMcap(value);
        case 'lots': return fmtLots(value);
        case 'num': return fmtNum(value);
        case 'streak': return isNum(value) && value > 0 ? `${value >= 10 ? '10+' : value}` : '—';
        case 'signed': return fmtSigned(value);
        default: return value == null || value === '' ? '—' : String(value);
      }
    }

    const BOARD_TAG = { star: '科', chinext: '创', bse: '北' };

    // ---------------------------------------------------------------------
    // 每个 tab 一套列定义 + 独立列偏好（显示/固定/排序，按 tab 持久化）
    // ---------------------------------------------------------------------

    const FLOW_COLUMNS = [
      { key: 'code', labelKey: 'col.code', width: 84, render: (row) => h('span', { className: 'sw-code' }, row.code) },
      { key: 'name', labelKey: 'col.name', width: 96, render: (row) => h('span', { className: 'sw-nameText' }, row.name) },
      { key: 'mainIn', labelKey: 'col.mainIn', width: 96, align: 'right', render: (row) => h('span', { className: 'sw-num ' + pctClass(row.mainIn) }, fmtMoneySign(row.mainIn)) },
      { key: 'pct', labelKey: 'col.pct', width: 66, align: 'right', render: (row) => h('span', { className: 'sw-num ' + pctClass(row.pct) }, fmtPct(row.pct)) },
      { key: 'mainInPct', labelKey: 'flowPctCol', width: 80, align: 'right', render: (row) => h('span', { className: 'sw-num' }, isNum(row.mainInPct) ? `${row.mainInPct.toFixed(2)}%` : '—') },
    ];

    const SCAN_COLUMNS = [
      { key: 'code', labelKey: 'col.code', width: 86, render: (row) => h('div', { className: 'sw-code' }, row.code) },
      { key: 'name', labelKey: 'col.name', width: 122, render: (row) => h('div', { className: 'sw-name' }, h('span', { className: 'sw-nameText' }, row.name), BOARD_TAG[row.board] ? h('span', { className: 'sw-tag' }, BOARD_TAG[row.board]) : null) },
      { key: 'price', labelKey: 'col.price', width: 80, align: 'right', render: (row) => h('div', { style: { textAlign: 'right' } }, fmtPrice(row.price)) },
      { key: 'pct', labelKey: 'col.pct', width: 84, align: 'right', render: (row) => h('div', { className: pctClass(row.pct), style: { textAlign: 'right' } }, fmtPct(row.pct)) },
      { key: 'amount', labelKey: 'col.amount', width: 96, align: 'right', render: (row) => h('div', { style: { textAlign: 'right' } }, fmtMoney(row.amount)) },
      { key: 'turnover', labelKey: 'col.turnover', width: 76, align: 'right', render: (row) => h('div', { style: { textAlign: 'right' } }, fmtPctPlain(row.turnover)) },
      { key: 'signals', labelKey: 'scanSignalCol', width: 220, render: (row, t, extra) => h('div', { className: 'sw-signalTags' }, (row.signals ?? []).map((hit) => h('span', {
        key: hit.id,
        className: 'sw-signalTag',
        title: hit.detail,
      }, (extra && extra.labelOf ? extra.labelOf(hit.id) : hit.id) + (hit.daysAgo > 0 ? ` ${hit.daysAgo}${t('scanDaysAgo')}` : '')))) },
      { key: 'detail', labelKey: 'scanDetailCol', width: 240, render: (row) => h('div', { className: 'sw-scanDetail' }, (row.signals ?? []).map((hit) => hit.detail).join('；')) },
    ];


    /** 固定列偏移（从左累加） */
    function frozenOffsetsOf(columns) {
      const offsets = new Map();
      let offset = 0;
      for (const column of columns) {
        if (column.frozen) {
          offsets.set(column.key, offset);
          offset += column.width;
        }
      }
      return offsets;
    }

    /** 单个单元格内容：榜单与结果表共用（名称带板块标签、分红列可点开明细、数值走格式化） */
    function columnCellContent(column, row, t, extra) {
      if (column.key === 'name') {
        const tag = BOARD_TAG[row.board];
        return h('div', { className: 'sw-name' },
          h('span', { className: 'sw-nameText', title: row.name }, row.name),
          tag ? h('span', { className: 'sw-tag' }, tag) : null);
      }
      const value = row[column.key];
      if (column.dividendLink) {
        return h('button', {
          type: 'button',
          className: 'sw-divLink',
          title: t('dividendStreakHint'),
          onClick: (event) => {
            if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
            if (extra && extra.onOpenDividend) extra.onOpenDividend(row);
          },
          onDoubleClick: (event) => {
            if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
          },
        }, formatCell(value, column.kind));
      }
      return formatCell(value, column.kind);
    }

    /** 结果表单元格 class */
    function columnCellClass(column, row) {
      return (column.align === 'right' ? 'sw-cellRight' : '')
        + (column.key === 'code' ? ' sw-code' : '')
        + (column.colored ? ' ' + pctClass(row[column.key]) : '')
        + (column.frozen ? ' sw-cellFrozen' : '');
    }

    function frozenCellStyle(offsets, column) {
      const left = offsets.get(column.key);
      return left == null ? undefined : { position: 'sticky', left, zIndex: 2 };
    }

    /** 表格上方的一小行工具行：右侧放齿轮 */
    /** 结果表（信号扫描 / 公式选股共用）：列配置驱动 + 点击表头排序 */
    function ResultTable({ t, columns, rows, onOpen, onConfigColumns, extra }) {
      const activeColumns = columns && columns.length ? columns : [];
      const grid = activeColumns.map((column) => `${column.width}px`).join(' ');
      const offsets = frozenOffsetsOf(activeColumns);
      const [sort, setSort] = React.useState({ key: null, dir: 'desc' });
      const sortedRows = React.useMemo(() => {
        const source = rows ?? [];
        if (!sort.key) return source;
        try {
          return sortRows(source, sort.key, sort.dir);
        } catch {
          return source;
        }
      }, [rows, sort]);
      const toggleSort = (key) => {
        setSort((prev) => {
          if (prev.key === key) return { key, dir: prev.dir === 'desc' ? 'asc' : 'desc' };
          return { key, dir: 'desc' };
        });
      };

      return h(React.Fragment, null,
        h(TableToolRow, { t, onConfigColumns }),
        h('div', { className: 'sw-scanTable' },
          h('div', { className: 'sw-resHead', style: { gridTemplateColumns: grid } },
            activeColumns.map((column) => {
              const active = sort.key === column.key;
              return h('button', {
                key: column.key,
                type: 'button',
                className: 'sw-resTh' + (column.align === 'right' ? ' sw-resThRight' : '')
                  + (active ? ' sw-resThOn' : '') + (column.frozen ? ' sw-thFrozen' : ''),
                style: frozenCellStyle(offsets, column),
                title: t(column.labelKey),
                onClick: () => toggleSort(column.key),
              },
              h('span', null, t(column.labelKey)),
              active ? h('span', { className: 'sw-sort' }, sort.dir === 'asc' ? '▲' : '▼') : null);
            })),
          sortedRows.map((row) => h('div', {
            key: row.code,
            className: 'sw-resRow',
            style: { gridTemplateColumns: grid },
            title: t('dblClickHint'),
            onDoubleClick: () => onOpen(row),
          }, activeColumns.map((column) => h('div', {
            key: column.key,
            className: 'sw-resCell' + (column.align === 'right' ? ' sw-resCellRight' : '')
              + (column.key === 'code' ? ' sw-code' : '')
              + (column.colored ? ' ' + pctClass(row[column.key]) : '')
              + (column.frozen ? ' sw-cellFrozen' : ''),
            style: frozenCellStyle(offsets, column),
          }, column.render ? column.render(row, t, extra) : columnCellContent(column, row, t, extra)))))));
    }

    function TableToolRow({ t, onConfigColumns, children }) {
      return h('div', { className: 'sw-toolRow' },
        children ?? null,
        onConfigColumns ? h(ColumnConfigGear, { t, onClick: onConfigColumns }) : null);
    }

    /** 跟随表格的小齿轮 */
    function ColumnConfigGear({ t, onClick }) {
      return h('button', {
        type: 'button',
        className: 'sw-gearBtn',
        title: `${t('columnConfig')} · ${t('columnConfigHint')}`,
        'aria-label': t('columnConfig'),
        onClick: (event) => {
          if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
          if (onClick) onClick();
        },
      }, '⚙');
    }



    // ---------------------------------------------------------------------
    // 本地持久化：自选池 + 自动刷新间隔
    // ---------------------------------------------------------------------

    const WATCH_KEY = 'dsh-stock-workbench:watchlist';
    const AUTO_KEY = 'dsh-stock-workbench:auto-seconds';
    const FORMULA_KEY = 'dsh-stock-workbench:formulas';

    function readStore(key, fallback) {
      try {
        if (typeof localStorage === 'undefined') return fallback;
        const raw = localStorage.getItem(key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    }

    function writeStore(key, value) {
      try {
        if (typeof localStorage !== 'undefined') localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* 隐私模式/配额满：退化为本次会话内存态 */
      }
    }

    /** 自选状态：{ active, groups: [{ id, name, codes }] }；旧版纯数组自动迁移成「默认」组 */
    function defaultWatchState() {
      return { active: 'default', groups: [{ id: 'default', name: '默认', codes: [] }] };
    }

    function normalizeWatchState(stored) {
      if (Array.isArray(stored)) {
        return { active: 'default', groups: [{ id: 'default', name: '默认', codes: stored.filter((code) => typeof code === 'string') }] };
      }
      if (!stored || !Array.isArray(stored.groups) || !stored.groups.length) return defaultWatchState();
      const groups = stored.groups
        .filter((group) => group && typeof group.id === 'string')
        .map((group) => ({
          id: group.id,
          name: typeof group.name === 'string' && group.name ? group.name : '未命名',
          codes: Array.isArray(group.codes) ? group.codes.filter((code) => typeof code === 'string') : [],
        }));
      if (!groups.length) return defaultWatchState();
      const active = groups.some((group) => group.id === stored.active) ? stored.active : groups[0].id;
      return { active, groups };
    }

    function useWatchlist() {
      const [state, setState] = React.useState(() => normalizeWatchState(readStore(WATCH_KEY, null)));
      const update = React.useCallback((mutator) => {
        setState((prev) => {
          const next = mutator(prev);
          writeStore(WATCH_KEY, next);
          return next;
        });
      }, []);
      const activeGroup = state.groups.find((group) => group.id === state.active) ?? state.groups[0];
      const codes = activeGroup.codes;
      const set = React.useMemo(() => new Set(codes), [codes]);
      const toggle = React.useCallback((code) => {
        update((prev) => ({
          ...prev,
          groups: prev.groups.map((group) => (group.id === prev.active
            ? {
              ...group,
              codes: group.codes.includes(code)
                ? group.codes.filter((item) => item !== code)
                : [...group.codes, code],
            }
            : group)),
        }));
      }, [update]);
      const switchGroup = React.useCallback((id) => update((prev) => ({ ...prev, active: id })), [update]);
      const addGroup = React.useCallback((name) => {
        const id = `g${Date.now().toString(36)}`;
        update((prev) => ({
          active: id,
          groups: [...prev.groups, { id, name: String(name || '新分组').slice(0, 12), codes: [] }],
        }));
        return id;
      }, [update]);
      const removeGroup = React.useCallback((id) => update((prev) => {
        if (prev.groups.length <= 1) return prev;
        const groups = prev.groups.filter((group) => group.id !== id);
        return { active: prev.active === id ? groups[0].id : prev.active, groups };
      }), [update]);
      const renameGroup = React.useCallback((id, name) => update((prev) => ({
        ...prev,
        groups: prev.groups.map((group) => (group.id === id
          ? { ...group, name: String(name || group.name).slice(0, 12) }
          : group)),
      })), [update]);
      return {
        state,
        groups: state.groups,
        active: state.active,
        activeName: activeGroup.name,
        codes,
        set,
        toggle,
        has: (code) => set.has(code),
        switchGroup,
        addGroup,
        removeGroup,
        renameGroup,
      };
    }

    /** 自选分组条（放在表格工具行左侧） */
    function WatchlistBar({ t, groups, active, onSwitch, onAdd, onRemove }) {
      const [creating, setCreating] = React.useState(false);
      const [name, setName] = React.useState('');
      const commit = (value) => {
        const next = String(value ?? name).trim();
        onAdd(next || t('watchGroupDefaultName'));
        setName('');
        setCreating(false);
      };
      return h('div', { className: 'sw-watchBar' },
        h('span', { className: 'sw-filterLabel' }, t('watchGroups')),
        groups.map((group) => h('span', {
          key: group.id,
          className: 'sw-watchChip' + (group.id === active ? ' sw-watchChipOn' : ''),
        },
        h('button', {
          type: 'button',
          className: 'sw-watchName',
          title: `${group.name} · ${group.codes.length}`,
          onClick: () => onSwitch(group.id),
        }, `${group.name} ${group.codes.length}`),
        groups.length > 1
          ? h('button', {
            type: 'button',
            className: 'sw-watchDel',
            title: t('watchGroupRemove'),
            onClick: () => onRemove(group.id),
          }, '×')
          : null)),
        creating
          ? h('input', {
            className: 'sw-input',
            style: { width: 96 },
            value: name,
            autoFocus: true,
            placeholder: t('watchGroupName'),
            onChange: (event) => setName(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter') commit(event && event.target ? event.target.value : undefined);
              if (event.key === 'Escape') {
                setCreating(false);
                setName('');
              }
            },
          })
          : h('button', {
            type: 'button',
            className: 'sw-watchChip sw-watchAdd',
            title: t('watchGroupAdd'),
            onClick: () => setCreating(true),
          }, '＋'));
    }

    // ---------------------------------------------------------------------
    // CSV 导出
    // ---------------------------------------------------------------------

    const CSV_COLUMNS = [
      ['code', '代码'],
      ['name', '名称'],
      ['price', '最新价'],
      ['pct', '涨跌幅%'],
      ['amount', '成交额(元)'],
      ['turnover', '换手率%'],
      ['volumeRatio', '量比'],
      ['amplitude', '振幅%'],
      ['speed', '涨速%'],
      ['pct5d', '5日涨跌%'],
      ['floatMcap', '流通市值(元)'],
      ['mainIn', '主力净流入(元)'],
      ['pe', '市盈率(动)'],
      ['board', '板块'],
    ];

    function csvCell(value) {
      if (value == null) return '';
      const text = String(value);
      return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    }

    /** 行 → CSV 文本（含表头；数值保持原始值，方便 Excel 继续算） */
    function buildCsv(rows) {
      const lines = [CSV_COLUMNS.map(([, label]) => csvCell(label)).join(',')];
      for (const row of rows) {
        lines.push(CSV_COLUMNS.map(([key]) => csvCell(row[key])).join(','));
      }
      return lines.join('\r\n');
    }

    function downloadCsv(filename, text) {
      return downloadText(filename, text, 'text/csv;charset=utf-8', '\ufeff');
    }

    function downloadText(filename, text, mime = 'text/plain;charset=utf-8', prefix = '') {
      if (typeof document === 'undefined' || typeof Blob === 'undefined') return false;
      const blob = new Blob([`${prefix}${text}`], { type: mime });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return true;
    }

    // ---------------------------------------------------------------------
    // Filters / sort
    // ---------------------------------------------------------------------

    const EMPTY_FILTERS = {
      search: '',
      boardCode: '',
      boardName: '',
      boardCodes: null,
      pctMin: '', pctMax: '',
      amountMin: '',
      turnoverMin: '', turnoverMax: '',
      volumeRatioMin: '',
      amplitudeMin: '',
      floatMcapMin: '', floatMcapMax: '',
      mainInMin: '',
      excludeST: true,
      excludeStar: false,
      excludeBse: false,
    };

    const DEFAULT_SORT = { key: 'pct', dir: 'desc' };

    const toNum = (v) => {
      if (v === '' || v === null || v === undefined) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    const isST = (row) => /ST|退/i.test(row.name ?? '');

    function applyFilters(rows, filters) {
      const f = { ...EMPTY_FILTERS, ...(filters ?? {}) };
      const search = String(f.search ?? '').trim().toLowerCase();
      const boardCodeSet = Array.isArray(f.boardCodes) && f.boardCodes.length ? new Set(f.boardCodes) : null;
      const pctMin = toNum(f.pctMin);
      const pctMax = toNum(f.pctMax);
      const amountMin = toNum(f.amountMin);
      const turnoverMin = toNum(f.turnoverMin);
      const turnoverMax = toNum(f.turnoverMax);
      const volumeRatioMin = toNum(f.volumeRatioMin);
      const amplitudeMin = toNum(f.amplitudeMin);
      const floatMcapMin = toNum(f.floatMcapMin);
      const floatMcapMax = toNum(f.floatMcapMax);
      const mainInMin = toNum(f.mainInMin);

      const out = [];
      for (const row of rows) {
        if (boardCodeSet && !boardCodeSet.has(row.code)) continue;
        if (f.excludeST && isST(row)) continue;
        if (f.excludeStar && row.board === 'star') continue;
        if (f.excludeBse && row.board === 'bse') continue;

        if (search) {
          const hit = (row.code ?? '').toLowerCase().includes(search)
            || (row.name ?? '').toLowerCase().includes(search);
          if (!hit) continue;
        }

        const pct = row.pct;
        if (pctMin !== null && !(pct !== null && pct >= pctMin)) continue;
        if (pctMax !== null && !(pct !== null && pct <= pctMax)) continue;
        if (amountMin !== null && !((row.amount ?? 0) >= amountMin * 1e8)) continue;
        if (turnoverMin !== null && !(row.turnover !== null && row.turnover >= turnoverMin)) continue;
        if (turnoverMax !== null && !(row.turnover !== null && row.turnover <= turnoverMax)) continue;
        if (volumeRatioMin !== null && !(row.volumeRatio !== null && row.volumeRatio >= volumeRatioMin)) continue;
        if (amplitudeMin !== null && !(row.amplitude !== null && row.amplitude >= amplitudeMin)) continue;
        if (floatMcapMin !== null && !((row.floatMcap ?? 0) >= floatMcapMin * 1e8)) continue;
        if (floatMcapMax !== null && !((row.floatMcap ?? 0) <= floatMcapMax * 1e8)) continue;
        if (mainInMin !== null && !((row.mainIn ?? -Infinity) >= mainInMin * 1e4)) continue;

        out.push(row);
      }
      return out;
    }

    function sortRows(rows, key, dir) {
      const indexed = rows.map((row, index) => ({ row, index }));
      const sign = dir === 'asc' ? 1 : -1;
      indexed.sort((a, b) => {
        const av = a.row[key];
        const bv = b.row[key];
        const aNull = av === null || av === undefined;
        const bNull = bv === null || bv === undefined;
        if (aNull && bNull) return a.index - b.index;
        if (aNull) return 1;
        if (bNull) return -1;
        if (typeof av === 'number' && typeof bv === 'number') {
          if (av !== bv) return (av - bv) * sign;
          return a.index - b.index;
        }
        const cmp = String(av).localeCompare(String(bv), 'zh-CN');
        return cmp !== 0 ? cmp * sign : a.index - b.index;
      });
      return indexed.map((item) => item.row);
    }

    const COLUMNS = [
      { key: '__watch', labelKey: 'col.watch', width: 32, star: true, locked: true },
      { key: 'code', labelKey: 'col.code', width: 82 },
      { key: 'name', labelKey: 'col.name', width: 118 },
      { key: 'price', labelKey: 'col.price', width: 84, align: 'right', kind: 'price', colored: true },
      { key: 'pct', labelKey: 'col.pct', width: 88, align: 'right', kind: 'pct', colored: true },
      { key: 'amplitude', labelKey: 'col.amplitude', width: 78, align: 'right', kind: 'pctPlain' },
      { key: 'amount', labelKey: 'col.amount', width: 92, align: 'right', kind: 'money' },
      { key: 'turnover', labelKey: 'col.turnover', width: 82, align: 'right', kind: 'pctPlain' },
      { key: 'volumeRatio', labelKey: 'col.volumeRatio', width: 72, align: 'right', kind: 'num' },
      { key: 'speed', labelKey: 'col.speed', width: 76, align: 'right', kind: 'pct', colored: true },
      { key: 'pct5d', labelKey: 'col.pct5d', width: 88, align: 'right', kind: 'pct', colored: true },
      { key: 'floatMcap', labelKey: 'col.floatMcap', width: 98, align: 'right', kind: 'mcap' },
      { key: 'mainIn', labelKey: 'col.mainIn', width: 108, align: 'right', kind: 'moneySign', colored: true },
      { key: 'regionBoard', labelKey: 'col.regionBoard', width: 96 },
      { key: 'concepts', labelKey: 'col.concepts', width: 190 },
      // 防御 / 基本面：原「红利防御」面板的指标，并入榜单后每只股票都可见可排序
      { key: 'dividendYield', labelKey: 'col.dividendYield', width: 86, align: 'right', kind: 'pctPlain' },
      { key: 'dividendYears', labelKey: 'col.dividendYears', width: 86, align: 'right', kind: 'num', dividendLink: true },
      { key: 'dividendConsecutive', labelKey: 'col.dividendConsecutive', width: 96, align: 'right', kind: 'streak', dividendLink: true },
      { key: 'pb', labelKey: 'col.pb', width: 72, align: 'right', kind: 'num' },
      { key: 'pe', labelKey: 'col.pe', width: 78, align: 'right', kind: 'num' },
      { key: 'roe', labelKey: 'col.roe', width: 78, align: 'right', kind: 'pctPlain' },
      { key: 'debtRatio', labelKey: 'col.debtRatio', width: 88, align: 'right', kind: 'pctPlain' },
      { key: 'grossMargin', labelKey: 'col.grossMargin', width: 88, align: 'right', kind: 'pctPlain' },
    ];

    // 公式结果表与「全 A 榜单」用同一套列（去掉星标列），保证信息完全一致
    const FORMULA_COLUMNS = COLUMNS.filter((column) => column.star !== true).map((column) => ({ ...column }));
    // 板块资金流表
    const BOARD_COLUMNS = [
      { key: 'name', labelKey: 'boardName', width: 180 },
      { key: 'pct', labelKey: 'col.pct', width: 88, align: 'right', kind: 'pct' },
      { key: 'mainIn', labelKey: 'col.mainIn', width: 120, align: 'right', kind: 'moneySign' },
      { key: 'mainInPct', labelKey: 'flowPctCol', width: 96, align: 'right', kind: 'pctPlain' },
      { key: 'up', labelKey: 'boardUp', width: 74, align: 'right', kind: 'num' },
      { key: 'down', labelKey: 'boardDown', width: 74, align: 'right', kind: 'num' },
    ];

    const COLUMN_SETS = { list: null, scan: SCAN_COLUMNS, flow: FLOW_COLUMNS, formula: FORMULA_COLUMNS, boards: BOARD_COLUMNS };

    const PRESETS = [
      { id: 'limit-up', labelKey: 'preset.limitUp', filters: { pctMin: '9.5' }, sort: { key: 'pct', dir: 'desc' } },
      { id: 'volume-surge', labelKey: 'preset.volumeSurge', filters: { volumeRatioMin: '2', amountMin: '2' }, sort: { key: 'volumeRatio', dir: 'desc' } },
      { id: 'main-inflow', labelKey: 'preset.mainInflow', filters: { mainInMin: '5000' }, sort: { key: 'mainIn', dir: 'desc' } },
      { id: 'heavy-turnover', labelKey: 'preset.heavyTurnover', filters: { turnoverMin: '10', amountMin: '5' }, sort: { key: 'turnover', dir: 'desc' } },
      { id: 'big-cap', labelKey: 'preset.bigCap', filters: { floatMcapMin: '300', pctMin: '0' }, sort: { key: 'pct', dir: 'desc' } },
      { id: 'low-pe', labelKey: 'preset.lowPe', filters: {}, sort: { key: 'pe', dir: 'asc' } },
    ];

    // ---------------------------------------------------------------------
    // Locale
    // ---------------------------------------------------------------------

    const zh = {
      nav: '看股',
      title: '看股工作台',
      refresh: '刷新',
      refreshing: '刷新中…',
      loading: '正在拉取全 A 快照…',
      loadFailed: '加载失败',
      retry: '重试',
      dataDate: '数据日期',
      snapshotAt: '快照',
      took: '耗时',
      universe: '全A',
      matched: '命中',
      refreshHint: '手动刷新：点一次拉一次全市场快照',
      payloadHint: '数据来源：东方财富公开行情接口，仅供研究参考',
      filters: '筛选',
      reset: '重置',
      presets: '快捷选股',
      search: '代码/名称',
      pct: '涨跌幅',
      amount: '成交额≥',
      turnover: '换手率',
      volumeRatio: '量比≥',
      amplitude: '振幅≥',
      floatMcap: '流通市值',
      mainIn: '主力净流入≥',
      excludeST: '排除 ST',
      excludeStar: '排除科创',
      excludeBse: '排除北交',
      unitYi: '亿',
      unitWan: '万',
      unitPercent: '%',
      breadthUp: '涨',
      breadthDown: '跌',
      breadthFlat: '平',
      limitUp: '涨停',
      limitDown: '跌停',
      amountTotal: '两市成交额',
      mainNet: '主力净流入',
      empty: '没有符合条件的股票',
      emptyHint: '放宽筛选条件，或点「重置」回到全市场。',
      errorHint: '主源不可用时会保留上一次成功的快照。',
      listEnd: '已到列表末尾',
      col: {
        code: '代码', name: '名称', price: '最新价', pct: '涨跌幅', amplitude: '振幅',
        amount: '成交额', turnover: '换手率', volumeRatio: '量比', speed: '涨速',
        pct5d: '5日涨跌', floatMcap: '流通市值', mainIn: '主力净流入', watch: '自选',
        pe: 'PE', pb: 'PB', roe: 'ROE', debtRatio: '负债率', grossMargin: '毛利率',
        dividendYield: '股息率', dividendYears: '分红年数', dividendConsecutive: '连续分红',
      },
      crashTitle: '看股工作台渲染出错',
      crashHint: '已捕获异常，页面不会白屏。可以先点重试；如果反复出现，把下面这段报错发给我。',
      crashRetry: '重试',
      columnConfig: '列配置',
      columnConfigHint: '选择显示哪些列、固定到左侧、拖拽调整顺序',
      columnDragHint: '按住拖拽调整顺序',
      columnShow: '显示该列',
      columnHide: '隐藏该列',
      columnFreeze: '固定到左侧',
      columnUnfreeze: '取消固定',
      columnReset: '恢复默认',
      save: '保存',
      cancel: '取消',
      dividendDetail: '分红详情',
      dividendLoading: '正在读分红明细…',
      dividendFailed: '分红明细读取失败',
      dividendNoRecords: '近 10 年没有已实施的分红记录',
      dividendStreakHint: '点击「分红年数 / 连续分红」查看分红明细',
      dividendStat: {
        yield: '股息率', dps: '近12个月每股派息', years3: '近3年分红年数',
        consecutive: '连续分红', last: '最近除息日', industry: '行业',
      },
      dividendCol: {
        report: '报告期', ex: '除息日', per10: '每10股派息(元)', perShare: '每股派息(元)', plan: '方案',
      },
      dividendStreakUnit: '年',
      dividendStreakMax: '10+',
      close: '关闭',
      detailBtn: '详情',
      detailTitle: '个股详情',
      detailHint: '查看该股全部指标与估值分位',
      detailTrade: '交易数据',
      detailValuation: '估值分位（近 5 年）',
      detailValuationPe: 'PE (TTM)',
      detailValuationPb: 'PB (MRQ)',
      detailValuationPePct: 'PE 分位',
      detailValuationPbPct: 'PB 分位',
      detailValuationSample: '样本天数',
      detailValuationYears: '统计区间',
      detailValuationLoading: '正在计算估值分位…',
      detailValuationFailed: '估值分位获取失败',
      detailDays: '天',
      detailYears: '年',
      detailDividend: '分红',
      detailFundamental: '基本面',
      detailBelong: '所属板块',
      detailLastEx: '最近除息日',
      detailRevenueYoy: '营收同比',
      detailProfitYoy: '净利同比',
      detailEps: '每股收益',
      detailBvps: '每股净资产',
      detailPs: '市销率 TTM',
      watchAdd: '加入自选',
      watchRemove: '取消自选',
      watchOnly: '只看自选',
      watchGroups: '自选组',
      watchGroupAdd: '新建自选组',
      watchGroupName: '分组名',
      watchGroupRemove: '删除该组',
      watchGroupDefaultName: '新分组',
      watchEmpty: '自选池还是空的',
      watchEmptyHint: '点榜单最左边的 ☆ 把股票加进来，或双击进详情后点「加入自选」。',
      autoRefresh: '自动刷新',
      autoOff: '手动',
      auto3: '3 秒',
      auto5: '5 秒',
      auto10: '10 秒',
      exportCsv: '导出 CSV',
      tabFlow: '资金流',
      tabBoards: '板块资金流',
      boardType: '板块类型',
      boardConcept: '概念板块',
      boardIndustry: '行业板块',
      boardName: '板块',
      boardUp: '上涨',
      boardDown: '下跌',
      boardHint: '按主力净流入排序',
      boardPickHint: '点击任意板块 → 在榜单里按概念筛选成分股',
      boardCount: '个板块',
      boardFilterLabel: '板块筛选',
      boardFilterClear: '清除板块筛选',
      boardMembersLoading: '正在读取成分股…',
      'col.regionBoard': '地域板块',
      'col.concepts': '所属概念',
      flowIn: '主力净流入 TOP',
      flowPctCol: '主力净占比',
      flowOut: '主力净流出 TOP',
      flowTotal: '全市场主力净流入',
      flowInCount: '净流入家数',
      flowOutCount: '净流出家数',
      flowHint: '按东财 f62 主力净流入排序；约 15% 的股票（北交所居多）恒为 0，已视为无数据剔除',
      flowNoData: '暂无资金流数据',
      flowColMainPct: '净占比',
      preset: {
        limitUp: '涨停/接近涨停', volumeSurge: '放量异动', mainInflow: '主力抢筹',
        heavyTurnover: '高换手活跃', bigCap: '大盘走强', lowPe: '低 PE',
      },
      back: '返回榜单',
      dblClickHint: '双击任意一行查看 K 线与分时',
      chartLoading: '正在加载图表…',
      chartError: '图表加载失败',
      noChartData: '该周期暂无数据',
      period: { trends: '分时', day: '日K', week: '周K', m60: '60分', m30: '30分', m15: '15分', m5: '5分' },
      stat: { pe: '市盈率', prevClose: '昨收', volume: '成交量' },
      maLabel: '均线',
      escHint: 'Esc 返回',
      chartHint: '滚轮缩放 · 拖动平移 · 双击复位',
      moreLoading: '加载更早数据…',
      moreExhausted: '已到最早',
      moreError: '补历史失败，可重试',
      zoomIn: '放大',
      zoomOut: '缩小',
      resetZoom: '复位',
      tabList: '全 A 榜单',
      tabScan: '信号扫描',
      scanHint: '两段式：先用快照粗筛候选池，再只对候选池拉日K算信号（全市场逐个拉 K 线不现实）',
      scanSignals: '信号',
      scanWindow: '窗口',
      scanWindowToday: '今日',
      scanWindow3: '近 3 日',
      scanWindow5: '近 5 日',
      scanMinAmount: '成交额≥',
      scanLimit: '候选上限',
      scanStart: '开始扫描',
      scanRunning: '正在拉取日K并计算…',
      scanScanned: '扫描',
      scanPool: '候选池',
      scanHits: '命中',
      scanMs: '耗时',
      scanCached: '缓存',
      scanNoHit: '没有命中任何信号',
      scanNoHitHint: '换一组信号、把窗口放宽到近 3 日，或调低成交额门槛再试。',
      scanSignalCol: '命中信号',
      scanDetailCol: '触发说明',
      scanDaysAgo: '日前',
      scanFailed: '失败',
      scanIdle: '选好信号后点「开始扫描」',
      scanPeriod: '周期',
      scanPeriodDay: '日线',
      tabFormula: '公式选股',
      formulaPlaceholder: '例：量比 > 2 且 涨跌幅 between 3 and 7',
      formulaRun: '执行',
      formulaHint: '支持 且/或/not、括号、between、contains；金额字段裸数字按「亿」，也可写 5000万。全角符号、方括号、逗号分隔都能认',
      formulaBuilder: '可视化构造',
      formulaBuilderClose: '收起构造',
      formulaBuilderAdd: '＋ 加条件',
      formulaBuilderApply: '生成并执行',
      formulaBuilderClear: '清空',
      formulaBuilderHint: '点选字段 / 运算符 / 数值生成公式，比记语法快；生成后仍可在输入框里改',
      formulaBuilderYi: '亿',
      formulaBuilderUnit: '（裸数字按亿）',
      opBetween: '介于',
      opContains: '包含',
      opEq: '等于',
      opNe: '不等于',
      formulaExamples: '示例',
      formulaError: '公式有误',
      formulaEmpty: '写一条公式，回车或点「执行」',
      formulaNoMatch: '没有符合条件的股票',
      formulaMatched: '命中',
      formulaFields: '可用字段',
      formulaFavorites: '收藏夹',
      formulaFavorite: '收藏当前',
      formulaFavName: '给这条公式起个名',
      formulaSave: '保存',
      formulaCancel: '取消',
      formulaRemove: '删除',
      formulaRestoreDefault: '恢复预置',
      formulaNoFavorites: '还没有收藏，点右侧「☆ 收藏当前」或「恢复预置」',
      formulaCustomTag: '自定义',
      formulaExport: '导出',
      formulaImport: '导入',
      formulaImportResult: '导入完成：新增 {n} 条，跳过 {bad} 条（表达式不合法）',
      formulaImportFailed: '导入失败',
      formulaMoveUp: '上移',
      formulaMoveDown: '下移',
      signalPresets: '预设组合',
      signalPresetGolden: '双金叉共振',
      signalPresetBreakout: '突破放量',
      signalPresetTrend: '趋势启动',
      indicator: '指标',
    };

    const en = {
      nav: 'Stocks',
      title: 'Stock Workbench',
      refresh: 'Refresh',
      refreshing: 'Refreshing…',
      loading: 'Loading full A-share snapshot…',
      loadFailed: 'Failed to load',
      retry: 'Retry',
      dataDate: 'Data date',
      snapshotAt: 'Snapshot',
      took: 'Took',
      universe: 'Universe',
      matched: 'Matched',
      refreshHint: 'Manual refresh: one click, one full-market snapshot',
      payloadHint: 'Source: Eastmoney public quote API — research use only',
      filters: 'Filters',
      reset: 'Reset',
      presets: 'Quick screens',
      search: 'Code/name',
      pct: 'Change',
      amount: 'Turnover≥',
      turnover: 'Turnover rate',
      volumeRatio: 'Vol ratio≥',
      amplitude: 'Amplitude≥',
      floatMcap: 'Float cap',
      mainIn: 'Main inflow≥',
      excludeST: 'Excl. ST',
      excludeStar: 'Excl. STAR',
      excludeBse: 'Excl. BSE',
      unitYi: '100M',
      unitWan: '10K',
      unitPercent: '%',
      breadthUp: 'Up',
      breadthDown: 'Down',
      breadthFlat: 'Flat',
      limitUp: 'Limit up',
      limitDown: 'Limit down',
      amountTotal: 'Total turnover',
      mainNet: 'Net main inflow',
      empty: 'No stocks match',
      emptyHint: 'Loosen the filters, or press Reset for the whole market.',
      errorHint: 'The last successful snapshot is kept when the source fails.',
      listEnd: 'End of list',
      col: {
        code: 'Code', name: 'Name', price: 'Last', pct: 'Chg%', amplitude: 'Range',
        amount: 'Amount', turnover: 'Turn%', volumeRatio: 'VolR', speed: 'Speed',
        pct5d: '5D%', floatMcap: 'Float cap', mainIn: 'Main in', watch: 'Watch',
        pe: 'PE', pb: 'PB', roe: 'ROE', debtRatio: 'Debt%', grossMargin: 'Gross%',
        dividendYield: 'Div yield', dividendYears: 'Div yrs', dividendConsecutive: 'Div streak',
      },
      crashTitle: 'Stock workbench crashed',
      crashHint: 'The exception was caught instead of a blank page. Try retry; if it persists, send me the trace below.',
      crashRetry: 'Retry',
      columnConfig: 'Columns',
      columnConfigHint: 'Choose visible columns, freeze to the left, drag to reorder',
      columnDragHint: 'Drag to reorder',
      columnShow: 'Show column',
      columnHide: 'Hide column',
      columnFreeze: 'Freeze left',
      columnUnfreeze: 'Unfreeze',
      columnReset: 'Reset',
      save: 'Save',
      cancel: 'Cancel',
      dividendDetail: 'Dividend detail',
      dividendLoading: 'Loading dividend records…',
      dividendFailed: 'Failed to load dividend records',
      dividendNoRecords: 'No implemented dividend in the last 10 years',
      dividendStreakHint: 'Click "Div yrs / Div streak" for the dividend history',
      dividendStat: {
        yield: 'Yield', dps: 'DPS (TTM)', years3: 'Yrs paid (3y)',
        consecutive: 'Consecutive', last: 'Last ex-date', industry: 'Industry',
      },
      dividendCol: {
        report: 'Report', ex: 'Ex-date', per10: 'Per 10 shares', perShare: 'Per share', plan: 'Plan',
      },
      dividendStreakUnit: 'y',
      dividendStreakMax: '10+',
      close: 'Close',
      detailBtn: 'Details',
      detailTitle: 'Stock details',
      detailHint: 'All metrics plus valuation percentile',
      detailTrade: 'Trading',
      detailValuation: 'Valuation percentile (5y)',
      detailValuationPe: 'PE (TTM)',
      detailValuationPb: 'PB (MRQ)',
      detailValuationPePct: 'PE pct',
      detailValuationPbPct: 'PB pct',
      detailValuationSample: 'Sample days',
      detailValuationYears: 'Window',
      detailValuationLoading: 'Computing valuation percentile…',
      detailValuationFailed: 'Valuation percentile failed',
      detailDays: 'days',
      detailYears: 'y',
      detailDividend: 'Dividend',
      detailFundamental: 'Fundamentals',
      detailBelong: 'Classification',
      detailLastEx: 'Last ex-date',
      detailRevenueYoy: 'Revenue YoY',
      detailProfitYoy: 'Profit YoY',
      detailEps: 'EPS',
      detailBvps: 'BVPS',
      detailPs: 'PS (TTM)',
      watchAdd: 'Add to watchlist',
      watchRemove: 'Remove from watchlist',
      watchOnly: 'Watchlist only',
      watchGroups: 'Lists',
      watchGroupAdd: 'New watchlist',
      watchGroupName: 'Name',
      watchGroupRemove: 'Delete list',
      watchGroupDefaultName: 'New list',
      watchEmpty: 'Watchlist is empty',
      watchEmptyHint: 'Click the ☆ at the left of a row, or open a stock and press Add.',
      autoRefresh: 'Auto refresh',
      autoOff: 'Manual',
      auto3: '3s',
      auto5: '5s',
      auto10: '10s',
      exportCsv: 'Export CSV',
      tabFlow: 'Money flow',
      tabBoards: 'Board flow',
      boardType: 'Board type',
      boardConcept: 'Concepts',
      boardIndustry: 'Industries',
      boardName: 'Board',
      boardUp: 'Up',
      boardDown: 'Down',
      boardHint: 'Sorted by main net inflow',
      boardPickHint: 'Click a board → the list tab filters stocks of that concept',
      boardCount: 'boards',
      boardFilterLabel: 'Board',
      boardFilterClear: 'Clear board filter',
      boardMembersLoading: 'Loading constituents…',
      'col.regionBoard': 'Region',
      'col.concepts': 'Concepts',
      flowIn: 'Main inflow TOP',
      flowPctCol: 'Main net %',
      flowOut: 'Main outflow TOP',
      flowTotal: 'Market-wide net main inflow',
      flowInCount: 'Net inflow count',
      flowOutCount: 'Net outflow count',
      flowHint: 'Ranked by Eastmoney f62; ~15% of stocks (mostly BSE) always report 0 and are treated as missing',
      flowNoData: 'No money-flow data',
      flowColMainPct: 'Net%',
      preset: {
        limitUp: 'Limit-up', volumeSurge: 'Volume surge', mainInflow: 'Main inflow',
        heavyTurnover: 'High turnover', bigCap: 'Large caps', lowPe: 'Low PE',
      },
      back: 'Back to list',
      dblClickHint: 'Double-click any row for its chart',
      chartLoading: 'Loading chart…',
      chartError: 'Chart failed to load',
      noChartData: 'No data for this period',
      period: { trends: 'Intraday', day: '1D', week: '1W', m60: '60m', m30: '30m', m15: '15m', m5: '5m' },
      stat: { pe: 'P/E', prevClose: 'Prev close', volume: 'Volume' },
      maLabel: 'MA',
      escHint: 'Esc to go back',
      chartHint: 'Wheel to zoom · drag to pan · double-click to reset',
      moreLoading: 'loading earlier data…',
      moreExhausted: 'reached the earliest bar',
      moreError: 'failed to load earlier bars',
      zoomIn: 'Zoom in',
      zoomOut: 'Zoom out',
      resetZoom: 'Reset',
      tabList: 'Screener',
      tabScan: 'Signal scan',
      scanHint: 'Two-stage: narrow a candidate pool from the snapshot, then pull daily bars only for those (5500 kline requests is a non-starter).',
      scanSignals: 'Signals',
      scanWindow: 'Window',
      scanWindowToday: 'Today',
      scanWindow3: '3 days',
      scanWindow5: '5 days',
      scanMinAmount: 'Turnover≥',
      scanLimit: 'Pool cap',
      scanStart: 'Scan',
      scanRunning: 'Loading daily bars and computing…',
      scanScanned: 'Scanned',
      scanPool: 'Pool',
      scanHits: 'Hits',
      scanMs: 'Took',
      scanCached: 'cached',
      scanNoHit: 'No signal hit',
      scanNoHitHint: 'Try another signal set, widen the window to 3 days, or lower the turnover floor.',
      scanSignalCol: 'Signals',
      scanDetailCol: 'Trigger',
      scanDaysAgo: 'd ago',
      scanFailed: 'failed',
      scanIdle: 'Pick signals, then press Scan',
      scanPeriod: 'Period',
      scanPeriodDay: '1D',
      tabFormula: 'Formula',
      formulaPlaceholder: 'e.g. 量比 > 2 且 涨跌幅 between 3 and 7',
      formulaRun: 'Run',
      formulaHint: 'Supports and/or/not, parentheses, between, contains; money fields default to 100M units, 5000万 is allowed. Full-width symbols, brackets and comma separators are accepted',
      formulaBuilder: 'Builder',
      formulaBuilderClose: 'Hide builder',
      formulaBuilderAdd: '+ Condition',
      formulaBuilderApply: 'Build & run',
      formulaBuilderClear: 'Clear',
      formulaBuilderHint: 'Pick field / operator / value instead of remembering the syntax; the generated text stays editable',
      formulaBuilderYi: '100M',
      formulaBuilderUnit: ' (bare number = 100M)',
      opBetween: 'between',
      opContains: 'contains',
      opEq: 'equals',
      opNe: 'not equals',
      formulaExamples: 'Examples',
      formulaError: 'Invalid formula',
      formulaEmpty: 'Write a formula, then press Enter or Run',
      formulaNoMatch: 'No stocks match',
      formulaMatched: 'Matched',
      formulaFields: 'Fields',
      formulaFavorites: 'Saved',
      formulaFavorite: 'Save current',
      formulaFavName: 'Name this formula',
      formulaSave: 'Save',
      formulaCancel: 'Cancel',
      formulaRemove: 'Remove',
      formulaRestoreDefault: 'Restore presets',
      formulaNoFavorites: 'No saved formulas yet — press Save current or Restore presets',
      formulaCustomTag: 'custom',
      formulaExport: 'Export',
      formulaImport: 'Import',
      formulaImportResult: 'Imported {n}, skipped {bad} (invalid expressions)',
      formulaImportFailed: 'Import failed',
      formulaMoveUp: 'Move up',
      formulaMoveDown: 'Move down',
      signalPresets: 'Cocktails',
      signalPresetGolden: 'Double golden cross',
      signalPresetBreakout: 'Breakout + volume',
      signalPresetTrend: 'Trend kickoff',
      indicator: 'Indicator',
    };

    // ---------------------------------------------------------------------
    // Styling (component-local <style>; removed on unmount)
    // ---------------------------------------------------------------------

    const STYLES = `
.sw-page{box-sizing:border-box;height:100%;min-height:0;display:flex;flex-direction:column;  padding:calc(28px + var(--dsh-frame-top-clearance,0px)) 16px 10px;gap:10px;
  background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#1f2328);
  font-size:13px;line-height:1.45;-webkit-font-smoothing:antialiased}
/* 工作台与详情页叠放：详情打开时工作台不卸载，返回时滚动位置与面板状态都还在 */
.sw-host{position:relative;height:100%;min-height:0;display:flex;flex-direction:column}
.sw-layer{flex:1;min-height:0;display:flex;flex-direction:column}
.sw-layerHidden{position:absolute;inset:0;flex:none;visibility:hidden;pointer-events:none}
.sw-layerTop{position:absolute;inset:0;z-index:3;background:var(--dsw-alias-bg-base,#fff)}
.sw-up{color:#e5484d}
.sw-down{color:#12a150}
.sw-flat{color:var(--dsw-alias-label-secondary,#6b7280)}
.sw-head{display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap;flex:none}
.sw-title{font-size:17px;font-weight:650;margin:0;letter-spacing:.01em}
.sw-meta{display:flex;align-items:center;gap:14px;flex-wrap:wrap;color:var(--dsw-alias-label-secondary,#6b7280);font-size:12px}
.sw-meta b{color:var(--dsw-alias-label-primary,#1f2328);font-weight:600;font-variant-numeric:tabular-nums}
.sw-headActions{margin-left:auto;display:flex;align-items:center;gap:8px}
.sw-btn{font:inherit;cursor:pointer;border-radius:8px;padding:6px 14px;display:inline-flex;align-items:center;gap:6px;
  border:.5px solid var(--dsw-alias-border-l2,#e5e7eb);background:var(--dsw-alias-bg-layer-1,#fff);
  color:var(--dsw-alias-label-primary,#1f2328);transition:background-color .12s,border-color .12s,opacity .12s}
.sw-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2,#f3f4f6)}
.sw-btn:disabled{cursor:default;opacity:.55}
.sw-btnPrimary{background:var(--dsw-alias-brand-primary,#4f6ef7);border-color:transparent;color:#fff}
.sw-btnPrimary:hover:not(:disabled){background:var(--dsw-alias-brand-primary,#4f6ef7);opacity:.9}
.sw-btnGhost{padding:4px 10px;font-size:12px;background:transparent;border-color:transparent;
  color:var(--dsw-alias-label-secondary,#6b7280)}
.sw-btnGhost:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2,#f3f4f6);color:var(--dsw-alias-label-primary,#1f2328)}
.sw-spinner{width:11px;height:11px;border-radius:50%;border:1.5px solid currentColor;border-top-color:transparent;
  animation:sw-spin .7s linear infinite;display:inline-block}
@keyframes sw-spin{to{transform:rotate(360deg)}}
.sw-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(148px,1fr));gap:8px;flex:none}
.sw-card{border:.5px solid var(--dsw-alias-border-l1,#e5e7eb);background:var(--dsw-alias-bg-layer-1,#fff);
  border-radius:10px;padding:8px 11px;display:flex;flex-direction:column;gap:2px;min-width:0}
.sw-cardName{color:var(--dsw-alias-label-secondary,#6b7280);font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sw-cardTop{display:flex;align-items:baseline;gap:8px;min-width:0}
.sw-cardPrice{font-size:15.5px;font-weight:600;font-variant-numeric:tabular-nums}
.sw-cardPct{font-size:12px;font-variant-numeric:tabular-nums}
.sw-breadth{flex:none;display:flex;align-items:center;gap:16px;flex-wrap:wrap;
  border:.5px solid var(--dsw-alias-border-l1,#e5e7eb);background:var(--dsw-alias-bg-layer-1,#fff);
  border-radius:10px;padding:7px 12px;font-size:12px}
.sw-bar{flex:1;min-width:160px;height:6px;border-radius:99px;overflow:hidden;display:flex;background:var(--dsw-alias-border-l1,#e5e7eb)}
.sw-barUp{background:#e5484d;height:100%}
.sw-barFlat{background:#9aa3b2;height:100%}
.sw-barDown{background:#12a150;height:100%}
.sw-breadthItem{display:inline-flex;align-items:baseline;gap:5px;white-space:nowrap}
.sw-breadthItem b{font-variant-numeric:tabular-nums;font-weight:600}
.sw-filters{flex:none;display:flex;flex-direction:column;gap:8px;border:.5px solid var(--dsw-alias-border-l1,#e5e7eb);
  background:var(--dsw-alias-bg-layer-1,#fff);border-radius:10px;padding:9px 12px}
.sw-filterRow{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.sw-filterLabel{color:var(--dsw-alias-label-secondary,#6b7280);font-size:11.5px;white-space:nowrap}
.sw-field{display:inline-flex;align-items:center;gap:5px}
.sw-input{font:inherit;font-size:12px;box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l2,#e5e7eb);
  background:var(--dsw-alias-bg-layer-2,#f7f8fa);color:var(--dsw-alias-label-primary,#1f2328);
  border-radius:7px;padding:4px 7px;min-width:0;outline:none;font-variant-numeric:tabular-nums}
.sw-input:focus{border-color:var(--dsw-alias-brand-primary,#4f6ef7);
  box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary,#4f6ef7) 16%,transparent)}
.sw-input::placeholder{color:var(--dsw-alias-label-tertiary,#9aa3b2)}
.sw-check{display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--dsw-alias-label-secondary,#6b7280);
  cursor:pointer;user-select:none;white-space:nowrap}
.sw-check input{accent-color:var(--dsw-alias-brand-primary,#4f6ef7);margin:0;cursor:pointer}
.sw-sep{color:var(--dsw-alias-label-tertiary,#9aa3b2);font-size:11px}
.sw-chips{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.sw-chip{font:inherit;font-size:12px;cursor:pointer;border-radius:99px;padding:3px 11px;
  border:.5px solid var(--dsw-alias-border-l2,#e5e7eb);background:transparent;
  color:var(--dsw-alias-label-secondary,#6b7280);transition:all .12s ease}
.sw-chip:hover{border-color:var(--dsw-alias-brand-primary,#4f6ef7);color:var(--dsw-alias-brand-primary,#4f6ef7)}
.sw-chipOn{border-color:var(--dsw-alias-brand-primary,#4f6ef7);color:var(--dsw-alias-brand-primary,#4f6ef7);
  background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4f6ef7) 9%,transparent);font-weight:600}
.sw-banner{flex:none;border-radius:8px;padding:7px 12px;font-size:12px;display:flex;align-items:center;gap:10px}
.sw-bannerError{background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#dc2626) 9%,transparent);
  color:var(--dsw-alias-state-error-primary,#dc2626);border:.5px solid color-mix(in srgb,var(--dsw-alias-state-error-primary,#dc2626) 28%,transparent)}
.sw-bannerWarn{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#b45309) 9%,transparent);
  color:var(--dsw-alias-state-warn-primary,#b45309);border:.5px solid color-mix(in srgb,var(--dsw-alias-state-warn-primary,#b45309) 24%,transparent)}
.sw-crash{padding:24px;display:flex;flex-direction:column;gap:10px;font-size:13px;
  color:var(--dsw-alias-label-primary,#1f2328)}
.sw-crash h3{margin:0;font-size:14px;color:var(--dsw-alias-state-error-primary,#dc2626)}
.sw-crashHint{margin:0;color:var(--dsw-alias-label-secondary,#6b7280);font-size:12px}
.sw-crashStack{margin:0;max-height:320px;overflow:auto;padding:10px;border-radius:8px;font-size:11px;
  line-height:1.5;white-space:pre-wrap;background:var(--dsw-alias-bg-layer-2,#f5f7fa);
  border:.5px solid var(--dsw-alias-border-l1,#e5e7eb)}
.sw-crash .sw-btn{align-self:flex-start}
.sw-toolRow{flex:none;display:flex;align-items:center;gap:8px;justify-content:flex-end;padding:0 2px 6px}
.sw-boardChip{display:inline-flex;align-items:center;gap:4px;border-radius:99px;padding:2px 4px 2px 9px;font-size:11.5px;color:var(--dsw-alias-brand-primary,#4f6ef7);border:.5px solid var(--dsw-alias-brand-primary,#4f6ef7);background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4f6ef7) 10%,transparent)}
.sw-boardChipDel{font:inherit;font-size:11px;cursor:pointer;border:none;background:transparent;color:inherit;padding:0 4px;border-radius:99px}
.sw-boardChipDel:hover{color:var(--dsw-alias-state-error-primary,#dc2626)}
.sw-watchBar{flex:1;min-width:0;display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-right:auto}
.sw-watchChip{display:inline-flex;align-items:center;gap:2px;border-radius:99px;font-size:11.5px;border:.5px solid var(--dsw-alias-border-l2,#e5e7eb);background:var(--dsw-alias-bg-layer-1,#fff)}
.sw-watchChipOn{border-color:var(--dsw-alias-brand-primary,#4f6ef7);background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4f6ef7) 10%,transparent)}
.sw-watchName{font:inherit;font-size:11.5px;cursor:pointer;border:none;background:transparent;padding:2px 7px;color:var(--dsw-alias-label-secondary,#6b7280);border-radius:99px}
.sw-watchChipOn .sw-watchName{color:var(--dsw-alias-brand-primary,#4f6ef7);font-weight:600}
.sw-watchDel{font:inherit;font-size:11px;cursor:pointer;border:none;background:transparent;padding:0 4px 0 0;color:var(--dsw-alias-label-tertiary,#9aa3b2)}
.sw-watchDel:hover{color:var(--dsw-alias-state-error-primary,#dc2626)}
.sw-watchAdd{font:inherit;font-size:11.5px;cursor:pointer;padding:2px 9px;color:var(--dsw-alias-label-secondary,#6b7280)}
.sw-watchAdd:hover{color:var(--dsw-alias-brand-primary,#4f6ef7);border-color:var(--dsw-alias-brand-primary,#4f6ef7)}
.sw-toolRow:empty{display:none}
.sw-gearBtn{width:24px;height:24px;padding:0;
  display:flex;align-items:center;justify-content:center;font-size:13px;line-height:1;cursor:pointer;
  border-radius:6px;color:var(--dsw-alias-label-secondary,#6b7280);
  border:.5px solid var(--dsw-alias-border-l2,#e5e7eb);background:var(--dsw-alias-bg-layer-1,#fff)}
.sw-gearBtn:hover{color:var(--dsw-alias-brand-primary,#4f6ef7);border-color:var(--dsw-alias-brand-primary,#4f6ef7)}
.sw-tableWrap{position:relative;flex:1;min-height:0;display:flex;flex-direction:column;border:.5px solid var(--dsw-alias-border-l1,#e5e7eb);
  background:var(--dsw-alias-bg-layer-1,#fff);border-radius:10px;overflow:hidden}
.sw-scroll{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain}
.sw-thead{position:sticky;top:0;z-index:2;display:grid;background:var(--dsw-alias-bg-layer-2,#f7f8fa);
  border-bottom:.5px solid var(--dsw-alias-border-l1,#e5e7eb)}
.sw-th{font:inherit;font-size:11.5px;font-weight:600;color:var(--dsw-alias-label-secondary,#6b7280);
  background:transparent;border:none;cursor:pointer;text-align:left;padding:7px 8px;white-space:nowrap;
  display:flex;align-items:center;gap:3px;min-width:0;user-select:none}
.sw-th:hover{color:var(--dsw-alias-label-primary,#1f2328)}
.sw-thRight{justify-content:flex-end}
.sw-thOn{color:var(--dsw-alias-brand-primary,#4f6ef7)}
.sw-sort{font-size:9px;line-height:1}
.sw-tbody{position:relative}
.sw-row{position:absolute;left:0;right:0;display:grid;align-items:center;box-sizing:border-box;
  border-bottom:.5px solid var(--dsw-alias-border-l1,#f0f1f3);font-variant-numeric:tabular-nums}
.sw-row:hover{background:var(--dsw-alias-bg-layer-2,#f7f8fa)}
.sw-cell{padding:0 8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12.5px;min-width:0}
.sw-cellRight{text-align:right}
.sw-divLink{font:inherit;font-size:12.5px;cursor:pointer;border:none;background:transparent;padding:0;
  color:var(--dsw-alias-brand-primary,#4f6ef7);text-decoration:underline dotted;text-underline-offset:2px;
  font-variant-numeric:tabular-nums}
.sw-divLink:hover{text-decoration:underline}
.sw-popMask{position:absolute;inset:0;z-index:9;background:rgba(15,17,21,.38);display:flex;
  align-items:flex-start;justify-content:flex-end;padding:12px}
.sw-pop{width:min(470px,96%);max-height:88%;display:flex;flex-direction:column;border-radius:12px;overflow:hidden;
  background:var(--dsw-alias-bg-layer-1,#fff);border:.5px solid var(--dsw-alias-border-l2,#e5e7eb);
  box-shadow:0 18px 44px rgba(0,0,0,.26)}
.sw-popHead{flex:none;display:flex;align-items:center;gap:8px;padding:10px 12px;font-size:13px;font-weight:650;
  border-bottom:.5px solid var(--dsw-alias-border-l1,#e5e7eb)}
.sw-popBody{flex:1;min-height:0;overflow:auto;padding:10px 12px;display:flex;flex-direction:column;gap:10px}
.sw-popGroup{display:flex;flex-direction:column;gap:5px}
.sw-popTitle{font-size:11.5px;font-weight:600;color:var(--dsw-alias-label-secondary,#6b7280)}
.sw-kvGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px 14px}
.sw-kv{display:flex;align-items:baseline;justify-content:space-between;gap:8px;font-size:12px;padding:2px 0;
  border-bottom:.5px dashed var(--dsw-alias-border-l1,#f0f1f3);min-width:0}
.sw-kvLabel{color:var(--dsw-alias-label-secondary,#6b7280);white-space:nowrap;flex:none}
.sw-kvValue{color:var(--dsw-alias-label-primary,#1f2328);font-variant-numeric:tabular-nums;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.sw-cheap{color:#16a34a !important}
.sw-expensive{color:#dc2626 !important}
.sw-popHint{font-size:12px;color:var(--dsw-alias-label-secondary,#6b7280);display:flex;align-items:center;gap:6px}
.sw-modalMask{position:absolute;inset:0;z-index:8;background:rgba(15,17,21,.42);display:flex;
  align-items:center;justify-content:center;padding:24px}
.sw-modal{width:min(780px,94%);max-height:82%;display:flex;flex-direction:column;border-radius:12px;overflow:hidden;
  background:var(--dsw-alias-bg-layer-1,#fff);border:.5px solid var(--dsw-alias-border-l2,#e5e7eb);
  box-shadow:0 20px 50px rgba(0,0,0,.28)}
.sw-colModal{width:min(420px,92%)}
.sw-colList{flex:1;min-height:0;overflow:auto;padding:8px 6px}
.sw-colRow{display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:7px;font-size:13px;
  color:var(--dsw-alias-label-primary,#1f2328);cursor:default}
.sw-colRow:hover{background:var(--dsw-alias-bg-layer-2,#f5f7fa)}
.sw-colRowOff{opacity:.5}
.sw-colRowOver{box-shadow:inset 0 2px 0 var(--dsw-alias-brand-primary,#4f6ef7)}
.sw-colHandle{color:var(--dsw-alias-label-tertiary,#b6bdc9);cursor:grab;font-size:12px;letter-spacing:-2px;
  user-select:none;flex:none}
.sw-colCheck{width:15px;height:15px;accent-color:var(--dsw-alias-brand-primary,#4f6ef7);flex:none;cursor:pointer}
.sw-colName{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sw-colStar{font:inherit;font-size:14px;line-height:1;cursor:pointer;border:none;background:transparent;
  color:var(--dsw-alias-label-tertiary,#b6bdc9);padding:2px 4px;border-radius:6px}
.sw-colStar:hover{color:var(--dsw-alias-brand-primary,#4f6ef7)}
.sw-colStarOn{color:#e8b339}
.sw-colFoot{flex:none;display:flex;align-items:center;gap:8px;padding:10px 14px;
  border-top:.5px solid var(--dsw-alias-border-l1,#e5e7eb)}
.sw-thFrozen,.sw-cellFrozen{background:var(--dsw-alias-bg-layer-1,#fff)}
.sw-thFrozen{z-index:3}
.sw-cellFrozen{box-shadow:1px 0 0 var(--dsw-alias-border-l1,#eef0f3)}
.sw-modalHead{flex:none;display:flex;align-items:center;gap:8px;padding:11px 14px;font-size:13px;font-weight:650;
  border-bottom:.5px solid var(--dsw-alias-border-l1,#e5e7eb)}
.sw-modalBody{flex:1;min-height:0;overflow:auto;padding:12px 14px;display:flex;flex-direction:column;gap:10px;font-size:12.5px}
.sw-divStats{display:flex;align-items:center;gap:16px;flex-wrap:wrap;font-size:11.5px;
  color:var(--dsw-alias-label-secondary,#6b7280);background:var(--dsw-alias-bg-layer-2,#f7f8fa);
  border-radius:8px;padding:8px 10px}
.sw-divStats b{color:var(--dsw-alias-label-primary,#1f2328);font-variant-numeric:tabular-nums}
.sw-divTable{border:.5px solid var(--dsw-alias-border-l1,#e5e7eb);border-radius:8px;overflow:hidden}
.sw-divHead,.sw-divRow{display:grid;grid-template-columns:110px 110px 132px 132px minmax(180px,1fr);
  align-items:center;gap:6px;padding:6px 10px}
.sw-divHead{background:var(--dsw-alias-bg-layer-2,#f7f8fa);font-size:11px;font-weight:600;
  color:var(--dsw-alias-label-secondary,#6b7280);border-bottom:.5px solid var(--dsw-alias-border-l1,#e5e7eb)}
.sw-divRow{border-bottom:.5px solid var(--dsw-alias-border-l1,#f0f1f3);font-size:12px;
  font-variant-numeric:tabular-nums}
.sw-divRow:last-child{border-bottom:none}
.sw-divPlan{color:var(--dsw-alias-label-secondary,#6b7280);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sw-code{color:var(--dsw-alias-label-secondary,#6b7280);font-family:var(--ds-font-family-code,ui-monospace,Menlo,Consolas,monospace);font-size:12px}
.sw-name{display:flex;align-items:center;gap:5px;min-width:0}
.sw-nameText{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sw-tag{font-size:9.5px;line-height:13px;padding:0 4px;border-radius:4px;flex:none;font-weight:600;
  background:var(--dsw-alias-bg-layer-2,#eef0f4);color:var(--dsw-alias-label-tertiary,#8b93a1)}
.sw-foot{flex:none;display:flex;align-items:center;gap:12px;flex-wrap:wrap;color:var(--dsw-alias-label-secondary,#6b7280);font-size:11.5px}
.sw-foot b{color:var(--dsw-alias-label-primary,#1f2328);font-variant-numeric:tabular-nums}
.sw-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;
  color:var(--dsw-alias-label-secondary,#6b7280);font-size:13px;padding:40px}
.sw-empty h3{font-size:14px;font-weight:600;margin:0;color:var(--dsw-alias-label-primary,#1f2328)}
.sw-loading{flex:1;display:flex;align-items:center;justify-content:center;gap:10px;
  color:var(--dsw-alias-label-secondary,#6b7280);font-size:13px}
.sw-rowPick{cursor:pointer}
.sw-detailHead{flex:none;display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.sw-backBtn{font:inherit;font-size:12.5px;cursor:pointer;border-radius:8px;padding:5px 11px;display:inline-flex;
  align-items:center;gap:6px;border:.5px solid var(--dsw-alias-border-l2,#e5e7eb);
  background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#1f2328)}
.sw-backBtn:hover{background:var(--dsw-alias-bg-layer-2,#f3f4f6)}
.sw-detailTitle{display:flex;align-items:baseline;gap:8px;min-width:0}
.sw-detailName{font-size:17px;font-weight:650;margin:0;white-space:nowrap}
.sw-detailCode{font-family:var(--ds-font-family-code,ui-monospace,Menlo,Consolas,monospace);
  color:var(--dsw-alias-label-secondary,#6b7280);font-size:12.5px}
.sw-detailPrice{font-size:22px;font-weight:650;font-variant-numeric:tabular-nums;line-height:1.1}
.sw-detailPct{font-size:13.5px;font-variant-numeric:tabular-nums}
.sw-stats{display:flex;align-items:center;gap:16px;flex-wrap:wrap;font-size:11.5px;
  color:var(--dsw-alias-label-secondary,#6b7280);margin-left:auto}
.sw-stat{display:inline-flex;align-items:baseline;gap:5px;white-space:nowrap}
.sw-stat b{color:var(--dsw-alias-label-primary,#1f2328);font-variant-numeric:tabular-nums;font-weight:600;font-size:12px}
.sw-periods{flex:none;display:flex;align-items:center;gap:4px;flex-wrap:wrap}
.sw-period{font:inherit;font-size:12px;cursor:pointer;border-radius:7px;padding:4px 11px;
  border:.5px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary,#6b7280)}
.sw-period:hover{background:var(--dsw-alias-bg-layer-2,#f3f4f6);color:var(--dsw-alias-label-primary,#1f2328)}
.sw-periodOn{background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4f6ef7) 10%,transparent);
  color:var(--dsw-alias-brand-primary,#4f6ef7);font-weight:600}
.sw-chartBox{flex:1;min-height:0;position:relative;border:.5px solid var(--dsw-alias-border-l1,#e5e7eb);
  background:var(--dsw-alias-bg-layer-1,#fff);border-radius:10px;overflow:hidden}
.sw-chartEmpty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:8px;
  color:var(--dsw-alias-label-secondary,#6b7280);font-size:13px}
.sw-tip{position:absolute;z-index:5;pointer-events:none;min-width:132px;
  background:var(--dsw-alias-bg-overlay,#fff);color:var(--dsw-alias-label-primary,#1f2328);
  border:.5px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:8px;padding:7px 9px;font-size:11.5px;
  line-height:1.55;box-shadow:0 8px 24px rgba(0,0,0,.18);font-variant-numeric:tabular-nums}
.sw-tipTitle{font-weight:600;margin-bottom:2px;color:var(--dsw-alias-label-primary,#1f2328)}
.sw-tipRow{display:flex;justify-content:space-between;gap:12px;white-space:nowrap;
  color:var(--dsw-alias-label-secondary,#5c6570)}
.sw-tipRow span:last-child{color:var(--dsw-alias-label-primary,#1f2328);font-variant-numeric:tabular-nums}
.sw-legend{display:flex;align-items:center;gap:12px;font-size:11px;color:var(--dsw-alias-label-secondary,#6b7280)}
.sw-legendItem{display:inline-flex;align-items:center;gap:4px}
.sw-legendDot{width:7px;height:7px;border-radius:2px;display:inline-block}
.sw-legendHint{color:var(--dsw-alias-label-tertiary,#9aa3b2);font-size:11px;white-space:nowrap}
.sw-chartCtl{position:absolute;top:8px;right:70px;z-index:4;display:flex;gap:4px}
.sw-chartBtn{font:inherit;font-size:12px;line-height:1;cursor:pointer;min-width:24px;height:22px;padding:0 6px;
  display:inline-flex;align-items:center;justify-content:center;border-radius:6px;
  border:.5px solid var(--dsw-alias-border-l2,#e5e7eb);
  background:color-mix(in srgb,var(--dsw-alias-bg-layer-1,#fff) 86%,transparent);
  color:var(--dsw-alias-label-secondary,#6b7280)}
.sw-chartBtn:hover{background:var(--dsw-alias-bg-layer-2,#f3f4f6);color:var(--dsw-alias-label-primary,#1f2328)}
.sw-chartRange{position:absolute;left:10px;bottom:5px;font-size:10.5px;pointer-events:none;
  color:var(--dsw-alias-label-tertiary,#9aa3b2);font-variant-numeric:tabular-nums}
.sw-chartBox svg{cursor:grab}
.sw-chartBox svg:active{cursor:grabbing}
.sw-tabs{display:flex;align-items:center;gap:2px;border-radius:9px;padding:2px;
  background:var(--dsw-alias-bg-layer-2,#f3f4f6);flex:none}
.sw-tab{font:inherit;font-size:12.5px;cursor:pointer;border:none;border-radius:7px;padding:5px 12px;
  background:transparent;color:var(--dsw-alias-label-secondary,#6b7280);white-space:nowrap}
.sw-tab:hover{color:var(--dsw-alias-label-primary,#1f2328)}
.sw-tabOn{background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#1f2328);
  font-weight:600;box-shadow:0 0 0 .5px var(--dsw-alias-border-l2,#e5e7eb)}
.sw-scan{flex:1;min-height:0;display:flex;flex-direction:column;gap:8px;
  border:.5px solid var(--dsw-alias-border-l1,#e5e7eb);background:var(--dsw-alias-bg-layer-1,#fff);
  border-radius:10px;padding:10px 12px;overflow:hidden}
.sw-scanBar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;flex:none}
.sw-scanChips{display:flex;align-items:center;gap:5px;flex-wrap:wrap}
.sw-scanHint{flex:none;font-size:11px;color:var(--dsw-alias-label-tertiary,#9aa3b2)}
.sw-scanStats{flex:none;display:flex;align-items:center;gap:14px;flex-wrap:wrap;font-size:11.5px;
  color:var(--dsw-alias-label-secondary,#6b7280);border-top:.5px solid var(--dsw-alias-border-l1,#eef0f4);padding-top:7px}
.sw-scanStats b{color:var(--dsw-alias-label-primary,#1f2328);font-variant-numeric:tabular-nums}
.sw-scanTable{position:relative;flex:1;min-height:0;overflow:auto;margin:0 -4px}
.sw-resHead{position:sticky;top:0;z-index:2;display:grid;align-items:center;padding:0;
  background:var(--dsw-alias-bg-layer-2,#f7f8fa);border-bottom:.5px solid var(--dsw-alias-border-l1,#e5e7eb);
  font-size:11.5px;font-weight:600;color:var(--dsw-alias-label-secondary,#6b7280);min-width:max-content}
.sw-resTh{font:inherit;font-weight:600;font-size:11.5px;color:inherit;text-align:left;cursor:pointer;
  border:none;background:transparent;padding:7px 8px;min-width:0;overflow:hidden;text-overflow:ellipsis;
  white-space:nowrap;display:flex;align-items:center;gap:3px}
.sw-resThRight{justify-content:flex-end}
.sw-resThOn{color:var(--dsw-alias-brand-primary,#4f6ef7)}
.sw-resRow{display:grid;align-items:center;height:32px;padding:0;cursor:pointer;
  border-bottom:.5px solid var(--dsw-alias-border-l1,#f0f1f3);font-size:12.5px;font-variant-numeric:tabular-nums}
.sw-resRow:hover{background:var(--dsw-alias-bg-layer-2,#f7f8fa)}
.sw-resCell{padding:0 8px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sw-resCellRight{text-align:right}
.sw-flowCompact{height:28px}
.sw-scanHead{position:sticky;top:0;z-index:2;display:grid;align-items:center;background:var(--dsw-alias-bg-layer-2,#f7f8fa);
  border-bottom:.5px solid var(--dsw-alias-border-l1,#e5e7eb);font-size:11.5px;font-weight:600;
  color:var(--dsw-alias-label-secondary,#6b7280);padding:6px 4px}
.sw-scanHead>span{padding:0 8px;white-space:nowrap}
.sw-scanRow{display:grid;align-items:center;height:32px;border-bottom:.5px solid var(--dsw-alias-border-l1,#f0f1f3);
  font-size:12.5px;font-variant-numeric:tabular-nums;cursor:pointer;padding:0 4px}
.sw-scanRow:hover{background:var(--dsw-alias-bg-layer-2,#f7f8fa)}
.sw-scanRow>div{padding:0 8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sw-signalTags{display:flex;align-items:center;gap:4px;overflow:hidden}
.sw-signalTag{font-size:10.5px;line-height:15px;padding:0 5px;border-radius:4px;flex:none;font-weight:600;
  background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4f6ef7) 12%,transparent);
  color:var(--dsw-alias-brand-primary,#4f6ef7)}
.sw-scanDetail{color:var(--dsw-alias-label-secondary,#6b7280);font-size:11.5px}
.sw-scanEmpty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;
  color:var(--dsw-alias-label-secondary,#6b7280);font-size:12.5px;padding:24px}
.sw-scanEmpty h3{font-size:13.5px;font-weight:600;margin:0;color:var(--dsw-alias-label-primary,#1f2328)}
.sw-star{font:inherit;font-size:13px;line-height:1;cursor:pointer;background:transparent;border:none;padding:0;
  color:var(--dsw-alias-label-tertiary,#c8ccd4);width:20px;height:20px;display:inline-flex;
  align-items:center;justify-content:center;border-radius:5px}
.sw-star:hover{color:#e8b339}
.sw-starOn{color:#e8b339}
.sw-select{font:inherit;font-size:12px;border-radius:7px;padding:4px 6px;cursor:pointer;outline:none;
  border:.5px solid var(--dsw-alias-border-l2,#e5e7eb);background:var(--dsw-alias-bg-layer-1,#fff);
  color:var(--dsw-alias-label-primary,#1f2328)}
.sw-select:focus{border-color:var(--dsw-alias-brand-primary,#4f6ef7)}
.sw-flow{position:relative;flex:1;min-height:0;display:flex;flex-direction:column;gap:8px;overflow:hidden}
.sw-flowStats{flex:none;display:flex;align-items:center;gap:16px;flex-wrap:wrap;font-size:11.5px;
  color:var(--dsw-alias-label-secondary,#6b7280);border:.5px solid var(--dsw-alias-border-l1,#e5e7eb);
  background:var(--dsw-alias-bg-layer-1,#fff);border-radius:10px;padding:7px 12px}
.sw-flowStats b{color:var(--dsw-alias-label-primary,#1f2328);font-variant-numeric:tabular-nums}
.sw-flowCols{flex:1;min-height:0;display:flex;gap:8px}
.sw-flowCol{flex:1;min-width:0;display:flex;flex-direction:column;
  border:.5px solid var(--dsw-alias-border-l1,#e5e7eb);background:var(--dsw-alias-bg-layer-1,#fff);
  border-radius:10px;overflow:hidden}
.sw-flowHead{flex:none;display:flex;align-items:center;gap:8px;padding:7px 10px;font-size:12px;font-weight:600;
  border-bottom:.5px solid var(--dsw-alias-border-l1,#e5e7eb);background:var(--dsw-alias-bg-layer-2,#f7f8fa)}
.sw-flowBody{flex:1;min-height:0;overflow:auto}
.sw-flowRow{display:grid;grid-template-columns:84px minmax(0,1fr) 92px 66px 74px;align-items:center;height:28px;
  padding:0 10px;border-bottom:.5px solid var(--dsw-alias-border-l1,#f0f1f3);font-size:12px;
  font-variant-numeric:tabular-nums;cursor:pointer}
.sw-flowRow:hover{background:var(--dsw-alias-bg-layer-2,#f7f8fa)}
.sw-flowRow>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sw-flowRow .sw-num{text-align:right}
.sw-slider{flex:none;border:.5px solid var(--dsw-alias-border-l1,#e5e7eb);
  background:var(--dsw-alias-bg-layer-1,#fff);border-radius:8px;overflow:hidden}
.sw-formulaInput{flex:1;min-width:220px;font-size:12.5px;padding:6px 10px;border-radius:8px;
  background:var(--dsw-alias-bg-layer-2,#f7f8fa);
  font-family:var(--ds-font-family-code,ui-monospace,Menlo,Consolas,monospace)}
.sw-formulaCaret{font-family:var(--ds-font-family-code,ui-monospace,Menlo,Consolas,monospace);font-size:11.5px;
  white-space:pre;background:var(--dsw-alias-bg-layer-2,#f7f8fa);border-radius:6px;
  padding:8px 10px;margin:4px 0 0;max-width:100%;overflow-x:auto;color:var(--dsw-alias-label-secondary,#5c6570)}
.sw-favList{display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0}
.sw-favChip{display:inline-flex;align-items:center;border-radius:99px;
  border:.5px solid var(--dsw-alias-border-l2,#e5e7eb);background:var(--dsw-alias-bg-layer-2,#f7f8fa);overflow:hidden}
.sw-favChip:hover{border-color:var(--dsw-alias-brand-primary,#4f6ef7)}
.sw-favApply{font:inherit;font-size:12px;cursor:pointer;border:none;background:transparent;padding:3px 4px 3px 11px;
  color:var(--dsw-alias-label-primary,#1f2328);display:inline-flex;align-items:center;gap:5px;max-width:220px}
.sw-favApply:hover{color:var(--dsw-alias-brand-primary,#4f6ef7)}
.sw-favName{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sw-favCustom{font-size:9.5px;line-height:13px;padding:0 4px;border-radius:4px;flex:none;
  background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4f6ef7) 14%,transparent);
  color:var(--dsw-alias-brand-primary,#4f6ef7)}
.sw-favDel{font:inherit;font-size:13px;line-height:1;cursor:pointer;border:none;background:transparent;
  color:var(--dsw-alias-label-tertiary,#9aa3b2);padding:3px 7px 3px 5px}
.sw-favDel:hover{color:var(--dsw-alias-state-error-primary,#dc2626)}
.sw-favMove{font:inherit;font-size:10px;line-height:1;cursor:pointer;border:none;background:transparent;
  color:var(--dsw-alias-label-tertiary,#9aa3b2);padding:3px 2px;opacity:0;transition:opacity .12s}
.sw-favChip:hover .sw-favMove{opacity:1}
.sw-favMove:hover{color:var(--dsw-alias-brand-primary,#4f6ef7)}
.sw-favMove:disabled{opacity:0!important;cursor:default}
.sw-importNote{flex:none;font-size:11.5px;color:var(--dsw-alias-label-secondary,#6b7280)}
.sw-scan{position:relative}
.sw-favDrawer{position:absolute;top:42px;right:8px;bottom:8px;width:330px;max-width:88%;z-index:6;
  display:flex;flex-direction:column;border-radius:10px;overflow:hidden;
  background:var(--dsw-alias-bg-layer-1,#fff);border:.5px solid var(--dsw-alias-border-l2,#e5e7eb);
  box-shadow:0 10px 30px rgba(0,0,0,.18)}
.sw-favHead{flex:none;display:flex;align-items:center;gap:8px;padding:9px 12px;font-size:12.5px;font-weight:600;
  border-bottom:.5px solid var(--dsw-alias-border-l1,#e5e7eb)}
.sw-favBody{flex:1;min-height:0;overflow:auto;padding:6px}
.sw-favItem{display:flex;align-items:center;gap:4px;border-radius:8px;padding:2px;margin-bottom:2px}
.sw-favItem:hover{background:var(--dsw-alias-bg-layer-2,#f5f7fa)}
.sw-favItemOn{background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4f6ef7) 9%,transparent)}
.sw-favInfo{font:inherit;flex:1;min-width:0;text-align:left;cursor:pointer;border:none;background:transparent;
  padding:6px 8px;display:flex;flex-direction:column;gap:2px;border-radius:6px}
.sw-favItemName{font-size:12.5px;font-weight:600;color:var(--dsw-alias-label-primary,#1f2328);
  display:flex;align-items:center;gap:5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sw-favItemExpr{font-size:11px;color:var(--dsw-alias-label-secondary,#6b7280);overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap}
.sw-favItemActions{display:flex;align-items:center;flex:none}
.sw-favFoot{flex:none;display:flex;align-items:center;gap:6px;padding:8px 10px;
  border-top:.5px solid var(--dsw-alias-border-l1,#e5e7eb);flex-wrap:wrap}
.sw-builder{flex:none;display:flex;flex-direction:column;gap:6px;padding:8px 10px;border-radius:8px;
  border:.5px solid var(--dsw-alias-border-l1,#e5e7eb);background:var(--dsw-alias-bg-layer-2,#f7f8fa)}
.sw-builderRows{display:flex;flex-direction:column;gap:6px}
.sw-builderRow{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.sw-builderHint{font-size:11px;color:var(--dsw-alias-label-tertiary,#9aa3b2)}
.sw-selectSm{font:inherit;font-size:12px;border-radius:6px;padding:3px 5px;cursor:pointer;outline:none;max-width:170px;
  border:.5px solid var(--dsw-alias-border-l2,#e5e7eb);background:var(--dsw-alias-bg-layer-1,#fff);
  color:var(--dsw-alias-label-primary,#1f2328)}
.sw-inputSm{font:inherit;font-size:12px;box-sizing:border-box;width:86px;border-radius:6px;padding:3px 7px;outline:none;
  border:.5px solid var(--dsw-alias-border-l2,#e5e7eb);background:var(--dsw-alias-bg-layer-1,#fff);
  color:var(--dsw-alias-label-primary,#1f2328);font-variant-numeric:tabular-nums}
.sw-inputSm:focus{border-color:var(--dsw-alias-brand-primary,#4f6ef7)}
`;

    // ---------------------------------------------------------------------
    // Small pieces
    // ---------------------------------------------------------------------

    function useT(ctx) {
      const [tick, setTick] = React.useState(0);
      React.useEffect(() => {
        if (typeof ctx?.locale?.subscribe !== 'function') return undefined;
        return ctx.locale.subscribe(() => setTick((n) => n + 1));
      }, [ctx, tick]);
      return ctx && typeof ctx.locale?.bind === 'function' ? ctx.locale.bind(NS) : (key) => key;
    }

    function apiUrl(path) {
      const rel = String(path).replace(/^\/+/, '');
      if (typeof document === 'undefined' || !document.baseURI) return `/${rel}`;
      const url = new URL(rel, document.baseURI);
      // 必须带上 search：pathname 会把 `?secid=..&klt=..` 整段丢掉，
      // 服务端就只收到一个没有参数的路由。
      return url.pathname + url.search;
    }

    function pctClass(v) {
      if (!isNum(v) || v === 0) return 'sw-flat';
      return v > 0 ? 'sw-up' : 'sw-down';
    }

    function WorkbenchIcon({ size = 16 }) {
      const s = Number(size) || 16;
      return h('svg', {
        width: s,
        height: s,
        viewBox: '0 0 16 16',
        fill: 'none',
        xmlns: 'http://www.w3.org/2000/svg',
        'aria-hidden': 'true',
        style: { display: 'block' },
      },
      h('rect', { x: 1.4, y: 1.4, width: 13.2, height: 13.2, rx: 3.6, stroke: 'currentColor', strokeWidth: 1.1, opacity: 0.45 }),
      h('rect', { x: 3.9, y: 6.2, width: 2.1, height: 5.6, rx: 0.6, fill: '#e5484d' }),
      h('rect', { x: 7.1, y: 4.0, width: 2.1, height: 7.8, rx: 0.6, fill: '#e5484d' }),
      h('rect', { x: 10.3, y: 8.2, width: 2.1, height: 3.6, rx: 0.6, fill: '#12a150' }));
    }

    function NumInput({ value, onChange, width, placeholder, ariaLabel }) {
      return h('input', {
        className: 'sw-input',
        type: 'text',
        inputMode: 'decimal',
        value: value ?? '',
        placeholder: placeholder ?? '',
        'aria-label': ariaLabel,
        onChange: (event) => onChange(event.target.value),
        style: { width: width ?? 54 },
      });
    }

    function Check({ label, checked, onChange }) {
      return h('label', { className: 'sw-check' },
        h('input', { type: 'checkbox', checked, onChange: (e) => onChange(e.target.checked) }),
        h('span', null, label));
    }

    function IndexCard({ item, t }) {
      return h('div', { className: 'sw-card' },
        h('div', { className: 'sw-cardName' }, item.name ?? '—'),
        h('div', { className: 'sw-cardTop' },
          h('span', { className: 'sw-cardPrice' }, fmtPrice(item.price)),
          h('span', { className: 'sw-cardPct ' + pctClass(item.pct) }, fmtPct(item.pct))));
    }

    function Breadth({ stats, breadth, t }) {
      const up = stats?.up ?? 0;
      const down = stats?.down ?? 0;
      const flat = stats?.flat ?? 0;
      const total = Math.max(1, up + down + flat);
      const amount = stats?.amount ?? 0;
      const mainIn = stats?.mainIn ?? 0;
      return h('div', { className: 'sw-breadth' },
        h('span', { className: 'sw-breadthItem sw-up' }, t('breadthUp'), ' ', h('b', null, up)),
        h('span', { className: 'sw-breadthItem sw-flat' }, t('breadthFlat'), ' ', h('b', null, flat)),
        h('span', { className: 'sw-breadthItem sw-down' }, t('breadthDown'), ' ', h('b', null, down)),
        h('div', { className: 'sw-bar', role: 'presentation' },
          h('div', { className: 'sw-barUp', style: { width: `${(up / total) * 100}%` } }),
          h('div', { className: 'sw-barFlat', style: { width: `${(flat / total) * 100}%` } }),
          h('div', { className: 'sw-barDown', style: { width: `${(down / total) * 100}%` } })),
        h('span', { className: 'sw-breadthItem sw-up' }, t('limitUp'), ' ', h('b', null, breadth?.limitUp ?? '—')),
        h('span', { className: 'sw-breadthItem sw-down' }, t('limitDown'), ' ', h('b', null, breadth?.limitDown ?? '—')),
        h('span', { className: 'sw-breadthItem' }, t('amountTotal'), ' ', h('b', null, fmtMoney(amount))),
        h('span', { className: 'sw-breadthItem' }, t('mainNet'), ' ',
          h('b', { className: pctClass(mainIn) }, fmtMoneySign(mainIn))));
    }

    function FilterPanel({ filters, setFilters, t, onReset, activePreset, onPreset, onlyWatch, onToggleOnlyWatch, watchCount, boardName, boardLoading, onClearBoard }) {
      const set = (patch) => setFilters((prev) => ({ ...prev, ...patch }));
      return h('section', { className: 'sw-filters' },
        h('div', { className: 'sw-filterRow' },
          h('span', { className: 'sw-filterLabel' }, t('presets')),
          h('div', { className: 'sw-chips' },
            h('button', {
              type: 'button',
              className: 'sw-chip' + (onlyWatch ? ' sw-chipOn' : ''),
              onClick: onToggleOnlyWatch,
              title: t('watchOnly'),
            }, `${t('watchOnly')} ${watchCount}`),
            PRESETS.map((preset) => h('button', {
              key: preset.id,
              type: 'button',
              className: 'sw-chip' + (activePreset === preset.id ? ' sw-chipOn' : ''),
              onClick: () => onPreset(preset),
            }, t(preset.labelKey)))),
          boardName
            ? h('span', { className: 'sw-boardChip' },
              h('span', null, `${t('boardFilterLabel')}：${boardName}${boardLoading ? ' …' : ''}`),
              h('button', {
                type: 'button',
                className: 'sw-boardChipDel',
                title: t('boardFilterClear'),
                onClick: onClearBoard,
              }, '×'))
            : null,
          h('button', { type: 'button', className: 'sw-btn sw-btnGhost', style: { marginLeft: 'auto' }, onClick: onReset },
            t('reset'))),

        h('div', { className: 'sw-filterRow' },
          h('span', { className: 'sw-filterLabel' }, t('search')),
          h(NumInput, {
            value: filters.search,
            onChange: (v) => set({ search: v }),
            width: 108,
            placeholder: '600000 / 银行',
            ariaLabel: t('search'),
          }),
          h('span', { className: 'sw-sep' }, '|'),
          h('span', { className: 'sw-filterLabel' }, t('pct')),
          h(NumInput, { value: filters.pctMin, onChange: (v) => set({ pctMin: v }), placeholder: 'min', ariaLabel: t('pct') + ' min' }),
          h('span', { className: 'sw-sep' }, '~'),
          h(NumInput, { value: filters.pctMax, onChange: (v) => set({ pctMax: v }), placeholder: 'max', ariaLabel: t('pct') + ' max' }),
          h('span', { className: 'sw-filterLabel' }, t('unitPercent')),
          h('span', { className: 'sw-sep' }, '|'),
          h('span', { className: 'sw-filterLabel' }, t('amount')),
          h(NumInput, { value: filters.amountMin, onChange: (v) => set({ amountMin: v }), placeholder: '1', ariaLabel: t('amount') }),
          h('span', { className: 'sw-filterLabel' }, t('unitYi')),
          h('span', { className: 'sw-sep' }, '|'),
          h('span', { className: 'sw-filterLabel' }, t('turnover')),
          h(NumInput, { value: filters.turnoverMin, onChange: (v) => set({ turnoverMin: v }), placeholder: 'min', ariaLabel: t('turnover') + ' min' }),
          h('span', { className: 'sw-sep' }, '~'),
          h(NumInput, { value: filters.turnoverMax, onChange: (v) => set({ turnoverMax: v }), placeholder: 'max', ariaLabel: t('turnover') + ' max' }),
          h('span', { className: 'sw-filterLabel' }, t('unitPercent'))),

        h('div', { className: 'sw-filterRow' },
          h('span', { className: 'sw-filterLabel' }, t('volumeRatio')),
          h(NumInput, { value: filters.volumeRatioMin, onChange: (v) => set({ volumeRatioMin: v }), placeholder: '2', ariaLabel: t('volumeRatio') }),
          h('span', { className: 'sw-sep' }, '|'),
          h('span', { className: 'sw-filterLabel' }, t('amplitude')),
          h(NumInput, { value: filters.amplitudeMin, onChange: (v) => set({ amplitudeMin: v }), placeholder: '5', ariaLabel: t('amplitude') }),
          h('span', { className: 'sw-filterLabel' }, t('unitPercent')),
          h('span', { className: 'sw-sep' }, '|'),
          h('span', { className: 'sw-filterLabel' }, t('floatMcap')),
          h(NumInput, { value: filters.floatMcapMin, onChange: (v) => set({ floatMcapMin: v }), placeholder: 'min', ariaLabel: t('floatMcap') + ' min' }),
          h('span', { className: 'sw-sep' }, '~'),
          h(NumInput, { value: filters.floatMcapMax, onChange: (v) => set({ floatMcapMax: v }), placeholder: 'max', ariaLabel: t('floatMcap') + ' max' }),
          h('span', { className: 'sw-filterLabel' }, t('unitYi')),
          h('span', { className: 'sw-sep' }, '|'),
          h('span', { className: 'sw-filterLabel' }, t('mainIn')),
          h(NumInput, { value: filters.mainInMin, onChange: (v) => set({ mainInMin: v }), width: 64, placeholder: '5000', ariaLabel: t('mainIn') }),
          h('span', { className: 'sw-filterLabel' }, t('unitWan')),
          h('span', { style: { flex: 1 } }),
          h(Check, { label: t('excludeST'), checked: filters.excludeST, onChange: (v) => set({ excludeST: v }) }),
          h(Check, { label: t('excludeStar'), checked: filters.excludeStar, onChange: (v) => set({ excludeStar: v }) }),
          h(Check, { label: t('excludeBse'), checked: filters.excludeBse, onChange: (v) => set({ excludeBse: v }) })));
    }

    // ---------------------------------------------------------------------
    // Table (fixed row height + windowing: 5.5k rows without 5.5k DOM nodes)
    // ---------------------------------------------------------------------

    const ROW_HEIGHT = 30;
    const OVERSCAN = 8;

    function useViewport(scrollRef) {
      const [viewport, setViewport] = React.useState({ top: 0, height: 480 });
      React.useEffect(() => {
        const el = scrollRef.current;
        if (!el) return undefined;
        let raf = 0;
        const measure = () => setViewport({ top: el.scrollTop, height: el.clientHeight || 480 });
        const onScroll = () => {
          if (raf) return;
          raf = requestAnimationFrame(() => {
            raf = 0;
            measure();
          });
        };
        measure();
        el.addEventListener('scroll', onScroll, { passive: true });
        let observer = null;
        if (typeof ResizeObserver === 'function') {
          observer = new ResizeObserver(measure);
          observer.observe(el);
        }
        return () => {
          if (raf) cancelAnimationFrame(raf);
          el.removeEventListener('scroll', onScroll);
          if (observer) observer.disconnect();
        };
      }, [scrollRef]);
      return viewport;
    }

    // ---------------------------------------------------------------------
    // 列配置：显示 / 固定 / 拖拽排序，按表格持久化
    // ---------------------------------------------------------------------

    const COLUMN_PREFS_KEY = 'dsh-stock-workbench:column-prefs';

    /** 读取全部 tab 的列偏好；兼容旧的「单个数组」格式（只属于榜单） */
    function loadColumnPrefsByTab() {
      const stored = readStore(COLUMN_PREFS_KEY, null);
      const sets = { ...COLUMN_SETS, list: COLUMNS };
      const out = {};
      for (const tab of Object.keys(sets)) {
        const raw = Array.isArray(stored) ? (tab === 'list' ? stored : null) : stored && stored[tab];
        out[tab] = normalizeColumnPrefs(sets[tab], raw);
      }
      return out;
    }

    /** 默认偏好：星标列锁定，其余可见、不固定 */
    function defaultColumnPrefs(columns) {
      return columns
        .filter((column) => !column.locked)
        .map((column) => ({ key: column.key, visible: column.hiddenByDefault !== true, frozen: column.frozenByDefault === true }));
    }

    /** 合并本地存储与当前列定义：丢弃已消失的列、新列追加到末尾、保持用户顺序 */
    function normalizeColumnPrefs(columns, stored) {
      const defaults = defaultColumnPrefs(columns);
      if (!Array.isArray(stored)) return defaults;
      const pending = new Map(defaults.map((item) => [item.key, item]));
      const out = [];
      for (const item of stored) {
        if (!item || typeof item.key !== 'string') continue;
        const base = pending.get(item.key);
        if (!base) continue;
        pending.delete(item.key);
        out.push({ key: item.key, visible: item.visible !== false, frozen: item.frozen === true });
      }
      for (const rest of pending.values()) out.push(rest);
      return out;
    }

    /** 把偏好套到列定义上：过滤隐藏列、按用户顺序排列、带上 frozen */
    function applyColumnPrefs(columns, prefs) {
      const byKey = new Map(columns.map((column) => [column.key, column]));
      const out = [];
      for (const pref of prefs) {
        const column = byKey.get(pref.key);
        if (!column) continue;
        if (pref.visible === false) continue;
        out.push({ ...column, frozen: column.frozen === true || (pref.frozen === true && column.star !== true) });
      }
      // 锁定列（星标）永远在最前，且默认固定
      const locked = columns.filter((column) => column.locked).map((column) => ({ ...column, frozen: true }));
      const ordered = [...locked, ...out];
      // 去重（锁定列也出现在 out 时以锁定版本为准）
      const seen = new Set();
      return ordered.filter((column) => {
        if (seen.has(column.key)) return false;
        seen.add(column.key);
        return true;
      });
    }

    function ColumnConfigDialog({ t, columns, prefs, onSave, onClose }) {
      const [draft, setDraft] = React.useState(() => prefs.map((item) => ({ ...item })));
      const dragFrom = React.useRef(-1);
      const [dragOver, setDragOver] = React.useState(-1);

      const columnOf = (key) => columns.find((column) => column.key === key);
      const labelOf = (key) => {
        const column = columnOf(key);
        return column ? t(column.labelKey) : key;
      };
      const patch = (key, next) => setDraft((prev) => prev.map((item) => (item.key === key ? { ...item, ...next } : item)));
      const move = (from, to) => {
        if (from < 0 || to < 0 || from === to) return;
        setDraft((prev) => {
          if (from >= prev.length || to >= prev.length) return prev;
          const next = prev.slice();
          const [moved] = next.splice(from, 1);
          next.splice(to, 0, moved);
          return next;
        });
      };

      return h('div', { className: 'sw-modalMask', onClick: onClose },
        h('div', {
          className: 'sw-modal sw-colModal',
          onClick: (event) => event.stopPropagation(),
          role: 'dialog',
          'aria-label': t('columnConfig'),
        },
        h('div', { className: 'sw-modalHead' },
          h('span', null, t('columnConfig')),
          h('button', {
            type: 'button',
            className: 'sw-btn sw-btnGhost',
            style: { marginLeft: 'auto' },
            title: t('close'),
            onClick: onClose,
          }, '×')),
        h('div', { className: 'sw-colList' },
          draft.map((item, index) => h('div', {
            key: item.key,
            className: 'sw-colRow'
              + (dragOver === index ? ' sw-colRowOver' : '')
              + (item.visible ? '' : ' sw-colRowOff'),
            draggable: true,
            onDragStart: () => {
              dragFrom.current = index;
            },
            onDragEnd: () => {
              dragFrom.current = -1;
              setDragOver(-1);
            },
            onDragOver: (event) => {
              event.preventDefault();
              if (dragOver !== index) setDragOver(index);
            },
            onDragLeave: () => setDragOver(-1),
            onDrop: (event) => {
              event.preventDefault();
              move(dragFrom.current, index);
              dragFrom.current = -1;
              setDragOver(-1);
            },
          },
          h('span', { className: 'sw-colHandle', title: t('columnDragHint') }, '⋮⋮'),
          h('input', {
            type: 'checkbox',
            className: 'sw-colCheck',
            checked: item.visible,
            title: item.visible ? t('columnHide') : t('columnShow'),
            onChange: (event) => patch(item.key, { visible: event.target.checked }),
          }),
          h('span', { className: 'sw-colName' }, labelOf(item.key)),
          h('button', {
            type: 'button',
            className: 'sw-colStar' + (item.frozen ? ' sw-colStarOn' : ''),
            title: item.frozen ? t('columnUnfreeze') : t('columnFreeze'),
            onClick: () => patch(item.key, { frozen: !item.frozen }),
          }, item.frozen ? '★' : '☆')))),
        h('div', { className: 'sw-colFoot' },
          h('button', {
            type: 'button',
            className: 'sw-btn sw-btnGhost',
            onClick: () => setDraft(defaultColumnPrefs(columns)),
          }, t('columnReset')),
          h('span', { style: { flex: 1 } }),
          h('button', { type: 'button', className: 'sw-btn', onClick: onClose }, t('cancel')),
          h('button', {
            type: 'button',
            className: 'sw-btn sw-btnPrimary',
            onClick: () => onSave(draft),
          }, t('save')))));
    }

    function StockTable({ rows, t, sort, onSort, onOpen, watched, onToggleWatch, onOpenDividend, columns, onConfigColumns, toolBar }) {
      const scrollRef = React.useRef(null);
      const viewport = useViewport(scrollRef);
      const activeColumns = columns && columns.length ? columns : COLUMNS;
      const grid = React.useMemo(() => activeColumns.map((col) => `${col.width}px`).join(' '), [activeColumns]);
      const minWidth = React.useMemo(() => activeColumns.reduce((sum, col) => sum + col.width, 0), [activeColumns]);
      // 固定列：靠左 sticky，offset 逐列累加
      const frozenOffsets = React.useMemo(() => {
        const offsets = new Map();
        let offset = 0;
        for (const column of activeColumns) {
          if (column.frozen) {
            offsets.set(column.key, offset);
            offset += column.width;
          }
        }
        return offsets;
      }, [activeColumns]);
      const frozenStyle = (key) => {
        const left = frozenOffsets.get(key);
        return left == null ? undefined : { position: 'sticky', left, zIndex: 2 };
      };

      const start = Math.max(0, Math.floor(viewport.top / ROW_HEIGHT) - OVERSCAN);
      const end = Math.min(rows.length, Math.ceil((viewport.top + viewport.height) / ROW_HEIGHT) + OVERSCAN);
      const visible = rows.slice(start, end);

      return h('div', { className: 'sw-tableWrap' },
        h(TableToolRow, { t, onConfigColumns, children: toolBar }),
        h('div', { className: 'sw-scroll', ref: scrollRef },
          h('div', { style: { minWidth } },
            h('div', { className: 'sw-thead', style: { gridTemplateColumns: grid } },
              activeColumns.map((col) => {
                if (col.star) {
                  return h('div', { key: col.key, className: 'sw-th sw-thFrozen', style: frozenStyle(col.key) }, '☆');
                }
                const active = sort && sort.key === col.key;
                return h('button', {
                  key: col.key,
                  type: 'button',
                  className: 'sw-th' + (col.align === 'right' ? ' sw-thRight' : '') + (active ? ' sw-thOn' : '')
                    + (col.frozen ? ' sw-thFrozen' : ''),
                  style: frozenStyle(col.key),
                  onClick: () => onSort(col.key),
                  title: t(col.labelKey),
                },
                h('span', null, t(col.labelKey)),
                active ? h('span', { className: 'sw-sort' }, sort.dir === 'asc' ? '▲' : '▼') : null);
              })),
            h('div', { className: 'sw-tbody', style: { height: rows.length * ROW_HEIGHT } },
              visible.map((row, index) => {
                const top = (start + index) * ROW_HEIGHT;
                return h('div', {
                  key: row.code,
                  className: 'sw-row sw-rowPick',
                  style: { top, height: ROW_HEIGHT, gridTemplateColumns: grid },
                  title: t('dblClickHint'),
                  onDoubleClick: () => onOpen(row),
                },
                activeColumns.map((col) => {
                  if (col.star) {
                    const active = watched && watched.has(row.code);
                    return h('div', {
                      key: col.key,
                      className: 'sw-cell sw-cellFrozen',
                      style: { display: 'flex', justifyContent: 'center', ...frozenStyle(col.key) },
                    },
                    h('button', {
                      type: 'button',
                      className: 'sw-star' + (active ? ' sw-starOn' : ''),
                      title: active ? t('watchRemove') : t('watchAdd'),
                      onClick: (event) => {
                        event.stopPropagation();
                        onToggleWatch(row.code);
                      },
                      onDoubleClick: (event) => event.stopPropagation(),
                    }, active ? '★' : '☆'));
                  }
                  if (col.key === 'name') {
                    const tag = BOARD_TAG[row.board];
                    return h('div', {
                      key: col.key,
                      className: 'sw-cell' + (col.frozen ? ' sw-cellFrozen' : ''),
                      style: frozenStyle(col.key),
                    },
                      h('div', { className: 'sw-name' },
                        h('span', { className: 'sw-nameText', title: row.name }, row.name),
                        tag ? h('span', { className: 'sw-tag' }, tag) : null));
                  }
                  const value = row[col.key];
                  const extra = col.colored ? ' ' + pctClass(value) : '';
                  const cls = 'sw-cell' + (col.align === 'right' ? ' sw-cellRight' : '')
                    + (col.key === 'code' ? ' sw-code' : '') + extra
                    + (col.frozen ? ' sw-cellFrozen' : '');
                  if (col.dividendLink) {
                    return h('div', { key: col.key, className: cls, style: frozenStyle(col.key) },
                      h('button', {
                        type: 'button',
                        className: 'sw-divLink',
                        title: t('dividendStreakHint'),
                        onClick: (event) => {
                          event.stopPropagation();
                          if (onOpenDividend) onOpenDividend(row);
                        },
                        onDoubleClick: (event) => event.stopPropagation(),
                      }, formatCell(value, col.kind)));
                  }
                  return h('div', { key: col.key, className: cls, style: frozenStyle(col.key) },
                    formatCell(value, col.kind));
                }));
              })))));
    }

    // ---------------------------------------------------------------------
    // Page
    // ---------------------------------------------------------------------

    function WorkbenchPage({ ctx }) {
      const t = useT(ctx);
      const [state, setState] = React.useState({ status: 'loading', data: null, error: null });
      const [filters, setFilters] = React.useState(EMPTY_FILTERS);
      const [sort, setSort] = React.useState(DEFAULT_SORT);
      const [activePreset, setActivePreset] = React.useState(null);
      const [selected, setSelected] = React.useState(null);
      const [dividendDetail, setDividendDetail] = React.useState(null);
      const [columnPrefsByTab, setColumnPrefsByTab] = React.useState(loadColumnPrefsByTab);
      const [configTab, setConfigTab] = React.useState(null);
      const [tab, setTab] = React.useState('list');
      const [onlyWatch, setOnlyWatch] = React.useState(false);
      const [autoSeconds, setAutoSeconds] = React.useState(() => {
        const stored = Number(readStore(AUTO_KEY, 0));
        return Number.isFinite(stored) && stored > 0 ? stored : 0;
      });
      const watch = useWatchlist();
      const seq = React.useRef(0);

      const load = React.useCallback(async (force) => {
        const mine = seq.current + 1;
        seq.current = mine;
        setState((prev) => ({
          data: prev.data,
          status: prev.data ? 'refreshing' : 'loading',
          error: null,
        }));
        try {
          const url = apiUrl(API_PATH) + (force ? '?force=1' : '');
          const response = await fetch(url, { cache: 'no-store', headers: { accept: 'application/json' } });
          let body = null;
          try {
            body = await response.json();
          } catch {
            body = null;
          }
          if (mine !== seq.current) return; // a newer refresh won
          if (!response.ok || !body || body.ok !== true) {
            throw new Error((body && body.error) || `${response.status} ${response.statusText}`);
          }
          setState({ status: 'ready', data: body.data, error: null });
        } catch (error) {
          if (mine !== seq.current) return;
          setState((prev) => ({
            data: prev.data,
            status: prev.data ? 'ready' : 'error',
            error: error instanceof Error ? error.message : String(error),
          }));
        }
      }, []);

      React.useEffect(() => {
        load(false);
      }, [load]);

      // 自动刷新：只在「榜单」tab 且没打开详情时跑，避免无意义的上游请求
      React.useEffect(() => {
        if (!autoSeconds || selected || tab !== 'list') return undefined;
        const timer = setInterval(() => {
          load(false);
        }, autoSeconds * 1000);
        return () => clearInterval(timer);
      }, [autoSeconds, selected, tab, load]);

      const changeAuto = React.useCallback((seconds) => {
        setAutoSeconds(seconds);
        writeStore(AUTO_KEY, seconds);
      }, []);

      const data = state.data;
      const rows = data?.rows ?? [];
      const meta = data?.meta ?? {};

      const filtered = React.useMemo(() => {
        const base = sortRows(applyFilters(rows, filters), sort.key, sort.dir);
        return onlyWatch ? base.filter((row) => watch.set.has(row.code)) : base;
      }, [rows, filters, sort, onlyWatch, watch.set]);

      const activeColumnsByTab = React.useMemo(() => {
        const sets = { ...COLUMN_SETS, list: COLUMNS };
        const out = {};
        for (const tab of Object.keys(sets)) {
          out[tab] = applyColumnPrefs(sets[tab], columnPrefsByTab[tab] ?? []);
        }
        return out;
      }, [columnPrefsByTab]);

      const saveColumnPrefs = React.useCallback((tab, draft) => {
        const sets = { ...COLUMN_SETS, list: COLUMNS };
        const normalized = normalizeColumnPrefs(sets[tab], draft);
        setColumnPrefsByTab((prev) => {
          const next = { ...prev, [tab]: normalized };
          writeStore(COLUMN_PREFS_KEY, next);
          return next;
        });
        setConfigTab(null);
      }, []);

      const openColumnConfig = React.useCallback((tab) => setConfigTab(tab), []);

      /** 点板块 → 拉成分股代码 → 回榜单按成员代码筛选（比按名字匹配可靠） */
      const pickBoard = React.useCallback(async (board) => {
        if (!board || !board.code) return;
        setFilters((prev) => ({ ...prev, boardCode: board.code, boardName: board.name, boardCodes: [] }));
        setTab('list');
        try {
          const response = await fetch(apiUrl(`dsh-stock/api/v1/board-members?code=${encodeURIComponent(board.code)}`), {
            headers: { accept: 'application/json' },
          });
          const body = await response.json().catch(() => null);
          if (!body || body.ok !== true) throw new Error((body && body.error) || `HTTP ${response.status}`);
          const codes = Array.isArray(body.data?.codes) ? body.data.codes : [];
          setFilters((prev) => (prev.boardCode === board.code
            ? { ...prev, boardCodes: codes }
            : prev));
        } catch (error) {
          setFilters((prev) => (prev.boardCode === board.code
            ? { ...prev, boardCode: '', boardName: '', boardCodes: null }
            : prev));
          try {
            console.warn('[dsh-stock-workbench] 板块成分股获取失败', error);
          } catch {
            /* 控制台不可用时忽略 */
          }
        }
      }, []);

      const exportCsv = React.useCallback(() => {
        if (!filtered.length) return;
        const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        downloadCsv(`A股筛选_${stamp}.csv`, buildCsv(filtered));
      }, [filtered]);

      /** 点「分红年数 / 连续分红」→ 拉该股分红明细并弹窗 */
      const dividendReq = React.useRef(0);
      const openDividend = React.useCallback(async (row) => {
        const req = dividendReq.current + 1;
        dividendReq.current = req;
        setDividendDetail({ status: 'loading', code: row.code, data: null, error: '' });
        try {
          const response = await fetch(
            apiUrl(`dsh-stock/api/v1/dividend?code=${encodeURIComponent(row.code)}`),
            { headers: { accept: 'application/json' } },
          );
          const body = await response.json().catch(() => null);
          if (!body || body.ok !== true) throw new Error((body && body.error) || `HTTP ${response.status}`);
          if (dividendReq.current !== req) return; // 用户已经关掉/换了股票
          setDividendDetail({ status: 'ready', code: row.code, data: body.data, error: '' });
        } catch (error) {
          if (dividendReq.current !== req) return;
          setDividendDetail({
            status: 'error',
            code: row.code,
            data: null,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }, []);
      const closeDividend = React.useCallback(() => {
        dividendReq.current += 1; // 作废进行中的请求，避免关掉后又弹回来
        setDividendDetail(null);
      }, []);

      const handleSort = React.useCallback((key) => {
        setActivePreset(null);
        setSort((prev) => {
          if (prev.key === key) return { key, dir: prev.dir === 'desc' ? 'asc' : 'desc' };
          const column = COLUMNS.find((col) => col.key === key);
          const isText = key === 'code' || key === 'name';
          // 之前这里误写成 { key: 条件 ? 'desc' : 'asc' }，等于把 'desc' 当成了字段名，
          // sortRows 拿不到值 → 顺序不变，表现就是"点表头没反应"。
          return { key, dir: column && column.align === 'right' && !isText ? 'desc' : 'asc' };
        });
      }, []);

      const handlePreset = React.useCallback((preset) => {
        setActivePreset((prev) => (prev === preset.id ? null : preset.id));
        setFilters((prev) => {
          if (activePreset === preset.id) return { ...prev, ...emptyOverride(preset.filters) };
          return { ...prev, ...preset.filters };
        });
        setSort(preset.sort ?? DEFAULT_SORT);
      }, [activePreset]);

      const reset = React.useCallback(() => {
        setFilters(EMPTY_FILTERS);
        setSort(DEFAULT_SORT);
        setActivePreset(null);
      }, []);

      const busy = state.status === 'loading' || state.status === 'refreshing';
      const snapshotTime = meta.fetchedAt
        ? new Date(meta.fetchedAt).toLocaleTimeString('zh-CN', { hour12: false })
        : '—';
      const tradingDay = meta.tradingDay
        ? `${String(meta.tradingDay).slice(0, 4)}-${String(meta.tradingDay).slice(4, 6)}-${String(meta.tradingDay).slice(6, 8)}`
        : '—';

      // 注意：打开详情时**不能**直接 return 详情页 —— 那会把整个工作台卸载，
      // 榜单滚动位置、信号/公式/防御面板的筛选结果全丢。改成两层叠放：
      // 工作台始终挂载（隐藏时只是 visibility:hidden），详情盖在上面。
      const workbench = h('div', { className: 'sw-page' },
        h('style', null, STYLES),

        h('header', { className: 'sw-head' },
          h('h1', { className: 'sw-title' }, t('title')),
          h('div', { className: 'sw-tabs' },
            h('button', {
              type: 'button',
              className: 'sw-tab' + (tab === 'list' ? ' sw-tabOn' : ''),
              onClick: () => setTab('list'),
            }, t('tabList')),
            h('button', {
              type: 'button',
              className: 'sw-tab' + (tab === 'scan' ? ' sw-tabOn' : ''),
              onClick: () => setTab('scan'),
            }, t('tabScan')),
            h('button', {
              type: 'button',
              className: 'sw-tab' + (tab === 'flow' ? ' sw-tabOn' : ''),
              onClick: () => setTab('flow'),
            }, t('tabFlow')),
            h('button', {
              type: 'button',
              className: 'sw-tab' + (tab === 'boards' ? ' sw-tabOn' : ''),
              onClick: () => setTab('boards'),
            }, t('tabBoards')),
            h('button', {
              type: 'button',
              className: 'sw-tab' + (tab === 'formula' ? ' sw-tabOn' : ''),
              onClick: () => setTab('formula'),
            }, t('tabFormula'))),
          h('div', { className: 'sw-meta' },
            h('span', null, t('dataDate'), ' ', h('b', null, tradingDay)),
            h('span', null, t('snapshotAt'), ' ', h('b', null, snapshotTime)),
            h('span', null, t('universe'), ' ', h('b', null, meta.count ?? '—'), ' / ', meta.universeCount ?? '—'),
            h('span', null, t('took'), ' ', h('b', null, meta.upstreamMs != null ? `${meta.upstreamMs}ms` : '—'))),
          h('div', { className: 'sw-headActions' },
            h('label', { className: 'sw-field' },
              h('span', { className: 'sw-filterLabel' }, t('autoRefresh')),
              h('select', {
                className: 'sw-select',
                value: String(autoSeconds),
                onChange: (event) => changeAuto(Number(event.target.value)),
              }, [[0, t('autoOff')], [3, t('auto3')], [5, t('auto5')], [10, t('auto10')]]
                .map(([value, label]) => h('option', { key: value, value: String(value) }, label)))),
            h('button', {
              type: 'button',
              className: 'sw-btn',
              onClick: exportCsv,
              disabled: !filtered.length,
              title: t('exportCsv'),
            }, t('exportCsv')),
            h('button', {
              type: 'button',
              className: 'sw-btn sw-btnPrimary',
              disabled: busy,
              onClick: () => load(true),
              title: t('refreshHint'),
            },
            busy ? h('span', { className: 'sw-spinner' }) : null,
            busy ? t('refreshing') : t('refresh')))),

        state.error
          ? h('div', { className: 'sw-banner sw-bannerError' },
            h('span', null, t('loadFailed'), '：', state.error),
            h('button', { type: 'button', className: 'sw-btn sw-btnGhost', onClick: () => load(true) }, t('retry')),
            h('span', { style: { opacity: 0.75 } }, t('errorHint')))
          : null,

        data && data.meta && data.meta.stale
          ? h('div', { className: 'sw-banner sw-bannerWarn' }, t('errorHint'))
          : null,

        data
          ? h(React.Fragment, null,
            h('section', { className: 'sw-cards' },
              (data.indices ?? []).map((item) => h(IndexCard, { key: item.code, item, t }))),
            h(Breadth, { stats: data.stats, breadth: data.breadth, t }))
          : null,

        tab === 'scan'
          ? h(SignalScanPanel, { t, onOpen: setSelected, columns: activeColumnsByTab.scan, onConfigColumns: () => openColumnConfig('scan'), onOpenDividend: openDividend })
          : tab === 'flow'
              ? h(MoneyFlowPanel, { rows, t, onOpen: setSelected, columns: activeColumnsByTab.flow, onConfigColumns: () => openColumnConfig('flow') })
              : tab === 'boards'
                ? h(BoardPanel, { t, onPick: pickBoard, columns: activeColumnsByTab.boards, onConfigColumns: () => openColumnConfig('boards') })
                : tab === 'formula'
                  ? h(FormulaPanel, { t, onOpen: setSelected, columns: activeColumnsByTab.formula, onConfigColumns: () => openColumnConfig('formula'), onOpenDividend: openDividend })
                : h(React.Fragment, null,
              h(FilterPanel, {
                filters,
                setFilters,
                t,
                onReset: reset,
                activePreset,
                onPreset: handlePreset,
                onlyWatch,
                onToggleOnlyWatch: () => setOnlyWatch((prev) => !prev),
                watchCount: watch.codes.length,
                boardName: filters.boardName,
                boardLoading: Array.isArray(filters.boardCodes) && filters.boardCodes.length === 0,
                onClearBoard: () => setFilters((prev) => ({ ...prev, boardCode: '', boardName: '', boardCodes: null })),
              }),
              state.status === 'loading'
                ? h('div', { className: 'sw-loading' }, h('span', { className: 'sw-spinner' }), t('loading'))
                : state.status === 'error'
                  ? h('div', { className: 'sw-empty' }, h('h3', null, t('loadFailed')), h('span', null, state.error))
                  : filtered.length === 0
                    ? h('div', { className: 'sw-empty' },
                      h('h3', null, onlyWatch ? t('watchEmpty') : t('empty')),
                      h('span', null, onlyWatch ? t('watchEmptyHint') : t('emptyHint')),
                      h('button', {
                        type: 'button',
                        className: 'sw-btn',
                        style: { marginTop: 8 },
                        onClick: onlyWatch ? () => setOnlyWatch(false) : reset,
                      }, onlyWatch ? t('tabList') : t('reset')))
                    : h(StockTable, {
                      rows: filtered,
                      t,
                      sort,
                      onSort: handleSort,
                      onOpen: setSelected,
                      watched: watch.set,
                      onToggleWatch: watch.toggle,
                      onOpenDividend: openDividend,
                      columns: activeColumnsByTab.list,
                      onConfigColumns: () => openColumnConfig('list'),
                      toolBar: h(WatchlistBar, {
                        t,
                        groups: watch.groups,
                        active: watch.active,
                        onSwitch: watch.switchGroup,
                        onAdd: watch.addGroup,
                        onRemove: watch.removeGroup,
                      }),
                    })),

        h('footer', { className: 'sw-foot' },
          h('span', null, t('matched'), ' ', h('b', null, filtered.length),
            ' / ', t('universe'), ' ', h('b', null, meta.count ?? rows.length)),
          h('span', { style: { opacity: 0.8 } }, t('dblClickHint')),
          h('span', { style: { marginLeft: 'auto' } }, t('payloadHint'),
            data ? ` · ${t('snapshotAt')} ${snapshotTime}` : '')));

      return h('div', { className: 'sw-host' },
        h('div', { className: selected ? 'sw-layer sw-layerHidden' : 'sw-layer' }, workbench),
        selected
          ? h('div', { className: 'sw-layer sw-layerTop' },
            h(DetailPage, {
              row: selected,
              t,
              onBack: () => setSelected(null),
              watched: watch.has(selected.code),
              onToggleWatch: () => watch.toggle(selected.code),
            }))
          : null,
        configTab
          ? (() => {
            const sets = { ...COLUMN_SETS, list: COLUMNS };
            return h(ColumnConfigDialog, {
              t,
              columns: sets[configTab],
              prefs: columnPrefsByTab[configTab] ?? [],
              onSave: (draft) => saveColumnPrefs(configTab, draft),
              onClose: () => setConfigTab(null),
            });
          })()
          : null,
        dividendDetail
          ? h(DividendDetailModal, {
            state: dividendDetail,
            t,
            onClose: closeDividend,
          })
          : null);
    }

    /** Turning a preset off clears exactly the fields it set. */
    function emptyOverride(presetFilters) {
      const patch = {};
      for (const key of Object.keys(presetFilters)) patch[key] = '';
      return patch;
    }

    // ---------------------------------------------------------------------
    // 资金流专项榜（数据来自快照 f62，零额外请求）
    // ---------------------------------------------------------------------

    /** 板块资金流：概念/行业板块 TOP，点击板块回榜单筛选成分股 */
    function BoardPanel({ t, onPick, columns, onConfigColumns, initialBoards }) {
      const [type, setType] = React.useState('concept');
      const [state, setState] = React.useState(() => (
        initialBoards
          ? { status: 'ready', boards: initialBoards, error: null, meta: null }
          : { status: 'loading', boards: [], error: null, meta: null }
      ));
      const [sort, setSort] = React.useState({ key: 'mainIn', dir: 'desc' });

      React.useEffect(() => {
        if (initialBoards) return undefined;
        let alive = true;
        setState({ status: 'loading', boards: [], error: null, meta: null });
        fetch(apiUrl(`dsh-stock/api/v1/boards?type=${type}`), { headers: { accept: 'application/json' } })
          .then((response) => response.json().then((body) => ({ body, status: response.status })))
          .then(({ body, status }) => {
            if (!alive) return;
            if (!body || body.ok !== true) throw new Error((body && body.error) || `HTTP ${status}`);
            setState({ status: 'ready', boards: body.data.boards ?? [], error: null, meta: body.data });
          })
          .catch((error) => {
            if (alive) setState({ status: 'error', boards: [], error: error.message, meta: null });
          });
        return () => {
          alive = false;
        };
      }, [type, initialBoards]);

      const activeColumns = columns && columns.length ? columns : BOARD_COLUMNS;
      const grid = activeColumns.map((column) => `${column.width}px`).join(' ');
      const sorted = React.useMemo(() => {
        try {
          return sortRows(state.boards ?? [], sort.key, sort.dir);
        } catch {
          return state.boards ?? [];
        }
      }, [state.boards, sort]);

      const toggleSort = (key) => setSort((prev) => (prev.key === key
        ? { key, dir: prev.dir === 'desc' ? 'asc' : 'desc' }
        : { key, dir: 'desc' }));

      const cellOf = (column, board) => {
        switch (column.key) {
          case 'name': return board.name;
          case 'pct': return fmtPct(board.pct);
          case 'mainIn': return fmtMoneySign(board.mainIn);
          case 'mainInPct': return isNum(board.mainInPct) ? `${board.mainInPct.toFixed(2)}%` : '—';
          case 'up': return fmtNum(board.up);
          case 'down': return fmtNum(board.down);
          default: return '—';
        }
      };

      let body;
      if (state.status === 'loading') {
        body = h('div', { className: 'sw-scanEmpty' }, h('span', { className: 'sw-spinner' }), t('loading'));
      } else if (state.status === 'error') {
        body = h('div', { className: 'sw-scanEmpty' }, h('h3', null, t('chartError')), h('span', null, state.error));
      } else {
        body = h('div', { className: 'sw-scanTable' },
          h('div', { className: 'sw-resHead', style: { gridTemplateColumns: grid } },
            activeColumns.map((column) => {
              const active = sort.key === column.key;
              return h('button', {
                key: column.key,
                type: 'button',
                className: 'sw-resTh' + (column.align === 'right' ? ' sw-resThRight' : '') + (active ? ' sw-resThOn' : ''),
                onClick: () => toggleSort(column.key),
                title: t(column.labelKey),
              },
              h('span', null, t(column.labelKey)),
              active ? h('span', { className: 'sw-sort' }, sort.dir === 'asc' ? '▲' : '▼') : null);
            })),
          sorted.map((board) => h('div', {
            key: board.code,
            className: 'sw-resRow',
            style: { gridTemplateColumns: grid },
            title: `${board.name} · ${t('boardPickHint')}`,
            onClick: () => onPick({ code: board.code, name: board.name }),
          }, activeColumns.map((column) => h('div', {
            key: column.key,
            className: 'sw-resCell' + (column.align === 'right' ? ' sw-resCellRight' : '')
              + (column.key === 'mainIn' ? ' ' + pctClass(board.mainIn) : '')
              + (column.key === 'pct' ? ' ' + pctClass(board.pct) : ''),
          }, cellOf(column, board))))));
      }

      return h('section', { className: 'sw-scan' },
        h('div', { className: 'sw-scanBar' },
          h('span', { className: 'sw-filterLabel' }, t('boardType')),
          h('div', { className: 'sw-scanChips' },
            h('button', {
              type: 'button',
              className: 'sw-chip' + (type === 'concept' ? ' sw-chipOn' : ''),
              onClick: () => setType('concept'),
            }, t('boardConcept')),
            h('button', {
              type: 'button',
              className: 'sw-chip' + (type === 'industry' ? ' sw-chipOn' : ''),
              onClick: () => setType('industry'),
            }, t('boardIndustry'))),
          h('span', { className: 'sw-scanHint' }, t('boardHint')),
          h('span', { style: { flex: 1 } }),
          state.meta ? h('span', { className: 'sw-scanDetail' }, `${state.meta.boards?.length ?? sorted.length} ${t('boardCount')}`) : null,
          h(ColumnConfigGear, { t, onClick: onConfigColumns })),
        h('div', { className: 'sw-scanHint' }, t('boardPickHint')),
        body);
    }

    function MoneyFlowPanel({ rows, t, onOpen, columns, onConfigColumns }) {
      const usable = React.useMemo(
        () => rows.filter((row) => typeof row.mainIn === 'number' && row.mainIn !== 0),
        [rows],
      );
      const inflow = React.useMemo(
        () => [...usable].sort((a, b) => b.mainIn - a.mainIn).slice(0, 30),
        [usable],
      );
      const outflow = React.useMemo(
        () => [...usable].sort((a, b) => a.mainIn - b.mainIn).slice(0, 30),
        [usable],
      );
      const total = usable.reduce((sum, row) => sum + row.mainIn, 0);
      const netIn = usable.filter((row) => row.mainIn > 0).length;
      const netOut = usable.length - netIn;

      const activeColumns = columns && columns.length ? columns : FLOW_COLUMNS;
      const grid = activeColumns.map((column) => `${column.width}px`).join(' ');
      const offsets = frozenOffsetsOf(activeColumns);

      const side = (title, list) =>
        h('div', { className: 'sw-flowCol' },
          h('div', { className: 'sw-flowHead' },
            title,
            h('span', { style: { marginLeft: 'auto', fontWeight: 400, opacity: 0.7 } }, list.length)),
          h('div', { className: 'sw-resHead', style: { gridTemplateColumns: grid } },
            activeColumns.map((column) => h('span', {
              key: column.key,
              className: 'sw-resTh' + (column.align === 'right' ? ' sw-resThRight' : '')
                + (column.frozen ? ' sw-thFrozen' : ''),
              style: frozenCellStyle(offsets, column),
            }, t(column.labelKey)))),
          h('div', { className: 'sw-flowBody' },
            list.length
              ? list.map((row) => h('div', {
                key: row.code,
                className: 'sw-resRow sw-flowCompact',
                style: { gridTemplateColumns: grid },
                title: t('dblClickHint'),
                onDoubleClick: () => onOpen(row),
              }, activeColumns.map((column) => h('span', {
                key: column.key,
                className: 'sw-resCell' + (column.align === 'right' ? ' sw-resCellRight' : '')
                  + (column.frozen ? ' sw-cellFrozen' : ''),
                style: frozenCellStyle(offsets, column),
              }, column.render(row, t)))))
              : h('div', { className: 'sw-scanEmpty' }, t('flowNoData'))));

      return h('section', { className: 'sw-flow' },
        h('div', { className: 'sw-flowStats' },
          h('span', null, t('flowTotal'), ' ',
            h('b', { className: pctClass(total) }, fmtMoneySign(total))),
          h('span', { className: 'sw-up' }, t('flowInCount'), ' ', h('b', null, netIn)),
          h('span', { className: 'sw-down' }, t('flowOutCount'), ' ', h('b', null, netOut)),
          h('span', { style: { opacity: 0.8 } }, t('flowHint'))),
        h(TableToolRow, { t, onConfigColumns }),
        h('div', { className: 'sw-flowCols' },
          side(t('flowIn'), inflow),
          side(t('flowOut'), outflow)));
    }

    // ---------------------------------------------------------------------
    // 公式选股（字段白名单 + 条件组合，解析在 Host 侧）
    // ---------------------------------------------------------------------

    const FORMULA_GRID = '86px 122px 80px 84px 96px 76px 66px 104px';

    /**
     * 预置公式的本地兜底（Host /formula/fields 拿不到时用它）。
     * SSR 测试会校验它与 lib/formula.js 的 FORMULA_PRESETS 完全一致，防止两边漂移。
     */
    const FALLBACK_PRESETS = [
      { id: 'preset-canslim', name: '欧奈尔式量价齐升', expr: '量比 > 2 且 涨跌幅 between 3 and 9 且 成交额 > 5亿', builtin: true },
      { id: 'preset-main-inflow', name: '主力资金共振', expr: '主力净流入 > 5000万 且 主力净占比 > 5 且 涨跌幅 > 0', builtin: true },
      { id: 'preset-small-active', name: '小盘活跃（游资偏好）', expr: '流通市值 between 20 and 80 亿 且 换手率 > 8 且 成交额 > 3亿', builtin: true },
      { id: 'preset-strong-pullback', name: '强势股缩量回踩', expr: '5日涨跌 > 15 且 涨跌幅 between -3 and 1 且 量比 < 1.2', builtin: true },
      { id: 'preset-low-valuation', name: '低估值大盘（PE/PB）', expr: '市盈率 between 0 and 12 且 市净率 between 0 and 1.5 且 流通市值 > 100亿', builtin: true },
      { id: 'preset-volume-stall', name: '放量滞涨（风险预警）', expr: '5日涨跌 > 25 且 量比 > 3 且 涨跌幅 between -3 and 3', builtin: true },
      { id: 'preset-oversold-rebound', name: '超跌反抽（RSI 近似）', expr: '5日涨跌 < -12 且 涨跌幅 > 2 且 量比 > 1.2', builtin: true },
      { id: 'preset-divergence', name: '跌但主力净买（背离观察）', expr: '涨跌幅 < -3 且 主力净流入 > 3000万', builtin: true },
      { id: 'preset-breakout', name: '放量突破（唐奇安近似）', expr: '涨跌幅 > 5 且 量比 > 2 且 振幅 < 8', builtin: true },
      { id: 'preset-limit-up', name: '涨停 / 接近涨停', expr: '涨跌幅 between 9.5 and 11', builtin: true },
      { id: 'preset-div-core', name: '高股息核心', expr: '股息率 > 5 且 分红年数 >= 2 且 市盈率 between 0 and 15', builtin: true },
      { id: 'preset-div-below-book', name: '破净高股息', expr: '股息率 > 4 且 市净率 < 1', builtin: true },
      { id: 'preset-div-cashcow', name: '现金牛（低负债高分红）', expr: '股息率 > 3 且 ROE > 10 且 资产负债率 < 60', builtin: true },
      { id: 'preset-div-bank', name: '银行红利', expr: '行业 contains "银行" 且 股息率 > 3', builtin: true },
      { id: 'preset-div-lowvol', name: '低波红利', expr: '股息率 > 4 且 分红年数 >= 2 且 市盈率 between 0 and 20 且 振幅 < 3', builtin: true },
    ];

    /**
     * 决定这次执行用哪段公式文本。
     * 「执行」按钮如果直接写 `onClick: run`，React 会把 SyntheticEvent 传进来，
     * 直接 String(event) 会得到 "[object Object]" —— 曾经因此报「未知字段 object」。
     * 所以这里只认字符串，其它一切回落输入框内容。
     */
    function resolveFormulaText(override, current) {
      return (typeof override === 'string' ? override : current).trim();
    }

    function FormulaPanel({ t, onOpen, initialFavOpen = false, columns, onConfigColumns, onOpenDividend }) {
      const [favOpen, setFavOpen] = React.useState(initialFavOpen);
      const [activeFavId, setActiveFavId] = React.useState(null);
      const [expr, setExpr] = React.useState('量比 > 2 且 涨跌幅 between 3 and 7');
      const [meta, setMeta] = React.useState({ fields: [], examples: [], presets: [] });
      const [state, setState] = React.useState({ status: 'idle', data: null, error: null, position: 0 });
      const [favorites, setFavorites] = React.useState(() => {
        const stored = readStore(FORMULA_KEY, null);
        return Array.isArray(stored)
          ? stored.filter((item) => item && item.id && item.name && item.expr)
          : [];
      });
      const [savingFav, setSavingFav] = React.useState(false);
      const [favName, setFavName] = React.useState('');
      const [importNote, setImportNote] = React.useState('');
      const [builderOpen, setBuilderOpen] = React.useState(false);
      const [builderRows, setBuilderRows] = React.useState([
        { field: 'volumeRatio', op: '>', value: '2', value2: '', connect: 'and' },
      ]);
      const importFileRef = React.useRef(null);

      React.useEffect(() => {
        let alive = true;
        fetch(apiUrl('dsh-stock/api/v1/formula/fields'), { headers: { accept: 'application/json' } })
          .then((response) => response.json())
          .then((body) => {
            if (!alive) return;
            if (body && body.ok) {
              setMeta({
                fields: Array.isArray(body.data?.fields) ? body.data.fields : [],
                examples: Array.isArray(body.data?.examples) ? body.data.examples : [],
                presets: Array.isArray(body.data?.presets) && body.data.presets.length
                  ? body.data.presets
                  : FALLBACK_PRESETS,
              });
            } else {
              setMeta((prev) => ({ ...prev, presets: FALLBACK_PRESETS }));
            }
          })
          .catch(() => {
            if (alive) setMeta((prev) => ({ ...prev, presets: FALLBACK_PRESETS }));
          });
        return () => {
          alive = false;
        };
      }, []);

      // 第一次进入（从没保存过收藏夹）时灌入预置；用户把收藏删空也算"已选择"，不再自动灌
      React.useEffect(() => {
        if (!meta.presets.length) return;
        const stored = readStore(FORMULA_KEY, null);
        if (Array.isArray(stored)) return; // 用户已有收藏夹（哪怕是空数组）
        writeStore(FORMULA_KEY, meta.presets);
        setFavorites(meta.presets);
      }, [meta.presets]);

      const run = async (override) => {
        const text = resolveFormulaText(override, expr);
        if (!text) {
          setState({ status: 'idle', data: null, error: null, position: 0 });
          return;
        }
        setState({ status: 'running', data: null, error: null, position: 0 });
        try {
          const query = new URLSearchParams({ expr: text, limit: '200' });
          const response = await fetch(apiUrl(`dsh-stock/api/v1/formula?${query.toString()}`), {
            cache: 'no-store',
            headers: { accept: 'application/json' },
          });
          const body = await response.json().catch(() => null);
          if (!body) throw new Error(`${response.status} ${response.statusText}`);
          if (body.ok !== true) {
            setState({
              status: 'error',
              data: null,
              error: body.error ?? t('formulaError'),
              position: Number(body.position) || 0,
            });
            return;
          }
          setState({ status: 'done', data: body.data, error: null, position: 0 });
        } catch (error) {
          setState({ status: 'error', data: null, error: error.message, position: 0 });
        }
      };

      const persistFavorites = (next) => {
        writeStore(FORMULA_KEY, next);
        setFavorites(next);
      };

      const saveFavorite = () => {
        const value = expr.trim();
        if (!value) return;
        const name = (favName || '').trim() || value.slice(0, 18);
        const item = {
          id: `custom-${Date.now().toString(36)}`,
          name: name.slice(0, 30),
          expr: value,
          builtin: false,
        };
        persistFavorites([...favorites, item]);
        setFavName('');
        setSavingFav(false);
      };

      const removeFavorite = (id) => {
        persistFavorites(favorites.filter((item) => item.id !== id));
      };

      const restorePresets = () => {
        const presets = meta.presets.length ? meta.presets : FALLBACK_PRESETS;
        const merged = [...favorites];
        const ids = new Set(merged.map((item) => item.id));
        for (const preset of presets) {
          if (!ids.has(preset.id)) merged.push(preset);
        }
        persistFavorites(merged);
      };

      const applyFavorite = (favorite) => {
        setActiveFavId(favorite.id);
        setExpr(favorite.expr);
        run(favorite.expr);
      };

      const moveFavorite = (id, delta) => {
        const index = favorites.findIndex((item) => item.id === id);
        const target = index + delta;
        if (index < 0 || target < 0 || target >= favorites.length) return;
        const next = [...favorites];
        const moved = next[index];
        next[index] = next[target];
        next[target] = moved;
        persistFavorites(next);
      };

      const exportFavorites = () => {
        const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const payload = {
          format: 'dsh-stock-workbench/formulas',
          version: 1,
          exportedAt: new Date().toISOString(),
          formulas: favorites.map((item) => ({
            id: item.id,
            name: item.name,
            expr: item.expr,
            builtin: item.builtin === true,
          })),
        };
        downloadText(`看股公式收藏_${stamp}.json`, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
      };

      const importFavorites = async (file) => {
        setImportNote('');
        try {
          const text = await file.text();
          const parsed = JSON.parse(text);
          const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.formulas) ? parsed.formulas : null;
          if (!list) throw new Error('文件里没有 formulas 数组');

          const candidates = [];
          for (const item of list.slice(0, 50)) {
            if (!item || typeof item.name !== 'string' || typeof item.expr !== 'string') continue;
            const name = item.name.trim().slice(0, 30);
            const expr = item.expr.trim();
            if (!name || !expr) continue;
            candidates.push({
              id: typeof item.id === 'string' && item.id ? item.id : `import-${Date.now().toString(36)}-${candidates.length}`,
              name,
              expr,
              builtin: false,
            });
          }

          // 表达式必须在 Host 侧解析通过才收：避免把一条永远报错的公式塞进收藏夹
          const accepted = [];
          let skipped = 0;
          for (const item of candidates) {
            const query = new URLSearchParams({ expr: item.expr });
            try {
              const response = await fetch(apiUrl(`dsh-stock/api/v1/formula/validate?${query.toString()}`), {
                headers: { accept: 'application/json' },
              });
              const body = await response.json();
              if (body && body.ok === true && body.data?.valid === true) accepted.push(item);
              else skipped += 1;
            } catch {
              skipped += 1;
            }
          }

          const merged = [...favorites];
          const ids = new Set(merged.map((item) => item.id));
          for (const item of accepted) {
            let candidate = item;
            let suffix = 1;
            while (ids.has(candidate.id)) {
              candidate = { ...item, id: `${item.id}-${suffix}` };
              suffix += 1;
            }
            ids.add(candidate.id);
            merged.push(candidate);
          }
          persistFavorites(merged);
          setImportNote(
            t('formulaImportResult')
              .replace('{n}', String(accepted.length))
              .replace('{bad}', String(skipped + (list.length - candidates.length))),
          );
        } catch (error) {
          setImportNote(`${t('formulaImportFailed')}：${error.message}`);
        }
      };

      // ---- 可视化构造器：点选字段/运算符/数值，生成公式文本 ----
      const builderFields = meta.fields.length ? meta.fields : [];
      const fieldDefOf = (key) => builderFields.find((field) => field.key === key) ?? null;
      const updateBuilderRow = (index, patch) => {
        setBuilderRows((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
      };
      const addBuilderRow = () => {
        setBuilderRows((rows) => [...rows, { field: 'pct', op: '>', value: '', value2: '', connect: 'and' }]);
      };
      const removeBuilderRow = (index) => {
        setBuilderRows((rows) => rows.filter((_, i) => i !== index));
      };
      const buildExpression = () => {
        const parts = [];
        builderRows.forEach((row) => {
          const def = fieldDefOf(row.field);
          if (!def) return;
          const value = String(row.value ?? '').trim();
          if (!value) return;
          let clause;
          if (def.text) {
            clause = `${def.label} contains "${value}"`;
          } else if (row.op === 'between') {
            const high = String(row.value2 ?? '').trim();
            if (!high) return;
            clause = `${def.label} between ${value} and ${high}`;
          } else {
            clause = `${def.label} ${row.op} ${value}`;
          }
          if (parts.length > 0) parts.push(row.connect === 'or' ? '或' : '且');
          parts.push(clause);
        });
        return parts.join(' ');
      };
      const applyBuilder = () => {
        const built = buildExpression();
        if (!built) return;
        setExpr(built);
        run(built);
      };

      const running = state.status === 'running';
      const data = state.data;

      let body;
      if (running) {
        body = h('div', { className: 'sw-scanEmpty' }, h('span', { className: 'sw-spinner' }), t('loading'));
      } else if (state.status === 'error') {
        body = h('div', { className: 'sw-scanEmpty' },
          h('h3', null, t('formulaError'), '：', state.error),
          state.position > 0
            ? h('pre', { className: 'sw-formulaCaret' }, `${expr}\n${' '.repeat(Math.min(state.position, expr.length))}^`)
            : null);
      } else if (!data) {
        body = h('div', { className: 'sw-scanEmpty' },
          h('span', null, t('formulaEmpty')),
          h('span', { className: 'sw-scanDetail' }, t('formulaHint')));
      } else if (!data.rows.length) {
        body = h('div', { className: 'sw-scanEmpty' },
          h('h3', null, t('formulaNoMatch')),
          h('span', null, t('formulaHint')));
      } else {
        body = h(ResultTable, {
          t,
          columns: columns && columns.length ? columns : FORMULA_COLUMNS,
          rows: data.rows,
          onOpen,
          onConfigColumns,
          extra: { onOpenDividend },
        });
      }

      return h('section', { className: 'sw-scan' },
        h('div', { className: 'sw-scanBar' },
          h('input', {
            className: 'sw-input sw-formulaInput',
            value: expr,
            placeholder: t('formulaPlaceholder'),
            'aria-label': t('tabFormula'),
            spellCheck: false,
            onChange: (event) => setExpr(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter') run();
            },
          }),
          h('button', {
            type: 'button',
            className: 'sw-btn sw-btnPrimary',
            disabled: running,
            onClick: () => run(),
          }, running ? h('span', { className: 'sw-spinner' }) : null, running ? t('loading') : t('formulaRun'))),

        h('div', { className: 'sw-scanBar' },
          h('button', {
            type: 'button',
            className: 'sw-btn sw-btnGhost',
            onClick: () => setBuilderOpen((open) => !open),
          }, builderOpen ? `▾ ${t('formulaBuilderClose')}` : `▸ ${t('formulaBuilder')}`),
          h('span', { className: 'sw-scanHint' }, builderOpen ? t('formulaBuilderHint') : '')),

        builderOpen
          ? h('div', { className: 'sw-builder' },
            h('div', { className: 'sw-builderRows' }, builderRows.map((row, index) => {
              const def = fieldDefOf(row.field);
              const numericOps = [
                { value: '>', label: '>' },
                { value: '>=', label: '>=' },
                { value: '<', label: '<' },
                { value: '<=', label: '<=' },
                { value: 'between', label: t('opBetween') },
                { value: '=', label: '=' },
              ];
              const textOps = [
                { value: 'contains', label: t('opContains') },
                { value: '=', label: t('opEq') },
                { value: '!=', label: t('opNe') },
              ];
              const ops = def && def.text ? textOps : numericOps;
              const isBetween = row.op === 'between';
              return h('div', { className: 'sw-builderRow', key: index },
                index > 0
                  ? h('select', {
                    className: 'sw-selectSm',
                    value: row.connect,
                    'aria-label': 'connector',
                    onChange: (event) => updateBuilderRow(index, { connect: event.target.value }),
                  }, h('option', { value: 'and' }, '且'), h('option', { value: 'or' }, '或'))
                  : h('span', { style: { width: 28 } }),
                h('select', {
                  className: 'sw-selectSm',
                  value: row.field,
                  'aria-label': 'field',
                  onChange: (event) => updateBuilderRow(index, {
                    field: event.target.value,
                    op: (fieldDefOf(event.target.value)?.text) ? 'contains' : '>',
                  }),
                }, builderFields.map((field) => h('option', { key: field.key, value: field.key }, field.label))),
                h('select', {
                  className: 'sw-selectSm',
                  value: row.op,
                  'aria-label': 'operator',
                  onChange: (event) => updateBuilderRow(index, { op: event.target.value }),
                }, ops.map((op) => h('option', { key: op.value, value: op.value }, op.label))),
                h('input', {
                  className: 'sw-inputSm',
                  value: row.value,
                  placeholder: def && def.text ? '银行' : '0',
                  onChange: (event) => updateBuilderRow(index, { value: event.target.value }),
                }),
                def && def.money && !isBetween
                  ? h('span', { className: 'sw-builderHint' }, t('formulaBuilderUnit'))
                  : null,
                isBetween
                  ? h(React.Fragment, null,
                    h('span', { className: 'sw-builderHint' }, '及'),
                    h('input', {
                      className: 'sw-inputSm',
                      value: row.value2,
                      placeholder: '0',
                      onChange: (event) => updateBuilderRow(index, { value2: event.target.value }),
                    }),
                    def && def.money ? h('span', { className: 'sw-builderHint' }, t('formulaBuilderUnit')) : null)
                  : null,
                h('button', {
                  type: 'button',
                  className: 'sw-btn sw-btnGhost',
                  title: t('formulaRemove'),
                  disabled: builderRows.length <= 1,
                  onClick: () => removeBuilderRow(index),
                }, '×'));
            })),
            h('div', { className: 'sw-builderRow' },
              h('button', { type: 'button', className: 'sw-btn sw-btnGhost', onClick: addBuilderRow }, t('formulaBuilderAdd')),
              h('button', {
                type: 'button',
                className: 'sw-btn sw-btnGhost',
                onClick: () => setBuilderRows([{ field: 'volumeRatio', op: '>', value: '', value2: '', connect: 'and' }]),
              }, t('formulaBuilderClear')),
              h('button', {
                type: 'button',
                className: 'sw-btn sw-btnPrimary',
                style: { marginLeft: 'auto' },
                disabled: !buildExpression(),
                onClick: applyBuilder,
              }, t('formulaBuilderApply'))))
          : null,

        h('div', { className: 'sw-scanBar' },
          h('button', {
            type: 'button',
            className: 'sw-btn' + (favOpen ? ' sw-btnPrimary' : ''),
            onClick: () => setFavOpen((open) => !open),
          }, `☆ ${t('formulaFavorites')} ${favorites.length}`),
          activeFavId
            ? h('span', { className: 'sw-scanDetail' },
              favorites.find((item) => item.id === activeFavId)?.name ?? '')
            : null,
          h('span', { style: { flex: 1 } }),
          h('input', {
            ref: importFileRef,
            type: 'file',
            accept: 'application/json,.json',
            style: { display: 'none' },
            onChange: (event) => {
              const file = event.target.files && event.target.files[0];
              event.target.value = '';
              if (file) importFavorites(file);
            },
          }),
          h('button', {
            type: 'button',
            className: 'sw-btn',
            disabled: !expr.trim(),
            onClick: () => {
              setSavingFav(true);
              setFavName('');
            },
          }, `☆ ${t('formulaFavorite')}`)),

        favOpen
          ? h('div', { className: 'sw-favDrawer' },
            h('div', { className: 'sw-favHead' },
              h('span', null, `${t('formulaFavorites')} (${favorites.length})`),
              h('button', {
                type: 'button',
                className: 'sw-btn sw-btnGhost',
                style: { marginLeft: 'auto' },
                onClick: () => setFavOpen(false),
              }, '×')),
            h('div', { className: 'sw-favBody' },
              favorites.length
                ? favorites.map((favorite, index) => h('div', {
                  key: favorite.id,
                  className: 'sw-favItem' + (activeFavId === favorite.id ? ' sw-favItemOn' : ''),
                },
                h('button', {
                  type: 'button',
                  className: 'sw-favInfo',
                  title: favorite.note ? `${favorite.expr}\n\n${favorite.note}` : favorite.expr,
                  onClick: () => applyFavorite(favorite),
                },
                h('span', { className: 'sw-favItemName' }, favorite.name,
                  favorite.builtin ? null : h('span', { className: 'sw-favCustom' }, t('formulaCustomTag'))),
                h('span', { className: 'sw-favItemExpr' }, favorite.expr)),
                h('div', { className: 'sw-favItemActions' },
                  h('button', {
                    type: 'button',
                    className: 'sw-favMove',
                    title: t('formulaMoveUp'),
                    disabled: index === 0,
                    onClick: () => moveFavorite(favorite.id, -1),
                  }, '▲'),
                  h('button', {
                    type: 'button',
                    className: 'sw-favMove',
                    title: t('formulaMoveDown'),
                    disabled: index === favorites.length - 1,
                    onClick: () => moveFavorite(favorite.id, 1),
                  }, '▼'),
                  h('button', {
                    type: 'button',
                    className: 'sw-favDel',
                    title: t('formulaRemove'),
                    onClick: () => removeFavorite(favorite.id),
                  }, '×'))))
                : h('div', { className: 'sw-scanDetail', style: { padding: '10px 4px' } }, t('formulaNoFavorites'))),
            h('div', { className: 'sw-favFoot' },
              savingFav
                ? h(React.Fragment, null,
                  h('input', {
                    className: 'sw-input',
                    style: { flex: 1, minWidth: 0 },
                    value: favName,
                    placeholder: t('formulaFavName'),
                    autoFocus: true,
                    onChange: (event) => setFavName(event.target.value),
                    onKeyDown: (event) => {
                      if (event.key === 'Enter') saveFavorite();
                      if (event.key === 'Escape') {
                        setSavingFav(false);
                        setFavName('');
                      }
                    },
                  }),
                  h('button', {
                    type: 'button',
                    className: 'sw-btn sw-btnPrimary',
                    disabled: !expr.trim(),
                    onClick: saveFavorite,
                  }, t('formulaSave')),
                  h('button', {
                    type: 'button',
                    className: 'sw-btn sw-btnGhost',
                    onClick: () => {
                      setSavingFav(false);
                      setFavName('');
                    },
                  }, t('formulaCancel')))
                : h(React.Fragment, null,
                  h('button', {
                    type: 'button',
                    className: 'sw-btn sw-btnGhost',
                    onClick: () => {
                      if (importFileRef.current) importFileRef.current.click();
                    },
                  }, t('formulaImport')),
                  h('button', {
                    type: 'button',
                    className: 'sw-btn sw-btnGhost',
                    disabled: !favorites.length,
                    onClick: exportFavorites,
                  }, t('formulaExport')),
                  h('button', {
                    type: 'button',
                    className: 'sw-btn sw-btnGhost',
                    onClick: restorePresets,
                  }, t('formulaRestoreDefault')))))
          : null,


        importNote ? h('div', { className: 'sw-importNote' }, importNote) : null,

        meta.examples.length
          ? h('div', { className: 'sw-scanBar' },
            h('span', { className: 'sw-filterLabel' }, t('formulaExamples')),
            h('div', { className: 'sw-scanChips' }, meta.examples.map((example) => h('button', {
              key: example.expr,
              type: 'button',
              className: 'sw-chip',
              title: example.expr,
              onClick: () => setExpr(example.expr),
            }, example.label))))
          : null,

        h('div', { className: 'sw-scanHint' },
          t('formulaHint'),
          meta.fields.length
            ? ` · ${t('formulaFields')}: ${meta.fields.map((field) => field.label).join(' / ')}`
            : ''),

        body,

        data
          ? h('div', { className: 'sw-scanStats' },
            h('span', null, t('formulaMatched'), ' ', h('b', null, data.matched)),
            h('span', null, t('scanPool'), ' ', h('b', null, data.total)),
            h('span', null, t('scanMs'), ' ', h('b', null, `${data.ms}ms`)),
            data.rows.length < data.matched
              ? h('span', { style: { opacity: 0.8 } }, `显示前 ${data.rows.length} 条（可导出完整结果）`)
              : null)
          : null);
    }

    // ---------------------------------------------------------------------
    // 技术信号扫描（v2）：两段式，先用快照粗筛候选池，再只对候选池拉日K
    // ---------------------------------------------------------------------

    const FALLBACK_SIGNALS = [
      { id: 'ma_golden', label: '均线金叉', desc: 'MA5 上穿 MA10' },
      { id: 'macd_golden', label: 'MACD 金叉', desc: 'DIF 上穿 DEA' },
      { id: 'breakout', label: '20 日新高', desc: '收盘价突破前 20 日最高价' },
      { id: 'volume_surge', label: '放量上攻', desc: '成交量 > 1.5×5日均量 且 涨幅 > 3%' },
      { id: 'ma_bull', label: '多头排列', desc: 'MA5 > MA10 > MA20 > MA60' },
      { id: 'ma60_hold', label: '站上 60 日线', desc: '收盘价在 MA60 上方且 MA60 向上' },
    ];

    const SIGNAL_PRESETS = [
      { id: 'double-golden', labelKey: 'signalPresetGolden', signals: ['ma_golden', 'macd_golden'], within: '1', klt: '101' },
      { id: 'breakout-volume', labelKey: 'signalPresetBreakout', signals: ['breakout', 'volume_surge'], within: '0', klt: '101' },
      { id: 'trend-start', labelKey: 'signalPresetTrend', signals: ['ma_golden', 'ma_bull', 'ma60_hold'], within: '3', klt: '101' },
    ];

    const SCAN_GRID = '86px 122px 80px 84px 96px 76px 172px minmax(220px, 1fr)';

    function SignalScanPanel({ t, onOpen, columns, onConfigColumns, onOpenDividend }) {
      const [meta, setMeta] = React.useState(FALLBACK_SIGNALS);
      const [selected, setSelected] = React.useState(['ma_golden', 'macd_golden']);
      const [minAmount, setMinAmount] = React.useState('1');
      const [limit, setLimit] = React.useState('150');
      const [within, setWithin] = React.useState('0');
      const [scanKlt, setScanKlt] = React.useState('101');
      const [activeSignalPreset, setActiveSignalPreset] = React.useState(null);

      const applySignalPreset = (preset) => {
        setSelected(preset.signals);
        setWithin(preset.within);
        setScanKlt(preset.klt);
        setActiveSignalPreset(preset.id);
      };
      const [state, setState] = React.useState({ status: 'idle', data: null, error: null });

      React.useEffect(() => {
        let alive = true;
        fetch(apiUrl('dsh-stock/api/v1/signals'), { headers: { accept: 'application/json' } })
          .then((response) => response.json())
          .then((body) => {
            if (!alive) return;
            if (body && body.ok && Array.isArray(body.data?.signals) && body.data.signals.length) {
              setMeta(body.data.signals);
            }
          })
          .catch(() => {
            /* 拿不到就用本地兜底表，功能不受影响 */
          });
        return () => {
          alive = false;
        };
      }, []);

      const toggleSignal = (id) => {
        setSelected((prev) => {
          if (prev.includes(id)) return prev.length > 1 ? prev.filter((item) => item !== id) : prev;
          return [...prev, id];
        });
      };

      const runScan = async () => {
        setState({ status: 'running', data: null, error: null });
        try {
          const query = new URLSearchParams({
            signals: selected.join(','),
            minAmount,
            limit,
            within,
            klt: scanKlt,
            excludeST: '1',
          });
          const response = await fetch(apiUrl(`dsh-stock/api/v1/scan?${query.toString()}`), {
            cache: 'no-store',
            headers: { accept: 'application/json' },
          });
          const body = await response.json().catch(() => null);
          if (!response.ok || !body || body.ok !== true) {
            throw new Error((body && body.error) || `${response.status} ${response.statusText}`);
          }
          setState({ status: 'done', data: body.data, error: null });
        } catch (error) {
          setState({ status: 'error', data: null, error: error.message });
        }
      };

      const labelOf = (id) => meta.find((item) => item.id === id)?.label ?? id;
      const running = state.status === 'running';
      const data = state.data;

      let body;
      if (running) {
        body = h('div', { className: 'sw-scanEmpty' },
          h('span', { className: 'sw-spinner' }),
          h('span', null, t('scanRunning')));
      } else if (state.status === 'error') {
        body = h('div', { className: 'sw-scanEmpty' },
          h('h3', null, t('chartError')),
          h('span', null, state.error));
      } else if (!data) {
        body = h('div', { className: 'sw-scanEmpty' }, h('span', null, t('scanIdle')));
      } else if (!data.matches.length) {
        body = h('div', { className: 'sw-scanEmpty' },
          h('h3', null, t('scanNoHit')),
          h('span', null, t('scanNoHitHint')));
      } else {
        body = h(ResultTable, {
          t,
          columns: columns && columns.length ? columns : SCAN_COLUMNS,
          rows: data.matches,
          onOpen,
          onConfigColumns,
          extra: { labelOf, onOpenDividend },
        });
      }

      return h('section', { className: 'sw-scan' },
        h('div', { className: 'sw-scanBar' },
          h('span', { className: 'sw-filterLabel' }, t('signalPresets')),
          h('div', { className: 'sw-scanChips' }, SIGNAL_PRESETS.map((preset) => h('button', {
            key: preset.id,
            type: 'button',
            className: 'sw-chip' + (activeSignalPreset === preset.id ? ' sw-chipOn' : ''),
            onClick: () => applySignalPreset(preset),
          }, t(preset.labelKey))))),

        h('div', { className: 'sw-scanBar' },
          h('span', { className: 'sw-filterLabel' }, t('scanSignals')),
          h('div', { className: 'sw-scanChips' }, meta.map((signal) => h('button', {
            key: signal.id,
            type: 'button',
            className: 'sw-chip' + (selected.includes(signal.id) ? ' sw-chipOn' : ''),
            title: signal.desc,
            onClick: () => {
              setActiveSignalPreset(null);
              toggleSignal(signal.id);
            },
          }, signal.label))),
          h('span', { className: 'sw-sep' }, '|'),
          h('span', { className: 'sw-filterLabel' }, t('scanWindow')),
          h('div', { className: 'sw-scanChips' },
            [['0', t('scanWindowToday')], ['3', t('scanWindow3')], ['5', t('scanWindow5')]]
              .map(([value, label]) => h('button', {
                key: value,
                type: 'button',
                className: 'sw-chip' + (within === value ? ' sw-chipOn' : ''),
                onClick: () => {
                  setActiveSignalPreset(null);
                  setWithin(value);
                },
              }, label))),
          h('span', { className: 'sw-sep' }, '|'),
          h('span', { className: 'sw-filterLabel' }, t('scanPeriod')),
          h('div', { className: 'sw-scanChips' },
            [['101', t('scanPeriodDay')], ['60', '60分'], ['15', '15分'], ['5', '5分']]
              .map(([value, label]) => h('button', {
                key: value,
                type: 'button',
                className: 'sw-chip' + (scanKlt === value ? ' sw-chipOn' : ''),
                onClick: () => {
                  setActiveSignalPreset(null);
                  setScanKlt(value);
                },
              }, label))),
          h('span', { className: 'sw-sep' }, '|'),
          h('span', { className: 'sw-filterLabel' }, t('scanMinAmount')),
          h(NumInput, { value: minAmount, onChange: setMinAmount, width: 50, ariaLabel: t('scanMinAmount') }),
          h('span', { className: 'sw-filterLabel' }, t('unitYi')),
          h('span', { className: 'sw-filterLabel' }, t('scanLimit')),
          h(NumInput, { value: limit, onChange: setLimit, width: 56, ariaLabel: t('scanLimit') }),
          h('button', {
            type: 'button',
            className: 'sw-btn sw-btnPrimary',
            style: { marginLeft: 'auto' },
            disabled: running,
            onClick: runScan,
          },
          running ? h('span', { className: 'sw-spinner' }) : null,
          running ? t('scanRunning') : t('scanStart'))),

        h('div', { className: 'sw-scanHint' }, t('scanHint')),
        body,

        data
          ? h('div', { className: 'sw-scanStats' },
            h('span', null, t('scanScanned'), ' ', h('b', null, data.scanned)),
            h('span', null, t('scanPool'), ' ', h('b', null, data.poolSize)),
            h('span', null, t('scanHits'), ' ', h('b', null, data.matches.length)),
            h('span', null, t('scanMs'), ' ', h('b', null, `${data.ms}ms`)),
            h('span', null, t('scanPeriod'), ' ',
              h('b', null, data.klt === 101 ? t('scanPeriodDay') : `${data.klt}分`)),
            data.failed ? h('span', null, t('scanFailed'), ' ', h('b', null, data.failed)) : null,
            data.cached ? h('span', null, t('scanCached')) : null)
          : null);
    }

    // ---------------------------------------------------------------------
    // Detail: K 线（日/周/60/30/15/5 分）与当日分时
    // ---------------------------------------------------------------------

    const PERIODS = [
      { id: 'trends', labelKey: 'period.trends' },
      { id: '101', labelKey: 'period.day', lmt: 240, cap: 2400 },
      { id: '102', labelKey: 'period.week', lmt: 160, cap: 800 },
      { id: '60', labelKey: 'period.m60', lmt: 240, cap: 1440 },
      { id: '30', labelKey: 'period.m30', lmt: 240, cap: 1440 },
      { id: '15', labelKey: 'period.m15', lmt: 240, cap: 1440 },
      { id: '5', labelKey: 'period.m5', lmt: 240, cap: 1440 },
    ];

    /** 每次补历史加多少根 */
    const KLINE_MORE_STEP = 240;

    /**
     * 下次应该请求多少根：在已有根数上 +step，但不超过该周期的上限。
     * 返回 null 表示已经到上限（不用再请求）。
     */
    function klineNextLimit(currentCount, cap, step = KLINE_MORE_STEP) {
      const safeCurrent = Number.isFinite(currentCount) && currentCount > 0 ? currentCount : 0;
      const safeCap = Number.isFinite(cap) && cap > 0 ? cap : safeCurrent + step;
      if (safeCurrent >= safeCap) return null;
      return Math.min(safeCap, safeCurrent + step);
    }

    const UP_COLOR = '#e5484d';
    const DOWN_COLOR = '#12a150';
    const AXIS_COLOR = 'var(--dsw-alias-label-tertiary,#9aa3b2)';
    const GRID_COLOR = 'var(--dsw-alias-border-l1,#eef0f4)';
    const MA_COLORS = ['#e8b339', '#4f9df7', '#b06ee5'];

    function useSize(ref) {
      const [size, setSize] = React.useState({ width: 0, height: 0 });
      React.useEffect(() => {
        const el = ref.current;
        if (!el) return undefined;
        const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
        measure();
        let observer = null;
        if (typeof ResizeObserver === 'function') {
          observer = new ResizeObserver(measure);
          observer.observe(el);
        }
        return () => {
          if (observer) observer.disconnect();
        };
      }, [ref]);
      return size;
    }

    function movingAverage(values, window) {
      const out = new Array(values.length).fill(null);
      let sum = 0;
      for (let i = 0; i < values.length; i += 1) {
        sum += values[i];
        if (i >= window) sum -= values[i - window];
        if (i >= window - 1) out[i] = sum / window;
      }
      return out;
    }

    function emaSeries(values, window) {
      const out = new Array(values.length).fill(null);
      if (!values.length) return out;
      const k = 2 / (window + 1);
      let prev = values[0];
      out[0] = prev;
      for (let i = 1; i < values.length; i += 1) {
        prev = values[i] * k + prev * (1 - k);
        out[i] = prev;
      }
      return out;
    }

    /** MACD(12,26,9)，hist 用 (DIF-DEA)×2，和国内软件口径一致 */
    function macdSeries(closes) {
      const ema12 = emaSeries(closes, 12);
      const ema26 = emaSeries(closes, 26);
      const dif = closes.map((_, i) => (ema12[i] == null || ema26[i] == null ? null : ema12[i] - ema26[i]));
      const dea = emaSeries(dif.map((value) => value ?? 0), 9);
      const hist = dif.map((value, i) => (value == null || dea[i] == null ? null : (value - dea[i]) * 2));
      return { dif, dea, hist };
    }

    /** KDJ(9,3,3)：K/D 用 2/3 旧值 + 1/3 新值，J = 3K - 2D */
    function kdjSeries(bars, n = 9) {
      const len = bars.length;
      const k = new Array(len).fill(null);
      const d = new Array(len).fill(null);
      const j = new Array(len).fill(null);
      let prevK = 50;
      let prevD = 50;
      for (let i = 0; i < len; i += 1) {
        if (i < n - 1) continue;
        let high = -Infinity;
        let low = Infinity;
        for (let m = i - n + 1; m <= i; m += 1) {
          if (bars[m].high > high) high = bars[m].high;
          if (bars[m].low < low) low = bars[m].low;
        }
        const rsv = high > low ? ((bars[i].close - low) / (high - low)) * 100 : 50;
        prevK = (2 / 3) * prevK + (1 / 3) * rsv;
        prevD = (2 / 3) * prevD + (1 / 3) * prevK;
        k[i] = prevK;
        d[i] = prevD;
        j[i] = 3 * prevK - 2 * prevD;
      }
      return { k, d, j };
    }

    /** RSI（Wilder 平滑） */
    function rsiSeries(closes, n) {
      const out = new Array(closes.length).fill(null);
      if (closes.length <= n) return out;
      let gain = 0;
      let loss = 0;
      for (let i = 1; i <= n; i += 1) {
        const diff = closes[i] - closes[i - 1];
        if (diff >= 0) gain += diff;
        else loss -= diff;
      }
      let avgGain = gain / n;
      let avgLoss = loss / n;
      out[n] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
      for (let i = n + 1; i < closes.length; i += 1) {
        const diff = closes[i] - closes[i - 1];
        const up = diff > 0 ? diff : 0;
        const down = diff < 0 ? -diff : 0;
        avgGain = (avgGain * (n - 1) + up) / n;
        avgLoss = (avgLoss * (n - 1) + down) / n;
        out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
      }
      return out;
    }

    /** BIAS(n) = (收盘 - MAn) / MAn × 100 */
    function biasSeries(closes, n) {
      const ma = movingAverage(closes, n);
      return closes.map((close, i) => (ma[i] == null || !ma[i] ? null : ((close - ma[i]) / ma[i]) * 100));
    }

    const INDICATORS = [
      { id: 'macd', label: 'MACD' },
      { id: 'kdj', label: 'KDJ' },
      { id: 'rsi', label: 'RSI' },
      { id: 'bias', label: 'BIAS' },
    ];

    const oneDecimal = (value) => value.toFixed(2);

    /**
     * 指标定义 → 线 / 柱 / 参考线 / 固定值域
     * @returns {{id:string, title:string, lines:Array, hist:?Array, guides:Array, fixed:?[number,number], format:Function}}
     */
    function computeIndicator(bars, id) {
      const closes = bars.map((bar) => bar.close);
      if (id === 'kdj') {
        const { k, d, j } = kdjSeries(bars);
        return {
          id,
          title: 'KDJ(9,3,3)',
          lines: [
            { key: 'K', values: k, color: MA_COLORS[0] },
            { key: 'D', values: d, color: MA_COLORS[1] },
            { key: 'J', values: j, color: MA_COLORS[2] },
          ],
          hist: null,
          guides: [20, 50, 80],
          fixed: [0, 100],
          format: oneDecimal,
        };
      }
      if (id === 'rsi') {
        return {
          id,
          title: 'RSI(6,12,24)',
          lines: [
            { key: 'RSI6', values: rsiSeries(closes, 6), color: MA_COLORS[0] },
            { key: 'RSI12', values: rsiSeries(closes, 12), color: MA_COLORS[1] },
            { key: 'RSI24', values: rsiSeries(closes, 24), color: MA_COLORS[2] },
          ],
          hist: null,
          guides: [20, 50, 80],
          fixed: [0, 100],
          format: oneDecimal,
        };
      }
      if (id === 'bias') {
        return {
          id,
          title: 'BIAS(6,12,24)',
          lines: [
            { key: 'BIAS6', values: biasSeries(closes, 6), color: MA_COLORS[0] },
            { key: 'BIAS12', values: biasSeries(closes, 12), color: MA_COLORS[1] },
            { key: 'BIAS24', values: biasSeries(closes, 24), color: MA_COLORS[2] },
          ],
          hist: null,
          guides: [0],
          fixed: null,
          format: oneDecimal,
        };
      }
      const { dif, dea, hist } = macdSeries(closes);
      return {
        id: 'macd',
        title: 'MACD(12,26,9)',
        lines: [
          { key: 'DIF', values: dif, color: MA_COLORS[0] },
          { key: 'DEA', values: dea, color: MA_COLORS[1] },
        ],
        hist,
        guides: [0],
        fixed: null,
        format: (value) => value.toFixed(3),
      };
    }

    function axisLabel(bars, index) {
      const bar = bars[index];
      if (!bar || !bar.d) return '';
      const [date, time] = String(bar.d).split(' ');
      if (!time) return date.slice(5);
      const prevDate = index > 0 ? String(bars[index - 1].d).split(' ')[0] : null;
      return prevDate === date ? time.slice(0, 5) : date.slice(5);
    }

    const MIN_VISIBLE_BARS = 12;

    /** 把视窗夹在 [0, n] 内，并保证至少 minVisible 根 */
    function clampView(view, n, minVisible = MIN_VISIBLE_BARS) {
      const floorSpan = Math.min(n, Math.max(1, minVisible));
      const span = Math.min(n, Math.max(floorSpan, view.to - view.from));
      let from = view.from;
      let to = from + span;
      if (from < 0) {
        from = 0;
        to = span;
      }
      if (to > n) {
        to = n;
        from = n - span;
      }
      return { from, to };
    }

    /** 以 anchorRatio（0=左边界, 1=右边界）为锚点缩放，滚轮用光标位置算 */
    function zoomView(view, n, factor, anchorRatio, minVisible = MIN_VISIBLE_BARS) {
      const span = view.to - view.from;
      const ratio = Math.max(0, Math.min(1, anchorRatio));
      const anchor = view.from + ratio * span;
      const nextSpan = Math.min(n, Math.max(Math.min(n, minVisible), span * factor));
      return clampView(
        { from: anchor - ratio * nextSpan, to: anchor + (1 - ratio) * nextSpan },
        n,
        minVisible,
      );
    }

    /** deltaRatio = 拖动距离 / 绘图宽度（向右拖为正，视窗向左移） */
    function panView(view, n, deltaRatio, minVisible = MIN_VISIBLE_BARS) {
      const span = view.to - view.from;
      const shift = deltaRatio * span;
      return clampView({ from: view.from + shift, to: view.to + shift }, n, minVisible);
    }

    function buildCandleLayout(bars, width, height, view, indicatorId = 'macd') {
      if (!bars || bars.length === 0 || width < 120 || height < 140) return null;
      const padL = 10;
      const padR = 62;
      const padT = 14;
      const padB = 20;
      const volGap = 8;
      const indGap = 8;
      const volH = Math.max(30, Math.round(height * 0.13));
      const indH = Math.max(50, Math.round(height * 0.17));
      const priceTop = padT;
      const priceBottom = height - padB - indH - indGap - volH - volGap;
      const priceH = priceBottom - priceTop;
      if (priceH < 30) return null;
      const plotW = width - padL - padR;
      const n = bars.length;
      const win = clampView(view ?? { from: 0, to: n }, n);
      const span = Math.max(1, win.to - win.from);
      const step = plotW / span;
      const candleW = Math.max(1, Math.min(12, step * 0.66));
      const visibleStart = Math.max(0, Math.floor(win.from));
      const visibleEnd = Math.min(n, Math.ceil(win.to));

      const closes = bars.map((bar) => bar.close);
      const mas = [movingAverage(closes, 5), movingAverage(closes, 10), movingAverage(closes, 20)];

      // 值域只取可见区间：放大后 Y 轴自动贴合可见 K 线
      const values = [];
      for (let i = visibleStart; i < visibleEnd; i += 1) {
        values.push(bars[i].high, bars[i].low);
        for (const series of mas) if (series[i] != null) values.push(series[i]);
      }

      let min = values.length ? Math.min(...values) : 0;
      let max = values.length ? Math.max(...values) : 1;
      if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
        min = Number.isFinite(min) ? min - 1 : 0;
        max = min + 2;
      }
      const padRange = (max - min) * 0.04;
      min -= padRange;
      max += padRange;

      const x = (i) => padL + (i - win.from + 0.5) * step;
      const y = (price) => priceTop + ((max - price) / (max - min)) * priceH;
      const volMax = Math.max(
        1,
        ...bars.slice(visibleStart, visibleEnd).map((bar) => bar.volLots ?? 0),
      );
      const volTop = (v) => priceBottom + volGap + (volH - (v / volMax) * volH);

      const priceTicks = [];
      for (let k = 0; k <= 4; k += 1) {
        const value = max - ((max - min) * k) / 4;
        priceTicks.push({ value, y: y(value) });
      }

      const tickCount = Math.max(2, Math.min(6, Math.floor(span / 8) + 1));
      const xTicks = [];
      for (let k = 0; k < tickCount; k += 1) {
        const wanted = win.from + (k / Math.max(1, tickCount - 1)) * Math.max(0, span - 1);
        const index = Math.max(visibleStart, Math.min(visibleEnd - 1, Math.round(wanted)));
        xTicks.push({ index, x: x(index), label: axisLabel(bars, index) });
      }

      const pathFor = (series) => {
        let d = '';
        for (let i = visibleStart; i < visibleEnd; i += 1) {
          const value = series[i];
          if (value == null) continue;
          d += `${d ? 'L' : 'M'}${x(i).toFixed(2)} ${y(value).toFixed(2)} `;
        }
        return d.trim();
      };

      // ---- 指标副图（成交量下方）----
      const indicator = computeIndicator(bars, indicatorId);
      const indTop = priceBottom + volGap + volH + indGap;
      const indBottom = height - padB;
      const indValues = [];
      for (const line of indicator.lines) {
        for (let i = visibleStart; i < visibleEnd; i += 1) {
          if (line.values[i] != null) indValues.push(line.values[i]);
        }
      }
      if (indicator.hist) {
        for (let i = visibleStart; i < visibleEnd; i += 1) {
          if (indicator.hist[i] != null) indValues.push(indicator.hist[i]);
        }
      }
      let indMin;
      let indMax;
      if (indicator.fixed) {
        [indMin, indMax] = indicator.fixed;
        indMin -= 4;
        indMax += 4;
      } else if (indValues.length) {
        indMin = Math.min(...indValues);
        indMax = Math.max(...indValues);
        if (indMax <= indMin) {
          indMin -= 1;
          indMax += 1;
        }
        const pad = (indMax - indMin) * 0.1;
        indMin -= pad;
        indMax += pad;
      } else {
        indMin = -1;
        indMax = 1;
      }
      const indY = (value) => indTop + ((indMax - value) / (indMax - indMin)) * indH;
      const indLines = indicator.lines.map((line) => {
        let d = '';
        for (let i = visibleStart; i < visibleEnd; i += 1) {
          const value = line.values[i];
          if (value == null) continue;
          d += `${d ? 'L' : 'M'}${x(i).toFixed(2)} ${indY(value).toFixed(2)} `;
        }
        return { key: line.key, color: line.color, values: line.values, d: d.trim() };
      });
      const indHist = indicator.hist
        ? Array.from({ length: visibleEnd - visibleStart }, (_, offset) => {
          const i = visibleStart + offset;
          const value = indicator.hist[i];
          if (value == null) return null;
          const zeroY = indY(0);
          const valueY = indY(value);
          return { x: x(i), y: Math.min(zeroY, valueY), h: Math.max(1, Math.abs(valueY - zeroY)), up: value >= 0 };
        }).filter(Boolean)
        : null;
      const indGuides = (indicator.guides ?? [])
        .filter((value) => value >= indMin && value <= indMax)
        .map((value) => ({ value, y: indY(value), label: indicator.format(value) }));

      return {
        padL, padR, padT, padB, priceTop, priceBottom, priceH, volH, volGap, plotW,
        n, span, win, visibleStart, visibleEnd, step, candleW, x, y, volTop, volMax,
        priceTicks, xTicks, closes, mas, min, max, pathFor,
        ind: {
          id: indicator.id,
          title: indicator.title,
          top: indTop,
          bottom: indBottom,
          h: indH,
          y: indY,
          min: indMin,
          max: indMax,
          lines: indLines,
          hist: indHist,
          guides: indGuides,
          format: indicator.format,
        },
      };
    }

    function buildTrendsLayout(points, preClose, width, height) {
      if (!points || points.length === 0 || width < 120 || height < 140) return null;
      const padL = 10;
      const padR = 62;
      const padT = 14;
      const padB = 20;
      const volGap = 10;
      const volH = Math.max(32, Math.round(height * 0.18));
      const priceTop = padT;
      const priceBottom = height - padB - volH - volGap;
      const priceH = priceBottom - priceTop;
      if (priceH < 30) return null;
      const plotW = width - padL - padR;
      const SLOTS = 240;

      const x = (i) => padL + (i / SLOTS) * plotW;
      const values = points.map((point) => point.close);
      if (isNum(preClose)) values.push(preClose);
      for (const point of points) if (isNum(point.avg)) values.push(point.avg);

      let min = Math.min(...values);
      let max = Math.max(...values);
      if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
        min = Number.isFinite(min) ? min - 0.01 : 0;
        max = min + 0.02;
      }
      const pad = Math.max((max - min) * 0.06, 0.001);
      min -= pad;
      max += pad;

      const y = (price) => priceTop + ((max - price) / (max - min)) * priceH;
      const volMax = Math.max(1, ...points.map((point) => point.volLots ?? 0));
      const volTop = (v) => priceBottom + volGap + (volH - (v / volMax) * volH);

      const priceTicks = [];
      for (let k = 0; k <= 4; k += 1) {
        const value = max - ((max - min) * k) / 4;
        priceTicks.push({ value, y: y(value) });
      }

      const xTicks = [0, 60, 120, 180, 240].map((slot, index) => ({
        slot,
        x: padL + (slot / SLOTS) * plotW,
        label: ['09:30', '10:30', '11:30', '14:00', '15:00'][index],
      }));

      const linePath = (key) => {
        let d = '';
        for (let i = 0; i < points.length; i += 1) {
          const value = points[i][key];
          if (!isNum(value)) continue;
          d += `${d ? 'L' : 'M'}${x(i).toFixed(2)} ${y(value).toFixed(2)} `;
        }
        return d.trim();
      };

      return {
        padL, padR, padT, padB, priceTop, priceBottom, priceH, volH, volGap, plotW,
        x, y, volTop, volMax, priceTicks, xTicks, SLOTS, min, max, linePath,
      };
    }

    function AxisLayer({ layout, width, height, priceFmt }) {
      const rightX = layout.padL + layout.plotW + 6;
      return h(React.Fragment, null,
        layout.priceTicks.map((tick, index) => h('g', { key: 'pt' + index },
          h('line', {
            x1: layout.padL, x2: layout.padL + layout.plotW, y1: tick.y, y2: tick.y,
            stroke: GRID_COLOR, strokeWidth: 1,
          }),
          h('text', {
            x: rightX, y: tick.y + 3.5, fontSize: 10, style: { fill: AXIS_COLOR },
          }, priceFmt(tick.value)))),
        h('line', {
          x1: layout.padL + layout.plotW + 1, x2: layout.padL + layout.plotW + 1,
          y1: layout.priceTop, y2: layout.priceBottom, stroke: GRID_COLOR, strokeWidth: 1,
        }),
        layout.xTicks.map((tick, index) => h('text', {
          key: 'xt' + index,
          x: tick.x,
          y: height - 5,
          fontSize: 10,
          textAnchor: 'middle',
          style: { fill: AXIS_COLOR },
        }, tick.label)));
    }

    /** 默认视窗：最近 120 根（数据不足就全量） */
    function defaultViewFor(bars) {
      const total = bars ? bars.length : 0;
      return { from: Math.max(0, total - Math.min(total, 120)), to: total };
    }

    /**
     * 底部 dataZoom 滑条：缩略走势 + 可拖动窗口（左右边缘改宽度，中间整体平移），
     * 和 K 线主图共用同一个 view。
     */
    function ChartSlider({ bars, view, onChange, t }) {
      const ref = React.useRef(null);
      const dragRef = React.useRef(null);
      const n = bars.length;
      const W = 1000;
      const H = 32;

      const closes = React.useMemo(() => bars.map((bar) => bar.close), [bars]);
      const bounds = React.useMemo(() => {
        let lo = Infinity;
        let hi = -Infinity;
        for (const close of closes) {
          if (close < lo) lo = close;
          if (close > hi) hi = close;
        }
        if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return { lo: 0, hi: 1 };
        return { lo, hi };
      }, [closes]);

      const path = React.useMemo(() => {
        let d = '';
        for (let i = 0; i < n; i += 1) {
          const x = (i / Math.max(1, n - 1)) * W;
          const y = 5 + (1 - (closes[i] - bounds.lo) / (bounds.hi - bounds.lo)) * (H - 12);
          d += `${d ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)} `;
        }
        return d.trim();
      }, [closes, bounds, n]);

      const safeView = view ?? defaultViewFor(bars);
      const winX = (safeView.from / Math.max(1, n)) * W;
      const winW = Math.max(4, ((safeView.to - safeView.from) / Math.max(1, n)) * W);

      const fractionAt = (clientX) => {
        const el = ref.current;
        if (!el) return 0;
        const rect = el.getBoundingClientRect();
        return Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
      };

      const onPointerDown = (event) => {
        if (event.button !== 0) return;
        const el = ref.current;
        const rect = el.getBoundingClientRect();
        const px = event.clientX - rect.left;
        const leftPx = (safeView.from / Math.max(1, n)) * rect.width;
        const rightPx = (safeView.to / Math.max(1, n)) * rect.width;
        const near = 9;
        let mode = 'move';
        if (Math.abs(px - leftPx) <= near) mode = 'left';
        else if (Math.abs(px - rightPx) <= near) mode = 'right';
        else if (px < leftPx || px > rightPx) {
          // 点空白：把窗口中心移过去
          const span = safeView.to - safeView.from;
          const center = fractionAt(event.clientX) * n;
          onChange(clampView({ from: center - span / 2, to: center + span / 2 }, n));
        }
        dragRef.current = { mode, base: safeView };
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          /* noop */
        }
      };

      const onPointerMove = (event) => {
        const drag = dragRef.current;
        if (!drag) return;
        const fraction = fractionAt(event.clientX);
        const index = fraction * n;
        const minimum = 5;
        if (drag.mode === 'left') {
          onChange(clampView({ from: Math.min(index, drag.base.to - minimum), to: drag.base.to }, n));
        } else if (drag.mode === 'right') {
          onChange(clampView({ from: drag.base.from, to: Math.max(index, drag.base.from + minimum) }, n));
        } else {
          const span = drag.base.to - drag.base.from;
          onChange(clampView({ from: index - span / 2, to: index + span / 2 }, n));
        }
      };

      const endDrag = (event) => {
        dragRef.current = null;
        try {
          event.currentTarget.releasePointerCapture(event.pointerId);
        } catch {
          /* noop */
        }
      };

      const brand = 'var(--dsw-alias-brand-primary,#4f6ef7)';

      return h('div', { className: 'sw-slider', title: t('chartHint') },
        h('svg', {
          ref,
          width: '100%',
          height: H,
          viewBox: `0 0 ${W} ${H}`,
          preserveAspectRatio: 'none',
          onPointerDown,
          onPointerMove,
          onPointerUp: endDrag,
          onPointerCancel: endDrag,
          style: { display: 'block', touchAction: 'none', cursor: 'ew-resize', userSelect: 'none' },
        },
        h('rect', { x: 0, y: 0, width: W, height: H, fill: 'transparent' }),
        h('path', {
          d: path,
          fill: 'none',
          stroke: 'var(--dsw-alias-border-l2,#c8ccd4)',
          strokeWidth: 1,
          vectorEffect: 'non-scaling-stroke',
        }),
        h('rect', {
          x: winX,
          y: 1,
          width: winW,
          height: H - 2,
          fill: brand,
          opacity: 0.12,
          stroke: brand,
          strokeWidth: 1,
          vectorEffect: 'non-scaling-stroke',
        }),
        h('rect', { x: winX - 1.5, y: 5, width: 3, height: H - 10, fill: brand }),
        h('rect', { x: winX + winW - 1.5, y: 5, width: 3, height: H - 10, fill: brand })));
    }

    function CandleChart({ bars, width, height, t, indicator = 'macd', view, onView, onRequestMore, moreHint }) {
      const total = bars ? bars.length : 0;
      const [hover, setHover] = React.useState(null);
      const svgRef = React.useRef(null);
      const layoutRef = React.useRef(null);
      const dragRef = React.useRef(null);
      const currentView = view ?? defaultViewFor(bars);
      const viewRef = React.useRef(currentView);
      viewRef.current = currentView;

      // 数据根数变化（换周期 / 补历史）时打断进行中的拖动，避免基准索引错位
      React.useEffect(() => {
        dragRef.current = null;
        setHover(null);
      }, [total]);

      const layout = React.useMemo(
        () => buildCandleLayout(bars, width, height, currentView, indicator),
        [bars, width, height, currentView.from, currentView.to, indicator],
      );
      layoutRef.current = layout;

      // 滚轮缩放必须走原生监听：React 的 onWheel 是被动监听，preventDefault 无效，
      // 结果缩放时页面跟着滚。
      React.useEffect(() => {
        const el = svgRef.current;
        if (!el) return undefined;
        const onWheel = (event) => {
          const current = layoutRef.current;
          if (!current) return;
          event.preventDefault();
          const rect = el.getBoundingClientRect();
          const ratio = (event.clientX - rect.left - current.padL) / current.plotW;
          const factor = event.deltaY > 0 ? 1.18 : 1 / 1.18;
          onView(zoomView(viewRef.current, current.n, factor, ratio));
        };
        el.addEventListener('wheel', onWheel, { passive: false });
        return () => el.removeEventListener('wheel', onWheel);
      }, [onView]);

      if (!layout) return null;
      const { x, y, volTop, candleW, win } = layout;

      const indexAt = (clientX, rect) => {
        const px = clientX - rect.left;
        const raw = win.from + ((px - layout.padL) / layout.plotW) * layout.span;
        return Math.max(0, Math.min(layout.n - 1, Math.floor(raw)));
      };

      const onPointerDown = (event) => {
        if (event.button !== 0) return;
        dragRef.current = { x: event.clientX, view: viewRef.current };
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          /* 不支持 pointer capture 的环境退化为普通拖动 */
        }
      };

      const onPointerMove = (event) => {
        if (!layout) return;
        if (dragRef.current) {
          const dx = event.clientX - dragRef.current.x;
          const next = panView(dragRef.current.view, layout.n, -dx / layout.plotW);
          onView(next);
          // 往左拖到最左端：请求更早的 K 线（DetailPage 侧会防重入并保持视野）
          if (next.from <= 0.01 && dragRef.current.view.from > 0 && typeof onRequestMore === 'function') {
            onRequestMore();
          }
          return;
        }
        const rect = event.currentTarget.getBoundingClientRect();
        const index = indexAt(event.clientX, rect);
        setHover({ index, cx: x(index) });
      };

      const endDrag = (event) => {
        if (!dragRef.current) return;
        dragRef.current = null;
        try {
          event.currentTarget.releasePointerCapture(event.pointerId);
        } catch {
          /* noop */
        }
      };

      const zoomBy = (factor) => onView(zoomView(viewRef.current, layout.n, factor, 0.5));
      const resetView = () => {
        onView(defaultViewFor(bars));
        setHover(null);
      };

      const hoverBar = hover ? bars[hover.index] : null;
      const tipWidth = 178;
      const tipLeft = hover ? Math.max(6, Math.min(width - tipWidth - 6, hover.cx + 14)) : 0;
      const indText = layout.ind && hover
        ? layout.ind.lines.map((line) => {
          const value = line.values[hover.index];
          return `${line.key} ${value == null ? '—' : layout.ind.format(value)}`;
        }).join('  ')
        : '';
      const fmtRange = (value) => {
        if (!value) return '—';
        const [date, time] = String(value).split(' ');
        return time ? `${date.slice(5)} ${time.slice(0, 5)}` : date.slice(5);
      };

      const visibleIndices = [];
      for (let i = layout.visibleStart; i < layout.visibleEnd; i += 1) visibleIndices.push(i);

      return h(React.Fragment, null,
        h('svg', {
          ref: svgRef,
          width: '100%',
          height: '100%',
          viewBox: `0 0 ${width} ${height}`,
          onPointerDown,
          onPointerMove,
          onPointerUp: endDrag,
          onPointerCancel: endDrag,
          onPointerLeave: (event) => {
            setHover(null);
            endDrag(event);
          },
          onDoubleClick: resetView,
          style: { display: 'block', touchAction: 'none', userSelect: 'none' },
        },
        h(AxisLayer, { layout, width, height, priceFmt: fmtPrice }),
        visibleIndices.map((index) => {
          const bar = bars[index];
          const color = bar.close >= bar.open ? UP_COLOR : DOWN_COLOR;
          const cx = x(index);
          const bodyTop = y(Math.max(bar.open, bar.close));
          const bodyBottom = y(Math.min(bar.open, bar.close));
          const vTop = volTop(bar.volLots ?? 0);
          const vHeight = Math.max(1, layout.priceBottom + layout.volGap + layout.volH - vTop);
          return h('g', { key: 'c' + index },
            h('line', {
              x1: cx, x2: cx, y1: y(bar.high), y2: y(bar.low),
              stroke: color, strokeWidth: 1,
            }),
            h('rect', {
              x: cx - candleW / 2, y: bodyTop, width: candleW,
              height: Math.max(1, bodyBottom - bodyTop), fill: color,
            }),
            h('rect', {
              x: cx - candleW / 2, y: vTop, width: candleW, height: vHeight, fill: color, opacity: 0.45,
            }));
        }),
        layout.mas.map((series, index) => h('path', {
          key: 'ma' + index,
          d: layout.pathFor(series),
          fill: 'none',
          stroke: MA_COLORS[index],
          strokeWidth: 1.2,
          opacity: 0.95,
        })),
        layout.ind ? h('g', null,
          h('line', {
            x1: layout.padL, x2: layout.padL + layout.plotW,
            y1: layout.ind.top, y2: layout.ind.top, stroke: GRID_COLOR, strokeWidth: 1,
          }),
          h('text', {
            x: layout.padL + 2, y: layout.ind.top + 11, fontSize: 10,
            style: { fill: AXIS_COLOR },
          }, layout.ind.title),
          layout.ind.guides.map((guide) => h('g', { key: 'ig' + guide.value },
            h('line', {
              x1: layout.padL, x2: layout.padL + layout.plotW,
              y1: guide.y, y2: guide.y, stroke: GRID_COLOR, strokeWidth: 1,
              strokeDasharray: guide.value === 0 ? undefined : '3 3',
            }),
            h('text', {
              x: layout.padL + layout.plotW + 6, y: guide.y + 3.5, fontSize: 9.5,
              style: { fill: AXIS_COLOR },
            }, guide.label))),
          layout.ind.hist
            ? layout.ind.hist.map((item, index) => h('rect', {
              key: 'ih' + index,
              x: item.x - Math.max(1, layout.candleW * 0.35),
              y: item.y,
              width: Math.max(1, layout.candleW * 0.7),
              height: item.h,
              fill: item.up ? UP_COLOR : DOWN_COLOR,
              opacity: 0.65,
            }))
            : null,
          layout.ind.lines.map((line) => (line.d
            ? h('path', {
              key: 'il' + line.key,
              d: line.d,
              fill: 'none',
              stroke: line.color,
              strokeWidth: 1.1,
            })
            : null))) : null,
        hover && hoverBar ? h('g', { pointerEvents: 'none' },
          h('line', {
            x1: hover.cx, x2: hover.cx, y1: layout.priceTop,
            y2: layout.ind ? layout.ind.bottom : layout.priceBottom,
            stroke: AXIS_COLOR, strokeWidth: 1, strokeDasharray: '3 3',
          }),
          h('line', {
            x1: layout.padL, x2: layout.padL + layout.plotW,
            y1: y(hoverBar.close), y2: y(hoverBar.close),
            stroke: AXIS_COLOR, strokeWidth: 1, strokeDasharray: '3 3',
          }),
          h('circle', { cx: hover.cx, cy: y(hoverBar.close), r: 2.5, fill: MA_COLORS[1] })) : null),
        h('div', { className: 'sw-chartCtl' },
          h('button', {
            type: 'button', className: 'sw-chartBtn', title: t('zoomIn'),
            onClick: () => zoomBy(1 / 1.5),
          }, '＋'),
          h('button', {
            type: 'button', className: 'sw-chartBtn', title: t('zoomOut'),
            onClick: () => zoomBy(1.5),
          }, '－'),
          h('button', {
            type: 'button', className: 'sw-chartBtn', title: t('resetZoom'),
            onClick: resetView,
          }, t('resetZoom'))),
        h('div', { className: 'sw-chartRange' },
          `${fmtRange(bars[layout.visibleStart]?.d)} ~ ${fmtRange(bars[layout.visibleEnd - 1]?.d)}`
          + ` · ${layout.visibleEnd - layout.visibleStart}/${layout.n}`
          + (moreHint === 'loading'
            ? ` · ${t('moreLoading')}`
            : moreHint === 'exhausted'
              ? ` · ${t('moreExhausted')}`
              : moreHint === 'error'
                ? ` · ${t('moreError')}`
                : '')),
        hover && hoverBar ? h('div', { className: 'sw-tip', style: { left: tipLeft, top: 10 } },
          h('div', { className: 'sw-tipTitle' }, hoverBar.d),
          h('div', { className: 'sw-tipRow' }, h('span', null, '开/收'), h('span', null, `${fmtPrice(hoverBar.open)} / ${fmtPrice(hoverBar.close)}`)),
          h('div', { className: 'sw-tipRow' }, h('span', null, '高/低'), h('span', null, `${fmtPrice(hoverBar.high)} / ${fmtPrice(hoverBar.low)}`)),
          h('div', { className: 'sw-tipRow' }, h('span', null, t('col.pct')), h('span', { style: { color: (hoverBar.pct ?? 0) >= 0 ? UP_COLOR : DOWN_COLOR } }, fmtPct(hoverBar.pct))),
          h('div', { className: 'sw-tipRow' }, h('span', null, t('stat.volume')), h('span', null, fmtLots(hoverBar.volLots))),
          h('div', { className: 'sw-tipRow' }, h('span', null, t('col.amount')), h('span', null, fmtMoney(hoverBar.amount))),
          h('div', { className: 'sw-tipRow' }, h('span', null, 'MA5/10/20'), h('span', null,
            `${fmtPrice(layout.mas[0][hover.index])} / ${fmtPrice(layout.mas[1][hover.index])} / ${fmtPrice(layout.mas[2][hover.index])}`)),
          indText
            ? h('div', { className: 'sw-tipRow' }, h('span', null, layout.ind.title.split('(')[0]), h('span', null, indText))
            : null) : null);
    }

    function TrendsChart({ points, preClose, width, height, t }) {
      const [hover, setHover] = React.useState(null);
      const layout = React.useMemo(
        () => buildTrendsLayout(points, preClose, width, height),
        [points, preClose, width, height],
      );
      if (!layout) return null;
      const { x, y, volTop, SLOTS } = layout;
      const last = points[points.length - 1];
      const up = isNum(last?.close) && isNum(preClose) ? last.close >= preClose : true;
      const lineColor = up ? UP_COLOR : DOWN_COLOR;

      const onMove = (event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const px = event.clientX - rect.left;
        const slot = Math.round(((px - layout.padL) / layout.plotW) * SLOTS);
        const index = Math.max(0, Math.min(points.length - 1, slot));
        setHover({ index, cx: x(index) });
      };

      const closePath = layout.linePath('close');
      const areaPath = closePath
        ? `${closePath} L${x(points.length - 1).toFixed(2)} ${layout.priceBottom} L${x(0).toFixed(2)} ${layout.priceBottom} Z`
        : '';
      const hoverPoint = hover ? points[hover.index] : null;
      const tipWidth = 150;
      const tipLeft = hover ? Math.max(6, Math.min(width - tipWidth - 6, hover.cx + 14)) : 0;

      return h(React.Fragment, null,
        h('svg', {
          width: '100%',
          height: '100%',
          viewBox: `0 0 ${width} ${height}`,
          onMouseMove: onMove,
          onMouseLeave: () => setHover(null),
          style: { display: 'block' },
        },
        h(AxisLayer, { layout, width, height, priceFmt: fmtPrice }),
        isNum(preClose) ? h('g', null,
          h('line', {
            x1: layout.padL, x2: layout.padL + layout.plotW,
            y1: y(preClose), y2: y(preClose),
            stroke: 'var(--dsw-alias-border-l2,#d6dae0)', strokeWidth: 1, strokeDasharray: '4 3',
          }),
          h('text', {
            x: layout.padL + layout.plotW + 6, y: y(preClose) + 3.5, fontSize: 10,
            style: { fill: AXIS_COLOR },
          }, fmtPrice(preClose))) : null,
        areaPath ? h('path', { d: areaPath, fill: lineColor, opacity: 0.08 }) : null,
        closePath ? h('path', { d: closePath, fill: 'none', stroke: lineColor, strokeWidth: 1.5 }) : null,
        layout.linePath('avg') ? h('path', {
          d: layout.linePath('avg'), fill: 'none', stroke: MA_COLORS[0], strokeWidth: 1.1,
        }) : null,
        points.map((point, index) => {
          const vTop = volTop(point.volLots ?? 0);
          const vHeight = Math.max(1, layout.priceBottom + layout.volGap + layout.volH - vTop);
          const barUp = isNum(point.close) && isNum(preClose) ? point.close >= preClose : true;
          return h('rect', {
            key: 'v' + index,
            x: x(index) - 1, y: vTop, width: 2, height: vHeight,
            fill: barUp ? UP_COLOR : DOWN_COLOR, opacity: 0.35,
          });
        }),
        hover ? h('g', { pointerEvents: 'none' },
          h('line', {
            x1: hover.cx, x2: hover.cx, y1: layout.priceTop, y2: layout.priceBottom,
            stroke: AXIS_COLOR, strokeWidth: 1, strokeDasharray: '3 3',
          }),
          h('circle', { cx: hover.cx, cy: y(hoverPoint.close), r: 2.6, fill: lineColor })) : null),
        hoverPoint ? h('div', { className: 'sw-tip', style: { left: tipLeft, top: 10 } },
          h('div', { className: 'sw-tipTitle' }, String(hoverPoint.time ?? '').slice(11)),
          h('div', { className: 'sw-tipRow' }, h('span', null, t('col.price')), h('span', null, fmtPrice(hoverPoint.close))),
          h('div', { className: 'sw-tipRow' }, h('span', null, '均价'), h('span', null, fmtPrice(hoverPoint.avg))),
          h('div', { className: 'sw-tipRow' }, h('span', null, t('stat.volume')), h('span', null, fmtLots(hoverPoint.volLots))),
          h('div', { className: 'sw-tipRow' }, h('span', null, t('col.amount')), h('span', null, fmtMoney(hoverPoint.amount)))) : null);
    }

    /** 个股详情 popover：交易 / 估值分位 / 分红 / 基本面 / 所属板块*/
    function StockDetailPopover({ t, row, valuation, onClose }) {
      React.useEffect(() => {
        if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return undefined;
        const handler = (event) => {
          if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
      }, [onClose]);

      const pctTone = (value) => {
        if (!isNum(value)) return '';
        if (value <= 30) return ' sw-cheap';
        if (value >= 70) return ' sw-expensive';
        return '';
      };
      const kv = (label, value, className = '') => h('div', { className: 'sw-kv' },
        h('span', { className: 'sw-kvLabel' }, label),
        h('span', { className: 'sw-kvValue' + (className ? ' ' + className : '') }, value));
      const group = (title, children) => h('div', { className: 'sw-popGroup' },
        h('div', { className: 'sw-popTitle' }, title),
        h('div', { className: 'sw-kvGrid' }, children));

      const percentText = (value) => (isNum(value) ? `${value.toFixed(1)}%` : '—');
      let valuationNodes;
      if (!valuation || valuation.status === 'loading') {
        valuationNodes = h('div', { className: 'sw-popHint' }, h('span', { className: 'sw-spinner' }), t('detailValuationLoading'));
      } else if (valuation.status === 'error') {
        valuationNodes = h('div', { className: 'sw-popHint sw-expensive' }, t('detailValuationFailed'), '：', valuation.error);
      } else {
        const data = valuation.data ?? {};
        valuationNodes = h('div', { className: 'sw-kvGrid' },
          kv(t('detailValuationPe'), isNum(data.pe) ? fmtNum(data.pe) : '—'),
          kv(t('detailValuationPb'), isNum(data.pb) ? fmtNum(data.pb) : '—'),
          kv(t('detailValuationPePct'), percentText(data.pePercentile), pctTone(data.pePercentile)),
          kv(t('detailValuationPbPct'), percentText(data.pbPercentile), pctTone(data.pbPercentile)),
          kv(t('detailValuationSample'), isNum(data.sampleDays) ? `${data.sampleDays} ${t('detailDays')}` : '—'),
          kv(t('detailValuationYears'), isNum(data.years) ? `${data.years} ${t('detailYears')}` : '—'));
      }

      return h('div', { className: 'sw-popMask', onClick: onClose },
        h('div', {
          className: 'sw-pop',
          onClick: (event) => {
            if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
          },
          role: 'dialog',
          'aria-label': t('detailTitle'),
        },
        h('div', { className: 'sw-popHead' },
          h('span', null, `${t('detailTitle')} · ${row.name} ${row.code}`),
          h('button', {
            type: 'button',
            className: 'sw-btn sw-btnGhost',
            style: { marginLeft: 'auto' },
            onClick: onClose,
          }, '×')),
        h('div', { className: 'sw-popBody' },
          group(t('detailTrade'), h(React.Fragment, null,
            kv(t('col.price'), fmtPrice(row.price), pctClass(row.pct)),
            kv(t('col.pct'), fmtPct(row.pct), pctClass(row.pct)),
            kv(t('col.amplitude'), fmtPctPlain(row.amplitude)),
            kv(t('col.amount'), fmtMoney(row.amount)),
            kv(t('col.turnover'), fmtPctPlain(row.turnover)),
            kv(t('col.volumeRatio'), fmtNum(row.volumeRatio)),
            kv(t('col.speed'), fmtPct(row.speed), pctClass(row.speed)),
            kv(t('col.pct5d'), fmtPct(row.pct5d), pctClass(row.pct5d)),
            kv(t('col.floatMcap'), fmtMcap(row.floatMcap)),
            kv(t('col.mainIn'), fmtMoneySign(row.mainIn), pctClass(row.mainIn)),
            kv(t('flowPctCol'), isNum(row.mainInPct) ? `${row.mainInPct.toFixed(2)}%` : '—'))),
          group(t('detailValuation'), valuationNodes),
          group(t('detailDividend'), h(React.Fragment, null,
            kv(t('col.dividendYield'), isNum(row.dividendYield) ? `${row.dividendYield.toFixed(2)}%` : '—'),
            kv(t('col.dividendYears'), isNum(row.dividendYears) ? `${row.dividendYears} ${t('dividendStreakUnit')}` : '—'),
            kv(t('col.dividendConsecutive'), row.dividendConsecutive ? `${row.dividendConsecutive >= 10 ? t('dividendStreakMax') : row.dividendConsecutive}${t('dividendStreakUnit')}` : '—'),
            kv(t('detailLastEx'), row.lastDividendDate ?? '—'))),
          group(t('detailFundamental'), h(React.Fragment, null,
            kv(t('col.roe'), fmtPctPlain(row.roe)),
            kv(t('col.debtRatio'), fmtPctPlain(row.debtRatio)),
            kv(t('col.grossMargin'), fmtPctPlain(row.grossMargin)),
            kv(t('detailRevenueYoy'), fmtPct(row.revenueYoy), pctClass(row.revenueYoy)),
            kv(t('detailProfitYoy'), fmtPct(row.profitYoy), pctClass(row.profitYoy)),
            kv(t('detailEps'), isNum(row.eps) ? row.eps.toFixed(3) : '—'),
            kv(t('detailBvps'), isNum(row.bvps) ? row.bvps.toFixed(2) : '—'),
            kv(t('detailPs'), isNum(row.ps) ? fmtNum(row.ps) : '—'))),
          group(t('detailBelong'), h(React.Fragment, null,
            kv(t('col.industry'), row.industry || '—'),
            kv(t('col.regionBoard'), row.regionBoard || '—'),
            kv(t('col.concepts'), row.concepts || '—'))))));
    }

    function DetailPage({ row, t, onBack, watched, onToggleWatch = () => {} }) {
      const [detailOpen, setDetailOpen] = React.useState(false);
      const [valuation, setValuation] = React.useState({ status: 'idle', data: null, error: '' });

      React.useEffect(() => {
        if (!detailOpen || valuation.status === 'ready' || valuation.status === 'loading') return undefined;
        let alive = true;
        setValuation({ status: 'loading', data: null, error: '' });
        fetch(apiUrl(`dsh-stock/api/v1/valuation?code=${encodeURIComponent(row.code)}`), {
          headers: { accept: 'application/json' },
        })
          .then((response) => response.json().then((body) => ({ body, status: response.status })))
          .then(({ body, status }) => {
            if (!alive) return;
            if (!body || body.ok !== true) throw new Error((body && body.error) || `HTTP ${status}`);
            setValuation({ status: 'ready', data: body.data, error: '' });
          })
          .catch((error) => {
            if (alive) setValuation({ status: 'error', data: null, error: error.message });
          });
        return () => {
          alive = false;
        };
      }, [detailOpen, row.code, valuation.status]);
      const [period, setPeriod] = React.useState('101');
      const [indicator, setIndicator] = React.useState('macd');
      const [view, setView] = React.useState(null);
      const [chart, setChart] = React.useState({ status: 'loading', data: null, error: null });
      const [moreState, setMoreState] = React.useState('idle'); // idle | loading | exhausted | error
      const moreRef = React.useRef({ loading: false, exhausted: false });
      const keepViewRef = React.useRef(false);
      const cacheRef = React.useRef(new Map());
      const boxRef = React.useRef(null);
      const size = useSize(boxRef);

      React.useEffect(() => {
        const handler = (event) => {
          if (event.key === 'Escape') onBack();
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
      }, [onBack]);

      React.useEffect(() => {
        // 切换周期 / 换股票：清空"已补到尽头"的标记，重新开始
        moreRef.current = { loading: false, exhausted: false };
        setMoreState('idle');
        const key = `${row.secid}:${period}`;
        const cached = cacheRef.current.get(key);
        if (cached) {
          setChart({ status: 'ready', data: cached, error: null });
          return undefined;
        }
        let alive = true;
        setChart({ status: 'loading', data: null, error: null });
        const meta = PERIODS.find((item) => item.id === period);
        const path = period === 'trends'
          ? `dsh-stock/api/v1/trends?secid=${encodeURIComponent(row.secid)}`
          : `dsh-stock/api/v1/kline?secid=${encodeURIComponent(row.secid)}&klt=${period}&lmt=${meta?.lmt ?? 240}`;
        fetch(apiUrl(path), { cache: 'no-store', headers: { accept: 'application/json' } })
          .then(async (response) => {
            const body = await response.json().catch(() => null);
            if (!response.ok || !body || body.ok !== true) {
              throw new Error((body && body.error) || `${response.status} ${response.statusText}`);
            }
            return body.data;
          })
          .then((data) => {
            if (!alive) return;
            cacheRef.current.set(key, data);
            setChart({ status: 'ready', data, error: null });
          })
          .catch((error) => {
            if (alive) setChart({ status: 'error', data: null, error: error.message });
          });
        return () => {
          alive = false;
        };
      }, [period, row.secid]);

      const tag = BOARD_TAG[row.board];
      const pct = row.pct;
      const width = size.width;
      const height = size.height;

      // 切换周期/换股时重置可见视窗；补历史时保持当前视野不动（见 requestMore）
      React.useEffect(() => {
        if (keepViewRef.current) {
          keepViewRef.current = false;
          return;
        }
        const bars = chart.data?.bars ?? [];
        setView(bars.length ? defaultViewFor(bars) : null);
      }, [chart.data]);

      /** 向左拖到边界：向前补一段历史 K 线，并把视窗整体后移保持视野不动 */
      const requestMore = React.useCallback(async () => {
        if (period === 'trends') return;
        const currentBars = chart.data?.bars ?? [];
        if (!currentBars.length) return;
        if (moreRef.current.loading || moreRef.current.exhausted) return;

        const meta = PERIODS.find((item) => item.id === period);
        const nextLimit = klineNextLimit(currentBars.length, meta?.cap ?? 2400);
        if (nextLimit == null) {
          moreRef.current.exhausted = true;
          setMoreState('exhausted');
          return;
        }

        moreRef.current.loading = true;
        setMoreState('loading');
        try {
          const query = new URLSearchParams({ secid: row.secid, klt: period, lmt: String(nextLimit) });
          const response = await fetch(apiUrl(`dsh-stock/api/v1/kline?${query.toString()}`), {
            headers: { accept: 'application/json' },
          });
          const body = await response.json().catch(() => null);
          if (!body || body.ok !== true) throw new Error((body && body.error) || `${response.status}`);
          const nextBars = body.data?.bars ?? [];
          if (nextBars.length <= currentBars.length) {
            moreRef.current.exhausted = true;
            setMoreState('exhausted');
            return;
          }
          const delta = nextBars.length - currentBars.length;
          const nextData = { ...body.data, bars: nextBars };
          cacheRef.current.set(`${row.secid}:${period}`, nextData);
          keepViewRef.current = true;
          setChart({ status: 'ready', data: nextData, error: null });
          // 前面多了 delta 根，索引整体后移；视窗一起后移，蜡烛不会跳
          setView((prev) => (prev ? { from: prev.from + delta, to: prev.to + delta } : prev));
          setMoreState('idle');
        } catch {
          setMoreState('error');
        } finally {
          moreRef.current.loading = false;
        }
      }, [period, row.secid, chart.data]);

      let chartNode = null;
      if (chart.status === 'loading') {
        chartNode = h('div', { className: 'sw-chartEmpty' }, h('span', { className: 'sw-spinner' }), t('chartLoading'));
      } else if (chart.status === 'error') {
        chartNode = h('div', { className: 'sw-chartEmpty' }, t('chartError'), '：', chart.error);
      } else if (period === 'trends') {
        const points = chart.data?.points ?? [];
        chartNode = points.length
          ? h(TrendsChart, { points, preClose: chart.data.preClose, width, height, t })
          : h('div', { className: 'sw-chartEmpty' }, t('noChartData'));
      } else {
        const bars = chart.data?.bars ?? [];
        chartNode = bars.length
          ? h(CandleChart, {
            bars,
            width,
            height,
            t,
            indicator,
            view,
            onView: setView,
            onRequestMore: requestMore,
            moreHint: moreState,
          })
          : h('div', { className: 'sw-chartEmpty' }, t('noChartData'));
      }

      return h('div', { className: 'sw-page' },
        h('style', null, STYLES),
        h('header', { className: 'sw-detailHead' },
          h('button', { type: 'button', className: 'sw-backBtn', onClick: onBack }, '← ', t('back')),
          h('button', {
            type: 'button',
            className: 'sw-backBtn' + (watched ? ' sw-starOn' : ''),
            onClick: onToggleWatch,
            title: watched ? t('watchRemove') : t('watchAdd'),
          }, watched ? `★ ${t('watchRemove')}` : `☆ ${t('watchAdd')}`),
          h('div', { className: 'sw-detailTitle' },
            h('h1', { className: 'sw-detailName' }, row.name),
            h('span', { className: 'sw-detailCode' }, row.code),
            tag ? h('span', { className: 'sw-tag' }, tag) : null),
          h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 10 } },
            h('span', { className: 'sw-detailPrice ' + pctClass(pct) }, fmtPrice(row.price)),
            h('span', { className: 'sw-detailPct ' + pctClass(pct) }, fmtPct(pct))),
          h('div', { className: 'sw-stats' },
            h('span', { className: 'sw-stat' }, t('col.amount'), h('b', null, fmtMoney(row.amount))),
            h('span', { className: 'sw-stat' }, t('stat.volume'), h('b', null, fmtLots(row.volLots))),
            h('span', { className: 'sw-stat' }, t('col.turnover'), h('b', null, fmtPctPlain(row.turnover))),
            h('span', { className: 'sw-stat' }, t('col.volumeRatio'), h('b', null, fmtNum(row.volumeRatio))),
            h('span', { className: 'sw-stat' }, t('col.amplitude'), h('b', null, fmtPctPlain(row.amplitude))),
            h('span', { className: 'sw-stat' }, t('col.floatMcap'), h('b', null, fmtMcap(row.floatMcap))),
            h('span', { className: 'sw-stat' }, t('col.mainIn'), h('b', { className: pctClass(row.mainIn) }, fmtMoneySign(row.mainIn))),
            h('span', { className: 'sw-stat' }, t('stat.pe'), h('b', null, fmtNum(row.pe))),
            h('button', {
              type: 'button',
              className: 'sw-btn sw-btnGhost',
              style: { marginLeft: 'auto' },
              title: t('detailHint'),
              onClick: () => setDetailOpen(true),
            }, `ⓘ ${t('detailBtn')}`))),

        h('div', { className: 'sw-periods' },
          PERIODS.map((item) => h('button', {
            key: item.id,
            type: 'button',
            className: 'sw-period' + (period === item.id ? ' sw-periodOn' : ''),
            onClick: () => setPeriod(item.id),
          }, t(item.labelKey))),
          period === 'trends'
            ? null
            : h(React.Fragment, null,
              h('span', { className: 'sw-sep', style: { marginLeft: 8 } }, '|'),
              h('span', { className: 'sw-filterLabel' }, t('indicator')),
              INDICATORS.map((item) => h('button', {
                key: item.id,
                type: 'button',
                className: 'sw-period' + (indicator === item.id ? ' sw-periodOn' : ''),
                onClick: () => setIndicator(item.id),
              }, item.label))),
          h('div', { className: 'sw-legend', style: { marginLeft: 'auto' } },
            h('span', { className: 'sw-legendItem' },
              h('span', { className: 'sw-legendDot', style: { background: UP_COLOR } }), '涨'),
            h('span', { className: 'sw-legendItem' },
              h('span', { className: 'sw-legendDot', style: { background: DOWN_COLOR } }), '跌'),
            period === 'trends'
              ? h('span', { className: 'sw-legendItem' },
                h('span', { className: 'sw-legendDot', style: { background: MA_COLORS[0] } }), '均价')
              : h(React.Fragment, null,
                h('span', { className: 'sw-legendItem' },
                  h('span', { className: 'sw-legendDot', style: { background: MA_COLORS[0] } }), 'MA5'),
                h('span', { className: 'sw-legendItem' },
                  h('span', { className: 'sw-legendDot', style: { background: MA_COLORS[1] } }), 'MA10'),
                h('span', { className: 'sw-legendItem' },
                  h('span', { className: 'sw-legendDot', style: { background: MA_COLORS[2] } }), 'MA20')),
            period === 'trends' ? null : h('span', { className: 'sw-legendHint' }, t('chartHint')))),

        h('div', { className: 'sw-chartBox', ref: boxRef }, chartNode),

        period !== 'trends' && (chart.data?.bars?.length ?? 0) > 40
          ? h(ChartSlider, {
            bars: chart.data.bars,
            view,
            onChange: (next) => {
              setView(next);
              // 滑条拖到最左端同样补历史
              if (next && next.from <= 0.01) requestMore();
            },
            t,
          })
          : null,

        h('footer', { className: 'sw-foot' },
          h('span', null, t('payloadHint')),
          h('span', { style: { marginLeft: 'auto' } }, t('escHint'))),
        detailOpen
          ? h(StockDetailPopover, {
            t,
            row,
            valuation,
            onClose: () => setDetailOpen(false),
          })
          : null);
    }

    // ---------------------------------------------------------------------
    // 分红详情弹窗
    // ---------------------------------------------------------------------

    function DividendDetailModal({ state, t, onClose }) {
      React.useEffect(() => {
        if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return undefined;
        const handler = (event) => {
          if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
      }, [onClose]);

      const data = state.data;
      const streak = data?.consecutive;
      const streakText = streak == null || streak <= 0
        ? '—'
        : `${streak >= 10 ? t('dividendStreakMax') : streak}${t('dividendStreakUnit')}`;
      const title = data?.name
        ? `${t('dividendDetail')} · ${data.name} ${data.code}`
        : `${t('dividendDetail')} · ${state.code}`;

      let body;
      if (state.status === 'loading') {
        body = h('div', { className: 'sw-scanEmpty', style: { padding: '26px' } },
          h('span', { className: 'sw-spinner' }), t('dividendLoading'));
      } else if (state.status === 'error') {
        body = h('div', { className: 'sw-scanEmpty', style: { padding: '26px' } },
          h('h3', null, t('dividendFailed')),
          h('span', { className: 'sw-chatError' }, state.error));
      } else {
        const records = data?.records ?? [];
        body = h(React.Fragment, null,
          h('div', { className: 'sw-divStats' },
            h('span', null, t('dividendStat.yield'), ' ',
              h('b', { className: pctClass(data?.dividendYield) },
                isNum(data?.dividendYield) ? `${data.dividendYield.toFixed(2)}%` : '—')),
            h('span', null, t('dividendStat.dps'), ' ',
              h('b', null, isNum(data?.dpsTTM) ? `${data.dpsTTM.toFixed(3)} 元` : '—')),
            h('span', null, t('dividendStat.consecutive'), ' ', h('b', null, streakText)),
            h('span', null, t('dividendStat.years3'), ' ', h('b', null, data?.years3 ?? 0)),
            h('span', null, t('dividendStat.last'), ' ', h('b', null, data?.lastExDate ?? '—')),
            h('span', null, t('dividendStat.industry'), ' ', h('b', null, data?.industry ?? '—'))),
          records.length === 0
            ? h('div', { className: 'sw-scanDetail', style: { padding: '12px 4px' } }, t('dividendNoRecords'))
            : h('div', { className: 'sw-divTable' },
              h('div', { className: 'sw-divHead' },
                h('span', null, t('dividendCol.report')),
                h('span', null, t('dividendCol.ex')),
                h('span', { style: { textAlign: 'right' } }, t('dividendCol.per10')),
                h('span', { style: { textAlign: 'right' } }, t('dividendCol.perShare')),
                h('span', null, t('dividendCol.plan'))),
              records.map((record, index) => h('div', {
                key: `${record.exDate ?? ''}-${index}`,
                className: 'sw-divRow',
              },
              h('span', null, record.reportDate ?? '—'),
              h('span', null, record.exDate ?? '—'),
              h('span', { style: { textAlign: 'right' } },
                isNum(record.per10) ? record.per10.toFixed(3) : '—'),
              h('span', { style: { textAlign: 'right' } },
                isNum(record.perShare) ? record.perShare.toFixed(4) : '—'),
              h('span', { className: 'sw-divPlan', title: record.plan ?? '' }, record.plan ?? '—')))));
      }

      return h('div', { className: 'sw-modalMask', onClick: onClose },
        h('div', {
          className: 'sw-modal',
          onClick: (event) => event.stopPropagation(),
          role: 'dialog',
          'aria-label': t('dividendDetail'),
        },
        h('div', { className: 'sw-modalHead' },
          h('span', null, title),
          h('button', {
            type: 'button',
            className: 'sw-btn sw-btnGhost',
            style: { marginLeft: 'auto' },
            title: t('close'),
            onClick: onClose,
          }, '×')),
        h('div', { className: 'sw-modalBody' }, body)));
    }

    // ---------------------------------------------------------------------
    // 错误边界：任何渲染异常都不要白屏
    // ---------------------------------------------------------------------

    class WorkbenchBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { error: null };
        this.retry = () => this.setState({ error: null });
      }

      static getDerivedStateFromError(error) {
        return { error };
      }

      componentDidCatch(error, info) {
        try {
          console.error('[dsh-stock-workbench] 渲染异常', error, info);
        } catch {
          /* 控制台不可用时忽略 */
        }
      }

      render() {
        const { error } = this.state;
        if (!error) return this.props.children;
        const { t } = this.props;
        return h('div', { className: 'sw-crash' },
          h('h3', null, t('crashTitle')),
          h('p', { className: 'sw-crashHint' }, t('crashHint')),
          h('pre', { className: 'sw-crashStack' }, String(error && (error.stack || error.message) || error)),
          h('button', { type: 'button', className: 'sw-btn sw-btnPrimary', onClick: this.retry },
            t('crashRetry')));
      }
    }

    // ---------------------------------------------------------------------
    // Plugin module
    // ---------------------------------------------------------------------

    /**
     * Locale 服务按扁平 key 查找（dshmarket 的字典就是这个形状），
     * 这里的源码用嵌套对象只是为了好读，注册前必须摊平成 `col.code`。
     */
    function flattenDict(dict, prefix = '', out = {}) {
      for (const [key, value] of Object.entries(dict)) {
        const full = prefix ? `${prefix}.${key}` : key;
        if (value && typeof value === 'object' && !Array.isArray(value)) flattenDict(value, full, out);
        else out[full] = value;
      }
      return out;
    }

    const inject = ['slots', 'locale'];

    function apply(ctx) {
      ctx.effect(
        () => ctx.locale.register(NS, { zh: flattenDict(zh), en: flattenDict(en) }),
        'dsh-stock-workbench: dictionaries',
      );
      const t = ctx.locale.bind(NS);

      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 30,
        label: () => t('nav'),
        locale: NS,
      }, (owner = {}) => h(WorkbenchIcon, { size: owner.size ?? 16 })));

      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: PANEL_ID,
        locale: NS,
      }, () => h(WorkbenchBoundary, { t }, h(WorkbenchPage, { ctx }))));
    }

    return {
      name: NS,
      inject,
      apply,
      // 测试入口：SSR 冒烟脚本直接渲染图表组件、单测布局数学。
      // Harness 只消费 name/inject/apply，多出的键不影响加载。
      __internals: {
        STYLES,
        flattenDict,
        apiUrl,
        clampView,
        zoomView,
        panView,
        MIN_VISIBLE_BARS,
        buildCandleLayout,
        buildTrendsLayout,
        defaultViewFor,
        ChartSlider,
        klineNextLimit,
        PERIODS,
        movingAverage,
        emaSeries,
        macdSeries,
        kdjSeries,
        rsiSeries,
        biasSeries,
        computeIndicator,
        INDICATORS,
        CandleChart,
        TrendsChart,
        SignalScanPanel,
        MoneyFlowPanel,
        FormulaPanel,
        resolveFormulaText,
        FALLBACK_PRESETS,
        FORMULA_KEY,
        buildCsv,
        csvCell,
        FALLBACK_SIGNALS,
        WorkbenchPage,
        DetailPage,
        COLUMNS,
        PERIODS,
        applyFilters,
        sortRows,
        formatCell,
        DividendDetailModal,
        WorkbenchBoundary,
        ColumnConfigDialog,
        ColumnConfigGear,
        TableToolRow,
        ResultTable,
        BoardPanel,
        BOARD_COLUMNS,
        StockDetailPopover,
        WatchlistBar,
        normalizeWatchState,
        defaultWatchState,
        columnCellContent,
        COLUMN_SETS,
        FLOW_COLUMNS,
        SCAN_COLUMNS,
        FORMULA_COLUMNS,
        loadColumnPrefsByTab,
        defaultColumnPrefs,
        normalizeColumnPrefs,
        applyColumnPrefs,
      },
    };
  },
});
