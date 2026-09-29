(function () {
    "use strict";

    const GOALS_KEY = "focusflow_goals";
    const STATE_KEY = "focusflow_user_state";
    const root = document.getElementById("trackPage");
    if (!root || !window.focusflowStore) return;

    const now = new Date();
    let view = "overview";
    let overviewPeriod = "daily";
    let selectedDate = dateKey(now);
    let selectedMonth = monthKey(now);
    let selectedYear = now.getFullYear();
    let selectedMonthDay = null;
    let selectedYearMonth = null;
    let showAllHistory = false;
    let weeklyTooltipPinned = false;

    function readJSON(key, fallback) {
        try {
            const value = JSON.parse(window.focusflowStore.getItem(key) || "null");
            return value === null ? fallback : value;
        } catch (_) { return fallback; }
    }

    function debugTrack(label, details) {
        if (typeof window.focusflowDebugLog === "function") {
            window.focusflowDebugLog(label, details);
        }
    }

    function dateKey(date) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    }

    function monthKey(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`; }
    function parseDate(value) { const [year, month, day] = value.split("-").map(Number); return new Date(year, month - 1, day); }
    function dateLabel(value, options = { month: "long", day: "numeric", year: "numeric" }) {
        return parseDate(value).toLocaleDateString(undefined, options);
    }

    function getData() {
        let state = readJSON(STATE_KEY, {});
        let goals = typeof window.focusflowGetActiveGoals === "function"
            ? window.focusflowGetActiveGoals()
            : readJSON(GOALS_KEY, []);
        state = readJSON(STATE_KEY, state);
        let history = state && state.trackHistory && typeof state.trackHistory === "object"
            ? Object.fromEntries(Object.entries(state.trackHistory).map(([key, record]) => [key,
                record && typeof record === "object" ? { ...record, date: record.date || key } : record])) : {};
        const today = dateKey(new Date());
        const currentGoals = (Array.isArray(goals) ? goals : [])
            .filter(goal => typeof window.focusflowIsSavedGoal !== "function" || window.focusflowIsSavedGoal(goal));
        const hasTodayFocus = state.lastFocusDate === today && Number(state.todayFocusSeconds) > 0;
        const hasSavedGoals = currentGoals.length > 0;
        if (!history[today] && (hasTodayFocus || hasSavedGoals) && typeof window.focusflowRecordTrackSnapshot === "function") {
            window.focusflowRecordTrackSnapshot(currentGoals, { point: true });
            state = readJSON(STATE_KEY, {});
            history = state && state.trackHistory && typeof state.trackHistory === "object"
                ? Object.fromEntries(Object.entries(state.trackHistory).map(([key, record]) => [key,
                    record && typeof record === "object" ? { ...record, date: record.date || key } : record])) : {};
        }
        const todayRecord = history[today];
        if (todayRecord && needsTodaySnapshotRepair(todayRecord, currentGoals, today)
            && typeof window.focusflowRecordTrackSnapshot === "function") {
            // Repair only the current date. Older history remains untouched,
            // while storage rebuilds today's totals from today's sessions and goals.
            window.focusflowRecordTrackSnapshot(currentGoals, {});
            state = readJSON(STATE_KEY, {});
            history = state && state.trackHistory && typeof state.trackHistory === "object"
                ? Object.fromEntries(Object.entries(state.trackHistory).map(([key, record]) => [key,
                    record && typeof record === "object" ? { ...record, date: record.date || key } : record])) : {};
        }

        goals = currentGoals;
        return { state: state || {}, goals, history };
    }

    function needsTodaySnapshotRepair(record, currentGoals, today) {
        if (!record || record.date !== today || Number(record.legacyFocusSeconds) > 0) return true;
        const points = Array.isArray(record.progressPoints) ? record.progressPoints : [];
        if (points.some(point => {
            const pointAt = Date.parse(point && point.at || "");
            return !Number.isFinite(pointAt) || dateKey(new Date(pointAt)) !== today;
        })) return true;
        const currentById = new Map(currentGoals.map(goal => [String(goal.id), goal]));
        const sessions = Array.isArray(record.focusSessions) ? record.focusSessions : [];
        const savedGoalIds = new Set((Array.isArray(record.goals) ? record.goals : [])
            .filter(goal => goal && goal.id != null).map(goal => String(goal.id)));
        if (sessions.some(session => {
            const sessionAt = Date.parse(session && session.at || "");
            const sessionDate = session && session.date
                || (Number.isFinite(sessionAt) ? dateKey(new Date(sessionAt)) : null);
            return sessionDate !== today
                || (session && session.goalId != null
                    && !currentById.has(String(session.goalId))
                    && !savedGoalIds.has(String(session.goalId)));
        })) return true;
        const savedFocus = Number(record.focusSeconds);
        const actualFocus = focusSessionsForDate(record)
            .reduce((sum, session) => sum + Number(session.seconds), 0);
        if (Number.isFinite(savedFocus) && Math.abs(savedFocus - actualFocus) > 0.001) return true;

        const savedGoals = Array.isArray(record.goals) ? record.goals.filter(goal => goal && !goal.deleted) : [];
        if (savedGoals.length !== currentById.size) return true;
        return savedGoals.some(saved => {
            const current = currentById.get(String(saved.id));
            const savedInvested = saved.invested == null || String(saved.invested).trim() === ""
                ? null : Number(saved.invested);
            const currentInvested = current && (current.invested == null || String(current.invested).trim() === ""
                ? null : Number(current.invested));
            return !current
                || Number(saved.target) !== Number(current.target)
                || String(saved.unit || "") !== String(current.unit || "")
                || savedInvested !== currentInvested;
        });
    }

    function averageProgress(goals) {
        return goals.length ? Math.round(goals.reduce((sum, goal) => sum + (Number(goal.progress) || 0), 0) / goals.length) : 0;
    }

    function records(data) {
        return Object.entries(data.history).map(([key, record]) => {
            if (!record || typeof record !== "object") return null;
            const date = /^\d{4}-\d{2}-\d{2}$/.test(record.date || "") ? record.date : key;
            return /^\d{4}-\d{2}-\d{2}$/.test(date) ? { ...record, date } : null;
        }).filter(Boolean).sort((a, b) => a.date.localeCompare(b.date));
    }

    function progressOf(record) {
        if (!record) return null;
        if (record.goalProgress !== null && record.goalProgress !== undefined && String(record.goalProgress).trim() !== ""
            && Number.isFinite(Number(String(record.goalProgress).replace(/%$/, "")))) {
            return Math.max(0, Math.min(100, Number(String(record.goalProgress).replace(/%$/, ""))));
        }
        const savedGoals = Array.isArray(record.goals) ? record.goals.filter(goal => goal && !goal.deleted) : [];
        if (savedGoals.length) {
            const values = savedGoals.map(goal => {
                const raw = goal.progress;
                if (raw !== null && raw !== undefined && String(raw).trim() !== "" && Number.isFinite(Number(String(raw).replace(/%$/, "")))) {
                    return Math.min(100, Math.max(0, Number(String(raw).replace(/%$/, ""))));
                }
                const target = Number(goal.target), invested = Number(goal.invested);
                if (Number.isFinite(target) && target > 0 && Number.isFinite(invested)) return Math.min(100, Math.max(0, invested / target * 100));
                return goal.completed === true ? 100 : 0;
            });
            return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
        }
        return averageProgress([]);
    }

    function dailyGoalProgress(record) {
        if (!record) return 0;
        const savedDailyProgress = Number(record.goalProgress);
        if (record.goalProgress !== null && record.goalProgress !== undefined
            && String(record.goalProgress).trim() !== "" && Number.isFinite(savedDailyProgress)) {
            return Math.max(0, Math.min(100, savedDailyProgress));
        }
        const savedGoals = Array.isArray(record.goals)
            ? record.goals.filter(goal => goal && !goal.deleted)
            : [];
        if (savedGoals.length) {
            const percentages = savedGoals.map(goal => {
                const target = Number(goal.target);
                const invested = Number(goal.invested);
                const savedProgress = Number(goal.progress);
                return Number.isFinite(savedProgress) ? Math.min(100, Math.max(0, savedProgress))
                    : target > 0 && Number.isFinite(invested) ? Math.min(100, Math.max(0, invested / target * 100)) : (goal.completed ? 100 : 0);
            });
            return percentages.reduce((sum, value) => sum + value, 0) / percentages.length;
        }
        return 0;
    }

    function weeklyProgressPoints(data, today = new Date()) {
        return Array.from({ length: 7 }, (_, index) => {
            const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6 + index);
            const key = dateKey(day);
            const isToday = index === 6;
        const value = dailyGoalProgress(data.history[key]);
            const exactDate = dateLabel(key, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
            return {
                x: index / 6,
                value,
                label: `${day.toLocaleDateString(undefined, { weekday: "short" })} ${day.getDate()}`,
                title: exactDate,
                tooltip: `${exactDate}: ${value}%`
            };
        });
    }

    function actualFocusSecondsForDate(record) {
        if (!record) return 0;
        const sessions = focusSessionsForDate(record);
        const sessionSeconds = sessions.reduce((sum, session) => sum + Number(session.seconds), 0);
        const hasStoredSessions = Array.isArray(record.focusSessions) && record.focusSessions.length > 0;
        const legacy = Number(record.legacyFocusSeconds);
        const savedAggregate = Number(record.focusSeconds);
        const isToday = record.date === dateKey(new Date());
        const legacySeconds = isToday ? 0
            : Number.isFinite(legacy) && legacy >= 0 ? legacy
                : !hasStoredSessions && Number.isFinite(savedAggregate) && savedAggregate > 0 ? savedAggregate : 0;
        return legacySeconds + sessionSeconds;
    }

    function focusSessionsForDate(record) {
        const sessions = Array.isArray(record && record.focusSessions) ? record.focusSessions : [];
        const deletedGoalIds = new Set((Array.isArray(record && record.goals) ? record.goals : [])
            .filter(goal => goal && goal.deleted && goal.id != null).map(goal => String(goal.id)));
        const seen = new Set();
        return sessions.filter(session => {
            if (!session) return false;
            const seconds = Number(session.seconds);
            const at = Date.parse(session.at || "");
            const sessionDate = session.date || (Number.isFinite(at) ? dateKey(new Date(at)) : record.date);
            if (!Number.isFinite(seconds) || seconds <= 0 || sessionDate !== record.date
                || (session.goalId != null && deletedGoalIds.has(String(session.goalId)))) return false;
            const id = session.id == null ? `${session.at}:${seconds}:${session.goalId || ""}:${session.mode || ""}` : String(session.id);
            if (seen.has(id)) return false;
            seen.add(id);
            return true;
        });
    }

    function focusSecondsForDate(record, data) {
        return record && typeof window.focusflowGetSnapshotFocusSeconds === "function"
            ? window.focusflowGetSnapshotFocusSeconds(record, data && data.history)
            : 0;
    }
    function monthRecords(data, key) { return records(data).filter(record => record.date.startsWith(key)); }
    function yearRecords(data, year) { return records(data).filter(record => record.date.startsWith(`${year}-`)); }
    function averageRecords(list) {
        const values = list.map(progressOf).filter(value => value !== null);
        return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
    }
    function sumFocus(list, data) { return list.reduce((sum, record) => sum + focusSecondsForDate(record, data), 0); }

    function goalCountsForDate(record) {
        if (!record) return { completed: 0, total: 0 };
        const goals = Array.isArray(record.goals) ? record.goals.filter(goal => goal && !goal.deleted) : [];
        const savedTotal = record.totalGoals;
        const savedCompleted = record.goalsCompleted;
        const hasTotal = savedTotal !== null && savedTotal !== undefined && String(savedTotal).trim() !== "" && Number.isFinite(Number(savedTotal));
        const hasCompleted = savedCompleted !== null && savedCompleted !== undefined && String(savedCompleted).trim() !== "" && Number.isFinite(Number(savedCompleted));
        return {
            completed: hasCompleted ? Number(savedCompleted) : goals.filter(goal => goal.completed === true).length,
            total: hasTotal ? Number(savedTotal) : goals.length
        };
    }

    function formatDuration(seconds) {
        const value = Math.max(0, Math.round(Number(seconds) || 0));
        const hours = Math.floor(value / 3600);
        const minutes = Math.floor(value % 3600 / 60);
        const remainder = value % 60;
        if (hours && minutes) return `${hours}h ${minutes}m${remainder ? ` ${remainder}s` : ""}`;
        if (hours) return `${hours}h${remainder ? ` ${remainder}s` : ""}`;
        if (minutes) return `${minutes}m${remainder ? ` ${remainder}s` : ""}`;
        return `${remainder}s`;
    }

    function setText(selector, value) {
        const node = root.querySelector(selector);
        if (node) node.textContent = value;
    }

    function svgNode(tag, attrs = {}) {
        const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
        Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, String(value)));
        return node;
    }

    function drawLineChart(name, points, emptyMessage, onSelect) {
        const svg = root.querySelector(`[data-chart="${name}"]`);
        const empty = root.querySelector(`[data-chart-empty="${name}"]`);
        if (!svg || !empty) return;
        svg.replaceChildren();
        const weeklyTooltip = name === "overview" ? root.querySelector('[data-chart-tooltip="overview"]') : null;
        weeklyTooltipPinned = false;
        if (weeklyTooltip) weeklyTooltip.hidden = true;
        const hasData = points.some(point => point.value !== null && point.value !== undefined && Number.isFinite(Number(point.value)));
        empty.hidden = hasData;
        svg.hidden = !hasData && name !== "yearly";
        if (!hasData && name !== "yearly") { empty.textContent = emptyMessage; return; }
        if (!hasData) empty.textContent = emptyMessage;

        const W = 800, H = name === "overview" ? 320 : (name === "monthly" || name === "yearly" ? 310 : 260), L = name === "monthly" || name === "yearly" ? 48 : 64, R = 20, T = 17, B = 38;
        const plotW = W - L - R, plotH = H - T - B;
        (name === "monthly" || name === "yearly" || name === "daily" ? [0, 20, 40, 60, 80, 100] : [0, 25, 50, 75, 100]).forEach(value => {
            const y = T + plotH * (1 - value / 100);
            const gridClass = name === "monthly" ? "grid-line monthly-grid-line"
                : (name === "yearly" ? "grid-line yearly-grid-line"
                    : name === "daily" ? "grid-line daily-grid-line" : "grid-line");
            svg.append(svgNode("line", { x1: L, x2: W - R, y1: y, y2: y, class: gridClass }));
            const label = svgNode("text", { x: L - 10, y: y + 4, class: "axis-label", "text-anchor": "end" });
            label.textContent = `${value}%`;
            svg.append(label);
        });
        if (name === "daily") {
            [[0, "12a"], [.25, "6a"], [.5, "12p"], [.75, "6p"]].forEach(([fraction, labelText]) => {
                const label = svgNode("text", { x: L + fraction * plotW, y: H - 7, class: "axis-label day-label daily-time-label", "text-anchor": fraction === 0 ? "start" : "middle" });
                label.textContent = labelText;
                svg.append(label);
            });
        }

        const sorted = points.slice().sort((a, b) => a.x - b.x);
        const coords = sorted.map(point => ({ ...point, cx: L + Math.max(0, Math.min(1, point.x)) * plotW,
            cy: point.value !== null && point.value !== undefined && Number.isFinite(Number(point.value)) ? T + plotH * (1 - Math.max(0, Math.min(100, Number(point.value))) / 100) : null }));
        let segment = [];
        const smoothPath = items => {
            let path = `M ${items[0].cx} ${items[0].cy}`;
            for (let i = 1; i < items.length; i++) {
                const prev = items[i - 1], curr = items[i];
                if (name === "overview" || name === "monthly" || name === "yearly" || name === "daily") {
                    path += ` L ${curr.cx} ${curr.cy}`;
                } else {
                    const midX = (prev.cx + curr.cx) / 2;
                    path += ` Q ${midX} ${prev.cy} ${midX} ${(prev.cy + curr.cy) / 2} T ${curr.cx} ${curr.cy}`;
                }
            }
            return path;
        };
        const drawSegment = items => {
            if (items.length > 1) {
                if (name === "overview" || name === "monthly" || name === "yearly" || name === "daily") {
                    const baseline = T + plotH;
                    const defs = svgNode("defs");
                    const gradientId = name === "monthly" ? "monthly-progress-area-gradient"
                        : name === "yearly" ? "yearly-progress-area-gradient"
                            : name === "daily" ? "daily-progress-area-gradient" : "weekly-progress-area-gradient";
                    const gradient = svgNode("linearGradient", { id: gradientId, x1: "0", y1: T, x2: "0", y2: baseline, gradientUnits: "userSpaceOnUse" });
                    const aqua = name === "monthly" || name === "yearly" || name === "daily";
                    gradient.append(
                        svgNode("stop", { offset: "0%", "stop-color": aqua ? "#63f5e1" : "#8deeff", "stop-opacity": aqua ? ".24" : ".28" }),
                        svgNode("stop", { offset: "100%", "stop-color": aqua ? "#63f5e1" : "#8deeff", "stop-opacity": ".015" })
                    );
                    defs.append(gradient);
                    svg.append(defs);
                    const curveCommands = smoothPath(items).replace(/^M\s+[^ ]+\s+[^ ]+/, "");
                    const areaPath = `M ${items[0].cx} ${baseline} L ${items[0].cx} ${items[0].cy}${curveCommands} L ${items[items.length - 1].cx} ${baseline} Z`;
                    const areaClass = name === "monthly" ? "monthly-progress-area"
                        : name === "yearly" ? "yearly-progress-area"
                            : name === "daily" ? "daily-progress-area" : "weekly-progress-area";
                    svg.append(svgNode("path", { d: areaPath, class: areaClass, "aria-hidden": "true" }));
                }
                const lineClass = name === "monthly" ? "trend-line monthly-trend-line"
                    : (name === "yearly" ? "trend-line yearly-trend-line"
                        : name === "daily" ? "trend-line daily-trend-line" : "trend-line");
                svg.append(svgNode("path", { d: smoothPath(items), class: lineClass }));
            }
        };
        coords.forEach(point => { if (point.cy === null) { drawSegment(segment); segment = []; } else segment.push(point); });
        drawSegment(segment);
        coords.forEach((point, index) => {
            if (point.label) {
                const label = svgNode("text", { x: point.cx, y: H - 7, class: "axis-label day-label", "text-anchor": "middle" });
                label.textContent = point.label;
                svg.append(label);
            }
            if (point.cy === null) {
                if (name === "yearly" && point.selectable) {
                    const baselineY = T + plotH;
                    const tooltip = point.tooltip || `${point.title}: No saved data`;
                    const group = svgNode("g", { class: `year-point no-saved-data${point.selected ? " selected" : ""}`, "data-index": index, role: "button", tabindex: 0, "aria-label": tooltip });
                    group.append(svgNode("circle", { cx: point.cx, cy: baselineY, r: 10, class: "data-hit" }));
                    group.append(svgNode("circle", { cx: point.cx, cy: baselineY, r: 3.7, class: "trend-dot" }));
                    group.addEventListener("click", () => onSelect && onSelect(point));
                    group.addEventListener("keydown", event => {
                        if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onSelect && onSelect(point);
                        }
                    });
                    svg.append(group);
                }
                return;
            }
            if (name === "overview") {
                const tooltip = point.tooltip || `${point.title}: ${point.value}%`;
                const group = svgNode("g", { class: "trend-point", role: "button", tabindex: 0, "aria-label": tooltip });
                group.append(svgNode("circle", { cx: point.cx, cy: point.cy, r: 13, class: "data-hit" }));
                group.append(svgNode("circle", { cx: point.cx, cy: point.cy, r: 5, class: "trend-dot" }));
                const nativeTitle = svgNode("title");
                nativeTitle.textContent = tooltip;
                group.append(nativeTitle);
                const showTooltip = () => {
                    if (!weeklyTooltip) return;
                    weeklyTooltip.textContent = tooltip;
                    weeklyTooltip.style.left = `${Math.min(85, Math.max(15, point.cx / W * 100))}%`;
                    weeklyTooltip.style.top = `${point.cy / H * 100}%`;
                    weeklyTooltip.style.transform = point.cy / H < 0.2
                        ? "translate(-50%, 12px)"
                        : "translate(-50%, calc(-100% - 12px))";
                    weeklyTooltip.hidden = false;
                };
                group.addEventListener("pointerenter", showTooltip);
                group.addEventListener("pointerleave", () => { if (!weeklyTooltipPinned && weeklyTooltip) weeklyTooltip.hidden = true; });
                group.addEventListener("focus", showTooltip);
                group.addEventListener("blur", () => { if (!weeklyTooltipPinned && weeklyTooltip) weeklyTooltip.hidden = true; });
                group.addEventListener("click", event => {
                    event.stopPropagation();
                    weeklyTooltipPinned = !weeklyTooltipPinned;
                    if (weeklyTooltipPinned) showTooltip();
                    else if (weeklyTooltip) weeklyTooltip.hidden = true;
                });
                group.addEventListener("keydown", event => {
                    if (event.key === "Escape") {
                        weeklyTooltipPinned = false;
                        if (weeklyTooltip) weeklyTooltip.hidden = true;
                    } else if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        group.click();
                    }
                });
                svg.append(group);
                return;
            }
            if (point.selectable) {
                const tooltip = point.tooltip || `${point.title}: ${Math.round(point.value)}%`;
                const pointClass = name === "yearly" ? "year-point" : name === "daily" ? "daily-point" : "month-point";
                const group = svgNode("g", { class: `${pointClass}${point.selected ? " selected" : ""}`, "data-index": index, role: "button", tabindex: 0, "aria-label": tooltip });
                if (name === "monthly") {
                    const step = plotW / Math.max(1, coords.length - 1);
                    const left = index === 0 ? L : point.cx - step / 2;
                    const right = index === coords.length - 1 ? W - R : point.cx + step / 2;
                    group.append(svgNode("rect", { x: left, y: T, width: right - left, height: plotH, class: "monthly-day-hit" }));
                } else {
                    group.append(svgNode("circle", { cx: point.cx, cy: point.cy, r: name === "daily" ? 12 : 13, class: "data-hit" }));
                }
                group.append(svgNode("circle", { cx: point.cx, cy: point.cy, r: name === "monthly" || name === "yearly" ? 3.7 : name === "daily" ? 4 : 5, class: "trend-dot" }));
                group.addEventListener("click", () => onSelect && onSelect(point));
                group.addEventListener("keydown", event => {
                    if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSelect && onSelect(point);
                    }
                });
                svg.append(group);
            } else {
                const circle = svgNode("circle", { cx: point.cx, cy: point.cy, r: name === "overview" ? 5 : (coords.length === 1 ? 6 : 4), class: "trend-dot" });
                circle.setAttribute("aria-label", point.tooltip || `${point.title || point.label}: ${Math.round(point.value)}%`);
                svg.append(circle);
            }
        });
    }

    function drawBars(name, values, emptyMessage) {
        const svg = root.querySelector(`[data-bars="${name}"]`);
        const empty = root.querySelector(`[data-bars-empty="${name}"]`);
        if (!svg || !empty) return;
        svg.replaceChildren();
        const hasData = name === "monthly" || name === "yearly" ? values.length > 0 : values.some(item => Number(item.value) > 0);
        empty.hidden = hasData;
        svg.hidden = !hasData;
        if (!hasData) { empty.textContent = emptyMessage; return; }
        const W = 800, H = 190, L = 10, R = 10, T = 17, B = 24;
        const plotW = W - L - R, plotH = H - T - B;
        const maxValue = Math.max(1, ...values.map(item => Number(item.value) || 0));
        const slot = plotW / values.length;
        const barW = Math.max(3, Math.min(24, slot * .58));
        values.forEach((item, index) => {
            const value = Math.max(0, Number(item.value) || 0);
            const barH = value ? Math.max(2, value / maxValue * plotH) : 1;
            const x = L + index * slot + (slot - barW) / 2;
            const y = T + plotH - barH;
            svg.append(svgNode("rect", { x, y: T, width: barW, height: plotH, rx: Math.min(5, barW / 2), class: "bar-base" }));
            if (value) {
                const bar = svgNode("rect", { x, y, width: barW, height: barH, rx: Math.min(5, barW / 2), class: "bar-fill" });
                const title = svgNode("title");
                title.textContent = `${item.fullLabel}: ${formatDuration(value)}`;
                bar.append(title);
                svg.append(bar);
                if (values.length <= 12) {
                    const amount = svgNode("text", { x: x + barW / 2, y: Math.max(11, y - 4), class: "bar-value" });
                    amount.textContent = value >= 3600 ? `${(value / 3600).toFixed(value % 3600 ? 1 : 0)}h` : `${Math.round(value / 60)}m`;
                    svg.append(amount);
                }
            }
            const showLabel = name === "daily" ? item.label && item.showLabel
                : item.label && (values.length <= 12 || index % (values.length > 24 ? 5 : 4) === 0 || index === values.length - 1);
            if (showLabel) {
                const label = svgNode("text", { x: x + barW / 2, y: H - 5, class: "bar-label" });
                label.textContent = item.label;
                svg.append(label);
            }
        });
    }

    function setView(next) {
        hideDailyTooltip();
        if (next === "monthly") resetMonthSelection();
        if (next === "yearly") resetYearSelection();
        view = next;
        const overviewHeading = root.querySelector(".track-heading");
        if (overviewHeading) overviewHeading.hidden = next !== "overview";
        root.querySelectorAll("[data-track-view]").forEach(section => { section.hidden = section.dataset.trackView !== next; });
        if (next === "overview") renderOverview();
        if (next === "daily") renderDaily();
        if (next === "monthly") renderMonthly();
        if (next === "yearly") renderYearly();
        window.scrollTo({ top: 0, behavior: "smooth" });
    }

    function renderOverview() {
        const data = getData(), all = records(data), today = dateKey(new Date());
        const daily = data.history[today] || null;
        const currentMonth = monthRecords(data, monthKey(new Date()));
        const currentYear = yearRecords(data, new Date().getFullYear());
        setText('[data-period="daily"]', daily ? `${progressOf(daily)}%` : "—");
        setText('[data-period="monthly"]', averageRecords(currentMonth) === null ? "—" : `${averageRecords(currentMonth)}%`);
        setText('[data-period="yearly"]', averageRecords(currentYear) === null ? "—" : `${averageRecords(currentYear)}%`);
        root.querySelectorAll("[data-open-view]").forEach(button => {
            const active = button.dataset.openView === overviewPeriod;
            button.classList.toggle("active", active);
            button.setAttribute("aria-pressed", String(active));
        });
        drawLineChart("overview", weeklyProgressPoints(data), "No progress recorded yet. Your progress will appear here as you work toward your goals.");
        setText("[data-overview-focus]", `${formatDuration(sumFocus(currentMonth, data))} this month`);
        renderHistory(all, data);
    }

    function renderHistory(all, data) {
        const list = root.querySelector("[data-history-list]"), empty = root.querySelector("[data-history-empty]");
        if (!list || !empty) return;
        list.replaceChildren();
        const sorted = all.slice().sort((a, b) => b.date.localeCompare(a.date));
        empty.hidden = sorted.length > 0;
        const visible = showAllHistory ? sorted : sorted.slice(0, 6);
        visible.forEach(record => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "track-history-row";
            const summaryGoals = Array.isArray(record.goals) ? record.goals.filter(goal => goal && !goal.deleted) : [];
            const summaryCounts = goalCountsForDate(record);
            const summary = summaryCounts.total ? `${summaryCounts.completed}/${summaryCounts.total} goals complete` : "No goals recorded";
            if (record.date === dateKey(new Date())) {
                const focusSeconds = focusSecondsForDate(record, data);
                debugTrack("today Track history Focus Time", {
                    source: "saved daily goal-investment snapshots",
                    goals: summaryGoals.map(goal => ({ id: goal.id, target: goal.target, invested: goal.invested, unit: goal.unit })),
                    focusSeconds,
                    formattedFocusTime: formatDuration(focusSeconds)
                });
            }
            [dateLabel(record.date, { month: "short", day: "numeric", year: "numeric" }), `${progressOf(record)}%`, summary, formatDuration(focusSecondsForDate(record, data)), "›"].forEach((value, index) => {
                const span = document.createElement("span");
                span.className = ["history-date", "history-progress", "history-summary", "history-time", "history-arrow"][index];
                span.textContent = value;
                button.append(span);
            });
            button.addEventListener("click", () => { selectedDate = record.date; setView("daily"); });
            list.append(button);
        });
        const toggle = root.querySelector("[data-toggle-history]");
        if (toggle) toggle.textContent = showAllHistory ? "Show Recent History ↑" : "View Full History →";
    }

    function selectedDayRecord(data) { return data.history[selectedDate] || null; }

    function hideDailyTooltip() {
        const detail = root.querySelector("[data-daily-point-detail]");
        if (detail) detail.hidden = true;
        root.querySelectorAll(".daily-point.selected").forEach(node => node.classList.remove("selected"));
    }

    function showDailyTooltip(point, record, data) {
        const detail = root.querySelector("[data-daily-point-detail]");
        const wrapper = root.querySelector('[data-chart="daily"]')?.parentElement;
        if (!detail || !wrapper) return;
        detail.replaceChildren();
        const title = document.createElement("h3");
        title.textContent = dateLabel(selectedDate, { month: "long", day: "numeric" });
        const metrics = document.createElement("div");
        metrics.className = "track-detail-metrics";
        const savedCounts = goalCountsForDate({ goals: point.goals, goalsCompleted: point.goalsCompleted, totalGoals: point.totalGoals });
        const counts = point.goalsCompleted !== undefined && point.totalGoals !== undefined
            ? savedCounts : goalCountsForDate(record);
        const values = [
            ["Progress", `${Math.round(point.value)}%`],
            ["Goals", `${counts.completed} / ${counts.total}`],
            ["Focus Time", formatDuration(focusSecondsForDate(record, data))]
        ];
        values.forEach(([label, value]) => {
            const item = document.createElement("span");
            const strong = document.createElement("strong");
            item.append(document.createTextNode(label), strong);
            strong.textContent = value;
            metrics.append(item);
        });
        detail.append(title, metrics);
        detail.hidden = false;
        const svg = root.querySelector('[data-chart="daily"]');
        const wrapperRect = wrapper.getBoundingClientRect();
        const svgRect = svg.getBoundingClientRect();
        const pointX = (point.cx / 800) * svgRect.width + svgRect.left - wrapperRect.left;
        const pointY = (point.cy / 260) * svgRect.height + svgRect.top - wrapperRect.top;
        const left = Math.max(8, Math.min(wrapperRect.width - detail.offsetWidth - 8, pointX - detail.offsetWidth / 2));
        const top = pointY < detail.offsetHeight + 14 ? pointY + 14 : pointY - detail.offsetHeight - 14;
        detail.style.left = `${left}px`;
        detail.style.top = `${Math.max(8, Math.min(wrapperRect.height - detail.offsetHeight - 8, top))}px`;
        root.querySelectorAll(".daily-point").forEach(node => node.classList.toggle("selected", Number(node.dataset.index) === point.index));
    }

    function dailyFocusBars(record) {
        const totals = Array(24).fill(0);
        focusSessionsForDate(record).forEach(session => {
            const seconds = Number(session.seconds);
            const at = Date.parse(session.at || "");
            if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isFinite(at)) return;
            totals[new Date(at).getHours()] += seconds;
        });
        return totals.map((value, hour) => ({
            label: hour === 0 ? "12a" : hour === 6 ? "6a" : hour === 12 ? "12p" : hour === 18 ? "6p" : "",
            showLabel: [0, 6, 12, 18].includes(hour),
            fullLabel: `${hour.toString().padStart(2, "0")}:00–${((hour + 1) % 24).toString().padStart(2, "0")}:00`,
            value
        }));
    }

    function ensureCurrentDailyPoint(data, record) {
        const today = dateKey(new Date());
        if (selectedDate !== today || !record || typeof window.focusflowRecordTrackSnapshot !== "function") return false;
        const rawPoints = Array.isArray(record.progressPoints) ? record.progressPoints : [];
        const latest = rawPoints.filter(point => point && Number.isFinite(Date.parse(point.at))
            && dateKey(new Date(Date.parse(point.at))) === today)
            .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
        const currentProgress = dailyGoalProgress(record);
        const currentCompleted = data.goals.filter(goal => goal && goal.completed).length;
        const currentTotal = data.goals.length;
        const savedProgress = latest && latest.progress !== null && latest.progress !== undefined
            && String(latest.progress).trim() !== ""
            ? Number(String(latest.progress).replace(/%$/, "")) : NaN;
        const goalSignature = list => (Array.isArray(list) ? list : [])
            .filter(goal => goal && goal.id != null && !goal.deleted)
            .map(goal => ({
                id: String(goal.id),
                name: goal.name || "",
                target: goal.target == null || goal.target === "" ? null : Number(goal.target),
                unit: goal.unit || "",
                invested: goal.invested == null || goal.invested === "" ? null : Number(goal.invested),
                progress: goal.progress == null || goal.progress === "" ? null : Number(String(goal.progress).replace(/%$/, "")),
                completed: goal.completed === true
            }))
            .sort((a, b) => a.id.localeCompare(b.id));
        const currentSignature = JSON.stringify(goalSignature(data.goals));
        const savedSignature = JSON.stringify(goalSignature(latest && latest.goals));
        const hasMatchingPoint = latest
            && Number.isFinite(savedProgress)
            && Math.abs(savedProgress - currentProgress) < 0.001
            && Number(latest.goalsCompleted) === currentCompleted
            && Number(latest.totalGoals) === currentTotal
            && savedSignature === currentSignature;
        if (hasMatchingPoint) return false;
        window.focusflowRecordTrackSnapshot(data.goals, { point: true });
        return true;
    }

    function renderDaily() {
        hideDailyTooltip();
        let data = getData(), record = selectedDayRecord(data);
        if (ensureCurrentDailyPoint(data, record)) {
            data = getData();
            record = selectedDayRecord(data);
        }
        const input = root.querySelector("[data-date-input]");
        if (input) input.value = selectedDate;
        setText("[data-daily-date-label]", dateLabel(selectedDate));
        setText("[data-daily-progress]", record ? `${progressOf(record)}%` : "—");
        setText("[data-daily-goals]", record ? `${record.goalsCompleted || 0} of ${record.totalGoals || 0} goals completed` : "No saved progress");
        const dailyFocusSeconds = focusSecondsForDate(record, data);
        if (selectedDate === dateKey(new Date())) {
            debugTrack("today Track Focus Time calculation", {
                source: "saved daily goal-investment snapshots",
                goals: record && record.goals
                    ? record.goals.map(goal => ({ id: goal.id, target: goal.target, invested: goal.invested, unit: goal.unit }))
                    : [],
                focusSeconds: dailyFocusSeconds,
                formattedFocusTime: formatDuration(dailyFocusSeconds)
            });
        }
        setText("[data-daily-focus]", record ? formatDuration(dailyFocusSeconds) : "—");
        const rawPoints = record && Array.isArray(record.progressPoints) ? record.progressPoints : [];
        const points = rawPoints.filter(point => {
            const pointTime = Date.parse(point && point.at || "");
            return Number.isFinite(pointTime) && dateKey(new Date(pointTime)) === selectedDate;
        }).map(point => {
            const at = new Date(point && point.at);
            const rawValue = point && point.progress;
            const value = rawValue !== null && rawValue !== undefined && String(rawValue).trim() !== ""
                ? Number(String(rawValue).replace(/%$/, "")) : NaN;
            if (Number.isNaN(at.getTime())) return null;
            const fraction = (at.getHours() * 3600 + at.getMinutes() * 60 + at.getSeconds()) / 86400;
            return {
                x: fraction,
                value: Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null,
                title: at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
                at: point.at,
                goalsCompleted: point.goalsCompleted,
                totalGoals: point.totalGoals,
                goals: point.goals,
                selectable: Number.isFinite(value)
            };
        }).filter(Boolean);
        points.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
        points.forEach((point, index) => {
            point.index = index;
            const exactDate = dateLabel(selectedDate, { month: "long", day: "numeric" });
            if (Number.isFinite(point.value)) point.tooltip = `${exactDate}, ${point.title}: ${Math.round(point.value)}% progress`;
        });
        drawLineChart("daily", points, "No progress recorded for this day.", point => showDailyTooltip(point, record, data));
        drawBars("daily", dailyFocusBars(record), "No focus sessions recorded for this day.");

        const reflection = root.querySelector("[data-reflection]"), reflectionEmpty = root.querySelector("[data-reflection-empty]");
        const note = record && String(record.reflection || "").trim();
        if (reflection) reflection.textContent = note || "";
        if (reflectionEmpty) reflectionEmpty.hidden = Boolean(note);
        const monthList = monthRecords(data, selectedDate.slice(0, 7));
        setText("[data-daily-month-average]", averageRecords(monthList) === null ? "—" : `${averageRecords(monthList)}%`);
        setText("[data-daily-month-days]", `Across ${monthList.length} saved day${monthList.length === 1 ? "" : "s"}`);
        setText("[data-daily-month-focus]", formatDuration(sumFocus(monthList, data)));
        renderDayGoals(record);
    }

    function renderDayGoals(record) {
        const list = root.querySelector("[data-daily-goal-list]"), empty = root.querySelector("[data-daily-goals-empty]");
        if (!list || !empty) return;
        list.replaceChildren();
        const goals = record && Array.isArray(record.goals)
            ? record.goals.filter(goal => selectedDate !== dateKey(new Date()) || !goal.deleted)
            : [];
        empty.hidden = goals.length > 0;
        goals.forEach(goal => {
            const row = document.createElement("div"); row.className = "track-goal-snapshot";
            const name = document.createElement("strong"); name.textContent = `${goal.name}${goal.deleted ? " · removed" : ""}`;
            const value = document.createElement("span"); value.textContent = `${goal.invested} / ${goal.target} ${goal.unit}`;
            const progress = document.createElement("span"); progress.className = "track-goal-progress"; progress.textContent = `${goal.progress}%`;
            const meter = document.createElement("span"); meter.className = "track-progress-meter";
            const fill = document.createElement("span"); fill.style.width = `${Math.max(0, Math.min(100, goal.progress))}%`; meter.append(fill);
            row.append(name, value, progress, meter); list.append(row);
        });
    }

    function renderMonthly() {
        const data = getData();
        const year = Number(selectedMonth.slice(0, 4)), month = Number(selectedMonth.slice(5, 7));
        const lastDay = new Date(year, month, 0).getDate(), saved = monthRecords(data, selectedMonth);
        const byDate = new Map(saved.map(record => [record.date, record]));
        if (selectedMonthDay && !selectedMonthDay.startsWith(`${selectedMonth}-`)) selectedMonthDay = null;
        const monthDate = new Date(year, month - 1, 1);
        setText("[data-month-label]", monthDate.toLocaleDateString(undefined, { month: "long", year: "numeric" }));
        const points = Array.from({ length: lastDay }, (_, index) => {
            const day = String(index + 1).padStart(2, "0"), date = `${selectedMonth}-${day}`;
            const record = byDate.get(date) || null;
            const value = record ? progressOf(record) : 0;
            return {
                date,
                x: index / Math.max(1, lastDay - 1),
                value,
                label: index === 0 || (index + 1) % 5 === 0 || index + 1 === lastDay ? String(index + 1) : "",
                title: dateLabel(date),
                tooltip: `${dateLabel(date)}: ${value}%`,
                selectable: true,
                selected: selectedMonthDay === date
            };
        });
        drawLineChart("monthly", points, "No saved progress for this month.", point => showMonthDay(point.date, point));
        const dailyValues = Array.from({ length: lastDay }, (_, index) => {
            const day = String(index + 1).padStart(2, "0"), record = byDate.get(`${selectedMonth}-${day}`);
            return { label: index === 0 || (index + 1) % 5 === 0 || index + 1 === lastDay ? String(index + 1) : "", fullLabel: dateLabel(`${selectedMonth}-${day}`), value: record ? focusSecondsForDate(record, data) : 0 };
        });
        drawBars("monthly", dailyValues, "No focus sessions recorded this month.");
        setText("[data-month-average]", averageRecords(saved) === null ? "—" : `${averageRecords(saved)}%`);
        setText("[data-month-days]", `Across ${saved.length} saved day${saved.length === 1 ? "" : "s"}`);
        setText("[data-month-focus]", formatDuration(sumFocus(saved, data)));
        if (selectedMonthDay) showMonthTooltip(selectedMonthDay, monthPointForDate(selectedMonthDay, data), data);
    }

    function resetMonthSelection() {
        selectedMonthDay = null;
        const detail = root.querySelector("[data-month-day-detail]");
        if (detail) detail.hidden = true;
        const svg = root.querySelector('[data-chart="monthly"]');
        if (svg) svg.querySelectorAll(".month-point.selected").forEach(node => node.classList.remove("selected"));
    }

    function resetYearSelection() {
        selectedYearMonth = null;
        const detail = root.querySelector("[data-year-month-detail]");
        if (detail) detail.hidden = true;
        const svg = root.querySelector('[data-chart="yearly"]');
        if (svg) svg.querySelectorAll(".year-point.selected").forEach(node => node.classList.remove("selected"));
    }

    function showMonthTooltip(date, point, data = getData()) {
        const detail = root.querySelector("[data-month-day-detail]"), wrap = root.querySelector(".track-month-chart-wrap");
        if (!detail || !wrap) return;
        const record = data.history[date] || null;
        detail.replaceChildren(); detail.hidden = false;
        const title = document.createElement("h3"); title.textContent = dateLabel(date, { month: "long", day: "numeric" });
        const metrics = document.createElement("div"); metrics.className = "track-detail-metrics";
        const goalCounts = goalCountsForDate(record);
        [["Progress", `${record ? progressOf(record) : 0}%`], ["Focus Time", formatDuration(focusSecondsForDate(record, data))], ["Goals", `${goalCounts.completed} / ${goalCounts.total}`]].forEach(([label, value]) => {
            const item = document.createElement("span"), strong = document.createElement("strong"); item.append(document.createTextNode(label), strong); strong.textContent = value; metrics.append(item);
        });
        const button = document.createElement("button"); button.type = "button"; button.textContent = "View Day →"; button.addEventListener("click", () => { selectedDate = date; setView("daily"); });
        detail.append(title, metrics, button);
        const svg = root.querySelector('[data-chart="monthly"]'), svgRect = svg && svg.getBoundingClientRect(), wrapRect = wrap.getBoundingClientRect();
        if (svgRect && point) {
            const tooltipWidth = detail.getBoundingClientRect().width;
            const anchorX = svgRect.left - wrapRect.left + point.cx / 800 * svgRect.width;
            const anchorY = svgRect.top - wrapRect.top + point.cy / 310 * svgRect.height;
            const left = Math.max(tooltipWidth / 2 + 8, Math.min(wrapRect.width - tooltipWidth / 2 - 8, anchorX));
            const above = anchorY - detail.offsetHeight - 13;
            const maxTop = Math.max(8, wrapRect.height - detail.offsetHeight - 8);
            const top = above >= 8 ? above : Math.min(maxTop, anchorY + 15);
            detail.style.left = `${left}px`;
            detail.style.top = `${Math.max(8, Math.min(maxTop, top))}px`;
        }
    }

    function showMonthDay(date, point) {
        selectedMonthDay = date;
        selectedDate = date;
        const svg = root.querySelector('[data-chart="monthly"]');
        if (svg) svg.querySelectorAll(".month-point").forEach(node => node.classList.toggle("selected", Number(node.getAttribute("data-index")) === Number(date.slice(8, 10)) - 1));
        showMonthTooltip(date, point);
    }

    function monthPointForDate(date, data = getData()) {
        const year = Number(date.slice(0, 4)), month = Number(date.slice(5, 7));
        const days = new Date(year, month, 0).getDate();
        const record = data.history[date] || null;
        const value = record ? progressOf(record) : 0;
        return {
            cx: 48 + (Number(date.slice(8, 10)) - 1) / Math.max(1, days - 1) * 732,
            cy: 17 + 255 * (1 - value / 100)
        };
    }

    function renderYearly() {
        const data = getData(), saved = yearRecords(data, selectedYear), monthData = Array.from({ length: 12 }, (_, index) => {
            const month = `${selectedYear}-${String(index + 1).padStart(2, "0")}`;
            const list = monthRecords(data, month);
            return { key: month, list, progress: averageRecords(list), focus: sumFocus(list, data) };
        });
        setText("[data-year-value]", String(selectedYear));
        const points = monthData.map((item, index) => ({
            key: item.key,
            x: index / 11,
            value: item.progress,
            label: new Date(selectedYear, index, 1).toLocaleDateString(undefined, { month: "short" }),
            title: new Date(selectedYear, Number(item.key.slice(5, 7)) - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" }),
            tooltip: `${new Date(selectedYear, index, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" })}: ${item.progress === null ? "No saved data" : `${item.progress}%`}`,
            hasSavedData: item.progress !== null,
            selectable: true,
            selected: selectedYearMonth === item.key
        }));
        drawLineChart("yearly", points, "No saved progress for this year.", point => showYearMonth(point.key));
        const bars = monthData.map((item, index) => ({ label: new Date(selectedYear, index, 1).toLocaleDateString(undefined, { month: "short" }), fullLabel: new Date(selectedYear, index, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" }), value: item.focus }));
        drawBars("yearly", bars, "No focus sessions recorded this year.");
        setText("[data-year-average]", averageRecords(saved) === null ? "—" : `${averageRecords(saved)}%`);
        setText("[data-year-days]", `Across ${saved.length} saved day${saved.length === 1 ? "" : "s"}`);
        setText("[data-year-focus]", formatDuration(sumFocus(saved, data)));
        if (selectedYearMonth && selectedYearMonth.startsWith(`${selectedYear}-`)) showYearMonth(selectedYearMonth);
        else {
            const detail = root.querySelector("[data-year-month-detail]");
            if (detail) { detail.replaceChildren(); detail.hidden = true; }
        }
    }

    function showYearMonth(key) {
        const data = getData(), list = monthRecords(data, key);
        selectedYearMonth = key;
        const detail = root.querySelector("[data-year-month-detail]");
        if (!detail) return;
        detail.replaceChildren();
        const date = new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, 1);
        const title = document.createElement("h3"); title.textContent = date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
        const metrics = document.createElement("div"); metrics.className = "track-detail-metrics";
        const progress = averageRecords(list);
        const goalTotals = list.reduce((totals, record) => {
            const counts = goalCountsForDate(record);
            return { completed: totals.completed + counts.completed, total: totals.total + counts.total };
        }, { completed: 0, total: 0 });
        const averageGoals = list.length
            ? `${Math.round(goalTotals.completed / list.length)} / ${Math.round(goalTotals.total / list.length)}`
            : "No saved data";
        [["Progress", progress === null ? "No saved data" : `${progress}%`], ["Focus Time", formatDuration(sumFocus(list, data))], ["Avg. Goals", averageGoals]].forEach(([label, value]) => {
            const item = document.createElement("span"), strong = document.createElement("strong"); item.append(document.createTextNode(label), strong); strong.textContent = value; metrics.append(item);
        });
        const button = document.createElement("button"); button.type = "button"; button.textContent = `View ${date.toLocaleDateString(undefined, { month: "long" })} →`; button.addEventListener("click", () => { selectedMonth = key; setView("monthly"); });
        detail.append(title, metrics, button);
        detail.hidden = false;
        const svg = root.querySelector('[data-chart="yearly"]');
        if (svg) svg.querySelectorAll(".year-point").forEach(node => node.classList.toggle("selected", Number(node.getAttribute("data-index")) === date.getMonth()));
    }

    root.addEventListener("click", event => {
        const target = event.target.closest("button");
        if (!target) return;
        if (target.hasAttribute("data-open-view")) { overviewPeriod = target.dataset.openView; setView(target.dataset.openView); }
        else if (target.hasAttribute("data-back-overview")) setView("overview");
        else if (target.hasAttribute("data-toggle-history")) { showAllHistory = !showAllHistory; renderOverview(); }
        else if (target.hasAttribute("data-date-step")) { const date = parseDate(selectedDate); date.setDate(date.getDate() + Number(target.dataset.dateStep)); selectedDate = dateKey(date); renderDaily(); }
        else if (target.hasAttribute("data-month-step")) {
            const [year, month] = selectedMonth.split("-").map(Number);
            const date = new Date(year, month - 1 + Number(target.dataset.monthStep), 1);
            selectedMonth = monthKey(date);
            resetMonthSelection();
            selectedDate = `${selectedMonth}-01`;
            renderMonthly();
        }
        else if (target.hasAttribute("data-year-step")) { selectedYear += Number(target.dataset.yearStep); resetYearSelection(); renderYearly(); }
    });

    root.addEventListener("pointerdown", event => {
        if (event.target.closest(".trend-point, .daily-point, .track-daily-tooltip, .track-month-tooltip, .track-year-detail")) return;
        if (view === "daily") hideDailyTooltip();
        if (view === "monthly" && !event.target.closest(".month-point")) resetMonthSelection();
        if (view === "yearly" && !event.target.closest(".year-point")) resetYearSelection();
        if (event.target.closest(".trend-point")) return;
        weeklyTooltipPinned = false;
        const tooltip = root.querySelector('[data-chart-tooltip="overview"]');
        if (tooltip) tooltip.hidden = true;
    });

    document.addEventListener("pointerdown", event => {
        if (root.contains(event.target)) return;
        if (view === "daily") hideDailyTooltip();
        if (view === "monthly") resetMonthSelection();
        if (view === "yearly") resetYearSelection();
        weeklyTooltipPinned = false;
        const tooltip = root.querySelector('[data-chart-tooltip="overview"]');
        if (tooltip) tooltip.hidden = true;
    });

    root.querySelector("[data-date-input]").addEventListener("change", event => { if (event.target.value) { selectedDate = event.target.value; renderDaily(); } });
    window.addEventListener("focusflow:data-change", event => {
        if ([GOALS_KEY, STATE_KEY, "focusflow_reflection"].includes(event.detail && event.detail.key)) {
            if (view === "overview") renderOverview();
            else if (view === "daily") renderDaily();
            else if (view === "monthly") renderMonthly();
            else renderYearly();
        }
    });

    renderOverview();
})();
