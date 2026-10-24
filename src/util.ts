export interface CronField {
  isStar: boolean;
  set: Set<number>;
  values: number[];
}

export type ParsedCron = CronField[];

const NICKNAMES: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *'
};

const MONTH_NAMES: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12
};
const DAY_NAMES: Record<string, number> = {sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6};

const FIELDS: Array<[string, number, number, Record<string, number>?]> = [
  ['minute', 0, 59],
  ['hour', 0, 23],
  ['day-of-month', 1, 31],
  ['month', 1, 12, MONTH_NAMES],
  ['day-of-week', 0, 7, DAY_NAMES]
];

/**
 * Enforce limits and generate list of currently desired tasks.
 */
export function desiredTasks(
  limits: Record<string, number>,
  availableTasks: string[],
  activeTasks: string[]
): string[] {
  const count: Record<string, number> = {};
  for (const task of activeTasks) count[task] = (count[task] ?? 0) + 1;

  const desired = [];
  for (const task of availableTasks) {
    const limit = limits[task];
    if (limit === undefined || (count[task] ?? 0) < limit) desired.push(task);
  }

  return desired;
}

/**
 * Calculate the next time a cron expression matches after a given time, in UTC.
 */
export function nextCronTime(cron: string | ParsedCron, from: Date): Date {
  const parsed = typeof cron === 'string' ? parseCron(cron) : cron;
  const [minutes, hours, , months] = parsed;

  let t = Math.floor(from.getTime() / 60000) * 60000 + 60000;
  const limit = t + 5 * 366 * 86400000;
  while (t < limit) {
    const date = new Date(t);
    const min = date.getUTCMinutes();
    const hour = date.getUTCHours();
    const mday = date.getUTCDate();
    const mon = date.getUTCMonth() + 1;
    const year = date.getUTCFullYear();
    const wday = date.getUTCDay();

    // Month
    if (months.set.has(mon) === false) {
      const next = nextValue(months.values, mon);
      t = next !== undefined ? Date.UTC(year, next - 1, 1) : Date.UTC(year + 1, months.values[0] - 1, 1);
      continue;
    }

    // Day of month / day of week (Vixie OR semantics)
    if (dayMatch(parsed, mday, wday) === false) {
      t = Date.UTC(year, mon - 1, mday + 1);
      continue;
    }

    // Hour
    if (hours.set.has(hour) === false) {
      const next = nextValue(hours.values, hour);
      t = next !== undefined ? Date.UTC(year, mon - 1, mday, next) : Date.UTC(year, mon - 1, mday + 1);
      continue;
    }

    // Minute
    if (minutes.set.has(min) === false) {
      const next = nextValue(minutes.values, min);
      t = next !== undefined ? Date.UTC(year, mon - 1, mday, hour, next) : Date.UTC(year, mon - 1, mday, hour + 1);
      continue;
    }

    return date;
  }

  throw new Error('No matching time found for cron expression');
}

/**
 * Parse cron expression.
 */
export function parseCron(expr: string): ParsedCron {
  if (expr.startsWith('@') === true) {
    const nickname = NICKNAMES[expr];
    if (nickname === undefined) throw new Error(`Unknown cron nickname "${expr}"`);
    expr = nickname;
  }

  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error(`Invalid cron expression "${expr}": expected 5 fields`);

  return fields.map((field, i) => parseField(field, ...FIELDS[i]));
}

function dayMatch(parsed: ParsedCron, mday: number, wday: number): boolean {
  const [, , days, , weekdays] = parsed;
  if (days.isStar === true && weekdays.isStar === true) return true;
  if (days.isStar === true) return weekdays.set.has(wday);
  if (weekdays.isStar === true) return days.set.has(mday);
  return days.set.has(mday) || weekdays.set.has(wday);
}

function nextValue(values: number[], after: number): number | undefined {
  return values.find(value => value >= after);
}

function parseField(field: string, name: string, min: number, max: number, names?: Record<string, number>): CronField {
  const set = new Set<number>();
  for (const part of field.split(',')) {
    const [range, step = '1'] = part.split(/\/(.*)/s);
    if (/^[1-9]\d*$/.test(step) === false) throw new Error(`Invalid step "${step}" in ${name} field`);

    let a: number, b: number;
    let match: RegExpMatchArray | null;
    if (range === '*') {
      [a, b] = [min, max];
    } else if ((match = range.match(/^(\w+)-(\w+)$/)) !== null) {
      [a, b] = [resolve(match[1], name, names), resolve(match[2], name, names)];
    } else if (/^\w+$/.test(range) === true) {
      a = b = resolve(range, name, names);
    } else {
      throw new Error(`Invalid ${name} field "${part}"`);
    }
    if (a < min || b > max || a > b) throw new Error(`Value out of range in ${name} field "${part}" (${min}-${max})`);

    for (let v = a; v <= b; v += parseInt(step)) set.add(v);
  }

  // Day-of-week 7 is an alias for Sunday (0)
  if (name === 'day-of-week' && set.delete(7) === true) set.add(0);

  return {isStar: field === '*', set, values: [...set].sort((a, b) => a - b)};
}

function resolve(value: string, name: string, names?: Record<string, number>): number {
  if (/^\d+$/.test(value) === true) return parseInt(value);
  const resolved = names?.[value.toLowerCase()];
  if (resolved === undefined) throw new Error(`Invalid name "${value}" in ${name} field`);
  return resolved;
}
