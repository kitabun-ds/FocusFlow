const GOALS_KEY = "focusflow_goals";
const MONTHLY_GOAL_KEY = "focusflow_monthly_goal";
const REFLECTION_KEY = "focusflow_reflection";
const REMINDER_SCHEDULE_KEY = "focusflow_reminder_schedule";

/* =========================================================
   LOAD DATA
   ========================================================= */

let goals = loadGoals();
let monthlyGoal = loadMonthlyGoal();
let reminders = loadReminders();
let selectedReminderGoalId = null;
let selectedReminderFrequency = "once";
let reminderInterval = null;
let reminderAudioContext = null;
let activeReminder = null;
let alarmInterval = null;
let alarmTimeout = null;
let activeNotification = null;
let reminderReturnFocus = null;
let reflectionSaveTimer = null;
let investedSaveQueue = Promise.resolve();

if (typeof window.focusflowDebugLog === "function") {
    window.focusflowDebugLog("Goals page initial stored goals", {
        storedGoals: focusflowStore.getItem(GOALS_KEY),
        loadedGoals: goals
    });
}


/* =========================================================
   STORAGE
   ========================================================= */

function loadGoals() {
    if (typeof window.focusflowGetActiveGoals === "function") {
        return window.focusflowGetActiveGoals();
    }
    try {
        return JSON.parse(
            focusflowStore.getItem(GOALS_KEY) || "[]"
        );
    } catch {
        return [];
    }
}

function saveGoals() {
    return focusflowStore.setItem(
        GOALS_KEY,
        JSON.stringify(goals)
    );
}

function saveTrackSnapshot(event = {}) {
    if (typeof window.focusflowRecordTrackSnapshot === "function") {
        return window.focusflowRecordTrackSnapshot(goals, event);
    }
    return Promise.resolve(false);
}

function loadMonthlyGoal() {
    const stored = readStoredJSON(MONTHLY_GOAL_KEY, null);

    if (typeof stored === "string") {
        return { title: stored, description: "" };
    }

    return stored && typeof stored === "object"
        ? { title: stored.title || "", description: stored.description || "" }
        : { title: "", description: "" };
}

function readStoredJSON(key, fallback) {
    try {
        return JSON.parse(focusflowStore.getItem(key) || JSON.stringify(fallback));
    } catch {
        return fallback;
    }
}

function loadReminders() {
    const stored = readStoredJSON(REMINDER_SCHEDULE_KEY, {});
    const schedule = stored && typeof stored === "object" && !Array.isArray(stored)
        ? stored
        : {};

    goals.forEach(goal => {
        const key = String(goal.id);
        if (!schedule[key] && /^\d{2}:\d{2}$/.test(goal.reminder || "")) {
            schedule[key] = {
                goalId: Number(goal.id),
                time: goal.reminder,
                enabled: true,
                frequency: "daily",
                nextAt: nextReminderDate(goal.reminder, "daily").toISOString(),
                lastFiredAt: null
            };
        }
    });

    return schedule;
}

function saveReminders() {
    return focusflowStore.setItem(
        REMINDER_SCHEDULE_KEY,
        JSON.stringify(reminders)
    );
}


/* =========================================================
   ELEMENTS
   ========================================================= */

const goalsList =
    document.getElementById("goalsList");

const goalsEmptyState =
    document.getElementById("goalsEmptyState");

const addGoalButton =
    document.getElementById("addGoalButton");

const emptyAddGoalButton =
    document.getElementById("emptyAddGoalButton");

const overallProgressValue =
    document.getElementById("overallProgressValue");

const overallProgressTitle =
    document.getElementById("overallProgressTitle");

const overallProgressMessage =
    document.getElementById("overallProgressMessage");

const overallProgressBar =
    document.getElementById("overallProgressBar");

const totalGoalsStat =
    document.getElementById("totalGoalsStat");

const completedGoalsStat =
    document.getElementById("completedGoalsStat");

const remainingGoalsStat =
    document.getElementById("remainingGoalsStat");

const totalTimeInvested =
    document.getElementById("totalTimeInvested");

const totalFocusTime =
    document.getElementById("totalFocusTime");

const currentStreakStat =
    document.getElementById("currentStreakStat");

const streakMetric =
    document.getElementById("streakMetric");

const reflectionInput =
    document.getElementById("reflectionInput");

const goalsDate =
    document.getElementById("goalsDate");


/* =========================================================
   MONTHLY GOAL ELEMENTS
   ========================================================= */

const monthlyGoalDisplay =
    document.getElementById("monthlyGoalTitle");

const monthlyGoalDescription =
    document.getElementById("monthlyGoalDescription");

const monthlyGoalDescriptionInput =
    document.getElementById("monthlyGoalDescriptionInput");

const monthlyGoalInput =
    document.getElementById("monthlyGoalInput");

const monthlyGoalEditButton =
    document.getElementById("editMonthlyGoalButton");

const monthlyGoalSaveButton =
    document.getElementById("saveMonthlyGoalButton");

const monthlyGoalCancelButton =
    document.getElementById("cancelMonthlyGoalButton");

const monthlyGoalEditor =
    document.getElementById("monthlyGoalEditor");


/* =========================================================
   REMINDER ELEMENTS
   ========================================================= */

const reminderModal =
    document.getElementById("reminderModal");

const openReminderButton =
    document.getElementById("openReminderButton");

const reminderGoalSelect =
    document.getElementById("reminderGoalSelect");

const reminderTimeInput =
    document.getElementById("reminderTimeInput");

const reminderEnabledInput =
    document.getElementById("reminderEnabled");

const setReminderButton =
    document.getElementById("setReminderButton");

