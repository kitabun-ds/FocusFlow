(function () {
    "use strict";

    const GOALS_KEY = "focusflow_goals";
    const SELECTED_GOAL_KEY = "focusflow_selected_goal";
    const USER_STATE_KEY = "focusflow_user_state";
    const POMODORO_WORK = 25 * 60;
    const BREAK_SECONDS = 5 * 60;
    const QUOTES = [
        "A quiet hour can change the shape of a day.",
        "Begin where you are; the next step will meet you there.",
        "Attention is a small gift with a long reach.",
        "Steady effort makes room for unexpected progress."
    ];

    const page = document.getElementById("focusPage");
    if (!page || !window.focusflowStore) return;
    const goalList = document.getElementById("focusGoalList");
    const noGoals = document.getElementById("focusNoGoals");
    const continueGoalButton = document.getElementById("focusGoalContinue");
    const timerDisplays = page.querySelectorAll("[data-timer]");
    const durationInputs = page.querySelectorAll("[data-duration-input]");
    const durationNotes = page.querySelectorAll("[data-duration-note]");
    const completedDuration = document.getElementById("focusCompletedDuration");
    const completedGoal = document.getElementById("focusCompletedGoal");
    const todayProgress = document.getElementById("focusTodayProgress");
    const quoteElement = document.getElementById("focusQuote");
    const continueSummary = document.getElementById("focusContinueSummary");

    let selectedGoalId = Number(focusflowStore.getItem(SELECTED_GOAL_KEY)) || null;
    let selectedGoal = null;
    let mode = null;
    let requestedSeconds = 0;
    let remainingSeconds = 0;
    let remainingFocusMs = 0;
    let phaseMilliseconds = 0;
    let phaseStartedAt = null;
    let deadline = null;
    let timerInterval = null;
    let focusMilliseconds = 0;
    let completionApplied = false;
    let focusSessionId = null;
    let previousQuoteIndex = -1;

    function debugFocus(label, details) {
        if (typeof window.focusflowDebugLog === "function") {
            window.focusflowDebugLog(label, details);
        }
    }

    function readJSON(key, fallback) {
        try {
            const value = JSON.parse(focusflowStore.getItem(key) || "null");
            return value === null ? fallback : value;
        } catch (_) { return fallback; }
    }

    function loadGoals() {
        if (typeof window.focusflowGetActiveGoals === "function") {
            return window.focusflowGetActiveGoals().filter(goal =>
                typeof window.focusflowIsSavedGoal !== "function"
                    ? Boolean(goal && String(goal.name || "").trim() && String(goal.unit || "").trim() && Number(goal.target) > 0)
                    : window.focusflowIsSavedGoal(goal)
            );
        }
        const goals = readJSON(GOALS_KEY, []);
        return Array.isArray(goals) ? goals.filter(goal => goal && String(goal.name || "").trim() && String(goal.unit || "").trim() && Number(goal.target) > 0) : [];
    }

    function show(screen) {
        page.dataset.state = screen;
        document.body.dataset.focusState = screen;
        page.querySelectorAll("[data-screen]").forEach(section => {
            section.hidden = section.dataset.screen !== screen;
        });
        page.querySelectorAll("[data-goal-summary]").forEach(node => renderSummary(node));
    }

    function goalDescription(goal) {
        return `${formatNumber(goal.target)} ${goal.unit || ""} target`.trim();
    }

    function renderSummary(node) {
        node.replaceChildren();
        if (!selectedGoal) return;
        const icon = document.createElement("span");
        icon.className = "focus-summary-icon";
        icon.setAttribute("aria-hidden", "true");
        icon.textContent = iconForGoal(selectedGoal.name);
        const details = document.createElement("span");
        details.className = "focus-summary-details";
        const name = document.createElement("strong");
        name.textContent = selectedGoal.name || "Untitled goal";
        const description = document.createElement("small");
        description.textContent = goalDescription(selectedGoal);
        details.append(name, description);
        node.append(icon, details);
    }

    function iconForGoal(name) {
        const value = String(name || "").toLowerCase();
        if (/code|program|develop/.test(value)) return "⌘";
        if (/math/.test(value)) return "∑";
        if (/read|book/.test(value)) return "▤";
        if (/exercise|fitness|workout/.test(value)) return "◈";
        if (/project/.test(value)) return "▱";
        return "◎";
    }

    function renderGoals() {
        const goals = loadGoals().filter(goal => goal && goal.id != null);
        goalList.replaceChildren();
        noGoals.hidden = goals.length > 0;
        continueGoalButton.disabled = !goals.some(goal => Number(goal.id) === selectedGoalId);
        goals.forEach(goal => {
            const button = document.createElement("button");
            const icon = document.createElement("span");
            const detail = document.createElement("span");
            const name = document.createElement("strong");
            const progress = document.createElement("small");
            const arrow = document.createElement("span");
            button.type = "button";
            button.className = "focus-goal-choice";
            button.setAttribute("role", "listitem");
            button.setAttribute("aria-pressed", String(Number(goal.id) === selectedGoalId));
            icon.className = "focus-goal-icon";
            icon.setAttribute("aria-hidden", "true");
            icon.textContent = iconForGoal(goal.name);
            detail.className = "focus-goal-detail";
            name.textContent = goal.name || "Untitled goal";
            progress.textContent = `${formatNumber(goal.target)} ${goal.unit || ""} target`.trim();
            arrow.className = "focus-mode-arrow";
            arrow.textContent = "›";
            detail.append(name, progress);
            button.append(icon, detail, arrow);
            if (Number(goal.id) === selectedGoalId) button.classList.add("selected");
            button.addEventListener("click", () => {
                selectedGoalId = Number(goal.id);
                selectedGoal = goal;
                focusflowStore.setItem(SELECTED_GOAL_KEY, String(selectedGoalId));
                renderGoals();
            });
            goalList.append(button);
        });
    }

    function getSelectedGoal() {
        return loadGoals().find(goal => Number(goal.id) === selectedGoalId) || null;
    }

    function formatNumber(value) {
        const number = Number(value) || 0;
        return Number.isInteger(number) ? String(number) : String(Number(number.toFixed(2)));
    }

    function goalUnitSeconds(unit) {
        const normalized = String(unit || "").trim().toLowerCase();
        return ["second", "sec", "secs", "seconds"].includes(normalized) ? 1
            : ["hour", "hr", "hrs", "hours"].includes(normalized) ? 3600 : 60;
    }

    function goalTargetSeconds(goal) {
        const target = Number(goal && goal.target);
        if (!Number.isFinite(target) || target <= 0) return 25 * 60;
        return target * goalUnitSeconds(goal.unit);
    }

    function goalRemainingSeconds(goal) {
        const invested = Number(goal && goal.invested);
        const investedSeconds = Number.isFinite(invested) && invested > 0
            ? invested * goalUnitSeconds(goal.unit) : 0;
        return Math.max(0, goalTargetSeconds(goal) - investedSeconds);
    }

    function durationFromInput() {
        const durationInput = Array.from(durationInputs).find(input => !input.closest("[hidden]")) || durationInputs[0];
        const minutes = Number(durationInput.value);
        if (!Number.isFinite(minutes) || minutes <= 0) return 0;
        return minutes * 60 * 1000;
    }

    function formatTimer(seconds) {
        const value = Math.max(0, Math.ceil(seconds));
        const hours = Math.floor(value / 3600);
        const minutes = Math.floor((value % 3600) / 60);
        const secs = value % 60;
        if (mode === "deep") {
            return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
        }
        return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    }

    function updateTimerDisplays(kind, seconds) {
        timerDisplays.forEach(display => {
            if (display.dataset.timer === kind) display.textContent = formatTimer(seconds);
        });
    }

    function updateReadyTimer() {
        const note = mode === "pomodoro" ? durationNotes[0] : durationNotes[1];
        if (mode === "pomodoro") {
            updateTimerDisplays("work", Math.min(POMODORO_WORK, requestedSeconds));
            note.textContent = `Total focus: ${formatDuration(requestedSeconds)}. Breaks are excluded.`;
        } else if (mode === "deep") {
            updateTimerDisplays("work", requestedSeconds);
            note.textContent = `Total uninterrupted focus: ${formatDuration(requestedSeconds)}.`;
        }
    }

    function formatDuration(seconds) {
        const totalMinutes = Math.round(seconds / 60);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        if (hours && minutes) return `${hours}h ${minutes}m`;
        if (hours) return `${hours}h`;
        return `${totalMinutes} min`;
    }

    function formatElapsed(seconds) {
        const rounded = seconds > 0 ? Math.max(1, Math.round(seconds)) : 0;
        const hours = Math.floor(rounded / 3600);
        const minutes = Math.floor((rounded % 3600) / 60);
        const remainder = rounded % 60;
        const clock = hours > 0
            ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
            : `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
        return clock;
    }

    function clearTimer() {
        if (timerInterval !== null) window.clearInterval(timerInterval);
        timerInterval = null;
        deadline = null;
        phaseStartedAt = null;
    }

    function pomodoroIntervalMs() { return Math.min(POMODORO_WORK * 1000, remainingFocusMs); }

    function startPhase(milliseconds) {
        clearTimer();
        phaseMilliseconds = milliseconds;
        phaseStartedAt = currentTimeMilliseconds();
        deadline = phaseStartedAt + milliseconds;
        debugFocus("timer phase start", {
            sessionId: focusSessionId,
            selectedGoalId,
            mode,
            timestamp: new Date().toISOString(),
            monotonicTimestampMs: phaseStartedAt,
            plannedPhaseMs: milliseconds,
            requestedSeconds,
            remainingSeconds
        });
        timerInterval = window.setInterval(tick, 200);
        tick();
    }

    function currentTimeMilliseconds() {
        return window.performance && typeof window.performance.now === "function"
            ? window.performance.now() : Date.now();
    }

    function tick() {
        if (deadline === null) return;
        const left = Math.max(0, Math.ceil((deadline - currentTimeMilliseconds()) / 1000));
        updateTimerDisplays(mode === "break" ? "break" : "work", left);
        if (left > 0) return;
        clearTimer();
        if (mode === "break") {
            mode = "pomodoro";
            startPhase(pomodoroIntervalMs());
        } else {
            focusMilliseconds += phaseMilliseconds;
            remainingFocusMs = Math.max(0, remainingFocusMs - phaseMilliseconds);
            remainingSeconds = Math.ceil(remainingFocusMs / 1000);
            if (remainingFocusMs === 0) finishWork();
            else if (mode === "pomodoro") {
                mode = "break";
                show("break");
                updateTimerDisplays("break", BREAK_SECONDS);
                startPhase(BREAK_SECONDS * 1000);
            } else startPhase(remainingFocusMs);
        }
    }

    function prepareSession(sessionMode) {
        selectedGoal = getSelectedGoal();
        if (!selectedGoal) { show("goal"); renderGoals(); return; }
        clearTimer();
        mode = sessionMode;
        requestedSeconds = goalRemainingSeconds(selectedGoal);
        remainingSeconds = requestedSeconds;
        remainingFocusMs = requestedSeconds * 1000;
        focusMilliseconds = 0;
        completionApplied = false;
        focusSessionId = window.crypto && typeof window.crypto.randomUUID === "function"
            ? window.crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const minutesValue = String(requestedSeconds / 60);
        durationInputs.forEach(input => { input.value = minutesValue; input.setCustomValidity(""); });
        debugFocus("prepareSession", {
            selectedGoalId,
            selectedGoal,
            target: selectedGoal.target,
            unit: selectedGoal.unit,
            investedBefore: selectedGoal.invested,
            targetSeconds: goalTargetSeconds(selectedGoal),
            investedSeconds: (Number(selectedGoal.invested) || 0) * goalUnitSeconds(selectedGoal.unit),
            requestedSeconds,
            remainingSeconds,
            remainingFocusMs,
            sessionId: focusSessionId
        });
        show(sessionMode === "pomodoro" ? "pomodoro-ready" : "deep-ready");
        updateReadyTimer();
    }

    function confirmDuration() {
        const durationInput = Array.from(durationInputs).find(input => !input.closest("[hidden]")) || durationInputs[0];
        const milliseconds = durationFromInput();
        if (!milliseconds) {
            durationInput.setCustomValidity("Enter a focus duration greater than zero.");
            durationInput.reportValidity();
            return false;
        }
        durationInput.setCustomValidity("");
        requestedSeconds = milliseconds / 1000;
        remainingSeconds = requestedSeconds;
        remainingFocusMs = milliseconds;
        focusMilliseconds = 0;
        updateReadyTimer();
        return true;
    }

    function startWork() {
        if (deadline !== null || !confirmDuration()) return;
        debugFocus("start", {
            selectedGoalId,
            selectedGoal,
            requestedSeconds,
            remainingSeconds,
            timestamp: new Date().toISOString(),
            sessionId: focusSessionId
        });
        show(mode === "pomodoro" ? "pomodoro-running" : "deep-running");
        startPhase(mode === "pomodoro" ? pomodoroIntervalMs() : remainingFocusMs);
    }

    function elapsedCurrentPhase() {
        if (deadline === null) return 0;
        return Math.max(0, Math.min(phaseMilliseconds, currentTimeMilliseconds() - phaseStartedAt));
    }

    function toggleWorkTimer(button) {
        if (mode === "break") return;
        if (deadline !== null) {
            if (currentTimeMilliseconds() >= deadline) { tick(); return; }
            const left = Math.max(0, Math.ceil((deadline - currentTimeMilliseconds()) / 1000));
            const elapsed = elapsedCurrentPhase();
            focusMilliseconds += elapsed;
            remainingFocusMs = Math.max(0, remainingFocusMs - elapsed);
            remainingSeconds = Math.ceil(remainingFocusMs / 1000);
            phaseMilliseconds = Math.max(0, deadline - currentTimeMilliseconds());
            clearTimer();
            button.textContent = "▶ Resume";
            updateTimerDisplays("work", left);
            return;
        }
        button.textContent = "Ⅱ Pause";
        startPhase(phaseMilliseconds || (mode === "pomodoro" ? pomodoroIntervalMs() : remainingFocusMs));
    }

    function goalUnitAmount(seconds, unit) {
        const normalized = String(unit || "").trim().toLowerCase();
        if (["second", "sec", "secs", "seconds", "minute", "min", "mins", "minutes", "hour", "hr", "hrs", "hours", ""].includes(normalized)) {
            return seconds / goalUnitSeconds(normalized);
        }
        return null;
    }

    function dateKey(date) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    }

    function updateTodayFocus(seconds) {
        const state = readJSON(USER_STATE_KEY, {});
        const today = dateKey(new Date());
        if (state.lastFocusDate !== today) {
            state.lastFocusDate = today;
            state.todayFocusSeconds = 0;
        }
        state.totalFocusSeconds = (Number(state.totalFocusSeconds) || 0) + seconds;
        const todayRecord = state.trackHistory && state.trackHistory[today];
        state.todayFocusSeconds = typeof window.focusflowGetSnapshotFocusSeconds === "function"
            ? window.focusflowGetSnapshotFocusSeconds(todayRecord, state.trackHistory)
            : Math.max(0, Number(state.todayFocusSeconds) || 0);
        focusflowStore.setItem(USER_STATE_KEY, JSON.stringify(state));
        return state.todayFocusSeconds;
    }

    async function applyCompletion(sessionMode) {
        if (completionApplied) return;
        completionApplied = true;
        const seconds = Math.max(0, focusMilliseconds / 1000);
        const goals = loadGoals();
        const goal = goals.find(item => Number(item.id) === selectedGoalId);
        const investedBefore = goal ? Number(goal.invested) || 0 : null;
        let amountAdded = null;
        let goalSaveSucceeded = true;
        if (goal && seconds > 0) {
            const amount = goalUnitAmount(seconds, goal.unit);
            if (amount !== null) {
                amountAdded = amount;
                goal.invested = (Number(goal.invested) || 0) + amount;
                const target = Number(goal.target);
                goal.progress = Number.isFinite(target) && target > 0
                    ? Math.min(100, Math.max(0, goal.invested / target * 100)) : 0;
                goal.completed = goal.progress >= 100;
                const goalsPayload = JSON.stringify(goals);
                debugFocus("goal investment before write", {
                    actualElapsedMs: focusMilliseconds,
                    actualElapsedSeconds: seconds,
                    selectedGoalId,
                    investedBefore,
                    amountAdded,
                    investedAfter: goal.invested,
                    progressAfter: goal.progress,
                    goalsPayload
                });
                goalSaveSucceeded = await focusflowStore.setItem(GOALS_KEY, goalsPayload);
                selectedGoal = goal;
                debugFocus("goal persistence readback", {
                    saveSucceeded: goalSaveSucceeded,
                    persistedGoals: focusflowStore.getItem(GOALS_KEY),
                    goalReadback: loadGoals().find(item => Number(item.id) === selectedGoalId)
                });
            }
        }
        if (!goalSaveSucceeded) {
            window.alert("Your focus time could not be saved to the goal. Please try again.");
            return;
        }
        if (seconds > 0 && goalSaveSucceeded && typeof window.focusflowRecordTrackSnapshot === "function") {
            const snapshotSaved = await window.focusflowRecordTrackSnapshot(goals, {
                session: {
                    id: focusSessionId,
                    at: new Date().toISOString(),
                    seconds,
                    goalId: selectedGoalId,
                    goalName: selectedGoal ? selectedGoal.name : "Untitled goal",
                    mode: sessionMode
                }
            });
            const stateAfterSnapshot = readJSON(USER_STATE_KEY, {});
            const todayKey = dateKey(new Date());
            const todaySnapshot = stateAfterSnapshot.trackHistory && stateAfterSnapshot.trackHistory[todayKey];
            const trackGoal = todaySnapshot && Array.isArray(todaySnapshot.goals)
                ? todaySnapshot.goals.find(item => Number(item.id) === selectedGoalId)
                : null;
            debugFocus("Track snapshot after session", {
                snapshotSaved,
                todayKey,
                goal: trackGoal,
                focusSession: todaySnapshot && todaySnapshot.focusSessions
                    ? todaySnapshot.focusSessions.find(item => item.id === focusSessionId)
                    : null,
                storedState: focusflowStore.getItem(USER_STATE_KEY)
            });
            if (snapshotSaved === false) {
                window.alert("Your goal was saved, but the Track session could not be saved. Please try again.");
            }
        }
        const todaySeconds = seconds > 0 ? updateTodayFocus(seconds) : (Number(readJSON(USER_STATE_KEY, {}).todayFocusSeconds) || 0);
        completedDuration.textContent = formatElapsed(seconds);
        completedGoal.textContent = selectedGoal ? (selectedGoal.name || "Untitled goal") : "-";
        todayProgress.textContent = `${formatElapsed(todaySeconds)} focused today`;
        continueSummary.textContent = `${formatElapsed(seconds)} focused on ${completedGoal.textContent}.`;
    }

    async function finishWork() {
        if (completionApplied) return;
        clearTimer();
        const completedMode = mode;
        mode = null;
        await applyCompletion(completedMode);
        show("completed");
    }

    function endWork() {
        const stopTimestamp = new Date().toISOString();
        const elapsedMs = deadline !== null && mode !== "break" ? elapsedCurrentPhase() : 0;
        if (elapsedMs) focusMilliseconds += elapsedMs;
        debugFocus("stop", {
            selectedGoalId,
            timestamp: stopTimestamp,
            elapsedCurrentPhaseMs: elapsedMs,
            actualElapsedMs: focusMilliseconds,
            actualElapsedSeconds: focusMilliseconds / 1000,
            accumulatedFocusBeforeCurrentPhaseMs: focusMilliseconds - elapsedMs,
            mode,
            sessionId: focusSessionId
        });
        clearTimer();
        finishWork();
    }

    function nextQuote() {
        let index = Math.floor(Math.random() * QUOTES.length);
        if (index === previousQuoteIndex) index = (index + 1) % QUOTES.length;
        previousQuoteIndex = index;
        quoteElement.textContent = `“${QUOTES[index]}”`;
    }

    function resetForAnotherSession() {
        clearTimer();
        mode = null;
        requestedSeconds = remainingSeconds = 0;
        remainingFocusMs = focusMilliseconds = phaseMilliseconds = 0;
        completionApplied = false;
        focusSessionId = null;
        selectedGoal = getSelectedGoal();
        renderGoals();
        show("landing");
    }

    page.addEventListener("click", event => {
        const button = event.target.closest("[data-action]");
        if (!button) return;
        switch (button.dataset.action) {
            case "choose-goal": renderGoals(); show("goal"); break;
            case "back-landing": show("landing"); break;
            case "back-goal": renderGoals(); show("goal"); break;
            case "continue-mode": selectedGoal = getSelectedGoal(); if (selectedGoal) show("mode"); break;
            case "prepare-pomodoro": prepareSession("pomodoro"); break;
            case "prepare-deep": prepareSession("deep"); break;
            case "back-mode": clearTimer(); mode = null; show("mode"); break;
            case "start-work": startWork(); break;
            case "toggle-work": toggleWorkTimer(button); break;
            case "end-work": endWork(); break;
            case "active-back":
                if (window.confirm("End this focus session and save the focus time so far?")) endWork();
                break;
            case "continue": nextQuote(); show("continue"); break;
            case "another-session": resetForAnotherSession(); break;
        }
    });

    window.addEventListener("focusflow:data-change", event => {
        if (!event.detail || event.detail.key !== GOALS_KEY) return;
        const activeGoals = loadGoals();
        const selectedIsActive = activeGoals.some(goal => Number(goal.id) === selectedGoalId);
        if (!selectedIsActive) {
            selectedGoalId = null;
            if (deadline === null && !completionApplied) selectedGoal = null;
            if (Number(focusflowStore.getItem(SELECTED_GOAL_KEY)) || null) {
                focusflowStore.removeItem(SELECTED_GOAL_KEY);
            }
        } else if (selectedGoalId !== null) {
            selectedGoal = activeGoals.find(goal => Number(goal.id) === selectedGoalId) || selectedGoal;
        }
        if (page.dataset.state === "goal") renderGoals();
    });

    durationInputs.forEach(durationInput => durationInput.addEventListener("input", () => {
        if (mode) {
            const milliseconds = durationFromInput();
            if (milliseconds) {
                requestedSeconds = milliseconds / 1000;
                remainingSeconds = requestedSeconds;
                durationInputs.forEach(input => { if (input !== durationInput) input.value = durationInput.value; });
                updateReadyTimer();
            }
        }
    }));

    window.addEventListener("beforeunload", event => {
        if (deadline !== null) {
            event.preventDefault();
            event.returnValue = "";
        }
    });

    selectedGoal = getSelectedGoal();
    if (!selectedGoal && selectedGoalId !== null) {
        selectedGoalId = null;
        focusflowStore.removeItem(SELECTED_GOAL_KEY);
    }
    show("landing");
})();
