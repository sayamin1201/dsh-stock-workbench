/**
 * 公式选股引擎（纯函数，无网络、无 IO）
 *
 * 目标：让用户写「量比 > 2 且 涨跌幅 between 3 and 7 且 流通市值 < 100亿」这种条件，
 * 而不是把字符串丢进 eval。所以：手写 tokenizer + 递归下降 parser，
 * 只认白名单字段和少数比较运算，任何越界写法在解析期就报错。
 *
 * 设计约定：
 *  - 金额类字段（成交额/流通市值/总市值/主力净流入）**裸数字默认按「亿」解释**，
 *    也可以显式写 `5000万`；其他字段裸数字就是它自己的单位（% 或倍）。
 *  - `and`（且）优先级高于 `or`（或），和常见编程语言一致；括号可强制结合。
 *  - 字段值为 null（停牌/东财未覆盖）时一律视为不命中，不会把"无数据"算成通过。
 */

// ---------------------------------------------------------------------------
// 字段白名单
// ---------------------------------------------------------------------------

/**
 * money=true 的字段基线单位是「元」，用户裸数字按亿换算。
 * 其余字段基线就是它的显示单位（% 或倍）。
 */
const FIELD_DEFS = [
  { key: 'pct', label: '涨跌幅', aliases: ['涨跌幅', '涨幅', 'pct', 'chg'], money: false },
  { key: 'price', label: '最新价', aliases: ['最新价', '价格', '股价', 'price'], money: false },
  { key: 'amount', label: '成交额', aliases: ['成交额', '成交金额', '金额', 'amount'], money: true },
  { key: 'turnover', label: '换手率', aliases: ['换手率', '换手', 'turnover'], money: false },
  { key: 'volumeRatio', label: '量比', aliases: ['量比', '量能比', 'volr', 'volumeratio'], money: false },
  { key: 'amplitude', label: '振幅', aliases: ['振幅', 'amplitude'], money: false },
  { key: 'speed', label: '涨速', aliases: ['涨速', 'speed'], money: false },
  { key: 'pct5d', label: '5日涨跌', aliases: ['5日涨跌', '五日涨跌', 'pct5d'], money: false },
  { key: 'floatMcap', label: '流通市值', aliases: ['流通市值', '流通盘', 'floatmcap'], money: true },
  { key: 'mcap', label: '总市值', aliases: ['总市值', '市值', 'mcap'], money: true },
  { key: 'mainIn', label: '主力净流入', aliases: ['主力净流入', '主力', 'mainin'], money: true },
  { key: 'mainInPct', label: '主力净占比', aliases: ['主力净占比', '净占比', 'maininpct'], money: false },
  { key: 'pe', label: '市盈率', aliases: ['市盈率', 'pe'], money: false },
  { key: 'pb', label: '市净率', aliases: ['市净率', 'pb'], money: false },
  { key: 'code', label: '代码', aliases: ['代码', 'code'], text: true },
  { key: 'name', label: '名称', aliases: ['名称', 'name'], text: true },
  // 防御 / 基本面
  { key: 'dividendYield', label: '股息率', aliases: ['股息率', '分红收益率', 'dividendyield', 'divyield'], money: false },
  { key: 'dividendYears', label: '分红年数', aliases: ['分红年数', '连续分红', '分红次数', 'dividendyears'], money: false },
  { key: 'roe', label: 'ROE', aliases: ['roe', '净资产收益率'], money: false },
  { key: 'debtRatio', label: '资产负债率', aliases: ['资产负债率', '负债率', 'debtratio'], money: false },
  { key: 'grossMargin', label: '毛利率', aliases: ['毛利率', 'grossmargin'], money: false },
  { key: 'eps', label: '每股收益', aliases: ['每股收益', 'eps'], money: false },
  { key: 'bvps', label: '每股净资产', aliases: ['每股净资产', 'bvps'], money: false },
  { key: 'revenueYoy', label: '营收同比', aliases: ['营收同比', '营业收入同比', 'revenueyoy'], money: false },
  { key: 'profitYoy', label: '净利同比', aliases: ['净利同比', '净利润同比', 'profityoy'], money: false },
  { key: 'industry', label: '行业', aliases: ['行业', 'industry'], text: true },
  { key: 'open', label: '开盘价', aliases: ['open', '开盘'], money: false, barOnly: true },
  { key: 'high', label: '最高价', aliases: ['high', '最高'], money: false, barOnly: true },
  { key: 'low', label: '最低价', aliases: ['low', '最低'], money: false, barOnly: true },
  { key: 'close', label: '收盘价', aliases: ['close', '收盘'], money: false, barOnly: true },
  { key: 'volume', label: '成交量(手)', aliases: ['volume', '成交量'], money: false, barOnly: true },
  { key: 'ma5', label: 'MA5', aliases: ['ma5'], money: false, barOnly: true },
  { key: 'ma10', label: 'MA10', aliases: ['ma10'], money: false, barOnly: true },
  { key: 'ma20', label: 'MA20', aliases: ['ma20'], money: false, barOnly: true },
  { key: 'ma60', label: 'MA60', aliases: ['ma60'], money: false, barOnly: true },
  { key: 'ma120', label: 'MA120', aliases: ['ma120'], money: false, barOnly: true },
  { key: 'ma250', label: 'MA250', aliases: ['ma250'], money: false, barOnly: true },
  { key: 'ema12', label: 'EMA12', aliases: ['ema12'], money: false, barOnly: true },
  { key: 'ema26', label: 'EMA26', aliases: ['ema26'], money: false, barOnly: true },
  { key: 'macd_dif', label: 'MACD DIF', aliases: ['macd_dif', 'dif'], money: false, barOnly: true },
  { key: 'macd_dea', label: 'MACD DEA', aliases: ['macd_dea', 'dea'], money: false, barOnly: true },
  { key: 'macd_hist', label: 'MACD 柱', aliases: ['macd_hist', 'macd柱'], money: false, barOnly: true },
  { key: 'rsi6', label: 'RSI6', aliases: ['rsi6'], money: false, barOnly: true },
  { key: 'rsi12', label: 'RSI12', aliases: ['rsi12'], money: false, barOnly: true },
  { key: 'rsi24', label: 'RSI24', aliases: ['rsi24'], money: false, barOnly: true },
  { key: 'kdj_k', label: 'KDJ K', aliases: ['kdj_k', 'k值'], money: false, barOnly: true },
  { key: 'kdj_d', label: 'KDJ D', aliases: ['kdj_d', 'd值'], money: false, barOnly: true },
  { key: 'kdj_j', label: 'KDJ J', aliases: ['kdj_j', 'j值'], money: false, barOnly: true },
  { key: 'boll_upper', label: 'BOLL上轨', aliases: ['boll_upper', '布林上轨'], money: false, barOnly: true },
  { key: 'boll_mid', label: 'BOLL中轨', aliases: ['boll_mid', '布林中轨'], money: false, barOnly: true },
  { key: 'boll_lower', label: 'BOLL下轨', aliases: ['boll_lower', '布林下轨'], money: false, barOnly: true },
  { key: 'atr14', label: 'ATR14', aliases: ['atr14', 'atr'], money: false, barOnly: true },
  { key: 'pe_pct', label: 'PE分位', aliases: ['pe_pct', 'pe分位'], money: false, barOnly: true },
  { key: 'pb_pct', label: 'PB分位', aliases: ['pb_pct', 'pb分位'], money: false, barOnly: true },
  { key: 'hold_days', label: '持有天数', aliases: ['hold_days', '持有天数'], money: false, barOnly: true },
  { key: 'pnl_pct', label: '持仓盈亏%', aliases: ['pnl_pct', '盈亏比例'], money: false, barOnly: true },
];