const deleteReminderButton =
    document.getElementById("deleteReminderButton");

const cancelReminderButton =
    document.getElementById("cancelReminderButton");

const closeReminderButton =
    document.getElementById("closeReminderButton");

const reminderModalTitle =
    document.getElementById("reminderModalTitle");

const reminderPermissionStatus =
    document.getElementById("reminderPermissionStatus");

const reminderDeliveryNote =
    document.getElementById("reminderDeliveryNote");

const toast =
    document.getElementById("reminderToast");

const toastGoalName =
    document.getElementById("toastGoalName");

const toastGoalDetails =
    document.getElementById("toastGoalDetails");


/* =========================================================
   DATE
   ========================================================= */

if (goalsDate) {

    const today = new Date();

    goalsDate.textContent =
        today.toLocaleDateString(
            "en-US",
            {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric"
            }
        );
}


/* =========================================================
   ADD GOAL
   ========================================================= */

function addGoalRow() {

    const newGoal = {
        id: Date.now(),
        name: "",
        unit: "",
        target: "",
        reminder: "",
        invested: 0
    };

    goals.push(newGoal);

    saveGoals();

    renderGoals();

    setTimeout(() => {

        const input =
            document.querySelector(
                `[data-goal-name="${newGoal.id}"]`
            );

        if (input) {
            input.focus();
        }

    }, 50);
}


/* =========================================================
   CREATE GOAL ROW
   ========================================================= */

function createGoalRow(goal) {

    const row =
        document.createElement("div");

    row.className =
        "goal-row";

    const isNew =
        !goal.name ||
        !goal.unit ||
        !goal.target;


    /* =====================================================
       NEW GOAL
       ===================================================== */

    if (isNew) {

        row.innerHTML = `

            <div class="goal-cell goal-name-cell">

                <input
                    type="text"
                    class="goal-inline-input"
                    placeholder="Goal"
                    value="${escapeHTML(goal.name)}"
                    data-goal-name="${goal.id}"
                >

            </div>


            <div class="goal-cell" data-label="Unit">

                <select
                    class="goal-inline-input"
                    data-unit="${goal.id}"
                    required
                >

                    <option value="">
                        Unit
                    </option>

                    <option value="pages">
                        Pages
                    </option>

                    <option value="minutes">
                        Minutes
                    </option>

                    <option value="hours">
                        Hours
                    </option>

                    <option value="liters">
                        Liters
                    </option>

                    <option value="seconds">
                        Seconds
                    </option>

                </select>

            </div>


            <div class="goal-cell" data-label="Target">

                <input
                    type="number"
                    class="goal-inline-input"
                    placeholder="Target"
                    min="0.1"
                    step="0.1"
                    value="${goal.target || ""}"
                    data-target="${goal.id}"
                >

            </div>


            <div class="goal-cell reminder-cell" data-label="Reminder">

                <span class="goal-muted-value">Save goal to add a reminder</span>

            </div>


            <div class="goal-cell invested-cell" data-label="Time Invested">

                <span class="invested-display">
                    0
                </span>

            </div>


            <div class="goal-cell progress-cell" data-label="Progress">

                <div class="mini-progress">

                <div class="mini-progress-track">

                    <div
                        class="mini-progress-fill"
                        style="width: 0%"
                    ></div>

                </div>

                <span class="progress-text">
                    0%
                </span>

                </div>

            </div>


            <div class="goal-actions">

                <button
                    type="button"
                    class="goal-save-button"
                    data-save="${goal.id}"
                >
                    Save
                </button>

                <button
                    type="button"
                    class="goal-cancel-button"
                    data-cancel="${goal.id}"
                >
                    Cancel
                </button>

            </div>
        `;

        return row;
    }


    /* =====================================================
       SAVED GOAL
       ===================================================== */

    const progress =
        calculateGoalProgress(goal);


    row.innerHTML = `

        <div class="goal-cell goal-name-cell">

            <span>
                ${escapeHTML(goal.name)}
            </span>

        </div>


        <div class="goal-cell" data-label="Unit">

            <span>
                ${capitalize(goal.unit)}
            </span>

        </div>


        <div class="goal-cell" data-label="Target">

            <span>
                ${goal.target}
            </span>

        </div>


        <div class="goal-cell reminder-cell" data-label="Reminder">
            ${renderReminderControls(goal)}
        </div>


        <div class="goal-cell invested-cell" data-label="Time Invested">

            <input
                type="number"
                class="invested-input"
                value="${Number(goal.invested) || 0}"
                min="0"
                step="0.1"
                data-invested="${goal.id}"
            >

        </div>


        <div class="goal-cell progress-cell" data-label="Progress">

            <div class="mini-progress">

            <div class="mini-progress-track">

                <div
                    class="mini-progress-fill"
                    style="width: ${progress}%"
                ></div>

            </div>

            <span class="progress-text">
                ${Math.round(progress)}%
            </span>

            </div>

        </div>


        <div class="goal-actions">

            <button
                type="button"
                class="goal-delete-button"
                data-delete="${goal.id}"
                aria-label="Delete goal"
            >
                <span class="material-symbols-outlined" aria-hidden="true">delete</span>
            </button>

        </div>
    `;

    return row;
}

