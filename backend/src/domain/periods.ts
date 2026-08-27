export type AnalyticsPeriod = "today" | "7d" | "30d" | "6m";

export type PeriodWindow = {
  start: Date;
  end: Date;
  comparisonStart: Date;
  comparisonEnd: Date;
};

export type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
};

const localFormatterCache = new Map<string, Intl.DateTimeFormat>();
const LOCAL_DATE_TIME_CACHE_LIMIT = 16_384;
const localDateTimeCache = new Map<string, number | null>();

const getFormatter = (timeZone: string): Intl.DateTimeFormat => {
  const cached = localFormatterCache.get(timeZone);
  if (cached) {
    return cached;
  }
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    calendar: "gregory",
    numberingSystem: "latn",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  localFormatterCache.set(timeZone, formatter);
  return formatter;
};

const parts = (date: Date, timeZone: string): LocalParts => {
  const values = Object.fromEntries(
    getFormatter(timeZone)
      .formatToParts(date)
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, Number(value)]),
  ) as Record<string, number>;
  return {
    year: values.year!,
    month: values.month!,
    day: values.day!,
    hour: values.hour!,
    minute: values.minute!,
    second: values.second!,
    millisecond: date.getUTCMilliseconds(),
  };
};

const localAsUtc = (value: LocalParts): number =>
  Date.UTC(
    value.year,
    value.month - 1,
    value.day,
    value.hour,
    value.minute,
    value.second,
    value.millisecond,
  );

const fromLocal = (value: LocalParts, timeZone: string): Date => {
  const target = localAsUtc(value);
  let candidate = target;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const actual = parts(new Date(candidate), timeZone);
    const offset = localAsUtc(actual) - candidate;
    const next = target - offset;
    if (next === candidate) {
      return new Date(candidate);
    }
    candidate = next;
  }
  return new Date(candidate);
};

const sameLocalParts = (left: LocalParts, right: LocalParts): boolean =>
  left.year === right.year &&
  left.month === right.month &&
  left.day === right.day &&
  left.hour === right.hour &&
  left.minute === right.minute &&
  left.second === right.second &&
  left.millisecond === right.millisecond;

/**
 * Convert a wall-clock timestamp without inventing a time during a DST gap.
 * The fixed-point conversion starts with the pre-transition offset, so an
 * ambiguous fold resolves to the earliest UTC occurrence.
 */
export const localDateTimeToUtc = (value: LocalParts, timeZone: string): Date | null => {
  const cacheKey = `${timeZone}|${value.year}-${value.month}-${value.day}T${value.hour}:${value.minute}:${value.second}.${value.millisecond}`;
  if (localDateTimeCache.has(cacheKey)) {
    const cached = localDateTimeCache.get(cacheKey)!;
    return cached === null ? null : new Date(cached);
  }

  const candidate = fromLocal(value, timeZone);
  const result = sameLocalParts(parts(candidate, timeZone), value) ? candidate : null;
  localDateTimeCache.set(cacheKey, result?.getTime() ?? null);
  if (localDateTimeCache.size > LOCAL_DATE_TIME_CACHE_LIMIT) {
    const oldest = localDateTimeCache.keys().next().value;
    if (oldest) localDateTimeCache.delete(oldest);
  }
  return result;
};

const calendarDate = (value: LocalParts, months: number, days: number): LocalParts => {
  if (months === 0) {
    const normalized = new Date(Date.UTC(value.year, value.month - 1, value.day + days));
    return {
      ...value,
      year: normalized.getUTCFullYear(),
      month: normalized.getUTCMonth() + 1,
      day: normalized.getUTCDate(),
    };
  }

  const monthIndex = value.year * 12 + value.month - 1 + months;
  const year = Math.floor(monthIndex / 12);
  const month = monthIndex - year * 12 + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { ...value, year, month, day: Math.min(value.day, lastDay) };
};

const addCalendar = (date: Date, timeZone: string, months: number, days: number): Date =>
  fromLocal(calendarDate(parts(date, timeZone), months, days), timeZone);

const startOfLocalDay = (date: Date, timeZone: string): Date => {
  const value = parts(date, timeZone);
  return fromLocal({ ...value, hour: 0, minute: 0, second: 0, millisecond: 0 }, timeZone);
};

const periodSpan = (period: AnalyticsPeriod): { months: number; days: number } => {
  switch (period) {
    case "7d":
      return { months: 0, days: 7 };
    case "30d":
      return { months: 0, days: 30 };
    case "6m":
      return { months: 6, days: 0 };
    case "today":
      return { months: 0, days: 1 };
  }
};

export function resolvePeriodWindow(
  now: Date,
  timeZone: string,
  period: AnalyticsPeriod,
): PeriodWindow {
  const end = new Date(now);
  if (period === "today") {
    const start = startOfLocalDay(end, timeZone);
    const comparisonEnd = addCalendar(end, timeZone, 0, -1);
    const comparisonStart = startOfLocalDay(comparisonEnd, timeZone);
    return { start, end, comparisonStart, comparisonEnd };
  }

  const span = periodSpan(period);
  const start = addCalendar(end, timeZone, -span.months, -span.days);
  const comparisonEnd = start;
  const comparisonStart = addCalendar(start, timeZone, -span.months, -span.days);
  return { start, end, comparisonStart, comparisonEnd };
}

export function localDateKey(date: Date, timeZone: string): string {
  const value = parts(date, timeZone);
  return [value.year, value.month, value.day]
    .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, "0"))
    .join("-");
}

export function localHourKey(date: Date, timeZone: string): string {
  const value = parts(date, timeZone);
  return `${localDateKey(date, timeZone)}T${String(value.hour).padStart(2, "0")}`;
}

export function localCalendarParts(date: Date, timeZone: string): LocalParts {
  return parts(date, timeZone);
}

export function localWeekdayAndHour(
  date: Date,
  timeZone: string,
): { weekday: number; hour: number } {
  const value = parts(date, timeZone);
  const weekday = new Date(Date.UTC(value.year, value.month - 1, value.day)).getUTCDay();
  return { weekday, hour: value.hour };
}
