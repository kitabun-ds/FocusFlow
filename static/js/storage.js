/* Small synchronous cache with asynchronous Supabase-backed persistence. */
(function () {
    const values = window.FOCUSFLOW_DATA || {};
    const pending = new Map();

    // TEMPORARY runtime trace. Open /focus?focusDebug=1 and /track?focusDebug=1.
    window.focusflowDebugLog = function (label, details) {
        if (new URLSearchParams(window.location.search).get("focusDebug") !== "1") return;
        let snapshot = details;
        try { snapshot = JSON.parse(JSON.stringify(details)); } catch (_) {}
        console.log(`[FOCUS DEBUG] ${label}`, snapshot);
    };

    function normalize(value) {
        if (value === null || value === undefined) return null;
        return typeof value === "string" ? value : JSON.stringify(value);
    }

    window.focusflowStore = {
        getItem(key) {
            return Object.prototype.hasOwnProperty.call(values, key)
                ? normalize(values[key])
                : null;
        },
        setItem(key, value) {
            const serialized = String(value);
            values[key] = serialized;
            window.dispatchEvent(new CustomEvent("focusflow:data-change", {
                detail: { key, value: serialized }
            }));
            const previous = pending.get(key) || Promise.resolve();
            const next = previous
                .catch(() => {})
                .then(() => fetch("/api/user-data", {
                    method: "PUT",
                    credentials: "same-origin",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ key, value: serialized })
                }))
                .then(response => {
                    if (!response.ok) throw new Error(`Save failed (${response.status})`);
                    return true;
                })
                .catch(error => {
                    console.error("FocusFlow data save failed:", error);
                    window.dispatchEvent(new CustomEvent("focusflow:data-save-error", {
                        detail: { key, error }
                    }));
                    return false;
                });
            pending.set(key, next);
            return next;
        },
        removeItem(key) {
            this.setItem(key, "null");
        },
        key(index) {
            return Object.keys(values)[index] || null;
        },
        get length() {
            return Object.keys(values).length;
        }
    };

    const GOALS_KEY = "focusflow_goals";
    const STATE_KEY = "focusflow_user_state";
    const REMINDERS_KEY = "focusflow_reminder_schedule";
    const SELECTED_GOAL_KEY = "focusflow_selected_goal";
    const GOAL_LIFETIME_MS = 24 * 60 * 60 * 1000;
    let goalCleanupTimer = null;
    let checkingGoals = false;
    let activeGoalsCache = [];

    function readJSON(key, fallback) {
        try {
            const value = JSON.parse(window.focusflowStore.getItem(key) || "null");
            return value === null ? fallback : value;
        } catch (_) { return fallback; }
    }

    function isSavedGoal(goal) {
        return Boolean(goal && String(goal.name || "").trim() && String(goal.unit || "").trim()
            && Number.isFinite(Number(goal.target)) && Number(goal.target) > 0);
    }

    window.focusflowIsSavedGoal = isSavedGoal;

    function localDateKey(date) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    }

    function inferredGoalCreation(goal, history) {
        const candidates = [];
        Object.entries(history || {}).forEach(([key, record]) => {
            if (!record || typeof record !== "object") return;
            const pointList = Array.isArray(record.progressPoints) ? record.progressPoints : [];
            pointList.forEach(point => {
                const match = Array.isArray(point && point.goals)
                    ? point.goals.find(item => item && String(item.id) === String(goal.id) && !item.deleted)
                    : null;
                if (match && point.at && Number.isFinite(Date.parse(point.at))) candidates.push(Date.parse(point.at));
            });
            const savedGoal = Array.isArray(record.goals)
                ? record.goals.find(item => item && String(item.id) === String(goal.id) && !item.deleted)
                : null;
            if (!savedGoal) return;
            if (record.updatedAt && Number.isFinite(Date.parse(record.updatedAt))) candidates.push(Date.parse(record.updatedAt));
            else if (/^\d{4}-\d{2}-\d{2}$/.test(record.date || key)) {
                const [year, month, day] = (record.date || key).split("-").map(Number);
                candidates.push(new Date(year, month - 1, day).getTime());
            }
        });
        if (!candidates.length) return null;
        return new Date(Math.min(...candidates)).toISOString();
    }

    function scheduleGoalExpiry(goals, nowMs = Date.now()) {
        if (goalCleanupTimer !== null) window.clearTimeout(goalCleanupTimer);
        goalCleanupTimer = null;
        const nextExpiry = goals.map(goal => Date.parse(goal && goal.expiresAt))
            .filter(time => Number.isFinite(time) && time > nowMs)
            .sort((a, b) => a - b)[0];
        if (nextExpiry !== undefined) {
            goalCleanupTimer = window.setTimeout(() => {
                goalCleanupTimer = null;
                window.focusflowGetActiveGoals();
            }, Math.min(2147480000, Math.max(0, nextExpiry - nowMs)));
        }
    }

    window.focusflowGetActiveGoals = function (nowValue = Date.now()) {
        if (checkingGoals) return activeGoalsCache.slice();
        const nowMs = nowValue instanceof Date ? nowValue.getTime() : Number(nowValue);
        const safeNow = Number.isFinite(nowMs) ? nowMs : Date.now();
        checkingGoals = true;
        try {
            const stored = readJSON(GOALS_KEY, []);
            const rawGoals = Array.isArray(stored) ? stored.filter(goal => goal && goal.id != null) : [];
            const state = readJSON(STATE_KEY, {});
            const history = state && state.trackHistory && typeof state.trackHistory === "object" ? state.trackHistory : {};
            let normalizedChanged = false;
            const normalized = rawGoals.map(goal => {
                const copy = { ...goal };
                const hasCreatedAt = Object.prototype.hasOwnProperty.call(copy, "createdAt");
                const hasExpiresAt = Object.prototype.hasOwnProperty.call(copy, "expiresAt");
                if (!hasCreatedAt && !hasExpiresAt) {
                    // Only current Goals records reach this migration path. If
                    // Track has no date evidence for one, start its first
                    // enforceable 24-hour window at migration time; historical
                    // Track-only goals are never copied into the active list.
                    const createdAt = isSavedGoal(copy)
                        ? inferredGoalCreation(copy, history) || new Date(safeNow).toISOString()
                        : null;
                    copy.createdAt = createdAt;
                    copy.expiresAt = createdAt ? new Date(Date.parse(createdAt) + GOAL_LIFETIME_MS).toISOString() : null;
                    normalizedChanged = true;
                } else {
                    const createdTime = Date.parse(copy.createdAt || "");
                    const expiresTime = Date.parse(copy.expiresAt || "");
                    if (Number.isFinite(createdTime) && !Number.isFinite(expiresTime)) {
                        copy.expiresAt = new Date(createdTime + GOAL_LIFETIME_MS).toISOString();
                        normalizedChanged = true;
                    } else if (!Number.isFinite(createdTime) && Number.isFinite(expiresTime)) {
                        copy.createdAt = new Date(expiresTime - GOAL_LIFETIME_MS).toISOString();
                        normalizedChanged = true;
                    } else if (!Number.isFinite(createdTime) && !Number.isFinite(expiresTime)) {
                        const inferred = isSavedGoal(copy) ? inferredGoalCreation(copy, history) : null;
                        const createdAt = isSavedGoal(copy) ? inferred || new Date(safeNow).toISOString() : null;
                        if (copy.createdAt !== createdAt || copy.expiresAt !== (createdAt ? new Date(Date.parse(createdAt) + GOAL_LIFETIME_MS).toISOString() : null)) {
                            copy.createdAt = createdAt;
                            copy.expiresAt = createdAt ? new Date(Date.parse(createdAt) + GOAL_LIFETIME_MS).toISOString() : null;
                            normalizedChanged = true;
                        }
                    }
                }
                return copy;
            });
            const expired = normalized.filter(goal => {
                const expiry = Date.parse(goal.expiresAt || "");
                return Number.isFinite(expiry) && expiry <= safeNow;
            });
            const expiredIds = new Set(expired.map(goal => String(goal.id)));
            const active = normalized.filter(goal => !expiredIds.has(String(goal.id)));
            activeGoalsCache = active;

            const goalsChanged = normalizedChanged || expired.length > 0
                || JSON.stringify(rawGoals) !== JSON.stringify(normalized);
            if (goalsChanged) window.focusflowStore.setItem(GOALS_KEY, JSON.stringify(active));

            if (expired.length) {
                const reminders = readJSON(REMINDERS_KEY, {});
                if (reminders && typeof reminders === "object" && !Array.isArray(reminders)) {
                    let remindersChanged = false;
                    expiredIds.forEach(id => {
                        if (Object.prototype.hasOwnProperty.call(reminders, id)) {
                            delete reminders[id];
                            remindersChanged = true;
                        }
                    });
                    if (remindersChanged) window.focusflowStore.setItem(REMINDERS_KEY, JSON.stringify(reminders));
                }
                if (expiredIds.has(String(window.focusflowStore.getItem(SELECTED_GOAL_KEY)))) {
                    window.focusflowStore.removeItem(SELECTED_GOAL_KEY);
                }
                if (typeof window.focusflowRecordTrackSnapshot === "function") {
                    window.focusflowRecordTrackSnapshot(active, { point: true });
                }
                window.dispatchEvent(new CustomEvent("focusflow:goals-expired", {
                    detail: { goals: expired.map(goal => ({ id: goal.id, name: goal.name })) }
                }));
            }

            const todayKey = localDateKey(new Date(safeNow));
            const todayRecord = history[todayKey];
            const hasTodayBaseline = Boolean(todayRecord && Array.isArray(todayRecord.progressPoints)
                && todayRecord.progressPoints.some(point => {
                    const pointTime = Date.parse(point && point.at || "");
                    return Array.isArray(point && point.goals) && Number.isFinite(pointTime)
                        && localDateKey(new Date(pointTime)) === todayKey;
                }));
            const currentState = readJSON(STATE_KEY, {});
            const hasCurrentActivity = active.some(isSavedGoal)
                || (currentState.lastFocusDate === todayKey && Number(currentState.todayFocusSeconds) > 0);
            if (!hasTodayBaseline && hasCurrentActivity
                && typeof window.focusflowRecordTrackSnapshot === "function") {
                window.focusflowRecordTrackSnapshot(active, { point: true, baseline: true });
            }

            scheduleGoalExpiry(active, safeNow);
            return active.slice();
        } finally {
            checkingGoals = false;
        }
    };

    function timeInvestmentSeconds(goal) {
        if (!goal) return null;
        const secondsPerUnit = {
            second: 1, sec: 1, secs: 1, seconds: 1,
            minute: 60, min: 60, mins: 60, minutes: 60,
            hour: 3600, hr: 3600, hrs: 3600, hours: 3600
        };
        const unit = String(goal.unit || "").trim().toLowerCase();
        const conversion = secondsPerUnit[unit];
        if (!conversion) return null;
        const invested = goal.invested;
        if (invested !== null && invested !== undefined && String(invested).trim() !== ""
            && Number.isFinite(Number(invested))) return Number(invested) * conversion;
        const target = Number(goal.target);
        const rawProgress = typeof goal.progress === "string" ? goal.progress.trim().replace(/%$/, "") : goal.progress;
        const progress = Number(rawProgress);
        if (!Number.isFinite(target) || target <= 0 || !Number.isFinite(progress)) return null;
        return target * Math.min(100, Math.max(0, progress)) / 100 * conversion;
    }

    // Focus Time is derived only from the saved goal snapshots for that date.
    // Session rows remain an audit trail and are never added to this result.
    window.focusflowGetSnapshotFocusSeconds = function (record, history = {}) {
        if (!record || typeof record !== "object") return 0;
        const date = /^\d{4}-\d{2}-\d{2}$/.test(record.date || "") ? record.date : null;
        if (!date) return 0;
        const points = (Array.isArray(record.progressPoints) ? record.progressPoints : [])
            .filter(point => {
                const at = Date.parse(point && point.at || "");
                return Array.isArray(point && point.goals) && Number.isFinite(at)
                    && localDateKey(new Date(at)) === date;
            })
            .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
        const baselineGoals = new Map((points[0] && points[0].goals || [])
            .filter(goal => goal && goal.id != null)
            .map(goal => [String(goal.id), goal]));

        let previousGoals = null;
        function findPreviousGoals() {
            if (previousGoals) return previousGoals;
            previousGoals = new Map();
            Object.entries(history || {}).map(([key, saved]) => {
                if (!saved || typeof saved !== "object") return null;
                const savedDate = /^\d{4}-\d{2}-\d{2}$/.test(saved.date || "") ? saved.date : key;
                return { date: savedDate, goals: Array.isArray(saved.goals) ? saved.goals : [] };
            }).filter(item => item && item.date < date).sort((a, b) => b.date.localeCompare(a.date))
                .forEach(item => item.goals.forEach(goal => {
                    if (goal && goal.id != null && !goal.deleted && !previousGoals.has(String(goal.id))) {
                        previousGoals.set(String(goal.id), goal);
                    }
                }));
            return previousGoals;
        }

        const today = localDateKey(new Date());
        return (Array.isArray(record.goals) ? record.goals : []).reduce((total, goal) => {
            if (!goal || goal.id == null) return total;
            const current = timeInvestmentSeconds(goal);
            if (current === null) return total;
            const id = String(goal.id);
            let baseline = baselineGoals.get(id) || null;
            const createdAt = Date.parse(goal.createdAt || "");
            const createdOnDate = Number.isFinite(createdAt) && localDateKey(new Date(createdAt)) === date;
            if (!baseline && !createdOnDate) baseline = findPreviousGoals().get(id) || null;
            if (baseline) {
                const previous = timeInvestmentSeconds(baseline);
                if (previous !== null) return total + Math.max(0, current - previous);
            }

            if (createdOnDate || (date !== today && !goal.createdAt && !baseline)) return total + Math.max(0, current);
            // Without a same-day baseline or creation date, don't attribute an
            // older cumulative investment to today.
            return total;
        }, 0);
    };

    window.focusflowRecordTrackSnapshot = function (goals, event = {}) {
        let state;
        try {
            state = JSON.parse(window.focusflowStore.getItem("focusflow_user_state") || "{}");
        } catch (_) {
            state = {};
        }
        if (!state || typeof state !== "object" || Array.isArray(state)) state = {};
        if (!state.trackHistory || typeof state.trackHistory !== "object" || Array.isArray(state.trackHistory)) {
            state.trackHistory = {};
        }

        const now = new Date();
        const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
        const storedToday = state.trackHistory[date];
        const previous = storedToday && (!storedToday.date || storedToday.date === date)
            ? storedToday : {};
        if (Object.prototype.hasOwnProperty.call(event, "reflection") && !String(event.reflection || "").trim()
            && !previous.date && !event.point && !event.session) return Promise.resolve(false);
        const requested = Array.isArray(goals) ? goals.filter(goal => goal && goal.id != null) : [];
        const currentGoals = typeof window.focusflowGetActiveGoals === "function"
            ? window.focusflowGetActiveGoals()
            : requested;
        const currentById = new Map(currentGoals.map(goal => [String(goal.id), goal]));
        const snapshot = requested.filter(goal => isSavedGoal(goal) && currentById.has(String(goal.id))).map(goal => {
            const activeGoal = currentById.get(String(goal.id));
            // The stored active goal is authoritative. A caller can hold an
            // older in-memory object while another save has already advanced it.
            const source = { ...goal, ...activeGoal };
            const hasValue = value => value !== null && value !== undefined
                && String(value).trim() !== "" && Number.isFinite(Number(value));
            const target = hasValue(source.target) ? Number(source.target) : null;
            const invested = hasValue(source.invested) ? Number(source.invested) : null;
            const progress = target > 0 && invested !== null
                ? Math.min(100, Math.max(0, invested / target * 100))
                : hasValue(source.progress) ? Math.min(100, Math.max(0, Number(source.progress))) : null;
            return {
                id: source.id,
                name: source.name || "Untitled goal",
                target,
                unit: source.unit || "",
                invested,
                progress,
                completed: progress === null ? source.completed === true : progress >= 100,
                createdAt: source.createdAt || null,
                expiresAt: source.expiresAt || null
            };
        });
        const currentIds = new Set(snapshot.map(goal => String(goal.id)));
        const goalsById = new Map(snapshot.map(goal => [String(goal.id), goal]));
        (previous.goals || []).forEach(goal => {
            if (!currentIds.has(String(goal.id))) goalsById.set(String(goal.id), { ...goal, deleted: true });
        });
        const savedSessions = Array.isArray(previous.focusSessions) ? previous.focusSessions : [];
        const existingSessions = savedSessions.filter(session => {
            const sessionAt = Date.parse(session && session.at || "");
            const sessionDate = session && session.date
                || (Number.isFinite(sessionAt) ? localDateKey(new Date(sessionAt)) : date);
            return sessionDate === date;
        });
        const savedPoints = Array.isArray(previous.progressPoints) ? previous.progressPoints : [];
        const existingPoints = savedPoints.filter(point => {
            const pointTime = Date.parse(point && point.at || "");
            return Number.isFinite(pointTime) && localDateKey(new Date(pointTime)) === date;
        });
        existingSessions.forEach(session => {
            if (session.goalId == null || currentIds.has(String(session.goalId))) return;
            const id = String(session.goalId);
            const previousGoal = goalsById.get(id) || { id: session.goalId };
            goalsById.set(id, { ...previousGoal, deleted: true });
        });
        const dailyGoals = Array.from(goalsById.values());
        const goalsCompleted = snapshot.filter(goal => goal.completed).length;
        const baselinePoint = existingPoints[0] || null;
        const baselineGoals = new Map((baselinePoint && Array.isArray(baselinePoint.goals) ? baselinePoint.goals : [])
            .filter(goal => goal && goal.id != null && !goal.deleted).map(goal => [String(goal.id), goal]));
        const timerSecondsByGoal = new Map();
        const progressSessions = existingSessions.slice();
        if (event.session && Number(event.session.seconds) > 0) progressSessions.push(event.session);
        const progressSessionIds = new Set();
        progressSessions.forEach(session => {
            if (!session || session.goalId == null || !Number.isFinite(Number(session.seconds)) || Number(session.seconds) <= 0) return;
            const id = session.id == null
                ? `${session.at || ""}:${Number(session.seconds)}:${session.goalId}:${session.mode || ""}`
                : String(session.id);
            if (progressSessionIds.has(id)) return;
            progressSessionIds.add(id);
            const goalId = String(session.goalId);
            timerSecondsByGoal.set(goalId, (timerSecondsByGoal.get(goalId) || 0) + Number(session.seconds));
        });
        const secondsPerTimeUnit = { second: 1, sec: 1, secs: 1, seconds: 1, minute: 60, min: 60, mins: 60, minutes: 60, hour: 3600, hr: 3600, hrs: 3600, hours: 3600 };
        const progressValues = snapshot.map(goal => {
            const target = Number(goal.target);
            const invested = Number(goal.invested);
            if (!Number.isFinite(target) || target <= 0 || !Number.isFinite(invested)) return 0;
            const id = String(goal.id);
            const baselineGoal = baselineGoals.get(id);
            let investedToday;
            if (baselineGoal && String(baselineGoal.unit || "") === String(goal.unit || "")) {
                const baselineInvested = Number(baselineGoal.invested);
                investedToday = Math.max(0, invested - (Number.isFinite(baselineInvested) ? baselineInvested : 0));
            } else if (event.baseline) {
                investedToday = 0;
            } else {
                const createdAt = Date.parse(goal.createdAt || "");
                const createdToday = Number.isFinite(createdAt) && localDateKey(new Date(createdAt)) === date;
                const secondsPerUnit = secondsPerTimeUnit[String(goal.unit || "").trim().toLowerCase()];
                investedToday = createdToday ? Math.max(0, invested)
                    : secondsPerUnit ? (timerSecondsByGoal.get(id) || 0) / secondsPerUnit : 0;
            }
            return Math.min(100, Math.max(0, investedToday / target * 100));
        });
        const goalProgress = progressValues.length
            ? Math.round(progressValues.reduce((sum, value) => sum + value, 0) / progressValues.length * 1000) / 1000
            : 0;
        // This writer only creates today's record. Its baseline is kept in
        // today's progress points; global/lifetime counters are not inputs.
        const legacyFocusSeconds = 0;
        const record = {
            ...previous,
            date,
            goals: dailyGoals,
            goalProgress,
            goalsCompleted,
            totalGoals: snapshot.length,
            legacyFocusSeconds,
            focusSeconds: legacyFocusSeconds,
            focusSessions: existingSessions,
            progressPoints: existingPoints,
            updatedAt: now.toISOString()
        };

        // Track page initialization may create a snapshot, but only actual user
        // actions should count toward activity analytics such as streaks.
        record.activity = previous.activity === true
            || event.activity === true
            || Boolean(event.session && Number(event.session.seconds) > 0);

        if (Object.prototype.hasOwnProperty.call(event, "reflection")) {
            record.reflection = String(event.reflection || "").trim();
        }
        if (event.session && Number(event.session.seconds) > 0) {
            const session = event.session;
            if (!record.focusSessions.some(item => item.id != null && item.id === session.id)) {
                const savedSession = {
                    id: session.id,
                    at: session.at || now.toISOString(),
                    date,
                    seconds: Number(session.seconds),
                    goalId: session.goalId == null ? null : session.goalId,
                    goalName: session.goalName || "Untitled goal",
                    mode: session.mode || "focus"
                };
                record.focusSessions.push(savedSession);
                event = { ...event, point: true, activity: true };
            }
        }

        const sessionIds = new Set();
        record.focusSessions = record.focusSessions.filter(session => {
            if (!session || !Number.isFinite(Number(session.seconds)) || Number(session.seconds) <= 0) return false;
            const id = session.id == null
                ? `${session.at || ""}:${Number(session.seconds)}:${session.goalId || ""}:${session.mode || ""}`
                : String(session.id);
            if (sessionIds.has(id)) return false;
            sessionIds.add(id);
            return true;
        });
        const deletedGoalIds = new Set(dailyGoals.filter(goal => goal.deleted && goal.id != null)
            .map(goal => String(goal.id)));
        const todaySessionSeconds = record.focusSessions.reduce((sum, session) => {
            if (session.goalId != null && deletedGoalIds.has(String(session.goalId))) return sum;
            return sum + Number(session.seconds);
        }, 0);
        record.focusSeconds = record.legacyFocusSeconds + todaySessionSeconds;
        if (state.lastFocusDate !== date) state.todayFocusSeconds = 0;
        if (record.focusSeconds > 0) state.lastFocusDate = date;

        if (event.point) {
            const at = now.toISOString();
            record.progressPoints.push({
                at,
                progress: record.goalProgress,
                goalsCompleted: record.goalsCompleted,
                totalGoals: record.totalGoals,
                focusSeconds: record.focusSeconds,
                goals: dailyGoals
            });
        }
        state.trackHistory[date] = record;
        state.todayFocusSeconds = window.focusflowGetSnapshotFocusSeconds(record, state.trackHistory);
        window.focusflowDebugLog("Track snapshot prepared", {
            date,
            event,
            snapshotGoals: record.goals.map(goal => ({ id: goal.id, target: goal.target, invested: goal.invested, unit: goal.unit })),
            focusSessions: record.focusSessions,
            focusSeconds: record.focusSeconds
        });
        const save = window.focusflowStore.setItem("focusflow_user_state", JSON.stringify(state));
        window.focusflowDebugLog("Track snapshot store readback", {
            date,
            state: window.focusflowStore.getItem("focusflow_user_state")
        });
        return save;
    };

    window.focusflowGetActiveGoals();
    document.addEventListener("visibilitychange", () => window.focusflowGetActiveGoals());
    window.addEventListener("focus", () => window.focusflowGetActiveGoals());
})();