function renderReminderControls(goal) {
    const reminder = reminders[String(goal.id)];
    if (!reminder) {
        return `
            <button type="button" class="goal-reminder-small-button" data-reminder="${goal.id}">
                <span class="material-symbols-outlined" aria-hidden="true">add_alarm</span>
                Add reminder
            </button>
        `;
    }

    const enabled = Boolean(reminder.enabled);
    return `
        <div class="reminder-row-controls">
            <button type="button" class="goal-reminder-small-button${enabled ? " reminder-active" : ""}" data-reminder="${goal.id}" aria-label="Edit ${escapeHTML(goal.name)} reminder">
                <span class="material-symbols-outlined" aria-hidden="true">notifications</span>
                ${formatTime(reminder.time)}
            </button>
            <label class="reminder-toggle-label">
                <input type="checkbox" data-reminder-toggle="${goal.id}" aria-label="Enable ${escapeHTML(goal.name)} reminder" ${enabled ? "checked" : ""}>
                <span>${enabled ? "On" : "Off"}</span>
            </label>
            <button type="button" class="reminder-control-button" data-reminder-edit="${goal.id}" aria-label="Edit reminder for ${escapeHTML(goal.name)}">
                <span class="material-symbols-outlined" aria-hidden="true">edit</span>
            </button>
            <button type="button" class="reminder-control-button" data-reminder-delete="${goal.id}" aria-label="Delete reminder for ${escapeHTML(goal.name)}">
                <span class="material-symbols-outlined" aria-hidden="true">delete</span>
            </button>
        </div>
    `;
}


/* =========================================================
   RENDER
   ========================================================= */

function renderGoals() {

    if (!goalsList) {
        return;
    }

    goalsList.innerHTML = "";

    if (goals.length === 0) {

        if (goalsEmptyState) {
            goalsList.appendChild(goalsEmptyState);
            goalsEmptyState.style.display =
                "block";
        }

        updateOverallProgress();

        return;
    }

    if (goalsEmptyState) {
        goalsEmptyState.style.display =
            "none";
    }

    goals.forEach(goal => {

        goalsList.appendChild(
            createGoalRow(goal)
        );

    });

    updateOverallProgress();
}


/* =========================================================
   SAVE NEW GOAL
   ========================================================= */

async function saveGoal(id) {

    const goal =
        goals.find(
            item => item.id === id
        );

    if (!goal) {
        return;
    }

    const nameInput =
        document.querySelector(
            `[data-goal-name="${id}"]`
        );

    const unitInput =
        document.querySelector(
            `[data-unit="${id}"]`
        );

    const targetInput =
        document.querySelector(
            `[data-target="${id}"]`
        );


    const name =
        nameInput?.value.trim() || "";

    const unit =
        unitInput?.value || "";

    const target =
        Number(targetInput?.value);


    if (!name) {

        alert(
            "Please enter a goal name."
        );

        return;
    }


    if (
        !Number.isFinite(target) ||
        target <= 0
    ) {

        alert(
            "Please enter a target greater than 0."
        );

        return;
    }


    if (!unit) {

        alert(
            "Please select a unit."
        );

        return;
    }


    goal.name =
        name;

    goal.unit =
        unit;

    goal.target =
        target;


    /*
       A newly created goal ALWAYS starts
       with zero invested.
    */

    goal.invested = 0;
    if (!goal.createdAt || !goal.expiresAt) {
        const createdAt = new Date();
        goal.createdAt = createdAt.toISOString();
        goal.expiresAt = new Date(createdAt.getTime() + 24 * 60 * 60 * 1000).toISOString();
    }


    const goalsSaved = await saveGoals();
    if (!goalsSaved) {
        window.alert("Your goal could not be saved. Please try again.");
        return false;
    }
    const snapshotSaved = await saveTrackSnapshot({ point: true, activity: true });
    if (snapshotSaved === false) {
        window.alert("Your goal was saved, but its Track history could not be saved. Please try again.");
        return false;
    }

    renderGoals();
    return true;
}


/* =========================================================
   DELETE
   ========================================================= */

async function deleteGoal(id) {

    const confirmed =
        confirm(
            "Delete this goal?"
        );

    if (!confirmed) {
        return;
    }

    goals =
        goals.filter(
            goal =>
                Number(goal.id) !==
                Number(id)
        );

    if (Number(focusflowStore.getItem("focusflow_selected_goal")) === Number(id)) {
        focusflowStore.removeItem("focusflow_selected_goal");
    }

    delete reminders[String(id)];

    const goalsSaved = await saveGoals();
    if (!goalsSaved) {
        window.alert("The goal could not be deleted from storage. Please try again.");
        return false;
    }
    await saveReminders();
    const snapshotSaved = await saveTrackSnapshot({ point: true, activity: true });
    if (snapshotSaved === false) {
        window.alert("The goal was deleted, but its Track history could not be saved. Please try again.");
        return false;
    }

    renderGoals();
    return true;
}


/* =========================================================
   MANUAL TIME INVESTED UPDATE
   ========================================================= */

