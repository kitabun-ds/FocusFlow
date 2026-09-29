(function () {
    "use strict";

    const root = document.getElementById("achievementsPage");
    const store = window.focusflowStore;
    if (!root || !store) return;

    const GOALS_KEY = "focusflow_goals";
    const STATE_KEY = "focusflow_user_state";
    const DAY_MS = 24 * 60 * 60 * 1000;
    let writingStreakNotice = false;

    function readJSON(key, fallback) {
        try {
            const value = JSON.parse(store.getItem(key) || "null");
            return value === null ? fallback : value;
        } catch (_) { return fallback; }
    }

    function dateKey(date) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    }

    function dateFromKey(key) {
        const [year, month, day] = key.split("-").map(Number);
        return new Date(year, month - 1, day);
    }

    function isDateKey(key) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(key || "")) return false;
        return dateKey(dateFromKey(key)) === key;
    }

    function isActive(record) {
        return Boolean(record && (record.activity === true
            || (Array.isArray(record.focusSessions) && record.focusSessions.some(session => Number(session && session.seconds) > 0))));
    }

    function hasGoalForDate(record) {
        return Boolean(record && Array.isArray(record.goals)
            && record.goals.some(goal => goal && goal.id != null));
    }

    function hasCurrentGoal(goals, now) {
        return goals.some(goal => {
            if (goal.id == null) return false;
            const createdAt = Date.parse(goal.createdAt || "");
            const expiresAt = Date.parse(goal.expiresAt || "");
            return !(Number.isFinite(createdAt) && createdAt > now.getTime())
                && !(Number.isFinite(expiresAt) && expiresAt <= now.getTime());
        });
    }

    function safePercent(value) { return Math.max(0, Math.min(100, Math.round(Number(value) || 0))); }

    function goalProgress(goal) {
        const target = Number(goal && goal.target) || 0;
        const invested = Number(goal && goal.invested) || 0;
        return target > 0 ? safePercent(invested / target * 100) : 0;
    }

    function setText(selector, value) {
        const node = root.querySelector(selector);
        if (node) node.textContent = String(value);
    }

    function setBar(selector, percentage) {
        const node = root.querySelector(selector);
        if (node) node.style.width = `${safePercent(percentage)}%`;
    }

    function getData() {
        const state = readJSON(STATE_KEY, {});
        const goalsValue = readJSON(GOALS_KEY, []);
        const historyObject = state && state.trackHistory && typeof state.trackHistory === "object"
            ? state.trackHistory : {};
        const today = dateKey(new Date());
        const history = Object.entries(historyObject)
            .map(([key, record]) => record && typeof record === "object"
                ? { ...record, date: isDateKey(record.date) ? record.date : key }
                : null)
            .filter(record => record && isDateKey(record.date) && record.date <= today)
            .sort((a, b) => a.date.localeCompare(b.date));
        const activeDates = Array.from(new Set(history.filter(isActive).map(record => record.date))).sort();
        // A saved date-scoped Track snapshot means the user was in FocusFlow
        // that day; its own goal snapshot proves a goal existed that day.
        // Today can also be established by current, unexpired goals while
        // this authenticated page is open. Keep this separate from active days.
        const streakDates = new Set(history.filter(hasGoalForDate).map(record => record.date));
        const currentGoals = Array.isArray(goalsValue)
            ? goalsValue.filter(goal => goal && typeof goal === "object") : [];
        if (hasCurrentGoal(currentGoals, new Date())) streakDates.add(today);
        return {
            state: state && typeof state === "object" ? state : {},
            goals: currentGoals,
            history,
            activeDates,
            streakDates: Array.from(streakDates).sort()
        };
    }

    function streakStats(dateKeys, today) {
        const set = new Set(dateKeys);
        let current = 0;
        const anchor = dateFromKey(today);
        if (!set.has(today)) anchor.setDate(anchor.getDate() - 1);
        if (set.has(dateKey(anchor))) {
            const cursor = new Date(anchor);
            while (set.has(dateKey(cursor))) {
                current += 1;
                cursor.setDate(cursor.getDate() - 1);
            }
        }
        let best = 0;
        let run = 0;
        let previous = null;
        dateKeys.forEach(key => {
            const date = dateFromKey(key);
            const utcDay = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
            const previousUtcDay = previous ? Date.UTC(previous.getFullYear(), previous.getMonth(), previous.getDate()) : null;
            if (previous && utcDay - previousUtcDay === DAY_MS) run += 1;
            else run = 1;
            best = Math.max(best, run);
            previous = date;
        });
        let breakLength = 0;
        const todayDate = dateFromKey(today);
        const yesterday = new Date(todayDate);
        yesterday.setDate(yesterday.getDate() - 1);
        const dayBeforeYesterday = new Date(yesterday);
        dayBeforeYesterday.setDate(dayBeforeYesterday.getDate() - 1);
        if (set.has(today) && !set.has(dateKey(yesterday)) && set.has(dateKey(dayBeforeYesterday))) {
            const cursor = new Date(dayBeforeYesterday);
            while (set.has(dateKey(cursor))) {
                breakLength += 1;
                cursor.setDate(cursor.getDate() - 1);
            }
        }
        return { current, best, breakLength };
    }

    function monthlyConsistency(activeDates, today) {
        const date = dateFromKey(today);
        const prefix = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-`;
        const activeDays = new Set(activeDates.filter(key => key.startsWith(prefix) && key <= today)).size;
        const elapsedDays = date.getDate();
        return { activeDays, elapsedDays, percentage: elapsedDays ? Math.round(activeDays / elapsedDays * 100) : 0 };
    }

    function uniqueFocusSessions(history) {
        const sessions = new Map();
        history.forEach(record => {
            (Array.isArray(record.focusSessions) ? record.focusSessions : []).forEach(session => {
                const seconds = Math.max(0, Number(session && session.seconds) || 0);
                if (!session || !seconds) return;
                const key = session.id == null
                    ? `${record.date}|${session.at || ""}|${seconds}|${session.goalId || ""}|${session.mode || ""}`
                    : `id:${session.id}`;
                if (!sessions.has(key)) sessions.set(key, seconds);
            });
        });
        return { count: sessions.size, seconds: Array.from(sessions.values()).reduce((sum, value) => sum + value, 0) };
    }

    function monthTracked(history, year, month) {
        const prefix = `${year}-${String(month + 1).padStart(2, "0")}-`;
        return history.filter(record => record.date.startsWith(prefix));
    }

    function renderHeatmap(history, today) {
        const heatmap = root.querySelector("[data-heatmap]");
        if (!heatmap) return;
        const byDate = new Map(history.map(record => [record.date, record]));
        const cells = [];
        const start = dateFromKey(today);
        start.setDate(start.getDate() - 89);
        for (let offset = 0; offset < 90; offset += 1) {
            const date = new Date(start);
            date.setDate(start.getDate() + offset);
            const key = dateKey(date);
            const record = byDate.get(key);
            const sessions = record && Array.isArray(record.focusSessions) ? record.focusSessions : [];
            const focusSeconds = Math.max(0, Number(record && record.focusSeconds) || 0);
            let intensity = 0;
            if (isActive(record)) {
                const amount = Math.max(sessions.length, focusSeconds / 1800, 1);
                intensity = amount >= 4 ? 4 : amount >= 2.5 ? 3 : amount >= 1.5 ? 2 : 1;
            }
            const cell = document.createElement("span");
            cell.className = `activity-heatmap-cell heat-intensity-${intensity}`;
            cell.setAttribute("aria-label", `${key}: ${isActive(record) ? "activity recorded" : "no recorded activity"}`);
            cell.title = `${date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })} · ${isActive(record) ? `${sessions.length} focus session${sessions.length === 1 ? "" : "s"}` : "No recorded activity"}`;
            cells.push(cell);
        }
        heatmap.replaceChildren(...cells);
    }

    function formatFocusTime(seconds) {
        const total = Math.max(0, Math.round(Number(seconds) || 0));
        if (!total) return "0h";
        if (total < 60) return `${total}s`;
        const hours = Math.floor(total / 3600);
        const minutes = Math.floor(total % 3600 / 60);
        return hours ? `${hours}h${minutes ? ` ${minutes}m` : ""}` : `${minutes}m`;
    }

    function render() {
        const data = getData();
        const now = new Date();
        const today = dateKey(now);
        const currentMonth = monthTracked(data.history, now.getFullYear(), now.getMonth());
        const activeMonthDays = monthlyConsistency(data.activeDates, today);
        const streak = streakStats(data.streakDates, today);
        const currentGoalProgress = data.goals.map(goalProgress);
        const goalAverage = currentGoalProgress.length
            ? Math.round(currentGoalProgress.reduce((sum, value) => sum + value, 0) / currentGoalProgress.length) : 0;
        const savedMonthlyProgress = currentMonth.map(record => Number(record.goalProgress)).filter(Number.isFinite);
        const monthlyProgress = savedMonthlyProgress.length
            ? Math.round(savedMonthlyProgress.reduce((sum, value) => sum + safePercent(value), 0) / savedMonthlyProgress.length)
            : goalAverage;
        const consistency = activeMonthDays.percentage;
        const sessionDates = new Set(currentMonth.filter(record => isActive(record) && Array.isArray(record.focusSessions) && record.focusSessions.some(session => Number(session && session.seconds) > 0)).map(record => record.date));
        const discipline = currentMonth.length ? Math.round(sessionDates.size / currentMonth.length * 100) : 0;
        const focusSessions = uniqueFocusSessions(data.history);
        const sessions = focusSessions.count;
        const legacyFocusSeconds = data.history.reduce((total, record) => {
            const hasSessions = Array.isArray(record.focusSessions) && record.focusSessions.some(session => Number(session && session.seconds) > 0);
            return total + (!hasSessions ? Math.max(0, Number(record.focusSeconds) || 0) : 0);
        }, 0);
        const focusSeconds = focusSessions.seconds + legacyFocusSeconds;
        const completedGoalIds = new Set();
        data.history.forEach(record => {
            (Array.isArray(record.goals) ? record.goals : []).forEach(goal => {
                if (goal && goal.id != null && (goal.completed === true || Number(String(goal.progress).replace("%", "")) >= 100)) completedGoalIds.add(String(goal.id));
            });
        });
        data.goals.forEach(goal => {
            if (goal.id != null && goalProgress(goal) >= 100) completedGoalIds.add(String(goal.id));
        });
        const completedGoals = completedGoalIds.size;

        setText("[data-streak-days]", streak.current);
        let streakMessage;
        const shownBreakDate = data.state.achievementsStreakBreakShownDate;
        if (streak.breakLength > 0 && shownBreakDate !== today) {
            streakMessage = `Your ${streak.breakLength}-day streak ended after a missed day. Today starts a new streak.`;
            data.state.achievementsStreakBreakShownDate = today;
            writingStreakNotice = true;
            store.setItem(STATE_KEY, JSON.stringify(data.state));
            writingStreakNotice = false;
        } else {
            streakMessage = streak.current > 0
                ? "Your steady focus is adding up. Keep the momentum going."
                : "Start today to build your first streak.";
        }
        setText("[data-streak-message]", streakMessage);
        const visualRatio = streak.current ? Math.min(.94, streak.current / (streak.current + 5)) : .04;
        const streakRing = root.querySelector("[data-streak-ring]");
        if (streakRing) streakRing.style.transform = `rotate(${visualRatio * 360 - 38}deg)`;

        setText("[data-consistency]", `${consistency}%`);
        setText("[data-active-days]", activeMonthDays.activeDays);
        setText("[data-tracked-days]", activeMonthDays.elapsedDays);
        setText("[data-best-streak]", streak.best);
        setText("[data-overall-progress]", `${monthlyProgress}%`);
        const ring = root.querySelector("[data-progress-ring]");
        if (ring) ring.style.setProperty("--progress-angle", `${monthlyProgress * 3.6}deg`);
        setText("[data-metric-consistency]", `${consistency}%`);
        setText("[data-metric-progress]", `${goalAverage}%`);
        setText("[data-metric-discipline]", `${discipline}%`);
        setBar("[data-bar-consistency]", consistency);
        setBar("[data-bar-progress]", goalAverage);
        setBar("[data-bar-discipline]", discipline);

        setText("[data-focus-time]", formatFocusTime(focusSeconds));
        setText("[data-goals-completed]", completedGoals);
        setText("[data-focus-sessions]", sessions);
        setText("[data-total-active-days]", data.activeDates.length);
        renderHeatmap(data.history, today);
    }

    render();
    window.addEventListener("focusflow:data-change", event => {
        if (writingStreakNotice && event.detail && event.detail.key === STATE_KEY) return;
        if (!event.detail || [GOALS_KEY, STATE_KEY].includes(event.detail.key)) render();
    });
})();