const ALIAS_INDEX = new Map();
for (const field of FIELD_DEFS) {
  for (const alias of field.aliases) {
    ALIAS_INDEX.set(alias.toLowerCase(), field);
  }
  ALIAS_INDEX.set(field.key.toLowerCase(), field);
}

/** 给前端展示的字段目录 */
/** 回测专用 bar 字段目录（表达式编辑器用） */
export function getBarFieldCatalog() {
  return FIELD_DEFS.filter((field) => field.barOnly === true).map((field) => ({
    key: field.key,
    label: field.label,
    aliases: field.aliases,
  }));
}

export function getFieldCatalog() {
  return FIELD_DEFS.filter((field) => field.barOnly !== true).map((field) => ({
    key: field.key,
    label: field.label,
    aliases: field.aliases,
    money: field.money === true,
    text: field.text === true,
  }));
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

const KEYWORDS = {
  and: 'and', '且': 'and', '并且': 'and', '同时': 'and',
  or: 'or', '或': 'or', '或者': 'or',
  not: 'not', '非': 'not', '不': 'not',
  between: 'between', '介于': 'between',
  contains: 'contains', '包含': 'contains',
  to: 'to', '到': 'to', '至': 'to',
};

const IDENT_START = /[A-Za-z_\u4e00-\u9fa5]/;
const IDENT_PART = /[A-Za-z0-9_\u4e00-\u9fa5]/;

/**
 * 书写习惯归一化：长度不变（1:1 替换），所以报错位置仍然对应原文下标。
 * 处理全角标点、全角数字，让「量比＞２」这类输入也能用。
 */
function normalizeInput(text) {
  let out = '';
  let quote = null; // 字符串字面量内部一律原样保留，避免「银行，保险」被改成半角
  for (const char of String(text ?? '')) {
    if (quote) {
      out += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      out += char;
      continue;
    }
    const code = char.codePointAt(0);
    if (code >= 0xff10 && code <= 0xff19) {
      out += String.fromCharCode(code - 0xff10 + 48); // 全角数字 → 半角
      continue;
    }
    switch (char) {
      case '＞': out += '>'; break;
      case '＜': out += '<'; break;
      case '＝': out += '='; break;
      case '！': out += '!'; break;
      case '（': out += '('; break;
      case '）': out += ')'; break;
      case '％': out += '%'; break;
      case '，': out += ','; break;
      case '；': out += ','; break;
      case '～': out += '~'; break;
      case '　': out += ' '; break;
      default: out += char;
    }
  }
  return out;
}

function tokenize(rawInput) {
  const tokens = [];
  let i = 0;
  const text = normalizeInput(rawInput);

  while (i < text.length) {
    const char = text[i];

    // 空白与「装饰性」符号：方括号、反引号、星号（常见于从文档里复制）
    if (/\s/.test(char) || char === '[' || char === ']' || char === '【' || char === '】'
      || char === '［' || char === '］' || char === '`' || char === '*') {
      i += 1;
      continue;
    }

    // 全角比较符（单字符 → 双字符运算符）
    if (char === '≥') {
      tokens.push({ type: 'op', value: '>=', position: i });
      i += 1;
      continue;
    }
    if (char === '≤') {
      tokens.push({ type: 'op', value: '<=', position: i });
      i += 1;
      continue;
    }
    if (char === '≠') {
      tokens.push({ type: 'op', value: '!=', position: i });
      i += 1;
      continue;
    }

    // 逻辑符号：&& / ||；逗号/分号等价于「且」
    if (char === '&' || char === '|') {
      if (text[i + 1] === char) {
        tokens.push({ type: 'keyword', value: char === '&' ? 'and' : 'or', position: i });
        i += 2;
        continue;
      }
      throw formulaError(
        char === '&' ? '「且」请写 and、&& 或「且」' : '「或」请写 or、|| 或「或」',
        i,
      );
    }
    if (char === ',' || char === ';') {
      tokens.push({ type: 'keyword', value: 'and', position: i });
      i += 1;
      continue;
    }
    if (char === '~') {
      tokens.push({ type: 'keyword', value: 'to', position: i });
      i += 1;
      continue;
    }

    if (char === '(' || char === ')') {
      tokens.push({ type: char === '(' ? 'lparen' : 'rparen', position: i });
      i += 1;
      continue;
    }

    if (char === '"' || char === "'") {
      const quote = char;
      let value = '';
      let j = i + 1;
      while (j < text.length && text[j] !== quote) {
        value += text[j];
        j += 1;
      }
      if (j >= text.length) {
        throw formulaError('字符串没有闭合的引号', i);
      }
      tokens.push({ type: 'string', value, position: i });
      i = j + 1;
      continue;
    }

    const two = text.slice(i, i + 2);
    if (two === '>=' || two === '<=' || two === '!=' || two === '==' || two === '<>') {
      tokens.push({ type: 'op', value: two === '<>' ? '!=' : two, position: i });
      i += 2;
      continue;
    }
    if ('><='.includes(char)) {
      tokens.push({ type: 'op', value: char, position: i });
      i += 1;
      continue;
    }

    if (/[0-9]/.test(char) || (char === '-' && /[0-9]/.test(text[i + 1] ?? ''))) {
      // 语言里没有减法，'-' 只能作为负数字面量的符号
      const rest = text.slice(i);
      const numberMatch = rest.match(/^-?\d+(?:\.\d+)?/);
      const after = rest.slice(numberMatch[0].length);
      if (char !== '-' && after && IDENT_START.test(after[0]) && !/[亿万]/.test(after[0])) {
        // 「5日涨跌」这种以数字开头的字段名
        let j = i;
        let ident = '';
        while (j < text.length && IDENT_PART.test(text[j])) {
          ident += text[j];
          j += 1;
        }
        tokens.push({ type: 'ident', value: ident, position: i });
        i = j;
        continue;
      }
      const value = Number(numberMatch[0]);
      let j = i + numberMatch[0].length;
      let unit = null;
      if (text[j] === '亿') {
        unit = 'yi';
        j += 1;
      } else if (text[j] === '万') {
        unit = 'wan';
        j += 1;
      } else if (text[j] === '%') {
        unit = 'pct';
        j += 1;
      }
      tokens.push({ type: 'number', value, unit, position: i });
      i = j;
      continue;
    }

    if (IDENT_START.test(char)) {
      let j = i;
      let ident = '';
      while (j < text.length && IDENT_PART.test(text[j])) {
        ident += text[j];
        j += 1;
      }
      const lowered = ident.toLowerCase();
      if (KEYWORDS[lowered]) {
        tokens.push({ type: 'keyword', value: KEYWORDS[lowered], position: i });
      } else {
        tokens.push({ type: 'ident', value: ident, position: i });
      }
      i = j;
      continue;
    }

    throw formulaError(`无法识别的字符「${char}」`, i);
  }

  return tokens;
}

function formulaError(message, position) {
  const error = new Error(message);
  error.name = 'FormulaError';
  error.position = position;
  return error;
}

// ---------------------------------------------------------------------------
// Parser（递归下降）
// ---------------------------------------------------------------------------

const NUMERIC_OPS = new Set(['>', '>=', '<', '<=', '=', '==', '!=']);

function resolveField(ident, position) {
  const field = ALIAS_INDEX.get(String(ident).toLowerCase());
  if (!field) {
    throw formulaError(`未知字段「${ident}」`, position);
  }
  return field;
}

/** 把用户写的数字换算成该字段的基线单位 */
function scaleValue(field, token) {
  const value = token.value;
  if (field.text) return value;
  if (!field.money) return value;
  if (token.unit === 'wan') return value * 1e4;
  if (token.unit === 'pct') return value; // 金额字段写 % 没意义，按原值处理
  return value * 1e8; // 裸数字 / 亿
}

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.index = 0;
  }

  peek(offset = 0) {
    return this.tokens[this.index + offset];
  }

  next() {
    const token = this.tokens[this.index];
    this.index += 1;
    return token;
  }

  end() {
    return this.index >= this.tokens.length;
  }

  expect(type, what) {
    const token = this.peek();
    if (!token || token.type !== type) {
      throw formulaError(`缺少${what}`, token ? token.position : 0);
    }
    return this.next();
  }

  /**
   * 读一个数字，并吃掉可能跟在后面的单位（允许「80 亿」这种带空格的写法）。
   * 单位只在金额字段上有意义，其他字段原样返回。
   */
  takeNumber(field, what) {
    const token = this.peek();
    if (!token || token.type !== 'number') {
      throw formulaError(`缺少${what}`, token ? token.position : 0);
    }
    this.next();
    let unit = token.unit;
    const next = this.peek();
    if (!unit && next && next.type === 'ident' && ['亿', '万', '%'].includes(next.value)) {
      unit = next.value === '亿' ? 'yi' : next.value === '万' ? 'wan' : 'pct';
      this.next();
    }
    return scaleValue(field, { value: token.value, unit });
  }

  parseExpression() {
    return this.parseOr();
  }

  parseOr() {
    let left = this.parseAnd();
    while (this.peek()?.type === 'keyword' && this.peek().value === 'or') {
      this.next();
      const right = this.parseAnd();
      left = { kind: 'or', left, right };
    }
    return left;
  }

  parseAnd() {
    let left = this.parseUnary();
    while (this.peek()?.type === 'keyword' && this.peek().value === 'and') {
      this.next();
      const right = this.parseUnary();
      left = { kind: 'and', left, right };
    }
    return left;
  }

  parseUnary() {
    const token = this.peek();
    if (token?.type === 'keyword' && token.value === 'not') {
      this.next();
      return { kind: 'not', node: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  parsePrimary() {
    const token = this.peek();
    if (!token) throw formulaError('条件不完整', 0);
    if (token.type === 'lparen') {
      this.next();
      const node = this.parseExpression();
      this.expect('rparen', '右括号');
      return node;
    }
    if (token.type !== 'ident') {
      throw formulaError('这里应该是一个字段名', token.position);
    }
    const fieldToken = this.next();
    const field = resolveField(fieldToken.value, fieldToken.position);

    const nextToken = this.peek();
    if (!nextToken) {
      throw formulaError(`字段「${fieldToken.value}」后面缺少比较符`, fieldToken.position);
    }

    // 文本字段：支持 = / == / != / contains
    if (field.text) {
      if (nextToken.type === 'keyword' && nextToken.value === 'contains') {
        this.next();
        const valueToken = this.peek();
        if (!valueToken || (valueToken.type !== 'string' && valueToken.type !== 'ident')) {
          throw formulaError('包含运算后面需要一个字符串', valueToken ? valueToken.position : 0);
        }
        this.next();
        return { kind: 'text', field: field.key, op: 'contains', value: String(valueToken.value) };
      }
      if (nextToken.type === 'op' && ['=', '==', '!='].includes(nextToken.value)) {
        this.next();
        const valueToken = this.peek();
        if (!valueToken || (valueToken.type !== 'string' && valueToken.type !== 'ident')) {
          throw formulaError('字符串比较缺少右值', valueToken ? valueToken.position : 0);
        }
        this.next();
        return { kind: 'text', field: field.key, op: nextToken.value === '!=' ? 'ne' : 'eq', value: String(valueToken.value) };
      }
      throw formulaError(`文本字段「${fieldToken.value}」只支持 = / != / contains`, nextToken.position);
    }

    // between / 介于
    if (nextToken.type === 'keyword' && nextToken.value === 'between') {
      this.next();
      const low = this.takeNumber(field, 'between 的下限');
      const separator = this.peek();
      if (!separator || separator.type !== 'keyword' || (separator.value !== 'and' && separator.value !== 'to')) {
        throw formulaError(
          'between 的下限和上限之间要写 and 或 ~（between 3 and 7 / between 3~7）',
          separator ? separator.position : 0,
        );
      }
      this.next();
      const high = this.takeNumber(field, 'between 的上限');
      return { kind: 'between', field: field.key, low, high };
    }

    if (nextToken.type !== 'op' || !NUMERIC_OPS.has(nextToken.value)) {
      throw formulaError(`字段「${fieldToken.value}」后面缺少比较符（> >= < <= = != between）`, nextToken.position);
    }
    this.next();
    const opValue = nextToken.value === '=' ? '==' : nextToken.value;
    // 支持字段与字段比较（如 close > ma20 / macd_dif > macd_dea）
    const rightToken = this.peek();
    if (rightToken && rightToken.type === 'ident') {
      const other = resolveField(rightToken.value, rightToken.position);
      if (other.text) throw formulaError('数值比较右侧不能是文本字段', rightToken.position);
      this.next();
      return { kind: 'compareField', field: field.key, op: opValue, otherField: other.key };
    }
    const value = this.takeNumber(field, '比较符后面的数字');
    return { kind: 'compare', field: field.key, op: opValue, value };
  }
}

// ---------------------------------------------------------------------------
// 求值
// ---------------------------------------------------------------------------

function compare(op, left, right) {
  switch (op) {
    case '>': return left > right;
    case '>=': return left >= right;
    case '<': return left < right;
    case '<=': return left <= right;
    case '==': return left === right;
    case '!=': return left !== right;
    default: return false;
  }
}

function evaluateNode(node, row) {
  switch (node.kind) {
    case 'and': return evaluateNode(node.left, row) && evaluateNode(node.right, row);
    case 'or': return evaluateNode(node.left, row) || evaluateNode(node.right, row);
    case 'not': return !evaluateNode(node.node, row);
    case 'compareField': {
      const leftValue = row[node.field];
      const rightValue = row[node.otherField];
      if (typeof leftValue !== 'number' || !Number.isFinite(leftValue)) return false;
      if (typeof rightValue !== 'number' || !Number.isFinite(rightValue)) return false;
      return compare(node.op, leftValue, rightValue);
    }
    case 'compare': {
      const value = row[node.field];
      if (typeof value !== 'number' || !Number.isFinite(value)) return false;
      return compare(node.op, value, node.value);
    }
    case 'between': {
      const value = row[node.field];
      if (typeof value !== 'number' || !Number.isFinite(value)) return false;
      return value >= node.low && value <= node.high;
    }
    case 'text': {
      const raw = row[node.field];
      if (raw == null) return false;
      const text = String(raw);
      if (node.op === 'contains') return text.includes(node.value);
      if (node.op === 'eq') return text === node.value;
      if (node.op === 'ne') return text !== node.value;
      return false;
    }
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// 对外 API
// ---------------------------------------------------------------------------

export const FORMULA_EXAMPLES = [
  { label: '放量上涨', expr: '量比 > 2 且 涨跌幅 between 3 and 7' },
  { label: '主力抢筹小盘', expr: '主力净流入 > 5000万 且 流通市值 < 100亿 且 涨跌幅 > 0' },
  { label: '高换手活跃', expr: '换手率 > 10 且 成交额 > 5亿' },
  { label: '低估值大盘', expr: '市盈率 between 0 and 15 且 流通市值 > 200亿' },
  { label: '温和反弹', expr: '5日涨跌 < -5 且 涨跌幅 > 2 且 振幅 > 4' },
];

/**
 * 收藏夹预置：公开经典方法的「快照可表达」近似版。
 *
 * 注意：这些是方法的近似，不是原版。写不了的部分都放在 note 里说明，
 * 例如 CANSLIM 的 C/A（季度盈利、营收增速）、I（机构持仓）、
 * 唐奇安通道（需要 20 日 K 线序列）、RSI（需要指标序列）都不在快照字段里。
 */
export const FORMULA_PRESETS = [
  {
    id: 'preset-canslim',
    name: '欧奈尔式量价齐升',
    basis: 'CANSLIM · N/V 近似',
    expr: '量比 > 2 且 涨跌幅 between 3 and 9 且 成交额 > 5亿',
    note: 'CANSLIM 里 N（新高）与 V（量能放大）的当日近似：明显放量 + 温和上涨。缺季度盈利(C/A)与机构持仓(I)数据，不能当完整 CANSLIM 用。',
  },
  {
    id: 'preset-main-inflow',
    name: '主力资金共振',
    basis: '资金流 · f62/f184',
    expr: '主力净流入 > 5000万 且 主力净占比 > 5 且 涨跌幅 > 0',
    note: '价格与主力资金同向。东财 f62/f184 口径未公开，且北交所约 15% 标的不覆盖；绝对值门槛按流通盘大小需自行调整。',
  },
  {
    id: 'preset-small-active',
    name: '小盘活跃（游资偏好）',
    basis: 'A 股题材轮动形态',
    expr: '流通市值 between 20 and 80 亿 且 换手率 > 8 且 成交额 > 3亿',
    note: '小市值 + 高换手 + 有量，是 A 股短线题材股的常见形态。波动极大，属于高风险池，不是稳健策略。',
  },
  {
    id: 'preset-strong-pullback',
    name: '强势股缩量回踩',
    basis: '趋势跟随 · 回踩买点',
    expr: '5日涨跌 > 15 且 涨跌幅 between -3 and 1 且 量比 < 1.2',
    note: '近 5 日大涨后今日缩量横盘/微跌，是趋势延续的经典观察点（缩量说明抛压不重）。必须配合止损，回踩失败会直接破位。',
  },
  {
    id: 'preset-low-valuation',
    name: '低估值大盘（PE/PB）',
    basis: '格雷厄姆 · 便宜货近似',
    expr: '市盈率 between 0 and 12 且 市净率 between 0 and 1.5 且 流通市值 > 100亿',
    note: '低 PE + 低 PB + 有流动性。仅用估值，不含股息率、负债率、ROE 质量，容易筛到"便宜但有问题"的公司。',
  },
  {
    id: 'preset-volume-stall',
    name: '放量滞涨（风险预警）',
    basis: '量价背离 · 派发特征',
    expr: '5日涨跌 > 25 且 量比 > 3 且 涨跌幅 between -3 and 3',
    note: '短期大涨后放巨量却涨不动，常出现在出货阶段。用途是「排除清单」或观察，不是买入信号。',
  },
  {
    id: 'preset-oversold-rebound',
    name: '超跌反抽（RSI 近似）',
    basis: 'RSI 超卖 · 序列近似',
    expr: '5日涨跌 < -12 且 涨跌幅 > 2 且 量比 > 1.2',
    note: '真正的 RSI(6) < 30 需要指标序列，这里用「5 日大跌 + 今日放量反弹」近似。接飞刀风险高，只适合短线。',
  },
  {
    id: 'preset-divergence',
    name: '跌但主力净买（背离观察）',
    basis: '资金背离',
    expr: '涨跌幅 < -3 且 主力净流入 > 3000万',
    note: '价格下跌而主力净流入，是分歧信号而非买点。要结合位置（高位背离 vs 低位背离）判断，单独使用没有意义。',
  },
  {
    id: 'preset-breakout',
    name: '放量突破（唐奇安近似）',
    basis: '海龟法则 · 通道突破',
    expr: '涨跌幅 > 5 且 量比 > 2 且 振幅 < 8',
    note: '唐奇安通道突破的本体是「收盘创 20 日新高」，那个在「信号扫描 → 20 日新高」里算得更准。这条是当日强度近似。',
  },
  {
    id: 'preset-limit-up',
    name: '涨停 / 接近涨停',
    basis: 'A 股涨停板',
    expr: '涨跌幅 between 9.5 and 11',
    note: '主板 10% 涨停附近。注意 ST 是 5%、创业板/科创板 20%、北交所 30%、新股上市前 5 日不限，用涨跌幅阈值会漏也会多。',
  },
  {
    id: 'preset-div-core',
    name: '高股息核心',
    basis: '红利策略 · 股息率+估值',
    expr: '股息率 > 5 且 分红年数 >= 2 且 市盈率 between 0 and 15',
    note: '红利策略的主干：股息率 5% 以上、近 3 年至少两年分红、PE 不高于 15。股息率会随股价波动，急跌时被动升高，要配合盈利稳定性看。',
  },
  {
    id: 'preset-div-below-book',
    name: '破净高股息',
    basis: '格雷厄姆 · 破净+分红',
    expr: '股息率 > 4 且 市净率 < 1',
    note: 'PB 低于 1 且股息率 4% 以上，常见于银行、地产、公用事业。破净可能是市场对资产质量的折价，不是自动的"便宜"。',
  },
  {
    id: 'preset-div-cashcow',
    name: '现金牛（低负债高分红）',
    basis: '防御型 · 现金流质量',
    expr: '股息率 > 3 且 ROE > 10 且 资产负债率 < 60',
    note: '能持续分红 + 赚钱 + 负债不高，防御性最强的组合。ROE 与负债率取最近一期报告、未年化，跨报告期比较时注意口径。',
  },
  {
    id: 'preset-div-bank',
    name: '银行红利',
    basis: '行业 + 股息率',
    expr: '行业 contains "银行" 且 股息率 > 3',
    note: '银行股是 A 股高股息主力，但负债率天然 90%+，不要用「资产负债率 < 60」去筛银行，会全部筛掉。',
  },
  {
    id: 'preset-div-lowvol',
    name: '低波红利',
    basis: '红利 + 低波动',
    expr: '股息率 > 4 且 分红年数 >= 2 且 市盈率 between 0 and 20 且 振幅 < 3',
    note: '高股息之外再要求当日振幅小于 3%，偏向走势平稳的品种；振幅只反映当日波动，不等于长期低波。',
  },
];

/** 给前端用的预置目录（收藏夹首次进入时灌入） */
export function getFormulaPresets() {
  return FORMULA_PRESETS.map((preset) => ({
    id: preset.id,
    name: preset.name,
    basis: preset.basis,
    expr: preset.expr,
    note: preset.note,
    builtin: true,
  }));
}

const MAX_LENGTH = 500;

/**
 * 编译公式。
 * @returns {{ok:true, ast:object, test:(row:object)=>boolean} | {ok:false, error:string, position:number}}
 */
export function compileFormula(input) {
  const text = String(input ?? '').trim();
  if (!text) return { ok: false, error: '公式是空的', position: 0 };
  if (text.length > MAX_LENGTH) return { ok: false, error: `公式太长（上限 ${MAX_LENGTH} 字符）`, position: MAX_LENGTH };

  let tokens;
  try {
    tokens = tokenize(text);
  } catch (error) {
    return { ok: false, error: error.message, position: error.position ?? 0 };
  }
  if (!tokens.length) return { ok: false, error: '公式是空的', position: 0 };

  try {
    const parser = new Parser(tokens);
    const ast = parser.parseExpression();
    if (!parser.end()) {
      const token = parser.peek();
      return { ok: false, error: `多余的内容「${token.value ?? token.type}」`, position: token.position };
    }
    return {
      ok: true,
      ast,
      test: (row) => {
        try {
          return evaluateNode(ast, row);
        } catch {
          return false;
        }
      },
    };
  } catch (error) {
    return { ok: false, error: error.message, position: error.position ?? 0 };
  }
}

/** 便捷入口：直接筛选一批行 */
export function filterByFormula(rows, input) {
  const compiled = compileFormula(input);
  if (!compiled.ok) return { ok: false, error: compiled.error, position: compiled.position };
  const matched = rows.filter((row) => compiled.test(row));
  return { ok: true, rows: matched, total: rows.length };
}