async function updateInvested(
    id,
    value
) {

    if (typeof window.focusflowGetActiveGoals === "function") {
        goals = window.focusflowGetActiveGoals();
    }

    const goal =
        goals.find(
            item =>
                Number(item.id) ===
                Number(id)
        );

    if (!goal) {
        return;
    }

    let invested =
        Number(value);

    if (
        !Number.isFinite(invested) ||
        invested < 0
    ) {
        invested = 0;
    }

    const now = new Date();
    const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const userState = readStoredJSON("focusflow_user_state", {}) || {};
    const todayRecord = userState.trackHistory && userState.trackHistory[todayKey];
    const hasGoalBaseline = Array.isArray(todayRecord && todayRecord.progressPoints)
        && todayRecord.progressPoints.some(point => {
            const pointAt = Date.parse(point && point.at || "");
            return Number.isFinite(pointAt)
                && `${new Date(pointAt).getFullYear()}-${String(new Date(pointAt).getMonth() + 1).padStart(2, "0")}-${String(new Date(pointAt).getDate()).padStart(2, "0")}` === todayKey
                && Array.isArray(point.goals)
                && point.goals.some(saved => saved && !saved.deleted && String(saved.id) === String(goal.id));
        });
    if (!hasGoalBaseline) {
        const baselineSaved = await saveTrackSnapshot({ point: true });
        if (baselineSaved === false) {
            window.alert("Your daily Track baseline could not be saved. Please try again.");
            return false;
        }
    }

    goal.invested = invested;
    goal.progress = calculateGoalProgress(goal);
    goal.completed = goal.progress >= 100;

    const goalsPayload = JSON.stringify(goals);
    if (typeof window.focusflowDebugLog === "function") {
        window.focusflowDebugLog("manual goal investment before persistence", {
            goalId: goal.id,
            target: goal.target,
            unit: goal.unit,
            invested: goal.invested,
            progress: goal.progress,
            goalsPayload
        });
    }

    const goalsSaved = await saveGoals();
    if (typeof window.focusflowDebugLog === "function") {
        window.focusflowDebugLog("manual goal investment persistence readback", {
            saveSucceeded: goalsSaved,
            storedGoals: focusflowStore.getItem(GOALS_KEY),
            goalReadback: loadGoals().find(item => Number(item.id) === Number(id))
        });
    }
    if (!goalsSaved) {
        window.alert("Your invested value could not be saved. It remains in this field; please try again.");
        return false;
    }

    const snapshotSaved = await saveTrackSnapshot({ point: true, activity: true });
    if (typeof window.focusflowDebugLog === "function") {
        const userState = readStoredJSON("focusflow_user_state", {}) || {};
        const today = new Date();
        const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
        const trackGoal = userState.trackHistory && userState.trackHistory[date]
            && Array.isArray(userState.trackHistory[date].goals)
            ? userState.trackHistory[date].goals.find(item => Number(item.id) === Number(id))
            : null;
        window.focusflowDebugLog("manual investment Track snapshot readback", {
            snapshotSaved,
            date,
            goal: trackGoal,
            trackSnapshot: userState.trackHistory && userState.trackHistory[date]
        });
    }
    if (snapshotSaved === false) {
        window.alert("Your goal was saved, but its Track history could not be saved. Please try again.");
        return false;
    }

    const row = document.querySelector(`[data-invested="${id}"]`)?.closest(".goal-row");
    if (row) {
        const progress = calculateGoalProgress(goal);
        const fill = row.querySelector(".mini-progress-fill");
        const label = row.querySelector(".progress-text");
        if (fill) fill.style.width = `${progress}%`;
        if (label) label.textContent = `${Math.round(progress)}%`;
    }

    updateOverallProgress();
    return true;
}


/* =========================================================
   GOAL PROGRESS
   ========================================================= */

function calculateGoalProgress(
    goal
) {

    const target =
        Number(goal.target) || 0;

    const invested =
        Number(goal.invested) || 0;

    if (target <= 0) {
        return 0;
    }

    return Math.min(100, Math.max(0, (invested / target) * 100));
}

function getSavedGoals() {
    return goals.filter(goal => typeof window.focusflowIsSavedGoal === "function"
        ? window.focusflowIsSavedGoal(goal)
        : Boolean(goal && String(goal.name || "").trim() && String(goal.unit || "").trim() && Number(goal.target) > 0));
}


/* =========================================================
   OVERALL PROGRESS
   ========================================================= */

function calculateOverallProgress() {
    const currentGoals = getSavedGoals();

    if (!currentGoals.length) {
        return 0;
    }

    let total = 0;

    currentGoals.forEach(goal => {

        total +=
            calculateGoalProgress(
                goal
            );

    });

    return Math.round(
        total / currentGoals.length
    );
}


function updateOverallProgress() {
    const currentGoals = getSavedGoals();

    const progress =
        calculateOverallProgress();


    if (overallProgressValue) {

        overallProgressValue.textContent =
            progress;
    }


    if (overallProgressBar) {

        overallProgressBar.style.width =
            `${progress}%`;
    }


    if (overallProgressTitle) overallProgressTitle.textContent = "Keep going";


    if (overallProgressMessage) {

        if (currentGoals.length === 0) {

            overallProgressMessage.textContent =
                "Add your first goal to start tracking your progress.";

        } else if (progress >= 100) {

            overallProgressMessage.textContent =
                "You completed all your goals.";

        } else {

            overallProgressMessage.textContent =
                "Small progress every day adds up.";
        }
    }


    if (totalGoalsStat) {

        totalGoalsStat.textContent =
            currentGoals.length;
    }


    const completed =
        currentGoals.filter(
            goal =>
                calculateGoalProgress(goal) >= 100
        ).length;


    if (completedGoalsStat) {

        completedGoalsStat.textContent =
            completed;
    }


    if (remainingGoalsStat) {

        remainingGoalsStat.textContent =
            currentGoals.length -
            completed;
    }

    const investedSeconds = currentGoals.reduce((total, goal) => {
        const invested = Number(goal.invested) || 0;
        const unit = String(goal.unit || "").trim().toLowerCase();
        if (["seconds", "second", "sec", "secs"].includes(unit)) return total + invested;
        if (["minutes", "minute", "min", "mins"].includes(unit)) return total + invested * 60;
        if (["hours", "hour", "hr", "hrs"].includes(unit)) return total + invested * 3600;
        return total;
    }, 0);

    if (totalTimeInvested) totalTimeInvested.textContent = formatDuration(investedSeconds);

    const userState = readStoredJSON("focusflow_user_state", {});
    const today = new Date();
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const todayRecord = userState.trackHistory && userState.trackHistory[todayKey];
    const todayFocusSeconds = typeof window.focusflowGetSnapshotFocusSeconds === "function"
        ? window.focusflowGetSnapshotFocusSeconds(todayRecord, userState.trackHistory)
        : userState.lastFocusDate === todayKey ? Math.max(0, Number(userState.todayFocusSeconds) || 0) : 0;
    if (totalFocusTime) totalFocusTime.textContent = formatDuration(todayFocusSeconds);
    const streak = Number(userState.streak);
    if (streakMetric && currentStreakStat) {
        const hasStreak = Number.isFinite(streak);
        streakMetric.hidden = !hasStreak;
        if (hasStreak) currentStreakStat.textContent = String(streak);
    }
}

