const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const russianMonthFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long"
});

const russianFullDateFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  year: "numeric"
});

const russianWeekdayFormatter = new Intl.DateTimeFormat("ru-RU", {
  weekday: "long"
});

const russianShortWeekdayFormatter = new Intl.DateTimeFormat("ru-RU", {
  weekday: "short"
});

export function toDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function fromDateKey(key) {
  const match = DATE_KEY_PATTERN.exec(key);
  if (!match) {
    throw new TypeError(`Invalid local date key: ${key}`);
  }

  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  if (toDateKey(date) !== key) {
    throw new TypeError(`Invalid local date key: ${key}`);
  }
  return date;
}

export function isDateKey(value) {
  if (typeof value !== "string" || !DATE_KEY_PATTERN.test(value)) return false;
  try {
    return toDateKey(fromDateKey(value)) === value;
  } catch {
    return false;
  }
}

export function shiftDateKey(key, dayDelta) {
  const date = fromDateKey(key);
  date.setDate(date.getDate() + dayDelta);
  return toDateKey(date);
}

export function getDateWindow(endKey, length) {
  const safeLength = Math.max(1, Math.floor(length));
  return Array.from({ length: safeLength }, (_, index) =>
    shiftDateKey(endKey, index - safeLength + 1)
  );
}

export function capitalize(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

export function getDateButtonParts(key, todayKey) {
  const date = fromDateKey(key);
  const weekday = russianShortWeekdayFormatter
    .format(date)
    .replace(".", "")
    .slice(0, 2);

  return {
    weekday: key === todayKey ? "сег" : weekday,
    dayNumber: String(date.getDate()),
    ariaLabel: key === todayKey
      ? `Сегодня, ${russianFullDateFormatter.format(date)}`
      : capitalize(`${russianWeekdayFormatter.format(date)}, ${russianFullDateFormatter.format(date)}`)
  };
}

export function getSelectedDateCopy(key, todayKey) {
  const date = fromDateKey(key);
  const yesterdayKey = shiftDateKey(todayKey, -1);
  let kicker = capitalize(russianWeekdayFormatter.format(date));

  if (key === todayKey) kicker = "Сегодня";
  if (key === yesterdayKey) kicker = "Вчера";

  return {
    kicker: kicker.toUpperCase(),
    title: capitalize(russianMonthFormatter.format(date))
  };
}

export function formatOverviewRange(dateKeys) {
  if (!dateKeys.length) return "";
  const start = fromDateKey(dateKeys[0]);
  const end = fromDateKey(dateKeys.at(-1));

  const getPart = (date, type) => russianFullDateFormatter
    .formatToParts(date)
    .find((part) => part.type === type)?.value ?? "";

  if (start.getFullYear() !== end.getFullYear()) {
    return `${russianFullDateFormatter.format(start)} — ${russianFullDateFormatter.format(end)}`;
  }

  if (start.getMonth() !== end.getMonth()) {
    return `${start.getDate()} ${getPart(start, "month")} — ${end.getDate()} ${getPart(end, "month")} ${end.getFullYear()}`;
  }

  return `${start.getDate()}–${end.getDate()} ${getPart(end, "month")} ${end.getFullYear()}`;
}

export function formatGeneratedAt(timestamp = Date.now()) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

export function formatOverviewDateHeader(key) {
  const date = fromDateKey(key);
  return {
    weekday: russianShortWeekdayFormatter.format(date).replace(".", "").toUpperCase(),
    date: `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}`
  };
}
