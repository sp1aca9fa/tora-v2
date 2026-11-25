// The rules files' "Numbers" tables agree with the code (spec 2026-11-25 rules-numbers-check, the
// owner's choice: the docs stay hand-written, this test fails when a value differs from its
// constant). It reads the code statically, from the source text, so unexported constants work and
// no package imports another. Each table row has one wiring entry below: for each constant the row
// names, how its value shows in the row's Value cell. A row's number that has no named constant is
// on its `notChecked` list with the reason.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const RULES = 'docs/rules';
const HEADER = ['Number', 'Value', 'In the code', 'Chosen'];

// ---------------------------------------------------------------------------------------------
// Reading the docs

interface Table {
  /** Each row: its "Number" cell and the others. */
  rows: Map<string, { value: string; code: string }>;
  /** The text after the table, up to the next heading, on one line. */
  after: string;
  header: string[];
}

const cellsOf = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());

function numbersTable(text: string): Table | null {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.trim() === '## Numbers');
  if (start < 0) return null;
  let i = start + 1;
  while (i < lines.length && !lines[i]!.trim().startsWith('|') && !lines[i]!.startsWith('#')) i++;
  const tableLines: string[] = [];
  while (i < lines.length && lines[i]!.trim().startsWith('|')) tableLines.push(lines[i++]!);
  const afterLines: string[] = [];
  while (i < lines.length && !lines[i]!.startsWith('#')) afterLines.push(lines[i++]!);
  const [head = '', , ...body] = tableLines;
  const rows = new Map<string, { value: string; code: string }>();
  for (const line of body) {
    const [number = '', value = '', code = ''] = cellsOf(line);
    rows.set(number, { value, code });
  }
  return { rows, after: afterLines.join(' ').replace(/\s+/g, ' ').trim(), header: cellsOf(head) };
}

const rulesFiles = readdirSync(join(ROOT, RULES)).filter((f) => f.endsWith('.md'));
const tables = new Map<string, Table>();
for (const f of rulesFiles) {
  const table = numbersTable(readFileSync(join(ROOT, RULES, f), 'utf8'));
  if (table) tables.set(f, table);
}

/** The backticked names of an "In the code" cell. */
const namesIn = (cell: string) => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);

/**
 * Whether `shown` is in `text` as a whole token: 15 does not match 150, 1.5, -15 or 1,500.
 */
function holds(text: string, shown: string): boolean {
  const escaped = shown.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // A boundary is needed only where the shown form starts or ends with a word character.
  const before = /^\d/.test(shown)
    ? '(?<![\\w.,-])'
    : /^-/.test(shown)
      ? '(?<![\\w.,])'
      : /^\w/.test(shown)
        ? '(?<!\\w)'
        : '';
  const after = /\w$/.test(shown) ? '(?!\\w|[.,]\\d)' : '';
  return new RegExp(`${before}${escaped}${after}`).test(text);
}

// ---------------------------------------------------------------------------------------------
// Reading the code

type Value = number | Value[] | { [key: string]: Value };

const SOURCE_ROOTS = [
  ...readdirSync(join(ROOT, 'packages')).map((p) => `packages/${p}/src`),
  'apps/web/src',
  'collectors-public/src',
];

function sourcesUnder(dir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(join(ROOT, dir));
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    const path = `${dir}/${name}`;
    if (name === 'node_modules' || name.startsWith('.')) return [];
    if (statSync(join(ROOT, path)).isDirectory()) return sourcesUnder(path);
    return /\.(ts|tsx|mts)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) ? [path] : [];
  });
}

const sourceText = new Map<string, string>();
const textOf = (file: string) => {
  if (!sourceText.has(file)) sourceText.set(file, readFileSync(join(ROOT, file), 'utf8'));
  return sourceText.get(file)!;
};
const SOURCES = SOURCE_ROOTS.flatMap(sourcesUnder);

const constDecl = (name: string) =>
  new RegExp(`^\\s*(?:export\\s+)?const\\s+${name}\\b\\s*(?::[^=]+?)?=\\s*`, 'm');