function formatDuration(seconds) {
    const totalMinutes = Math.floor(Math.max(0, Number(seconds) || 0) / 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours && minutes) return `${hours}h ${minutes}m`;
    if (hours) return `${hours}h`;
    return `${totalMinutes}m`;
}


/* =========================================================
   MONTHLY GOAL
   ========================================================= */

function renderMonthlyGoal() {
    if (!monthlyGoalDisplay) return;

    const hasGoal = Boolean(monthlyGoal.title);
    monthlyGoalDisplay.textContent = hasGoal
        ? monthlyGoal.title
        : "No monthly goal yet";

    if (monthlyGoalDescription) {
        monthlyGoalDescription.textContent = hasGoal
            ? monthlyGoal.description || "A clear direction makes each small step count."
            : "Add one meaningful goal to guide your month.";
    }

    if (monthlyGoalEditor) monthlyGoalEditor.hidden = true;
    if (monthlyGoalEditButton) {
        monthlyGoalEditButton.textContent = hasGoal
            ? "Edit Monthly Goal"
            : "+ Add Monthly Goal";
    }
}


if (monthlyGoalEditButton) {

    monthlyGoalEditButton.addEventListener(
        "click",
        function () {
            if (monthlyGoalInput) monthlyGoalInput.value = monthlyGoal.title;
            if (monthlyGoalDescriptionInput) {
                monthlyGoalDescriptionInput.value = monthlyGoal.description;
            }
            if (monthlyGoalEditor) monthlyGoalEditor.hidden = false;
            monthlyGoalInput?.focus();
        }
    );
}


if (monthlyGoalSaveButton) {

    monthlyGoalSaveButton.addEventListener(
        "click",
        function () {
            const title = monthlyGoalInput?.value.trim() || "";
            const description = monthlyGoalDescriptionInput?.value.trim() || "";
            if (!title) {
                monthlyGoalInput?.focus();
                return;
            }
            monthlyGoal = { title, description };
            focusflowStore.setItem(MONTHLY_GOAL_KEY, JSON.stringify(monthlyGoal));
            renderMonthlyGoal();
        }
    );
}


if (monthlyGoalCancelButton) {

    monthlyGoalCancelButton.addEventListener(
        "click",
        function () {
            if (monthlyGoalEditor) monthlyGoalEditor.hidden = true;
        }
    );
}


/* =========================================================
   REFLECTION
   ========================================================= */

if (reflectionInput) {

    reflectionInput.value =
        focusflowStore.getItem(
            REFLECTION_KEY
        ) || "";


    reflectionInput.addEventListener(
        "input",
        function () {
            const reflection = reflectionInput.value;
            focusflowStore.setItem(REFLECTION_KEY, reflection);
            window.clearTimeout(reflectionSaveTimer);
            reflectionSaveTimer = window.setTimeout(() => {
                saveTrackSnapshot({ reflection, activity: Boolean(String(reflection || "").trim()) });
            }, 600);
        }
    );

    reflectionInput.addEventListener("change", function () {
        window.clearTimeout(reflectionSaveTimer);
        saveTrackSnapshot({ reflection: reflectionInput.value, activity: Boolean(reflectionInput.value.trim()) });
    });
}


/* =========================================================
   REMINDER PERMISSION
   ========================================================= */

async function requestNotificationPermission() {
    if (!("Notification" in window)) {
        setReminderStatus("System notifications are unavailable here. In-app reminders still work while this page is open.");
        return false;
    }

    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") {
        setReminderStatus("Notifications are blocked by browser settings. In-app reminders still work while this page is open.");
        return false;
    }

    try {
        const permission = await Notification.requestPermission();
        if (permission === "granted") return true;
        setReminderStatus("Notification permission was not granted. In-app reminders still work while this page is open.");
        return false;
    } catch {
        setReminderStatus("The browser could not request notification permission. In-app reminders still work while this page is open.");
        return false;
    }
}

function setReminderStatus(message) {
    if (reminderPermissionStatus) reminderPermissionStatus.textContent = message;
    const pageStatus = document.getElementById("reminderPageStatus");
    if (pageStatus) {
        pageStatus.textContent = message;
        pageStatus.hidden = !message;
    }
}

function updateFrequencyButtons() {
    document.querySelectorAll("[data-frequency]").forEach(button => {
        const active = button.dataset.frequency === selectedReminderFrequency;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
    });
}

function populateReminderGoals(selectedId) {
    if (!reminderGoalSelect) return;

    const savedGoals = goals.filter(goal => goal.name && goal.unit && Number(goal.target) > 0);
    reminderGoalSelect.innerHTML = savedGoals.map(goal =>
        `<option value="${goal.id}">${escapeHTML(goal.name)}</option>`
    ).join("");

    if (savedGoals.length) {
        const selected = savedGoals.find(goal => Number(goal.id) === Number(selectedId));
        reminderGoalSelect.value = String((selected || savedGoals[0]).id);
    }

    if (setReminderButton) setReminderButton.disabled = savedGoals.length === 0;
}

