const TYPE_CATEGORIES = {
  morning: ["morning"],
  night: ["night"],
  incomplete_goals: ["incomplete_goals", "progress", "focus"],
  streak: ["streak", "consistency"],
  completion: ["completion", "goal_start"],
  comeback: ["comeback", "consistency"],
};

export function parseStoredValue(value, fallback) {
  if (typeof value !== "string") return value ?? fallback;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function localParts(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const year = Number(values.year);
  const month = Number(values.month);
  const day = Number(values.day);
  const hour = Number(values.hour);
  const minute = Number(values.minute);
  return {
    year, month, day, hour, minute,
    date: `${values.year}-${values.month}-${values.day}`,
  };
}

function calendarDayDifference(from, to) {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.floor((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

export function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isMeaningful(record) {
  return Boolean(record && (record.activity === true
    || asArray(record.focusSessions).some(session => Number(session?.seconds) > 0)));
}

function meaningfulDates(history, timezone) {
  const dates = new Set();
  let latestAt = null;
  let latestDate = null;
  for (const [key, record] of Object.entries(history || {})) {
    if (!isMeaningful(record)) continue;
    const recordDate = typeof record?.date === "string" ? record.date : key;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(recordDate)) continue;
    const explicit = Date.parse(record?.lastMeaningfulActivityAt || "");
    if (record.activity === true) {
      const activityDate = Number.isFinite(explicit)
        ? localParts(new Date(explicit), timezone).date : recordDate;
      dates.add(activityDate);
      if (Number.isFinite(explicit) && (latestAt === null || explicit > latestAt)) latestAt = explicit;
      if (!latestDate || activityDate > latestDate) latestDate = activityDate;
    }
    for (const session of asArray(record?.focusSessions)) {
      if (Number(session?.seconds) <= 0) continue;
      const at = Date.parse(session?.at || "");
      const sessionDate = Number.isFinite(at) ? localParts(new Date(at), timezone).date : recordDate;
      dates.add(sessionDate);
      if (!latestDate || sessionDate > latestDate) latestDate = sessionDate;
      if (Number.isFinite(at) && (latestAt === null || at > latestAt)) latestAt = at;
    }
  }
  if (latestAt !== null) latestDate = localParts(new Date(latestAt), timezone).date;
  return { dates, latestAt, latestDate };
}

function activeGoals(goals, nowMs) {
  return goals.filter(goal => {
    if (!goal || goal.id == null || !String(goal.name || "").trim()) return false;
    const target = Number(goal.target);
    if (!Number.isFinite(target) || target <= 0 || !String(goal.unit || "").trim()) return false;
    const expiry = Date.parse(goal.expiresAt || "");
    return !Number.isFinite(expiry) || expiry > nowMs;
  });
}

function goalCreatedDate(goal, timezone) {
  const explicitCreatedAt = Date.parse(goal?.createdAt || "");
  const expiry = Date.parse(goal?.expiresAt || "");
  const createdAt = Number.isFinite(explicitCreatedAt)
    ? explicitCreatedAt
    : Number.isFinite(expiry) ? expiry - 24 * 60 * 60 * 1000 : Number.NaN;
  return Number.isFinite(createdAt) ? localParts(new Date(createdAt), timezone).date : null;
}

function isCompleted(goal) {
  const target = Number(goal?.target);
  const invested = Number(goal?.invested);
  return target > 0 && Number.isFinite(invested) && invested >= target;
}

function chooseQuoteCategory(userId, type, date) {
  const candidates = TYPE_CATEGORIES[type] || [type];
  const seed = `${userId}:${type}:${date}`;
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return candidates[hash % candidates.length];
}

function goalCreatedAtIsToday(goal, date, timezone) {
  return goalCreatedDate(goal, timezone) === date;
}

export function taskForUser(userId, preferences, goals, state, now) {
  let timezone = typeof preferences.timezone === "string" ? preferences.timezone : "UTC";
  let today;
  try {
    today = localParts(now, timezone);
  } catch (_) {
    timezone = "UTC";
    today = localParts(now, timezone);
  }
  const history = state?.trackHistory && typeof state.trackHistory === "object"
    ? state.trackHistory : {};
  const active = activeGoals(goals, now.getTime());
  const activity = meaningfulDates(history, timezone);
  const hasActivityToday = [...activity.dates].some(date => date === today.date);
  const savedTodayGoals = asArray(history[today.date]?.goals);
  const createdToday = active.some(goal => goalCreatedDate(goal, timezone) === today.date)
    || savedTodayGoals.some(goal => goalCreatedAtIsToday(goal, today.date, timezone));
  const tomorrow = new Date(Date.UTC(today.year, today.month - 1, today.day + 1));
  const tomorrowKey = `${tomorrow.getUTCFullYear()}-${String(tomorrow.getUTCMonth() + 1).padStart(2, "0")}-${String(tomorrow.getUTCDate()).padStart(2, "0")}`;
  const createdTomorrow = active.some(goal => goalCreatedDate(goal, timezone) === tomorrowKey);
  const incomplete = active.filter(goal => !isCompleted(goal));
  const allComplete = active.length > 0 && incomplete.length === 0;
  const candidates = [];

  if (allComplete && createdToday && hasActivityToday) {
    candidates.push({ type: "completion", eventKey: `completion:${today.date}`, quoteCategory: chooseQuoteCategory(userId, "completion", today.date), path: "/goals" });
  }

  const expiring = active
    .map(goal => ({ goal, expiry: Date.parse(goal.expiresAt || "") }))
    .filter(item => Number.isFinite(item.expiry) && item.expiry > now.getTime() && item.expiry - now.getTime() <= 24 * 60 * 60 * 1000)
    .sort((a, b) => a.expiry - b.expiry)[0];
  if (expiring && !createdTomorrow && today.hour >= 19 && today.hour < 23) {
    candidates.push({
      type: "night",
      eventKey: `expiry:${new Date(expiring.expiry).toISOString()}`,
      quoteCategory: "night",
      path: "/goals",
    });
  }

  if (!createdToday && today.hour >= 7 && today.hour < 10) {
    candidates.push({ type: "morning", eventKey: `morning:${today.date}`, quoteCategory: "morning", path: "/goals" });
  }

  if (activity.latestDate && today.hour >= 9 && today.hour < 21) {
    const inactiveDays = calendarDayDifference(activity.latestDate, today.date);
    if (inactiveDays >= 3) {
      candidates.push({
        type: "comeback",
        eventKey: `inactive-since:${activity.latestDate}`,
        quoteCategory: chooseQuoteCategory(userId, "comeback", today.date),
        path: "/focus",
      });
    }
  }

  let previousActiveRun = 0;
  for (let offset = 1; offset <= 365; offset += 1) {
    const date = new Date(Date.UTC(today.year, today.month - 1, today.day - offset));
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
    if (!activity.dates.has(key)) break;
    previousActiveRun += 1;
  }
  if (previousActiveRun > 0 && !hasActivityToday && today.hour >= 15 && today.hour < 22) {
    candidates.push({ type: "streak", eventKey: `streak:${today.date}`, quoteCategory: chooseQuoteCategory(userId, "streak", today.date), path: "/focus" });
  }

  let inactiveHours = Number.POSITIVE_INFINITY;
  if (activity.latestAt !== null) inactiveHours = (now.getTime() - activity.latestAt) / 3_600_000;
  else if (activity.latestDate === today.date) inactiveHours = 0;
  else if (activity.latestDate) inactiveHours = calendarDayDifference(activity.latestDate, today.date) * 24 + today.hour;
  else {
    const latestGoalCreatedAt = Math.max(...active
      .map(goal => Date.parse(goal.createdAt || ""))
      .filter(Number.isFinite));
    if (Number.isFinite(latestGoalCreatedAt)) {
      inactiveHours = (now.getTime() - latestGoalCreatedAt) / 3_600_000;
    }
  }
  if (incomplete.length > 0 && inactiveHours >= 6 && today.hour >= 13 && today.hour < 21) {
    candidates.push({ type: "incomplete_goals", eventKey: `incomplete:${today.date}`, quoteCategory: chooseQuoteCategory(userId, "incomplete_goals", today.date), path: "/goals" });
  }

  return candidates.filter(candidate => preferences.categories?.[candidate.type] !== false);
}