const classDecl = (name: string) => new RegExp(`^\\s*(?:export\\s+)?class\\s+${name}\\b`, 'm');

/** The expression from `start` to the `;` that ends the statement, without comments. */
function statementAt(text: string, start: number): string {
  let depth = 0;
  let out = '';
  for (let i = start; i < text.length; i++) {
    const c = text[i]!;
    if (c === '/' && text[i + 1] === '/') {
      i = text.indexOf('\n', i) - 1;
      if (i < 0) break;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i) + 1;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const end = text.indexOf(c, i + 1);
      out += text.slice(i, end + 1);
      i = end;
      continue;
    }
    if ('([{'.includes(c)) depth++;
    if (')]}'.includes(c)) depth--;
    if (depth === 0 && c === ';') break;
    if (depth < 0) break;
    out += c;
  }
  return out.replace(/\bas\s+const\b/g, '').trim();
}

/**
 * Evaluates a literal: numbers (with `_`), `+ - * / **`, parentheses, arrays, objects with
 * identifier, number or string keys, and names of other constants of the same file.
 */
function evaluate(expr: string, resolve: (name: string) => Value): Value {
  const tokens =
    expr.match(/\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?|\*\*|[A-Za-z_$][\w$]*|'[^']*'|"[^"]*"|\S/g) ?? [];
  let i = 0;
  const peek = () => tokens[i];
  const take = (want?: string) => {
    const t = tokens[i++];
    if (t === undefined || (want !== undefined && t !== want))
      throw new Error(`expected ${want ?? 'more'} in \`${expr}\``);
    return t;
  };
  const num = (v: Value) => {
    if (typeof v !== 'number') throw new Error(`arithmetic on a non-number in \`${expr}\``);
    return v;
  };
  const primary = (): Value => {
    const t = take();
    if (/^\d/.test(t)) return Number(t.replace(/_/g, ''));
    if (t === '(') {
      const v = sum();
      take(')');
      return v;
    }
    if (t === '[') {
      const items: Value[] = [];
      while (peek() !== ']') {
        items.push(sum());
        if (peek() === ',') take(',');
      }
      take(']');
      return items;
    }
    if (t === '{') {
      const obj: Record<string, Value> = {};
      while (peek() !== '}') {
        const key = take().replace(/^['"]|['"]$/g, '');
        take(':');
        obj[key] = sum();
        if (peek() === ',') take(',');
      }
      take('}');
      return obj;
    }
    if (/^[A-Za-z_$]/.test(t)) return resolve(t);
    throw new Error(`cannot evaluate \`${t}\` in \`${expr}\``);
  };
  const unary = (): Value => (peek() === '-' ? (take(), -num(unary())) : primary());
  const power = (): Value => {
    const base = unary();
    return peek() === '**' ? (take(), num(base) ** num(power())) : base;
  };
  const product = (): Value => {
    let v = power();
    while (peek() === '*' || peek() === '/')
      v = take() === '*' ? num(v) * num(power()) : num(v) / num(power());
    return v;
  };
  const sum = (): Value => {
    let v = product();
    while (peek() === '+' || peek() === '-')
      v = take() === '+' ? num(v) + num(product()) : num(v) - num(product());
    return v;
  };
  const v = sum();
  if (i !== tokens.length) throw new Error(`cannot evaluate \`${expr}\``);
  return v;
}

function constIn(file: string, name: string, seen: string[] = []): Value {
  if (seen.includes(name)) throw new Error(`${name} refers to itself`);
  const text = textOf(file);
  const m = constDecl(name).exec(text);
  if (!m) throw new Error(`${name} is not declared in ${file}`);
  return evaluate(statementAt(text, m.index + m[0].length), (other) =>
    constIn(file, other, [...seen, name]),
  );
}

/** A class's default: the first `field: value` in its body (`PoliteHttp`'s options). */
function classDefault(file: string, name: string, field: string): Value {
  const text = textOf(file);
  const m = classDecl(name).exec(text);
  const body = m ? text.slice(m.index) : '';
  const f = new RegExp(`\\b${field}:\\s*`).exec(body);
  if (!f) throw new Error(`${name} has no default ${field} in ${file}`);
  return evaluate(statementAt(body.slice(f.index + f[0].length), 0).split(',')[0]!, () => {
    throw new Error(`${name}.${field} is not a literal`);
  });
}

/** A shell script's default: `NAME="${NAME:-300}"`. */
function shellDefault(file: string, name: string): Value {
  const m = new RegExp(`^${name}="\\$\\{${name}:-(\\d+)\\}"$`, 'm').exec(textOf(file));
  if (!m) throw new Error(`${name} has no default in ${file}`);
  return Number(m[1]);
}

/**
 * The value of `NAME` or `NAME.field`, and the file it is in. A name declared in two files needs
 * the wiring's `file`.
 */
function codeValue(ref: string, file?: string): { value: Value; file: string } {
  const [name = '', field] = ref.split('.');
  if (file?.endsWith('.sh')) return { value: shellDefault(file, name), file };
  const files = file
    ? [file]
    : SOURCES.filter((f) => constDecl(name).test(textOf(f)) || classDecl(name).test(textOf(f)));
  if (files.length === 0) throw new Error(`${name} is not declared in the code`);
  if (files.length > 1)
    throw new Error(`${name} is declared in ${files.join(', ')}: the wiring must name the file`);
  const at = files[0]!;
  if (classDecl(name).test(textOf(at)) && !constDecl(name).test(textOf(at))) {
    if (!field) throw new Error(`${name} is a class: the wiring must name its field`);
    return { value: classDefault(at, name, field), file: at };
  }
  let value = constIn(at, name);
  if (field !== undefined) {
    if (typeof value !== 'object' || Array.isArray(value) || !(field in value))
      throw new Error(`${name} has no field ${field}`);
    value = value[field]!;
  }
  return { value, file: at };
}

// ---------------------------------------------------------------------------------------------
// How a value shows in a Value cell

type Show = (v: Value) => string;

const asNumber = (v: Value): number => {
  if (typeof v !== 'number') throw new Error(`not a number: ${JSON.stringify(v)}`);
  return v;
};
/** 1095 -> "1,095"; float noise is rounded away (0.15 * 100). */
const fmt = (n: number) => {
  const r = Number(n.toFixed(6));
  return Number.isInteger(r) && Math.abs(r) >= 1000 ? r.toLocaleString('en-US') : String(r);
};
const field = (v: Value, key: string): Value => {
  if (typeof v !== 'object' || Array.isArray(v) || !(key in v))
    throw new Error(`no field ${key} in ${JSON.stringify(v)}`);
  return v[key]!;
};

/** As is, with what follows it in the cell: `plain(' days')` shows 30 as "30 days". */
const plain =
  (after = '', before = ''): Show =>
  (v) =>
    `${before}${fmt(asNumber(v))}${after}`;
/** A share as a percent: 0.15 -> "15 %". */
const percent: Show = (v) => `${fmt(asNumber(v) * 100)} %`;
/** A fall shown without its sign: -0.15 -> "15 %". */
const percentSize: Show = (v) => `${fmt(Math.abs(asNumber(v)) * 100)} %`;
/** A share as percentage points: 0.15 -> "15 points" (or just "15" with `after` ''). */
const points =
  (after = ' points', before = ''): Show =>
  (v) =>
    `${before}${fmt(asNumber(v) * 100)}${after}`;
/** A duration in `unit` ms shown with its word: `ms(HOUR, ' hours')`. */
const per =
  (unitMs: number, after: string): Show =>
  (v) =>
    `${fmt(asNumber(v) / unitMs)}${after}`;
/** A `{ from, to }` pair. */
const fromTo =
  (show: (n: number) => string = fmt, sep = ' to '): Show =>
  (v) =>
    `${show(asNumber(field(v, 'from')))}${sep}${show(asNumber(field(v, 'to')))}`;
/** A list or an object's values in order, joined: [30, 90, 180] -> "30, 90, 180". */
const list =
  (after = ''): Show =>
  (v) => {
    if (typeof v !== 'object') throw new Error(`not a list: ${v}`);
    return `${Object.values(v).map(asNumber).map(fmt).join(', ')}${after}`;
  };

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// ---------------------------------------------------------------------------------------------
// The wiring: one entry per table row

interface Check {
  /** `NAME` or `NAME.field` (a field of a constant object, or a class's default). */
  code: string;
  /** How the cell names it, when not as `code`'s name (`_PER_USERNAME`); null: not named there. */
  token?: string | null;
  /** The file, when the name is declared in more than one, or for a shell script's default. */
  file?: string;
  show: Show;
  /** Checked against the text after the table instead of the Value cell. */
  inText?: true;
}

interface Row {
  checks?: Check[];
  /** A name of the "In the code" cell, or a part of the row, that is not checked, and why. */
  notChecked?: [what: string, reason: string][];
  /** The doc and the code differ today: the row's test is a known failure until settled. */
  knownMismatch?: string;
}

const NO_CONSTANT = 'no named constant';
const c = (code: string, show: Show, more: Partial<Check> = {}): Check => ({ code, show, ...more });

const WIRING: Record<string, Record<string, Row>> = {
  'accounts.md': {
    'Devices per account': { checks: [c('MAX_ACTIVE_DEVICES', plain())] },
    'Password length': { checks: [c('MIN_PASSWORD', plain(' or more'))] },
    'Second step within': { checks: [c('MFA_MAX_AGE_SECONDS', per(MINUTE / SECOND, ' minutes'))] },
    'Code accepted': { notChecked: [['totp.ts', NO_CONSTANT]] },
    'Backup codes': { notChecked: [['backup-codes.ts', NO_CONSTANT]] },
    'Session: renewed after, ends': {
      checks: [
        c('SESSION_RENEW_AFTER_SECONDS', per(HOUR / SECOND, ' hours')),
        c('SESSION_MAX_AGE_SECONDS', per(DAY / SECOND, ' days')),
      ],
    },
    Lockout: {
      checks: [
        c('MAX_FAILURES_PER_IP', plain(' / ')),
        c('IP_WINDOW_MS', per(MINUTE, ' min'), { token: null }),
        c('MAX_FAILURES_PER_USERNAME', plain(' / h'), { token: '_PER_USERNAME' }),
        c('MAX_FAILURES_GLOBAL', plain(' / h'), { token: '_GLOBAL' }),
      ],
    },
    'Attempts kept': { checks: [c('RETENTION_MS', per(DAY, ' days'))] },
    'Setup link': { checks: [c('SETUP_LINK_HOURS', plain(' hours'))] },
    'A download that can be loaded': { notChecked: [['the import route', NO_CONSTANT]] },
  },

  'alerts.md': {
    'Nothing ran': { checks: [c('MISSED_HOURS', plain(' hours'))] },
    'Morning items, the summary: not again in': {
      checks: [c('SUMMARY_GAP_HOURS', plain(' hours'))],
    },
    'Quiet source': {
      checks: [c('QUIET_DAYS', plain(' days')), c('USUAL_DAYS', plain('', 'to '))],
    },
    'Read budget, pace from': {
      checks: [
        c('DEFAULT_ROWS_READ_BUDGET', (v) => `${fmt(asNumber(v) / 1_000_000)} million`),
        c('PACE_FROM_DAY', plain('th', 'the ')),
      ],
    },
    'Watch alert again after': { checks: [c('ALERT_QUIET_DAYS', plain(' days'))] },
    'Asks left out of the target alert': {
      checks: [c('ASK_FLOOR', (v) => (asNumber(v) === 0.5 ? 'half' : percent(v)))],
    },
    'Sharp drop': {
      checks: [
        c('SHARP_DROP_7D', percentSize),
        c('SHARP_DROP_DAYS', plain(' days'), { token: null }),
        c('ALERT_QUIET_DAYS', plain(' days')),
      ],
    },
    'Failed sign-in': { checks: [c('LOGIN_ALERT_QUIET_MS', per(MINUTE, ' minutes'))] },
    'History kept': { checks: [c('ALERT_LOG_DAYS', plain(' days'))] },
    'Settings: not collected, median moved': {
      checks: [
        c('HEALTH_STALE_DAYS', plain(' days')),
        c('JUMP_SHARE', percent),
        c('JUMP_RECENT_DAYS', plain(' and')),
        c('JUMP_BEFORE_DAYS', plain('', 'and ')),
      ],
    },
    'Self check: every limit above': {
      // The sentence after the table states the owner's limits exactly.
      checks: [
        c('DATA_CHECK.learnNights', plain(' nights', 'learning '), { inText: true }),
        c('DATA_CHECK.farTimesUsual', plain(' times the usual far share'), { inText: true }),
        c('DATA_CHECK.apartRatio', plain(' times apart', 'over '), { inText: true }),
        c('DATA_CHECK.apartMinSales', plain(' sales each'), { inText: true }),
        c('DATA_CHECK.leansNet', plain(' items one way'), { inText: true }),
      ],
      notChecked: [
        [
          'DATA_CHECK (its other fields)',
          'stated in the prose and table of "The self check", not in one exact sentence each',
        ],
      ],
    },
  },

  'buy-timing.md': {
    "Days for a 180-day range, a year's tenth": { checks: [c('RANGE_MIN_DAYS', list())] },
    'Days for a usual price': { notChecked: [['seriesStats', NO_CONSTANT]] },
    'Days for a trend': { notChecked: [['fittedChange', NO_CONSTANT]] },
    'Falling fast': {
      checks: [c('FALLING_2W', percent), c('FALL_DAYS', per(7, ' weeks'), { token: null })],
    },
    'Market: items, fall': {
      checks: [c('MARKET_MIN_ITEMS', plain(', ')), c('MARKET_FALLING_12W', percent)],
    },
    'Pattern: items, days ahead, oldest age': {
      checks: [
        c('PATTERN_MIN_ITEMS', plain(', ')),
        c('PATTERN_HORIZON', plain(', ', ', ')),
        c('PATTERN_MAX_AGE', plain('', ', '), { token: null }),
      ],
    },
    'New-release wait when the age is unknown': {
      checks: [c('NEW_RELEASE_DAYS', plain(' days'))],
    },
    'A full first year': {
      checks: [
        c(
          'FULL_YEAR',
          fromTo((n) => `day ${fmt(n)}`),
        ),
      ],
    },
    'Deeper quarter of the fall': { checks: [c('LOW_DROP_QUARTER_MIN', plain(' items'))] },
    'Cheap and steady': {
      checks: [
        c('CHEAP_YEAR', plain(', ')),
        c('HELD_2W', percent),
        c('YEAR_MIN_DAYS', plain(' days')),
      ],
    },
    'Default margin': { checks: [c('DEFAULT_MARGIN', plain(' %'))] },
    'Limited data': { checks: [c('LIMITED_SALES', plain(' sales', 'under '))] },
    'Rule tests: signals shown from, margin': { checks: [c('RULE_TEST_MIN_SIGNALS', plain(', '))] },
    'A saved row, a listing report is used for': {
      checks: [c('SIGNAL_FRESH_DAYS', plain(' days')), c('SUPPLY_FRESH_DAYS', plain(' days'))],
    },
    'Line suggestion': { notChecked: [['suggestLines', NO_CONSTANT]] },
    'Target shares, rough under, wrong date': {
      checks: [
        c('TARGET_SHARES', list(';')),
        c('TARGET_ROUGH_UNDER', plain(';', '; ')),
        c('WRONG_AGE_EARLY_DAYS', plain('', '; '), { token: null }),
      ],
    },
  },

  'collectors.md': {
    'Wait between requests': {
      checks: [
        c('PoliteHttp.minDelayMs', per(SECOND, ' to ')),
        c('PoliteHttp.maxDelayMs', per(SECOND, ' seconds')),
        c('MIN_DELAY_MS', per(SECOND, ' to ')),
      ],
    },
    'Requests per run': { checks: [c('PoliteHttp.maxRequests', plain())] },
    'Tries again, waits, no answer': {
      checks: [c('PoliteHttp.retries', plain(';')), c('PoliteHttp.timeoutMs', per(SECOND, ' s'))],
    },
    'Searches per run, results kept': { checks: [c('MATCH_PER_RUN', plain(', '))] },
    'Set aside after, tried again every': {
      checks: [
        c('LISTING_BROKEN_NIGHTS', plain(' nights')),
        c('LISTING_RETRY_DAYS', plain(' days')),
      ],
    },
    'Random wait before a collect': {
      checks: [
        c('MAX_JITTER_SECONDS', plain(' seconds', 'to '), { file: 'scripts/collect-cron.sh' }),
      ],
    },
    'A run left as running': { checks: [c('STALE_RUN_MS', per(HOUR, ' hours'))] },
    'A long run; the night window': { notChecked: [['collectorTimes', NO_CONSTANT]] },
    'Daytime: a day, the floor, pace, hours': {
      checks: [
        c('MARKET_PER_DAY', plain(', ')),
        c('MARKET_FLOOR', plain(', ', ', ')),
        c('MARKET_PACE', (v) =>
          fromTo(
            (n) => fmt(n / SECOND),
            ' to ',
          )({ from: field(v, 'minDelayMs'), to: field(v, 'maxDelayMs') }).concat(' s'),
        ),
        c('MARKET_HOURS', fromTo()),
      ],
    },
    'Daytime: wait after a refusal, failures': {
      checks: [
        c('MARKET_WAIT_MS', per(HOUR, ' hours')),
        c('MARKET_FAILURES_DAILY', plain('', ', ')),
      ],
    },
    'Daytime: after a refused collect': { checks: [c('COLLECT_REFUSAL_MS', per(HOUR, ' hours'))] },
  },

  'opportunities.md': {
    'Line rising or falling; items for a line': {
      checks: [c('LINE_MOVE', percent), c('LINE_MIN_ITEMS', plain('', '; '))],
    },
    'Leads or lags': { checks: [c('AGAINST_LINE', points())] },
    'Sales up, down, minimum': {
      checks: [
        c('SALES_UP', plain(', ')),
        c('SALES_DOWN', plain(', ')),
        c('SALES_MIN', plain('', ', ')),
      ],
    },
    'Quick rise': { checks: [c('QUICK_RISE', percent)] },
    'For its age: points, items, ages': {
      checks: [
        c('AGAINST_AGE', points(';')),
        c('AGE_MIN_ITEMS', plain(';', '; ')),
        c('AGE_RANGE', fromTo()),
      ],
    },
    'Tests: days ahead, outcomes, points': {
      checks: [
        c('OPPORTUNITY_HORIZON', plain(';')),
        c('PROVEN_MIN_CHECKS', plain(';', '; ')),
        c('PROVEN_POINTS', points('', '; ')),
      ],
    },
    'A listing under the market': {
      checks: [c('ASK_FLOOR', percent), c('ASK_UNDER', percent)],
    },
    'A shop buy price near': {
      checks: [c('BUYLIST_NEAR', percent), c('BUYLIST_DAYS', plain(' days'))],
    },
    "The market's warning": { checks: [c('MARKET_SHARE', percent)] },
    "Days of sales for a reference's series": { checks: [c('STEADY_DAYS', plain())] },
    'Listings drying up': {
      checks: [
        c('LISTINGS_DRYING', percent),
        c('LISTINGS_MIN', plain(';', '; ')),
        c('LISTINGS_BACK_DAYS', plain(' and')),
        c('LISTINGS_GAP_DAYS', plain(' days')),
      ],
    },
    Potential: {
      checks: [
        c('POTENTIAL_SUBJECTS', plain(' words')),
        c('POTENTIAL_RARITIES', plain(' rarities')),
      ],
    },
    Trending: {
      checks: [
        c('TRENDING_MIN', (v) => `${fmt(asNumber(v))}, ${fmt(asNumber(v))},`),
        c('TRENDING_RATIO', plain(';')),
      ],
    },
    Candidates: {
      checks: [c('CANDIDATE_TOP', plain(',', 'top ')), c('CANDIDATE_DAYS', plain(' days'))],
    },
    "A pick's share of the budget, at most": { checks: [c('MIX_MAX_SHARE', percent)] },
    'Spread: heavy group, heavy item, little': {
      checks: [
        c('SPREAD_HEAVY_SHARE', percent),
        c('SPREAD_HEAVY_ITEM', percent),
        c('SPREAD_LITTLE_SHARE', percent),
      ],
    },
    'Opening: boxes, fee, re-read': {
      checks: [c('DEFAULT_OPENING_FEE', percent)],
      notChecked: [['openingValue', NO_CONSTANT]],
    },
  },

  'sources-markets.md': {
    'Quality gate: window, sales per side': { notChecked: [['checkSourceQuality', NO_CONSTANT]] },
    'Quality gate: pairs, gap': {
      checks: [c('QUALITY_MIN_PAIRS', plain(',')), c('QUALITY_MAX_GAP', percent)],
    },
    'Identity amount, default': {
      checks: [c('IDENTITY_MIN_COST', plain(' yen'), { token: null })],
      notChecked: [
        [
          'identityMinCostFor',
          'a function: its yen default IDENTITY_MIN_COST is checked; the 20 of other currencies is in its body',
        ],
      ],
    },
    "A compared market's prices": { notChecked: [['foreignPrices', NO_CONSTANT]] },
    'Rates: first fetch': { notChecked: [['rates.ts', NO_CONSTANT]] },
    'A stale rate': { notChecked: [['rates.ts', NO_CONSTANT]] },
  },

  'values.md': {
    'Sales a step needs': { checks: [c('MIN_SAMPLES', plain())] },
    'Steps in the own bucket': { checks: [c('WINDOWS', list(' days'))] },
    'Longest look back': { checks: [c('LONG_WINDOW', plain(' days'))] },
    'Steps with similar conditions': { notChecked: [['valueUnit', NO_CONSTANT]] },
    Outliers: { notChecked: [['withoutOutliers', NO_CONSTANT]] },
    'High confidence': {
      checks: [
        c('HIGH_CONFIDENCE_SALES', plain('+ sales')),
        c('HIGH_CONFIDENCE_DAYS', plain(' days')),
      ],
    },
    'Medium confidence': {
      checks: [c('MIN_SAMPLES', plain('+ sales')), c('MEDIUM_CONFIDENCE_DAYS', plain(' days'))],
    },
    "A shop's asking price, at most": { checks: [c('STORE_DAYS', plain(' days old'))] },
    'A buy-back price, at most': { notChecked: [['buylistFloor', NO_CONSTANT]] },
    'A saved value is used for': { checks: [c('BUCKET_VALUE_MAX_AGE_DAYS', plain(' days'))] },
    'The chart goes back at most': { checks: [c('MAX_HISTORY_DAYS', plain(' days'))] },
  },
};

/** The count of `notChecked` entries: adding one is a visible change here. */
const NOT_CHECKED_COUNT = 17;

// ---------------------------------------------------------------------------------------------

const tokenOf = (check: Check) =>
  check.token === undefined ? check.code.split('.')[0]! : check.token;

describe("the rules files' Numbers tables", () => {
  it('are the ones the wiring knows, each with the usual columns', () => {
    expect([...tables.keys()].sort()).toEqual(Object.keys(WIRING).sort());
    const odd = [...tables].filter(([, t]) => t.header.join('|') !== HEADER.join('|'));
    expect(odd.map(([f, t]) => `${RULES}/${f}: ${t.header.join(' | ')}`)).toEqual([]);
  });

  it('have one wiring entry per row, and no entry without a row', () => {
    const problems: string[] = [];
    for (const [file, table] of tables) {
      const wiring = WIRING[file] ?? {};
      for (const row of table.rows.keys())
        if (!(row in wiring)) problems.push(`${RULES}/${file}, row "${row}": not wired`);
      for (const row of Object.keys(wiring))
        if (!table.rows.has(row))
          problems.push(`${RULES}/${file}: wired row "${row}" is not in the table`);
    }
    expect(problems).toEqual([]);
  });

  it('wire or set aside each name of an "In the code" cell', () => {
    const problems: string[] = [];
    for (const [file, table] of tables)
      for (const [row, { code }] of table.rows) {
        const wired = WIRING[file]?.[row];
        if (!wired) continue;
        const names = namesIn(code);
        const covered = new Set([
          ...(wired.checks ?? []).map(tokenOf),
          ...(wired.notChecked ?? []).map(([what]) => what),
        ]);
        for (const name of names)
          if (!covered.has(name))
            problems.push(
              `${RULES}/${file}, row "${row}": \`${name}\` is neither checked nor notChecked`,
            );
        for (const check of wired.checks ?? []) {
          const token = tokenOf(check);
          if (token !== null && !names.includes(token))
            problems.push(
              `${RULES}/${file}, row "${row}": \`${token}\` is wired but not in the cell "${code}"`,
            );
        }
        if (!wired.checks?.length && !wired.notChecked?.length)
          problems.push(`${RULES}/${file}, row "${row}": wired with nothing`);
      }
    expect(problems).toEqual([]);
  });

  it('set aside a known number of entries', () => {
    const count = Object.values(WIRING)
      .flatMap((rows) => Object.values(rows))
      .reduce((n, row) => n + (row.notChecked?.length ?? 0), 0);
    expect(count).toBe(NOT_CHECKED_COUNT);
  });

  const cases = Object.entries(WIRING).flatMap(([file, rows]) =>
    Object.entries(rows)
      .filter(([, row]) => row.checks?.length)
      .map(([row, wired]) => ({ file, row, wired })),
  );

  for (const { file, row, wired } of cases) {
    const test = wired.knownMismatch ? it.fails : it;
    const name = `${file}, "${row}"${wired.knownMismatch ? ` (known mismatch: ${wired.knownMismatch})` : ''}`;
    test(name, () => {
      const table = tables.get(file);
      const cells = table?.rows.get(row);
      expect(cells, `${RULES}/${file}, row "${row}": not in the table`).toBeDefined();
      const problems: string[] = [];
      for (const check of wired.checks ?? []) {
        const where = check.inText ? 'the text after the table' : 'the Value cell';
        const text = check.inText ? table!.after : cells!.value;
        try {
          const { value, file: at } = codeValue(check.code, check.file);
          const shown = check.show(value);
          if (!holds(text, shown))
            problems.push(
              `${RULES}/${file}, row "${row}": ${check.code} = ${JSON.stringify(value)} (${at}) shows as "${shown}", not in ${where} "${text}"`,
            );
        } catch (e) {
          problems.push(`${RULES}/${file}, row "${row}": ${check.code}: ${(e as Error).message}`);
        }
      }
      expect(problems).toEqual([]);
    });
  }
});

describe('the reading', () => {
  it('matches whole number tokens only', () => {
    expect(holds('150 million', '15')).toBe(false);
    expect(holds('1.5 x IQR', '15')).toBe(false);
    expect(holds('1,500', '1')).toBe(false);
    expect(holds('under -15 %', '15 %')).toBe(false);
    expect(holds('under -15 %', '-15 %')).toBe(true);
    expect(holds('5 / 15 min, 10 / h', '15 min')).toBe(true);
    expect(holds('120 to 1,095', '120 to 1,095')).toBe(true);
    expect(holds('120 to 1,095', '20')).toBe(false);
  });

  it('evaluates the literals the code uses', () => {
    const none = () => {
      throw new Error('no names');
    };
    expect(evaluate('15 * 60 * 1000', none)).toBe(900_000);
    expect(evaluate('150_000_000', none)).toBe(150_000_000);
    expect(evaluate('[30, 90, 180]', none)).toEqual([30, 90, 180]);
    expect(evaluate('{ 180: 10, 365: 20 }', none)).toEqual({ 180: 10, 365: 20 });
    expect(evaluate('-0.05', none)).toBe(-0.05);
    expect(evaluate('2 ** 3 * (1 + 1)', none)).toBe(16);
    expect(evaluate('OTHER * 2', (n) => (n === 'OTHER' ? 3 : none()))).toBe(6);
    expect(() => evaluate('someCall(3)', none)).toThrow();
    expect(() => evaluate("'text'", none)).toThrow();
  });
});