function openReminderModal(id = null) {
    if (!reminderModal) return;

    reminderReturnFocus = document.activeElement;
    populateReminderGoals(id);
    selectedReminderGoalId = reminderGoalSelect?.value
        ? Number(reminderGoalSelect.value)
        : null;

    const reminder = selectedReminderGoalId === null
        ? null
        : reminders[String(selectedReminderGoalId)];

    if (reminderTimeInput) reminderTimeInput.value = reminder?.time || "";
    if (reminderEnabledInput) reminderEnabledInput.checked = reminder?.enabled ?? true;
    selectedReminderFrequency = reminder?.frequency || "once";
    if (reminderModalTitle) {
        reminderModalTitle.textContent = reminder ? "Edit Reminder" : "Set a Reminder";
    }
    if (deleteReminderButton) deleteReminderButton.hidden = !reminder;
    updateFrequencyButtons();
    setReminderStatus(reminderGoalSelect?.options.length
        ? ""
        : "Add and save a goal before setting a reminder.");
    reminderModal.hidden = false;
    if (reminderGoalSelect?.options.length) reminderGoalSelect.focus();
}

function closeReminderModal() {
    if (reminderModal) reminderModal.hidden = true;
    selectedReminderGoalId = null;
    if (reminderReturnFocus instanceof HTMLElement) reminderReturnFocus.focus();
}

function nextReminderDate(time, frequency, from = new Date()) {
    const [hour, minute] = time.split(":").map(Number);
    const next = new Date(from);
    next.setHours(hour, minute, 0, 0);

    if (next <= from) next.setDate(next.getDate() + 1);
    if (frequency === "weekdays") {
        while (next.getDay() === 0 || next.getDay() === 6) {
            next.setDate(next.getDate() + 1);
        }
    }
    return next;
}

async function unlockReminderAudio() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    try {
        if (!reminderAudioContext) reminderAudioContext = new AudioContextClass();
        if (reminderAudioContext.state === "suspended") {
            await reminderAudioContext.resume();
        }
    } catch {
        reminderAudioContext = null;
    }
}

async function saveReminder() {
    const goalId = Number(reminderGoalSelect?.value);
    const goal = goals.find(item => Number(item.id) === goalId);
    const time = reminderTimeInput?.value || "";
    const enabled = Boolean(reminderEnabledInput?.checked);

    if (!goal || !time) {
        setReminderStatus(goal ? "Choose a reminder time." : "Choose a saved goal first.");
        return;
    }

    if (enabled) {
        await unlockReminderAudio();
        await requestNotificationPermission();
    }

    const previous = reminders[String(goalId)];
    reminders[String(goalId)] = {
        goalId,
        time,
        enabled,
        frequency: selectedReminderFrequency,
        nextAt: enabled ? nextReminderDate(time, selectedReminderFrequency).toISOString() : null,
        lastFiredAt: previous?.lastFiredAt || null
    };

    if (setReminderButton) setReminderButton.disabled = true;
    const saved = await saveReminders();
    if (setReminderButton) setReminderButton.disabled = false;

    if (!saved) {
        if (previous) reminders[String(goalId)] = previous;
        else delete reminders[String(goalId)];
        setReminderStatus("Could not save this reminder to your account. Check your connection and try again.");
        renderGoals();
        return;
    }

    if ("Notification" in window && Notification.permission === "granted") {
        setReminderStatus("Reminder saved. Browser notifications are enabled.");
    } else if (enabled && "Notification" in window && Notification.permission === "denied") {
        setReminderStatus("Reminder saved. Browser notifications are blocked; the in-app alarm will still appear while this page is open.");
    } else {
        setReminderStatus("Reminder saved to your account. In-app alerts run while FocusFlow is open.");
    }

    renderGoals();
    startReminderChecker();
    window.setTimeout(closeReminderModal, 900);
}

if (openReminderButton) {
    openReminderButton.addEventListener("click", () => openReminderModal());
}

if (reminderGoalSelect) {
    reminderGoalSelect.addEventListener("change", () => {
        selectedReminderGoalId = Number(reminderGoalSelect.value) || null;
        const reminder = selectedReminderGoalId === null
            ? null
            : reminders[String(selectedReminderGoalId)];
        if (reminderTimeInput) reminderTimeInput.value = reminder?.time || "";
        if (reminderEnabledInput) reminderEnabledInput.checked = reminder?.enabled ?? true;
        selectedReminderFrequency = reminder?.frequency || "once";
        if (reminderModalTitle) {
            reminderModalTitle.textContent = reminder ? "Edit Reminder" : "Set a Reminder";
        }
        if (deleteReminderButton) deleteReminderButton.hidden = !reminder;
        updateFrequencyButtons();
    });
}

document.querySelectorAll("[data-frequency]").forEach(button => {
    button.addEventListener("click", () => {
        selectedReminderFrequency = button.dataset.frequency;
        updateFrequencyButtons();
    });
});

if (setReminderButton) setReminderButton.addEventListener("click", saveReminder);
if (cancelReminderButton) cancelReminderButton.addEventListener("click", closeReminderModal);
if (closeReminderButton) closeReminderButton.addEventListener("click", closeReminderModal);

if (deleteReminderButton) {
    deleteReminderButton.addEventListener("click", async () => {
        const goalId = Number(reminderGoalSelect?.value);
        if (await removeReminderForGoal(goalId)) closeReminderModal();
    });
}

async function removeReminderForGoal(goalId) {
    const key = String(goalId);
    const goal = goals.find(item => Number(item.id) === Number(goalId));
    const previous = reminders[key] ? { ...reminders[key] } : null;
    const previousLegacyReminder = goal?.reminder;
    if (!previous && !previousLegacyReminder) return true;

    delete reminders[key];
    if (goal) goal.reminder = "";

    const [goalsSaved, remindersSaved] = await Promise.all([
        saveGoals(),
        saveReminders()
    ]);
    if (!goalsSaved || !remindersSaved) {
        if (previous) reminders[key] = previous;
        if (goal) goal.reminder = previousLegacyReminder;
        await Promise.all([saveGoals(), saveReminders()]);
        setReminderStatus("Could not delete this reminder from your account. Check your connection and try again.");
        renderGoals();
        return false;
    }

    if (activeReminder && Number(activeReminder.goalId) === Number(goalId)) {
        stopReminderAlarm();
    }

    setReminderStatus("Reminder deleted.");
    renderGoals();
    startReminderChecker();
    return true;
}

async function toggleReminder(goalId, enabled) {
    const reminder = reminders[String(goalId)];
    if (!reminder) return;

    const previous = { ...reminder };
    if (enabled) {
        await unlockReminderAudio();
        await requestNotificationPermission();
    }
    reminder.enabled = enabled;
    reminder.nextAt = enabled
        ? nextReminderDate(reminder.time, reminder.frequency).toISOString()
        : null;

    const saved = await saveReminders();
    if (!saved) {
        reminders[String(goalId)] = previous;
        setReminderStatus("Could not update this reminder on your account. Check your connection and try again.");
    } else {
        if (!enabled) {
            setReminderStatus("Reminder paused.");
        } else if ("Notification" in window && Notification.permission === "denied") {
            setReminderStatus("Reminder enabled. Browser notifications are blocked; the in-app alarm will still appear while this page is open.");
        } else {
            setReminderStatus("Reminder enabled.");
        }
    }
    renderGoals();
    startReminderChecker();
}

if (reminderModal) {
    reminderModal.addEventListener(
        "click",
        function (event) {
            if (event.target === reminderModal) closeReminderModal();
        }
    );
}

document.addEventListener("keydown", event => {
    if (event.key === "Escape" && reminderModal && !reminderModal.hidden) {
        closeReminderModal();
    }
});


/* =========================================================
   REMINDER CHECKER
   ========================================================= */

function startReminderChecker() {
    if (reminderInterval) clearInterval(reminderInterval);
    checkReminders();
    reminderInterval = window.setInterval(checkReminders, 15000);
}


function checkReminders() {
    const now = Date.now();
    let scheduleChanged = false;

    Object.entries(reminders).forEach(([key, reminder]) => {
        if (!reminder?.enabled || !reminder.nextAt) return;
        const dueAt = Date.parse(reminder.nextAt);
        if (!Number.isFinite(dueAt) || dueAt > now) return;

        const goal = goals.find(item => Number(item.id) === Number(key));
        if (goal && now - dueAt <= 10 * 60 * 1000) fireReminder(goal, reminder);

        reminder.lastFiredAt = new Date(dueAt).toISOString();
        if (reminder.frequency === "once") {
            reminder.enabled = false;
            reminder.nextAt = null;
        } else {
            reminder.nextAt = nextReminderDate(
                reminder.time,
                reminder.frequency,
                new Date(now)
            ).toISOString();
        }
        scheduleChanged = true;
    });

    if (scheduleChanged) {
        saveReminders();
        renderGoals();
    }
}


/* =========================================================
   RING + NOTIFICATION
   ========================================================= */

function fireReminder(goal) {
    stopReminderAlarm(false);
    activeReminder = { goalId: goal.id };
    if (toastGoalName) toastGoalName.textContent = `FocusFlow Reminder — ${goal.name}`;
    if (toastGoalDetails) {
        toastGoalDetails.textContent = `Your ${formatTime(reminders[String(goal.id)]?.time)} reminder is ready.`;
    }
    if (toast) toast.hidden = false;
    playReminderSound();
    alarmInterval = window.setInterval(playReminderSound, 3200);
    alarmTimeout = window.setTimeout(() => stopReminderAlarm(false), 60000);

    if ("Notification" in window && Notification.permission === "granted") {
        try {
            activeNotification = new Notification(`FocusFlow Reminder — ${goal.name}`, {
                body: `Time to work on ${goal.name}. Scheduled for ${formatTime(reminders[String(goal.id)]?.time)}.`,
                icon: "/static/images/sunocean.jpeg"
            });
            activeNotification.onclick = () => {
                window.focus();
                activeNotification?.close();
            };
        } catch (error) {
            console.warn("FocusFlow system notification unavailable:", error);
        }
    }
}

function stopReminderAlarm(hideToast = true) {
    if (alarmInterval) window.clearInterval(alarmInterval);
    if (alarmTimeout) window.clearTimeout(alarmTimeout);
    alarmInterval = null;
    alarmTimeout = null;
    activeNotification?.close();
    activeNotification = null;
    if (hideToast && toast) toast.hidden = true;
    if (hideToast) activeReminder = null;
}


/* =========================================================
   REMINDER SOUND
   ========================================================= */

function playReminderSound() {
    if (!reminderAudioContext || reminderAudioContext.state !== "running") return;
    const startAt = reminderAudioContext.currentTime;
    [0, 0.32, 0.64].forEach((offset, index) => {
        const oscillator = reminderAudioContext.createOscillator();
        const gain = reminderAudioContext.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = index === 1 ? 988 : 784;
        gain.gain.setValueAtTime(0.0001, startAt + offset);
        gain.gain.exponentialRampToValueAtTime(0.13, startAt + offset + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + offset + 0.24);
        oscillator.connect(gain);
        gain.connect(reminderAudioContext.destination);
        oscillator.start(startAt + offset);
        oscillator.stop(startAt + offset + 0.25);
    });
}

document.addEventListener("visibilitychange", checkReminders);
window.addEventListener("focus", checkReminders);

window.addEventListener("focusflow:data-change", event => {
    const key = event.detail && event.detail.key;
    if (key === GOALS_KEY) {
        const nextGoals = loadGoals();
        const goalsChanged = JSON.stringify(goals) !== JSON.stringify(nextGoals);
        goals = nextGoals;
        reminders = loadReminders();
        if (activeReminder && !goals.some(goal => Number(goal.id) === Number(activeReminder.goalId))) stopReminderAlarm();
        if (selectedReminderGoalId !== null && !goals.some(goal => Number(goal.id) === Number(selectedReminderGoalId))) closeReminderModal();
        if (goalsChanged) {
            renderGoals();
            updateOverallProgress();
        }
    } else if (key === REMINDER_SCHEDULE_KEY) {
        reminders = loadReminders();
    } else if (key === "focusflow_user_state") {
        updateOverallProgress();
    }
});

window.addEventListener("focusflow:goals-expired", event => {
    const expiredIds = new Set((event.detail && event.detail.goals || []).map(goal => Number(goal.id)));
    if (activeReminder && expiredIds.has(Number(activeReminder.goalId))) stopReminderAlarm();
    if (selectedReminderGoalId !== null && expiredIds.has(Number(selectedReminderGoalId))) closeReminderModal();
});

document.addEventListener("click", event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const saveButton = target.closest("[data-save]");
    if (saveButton) {
        saveGoal(Number(saveButton.dataset.save));
        return;
    }

    const cancelButton = target.closest("[data-cancel]");
    if (cancelButton) {
        const id = Number(cancelButton.dataset.cancel);
        goals = goals.filter(goal => Number(goal.id) !== id);
        if (Number(focusflowStore.getItem("focusflow_selected_goal")) === id) {
            focusflowStore.removeItem("focusflow_selected_goal");
        }
        saveGoals();
        renderGoals();
        return;
    }

    const reminderEditButton = target.closest("[data-reminder-edit]");
    if (reminderEditButton) {
        openReminderModal(Number(reminderEditButton.dataset.reminderEdit));
        return;
    }

    const reminderDeleteButton = target.closest("[data-reminder-delete]");
    if (reminderDeleteButton) {
        removeReminderForGoal(Number(reminderDeleteButton.dataset.reminderDelete));
        return;
    }

    const deleteButton = target.closest("[data-delete]");
    if (deleteButton) {
        deleteGoal(Number(deleteButton.dataset.delete));
        return;
    }

    const reminderButton = target.closest("[data-reminder]");
    if (reminderButton) openReminderModal(Number(reminderButton.dataset.reminder));
});


/* =========================================================
   INVESTED INPUT
   ========================================================= */

document.addEventListener(
    "change",
    function (event) {

        const input =
            event.target.closest(
                "[data-invested]"
            );

        if (!input) {
            return;
        }

        const id = Number(input.dataset.invested);
        const value = input.value;
        investedSaveQueue = investedSaveQueue
            .then(() => updateInvested(id, value))
            .catch(error => {
                console.error("Could not update invested goal progress:", error);
                window.alert("Your invested value could not be saved. It remains in this field; please try again.");
            });
    }
);

document.addEventListener("change", event => {
    const toggle = event.target.closest("[data-reminder-toggle]");
    if (toggle) toggleReminder(Number(toggle.dataset.reminderToggle), toggle.checked);
});

document.getElementById("toastStartButton")?.addEventListener("click", () => {
    stopReminderAlarm();
    window.location.assign("/focus");
});

document.getElementById("toastSnoozeButton")?.addEventListener("click", async () => {
    if (!activeReminder) return;
    const goalId = activeReminder.goalId;
    stopReminderAlarm();
    const reminder = reminders[String(goalId)];
    if (!reminder) return;

    reminder.enabled = true;
    reminder.nextAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    if (await saveReminders()) {
        if (toast) toast.hidden = true;
        activeReminder = null;
        renderGoals();
        setReminderStatus("Reminder snoozed for 10 minutes.");
    }
});

document.getElementById("toastDismissButton")?.addEventListener("click", () => {
    stopReminderAlarm();
});


/* =========================================================
   ADD BUTTONS
   ========================================================= */

if (addGoalButton) {

    addGoalButton.addEventListener(
        "click",
        addGoalRow
    );
}


if (emptyAddGoalButton) {

    emptyAddGoalButton.addEventListener(
        "click",
        addGoalRow
    );
}


/* =========================================================
   HELPERS
   ========================================================= */

function capitalize(value) {

    if (!value) {
        return "";
    }

    return (
        value.charAt(0).toUpperCase() +
        value.slice(1)
    );
}


function escapeHTML(value) {

    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}


function formatTime(time) {

    if (!time) {
        return "Set reminder";
    }

    const parts =
        time.split(":");

    let hour =
        Number(parts[0]);

    const minute =
        parts[1];

    const period =
        hour >= 12
            ? "PM"
            : "AM";

    hour =
        hour % 12 || 12;

    return `${hour}:${minute} ${period}`;
}


/* =========================================================
   START
   ========================================================= */

renderGoals();
renderMonthlyGoal();
startReminderChecker();
