const HOME_GOALS_KEY = "focusflow_goals";


/* =========================================================
   GET GOALS
   ========================================================= */

function getHomeGoals() {

    try {

        const goals =
            JSON.parse(
                focusflowStore.getItem(HOME_GOALS_KEY)
            );

        return Array.isArray(goals)
            ? goals
            : [];

    } catch (error) {

        return [];

    }

}


/* =========================================================
   DATE
   ========================================================= */

function updateHomeDate() {

    const dateElement =
        document.getElementById("current-date");


    if (!dateElement) {
        return;
    }


    const today = new Date();


    dateElement.textContent =
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
   TIME-BASED GREETING
   ========================================================= */

function updateHomeGreeting() {

    const greetingElement =
        document.getElementById("home-greeting-time");

    if (!greetingElement) {
        return;
    }

    const hour = new Date().getHours();
    let greeting;

    if (hour >= 5 && hour < 12) {
        greeting = "Good Morning";
    } else if (hour >= 12 && hour < 17) {
        greeting = "Good Afternoon";
    } else if (hour >= 17 && hour < 21) {
        greeting = "Good Evening";
    } else {
        greeting = "Good Night";
    }

    greetingElement.textContent = greeting;

}


/* =========================================================
   FORMAT GOAL VALUE
   ========================================================= */

function formatGoalValue(value) {

    const number =
        Number(value) || 0;


    if (Number.isInteger(number)) {

        return String(number);

    }


    return number
        .toFixed(2)
        .replace(/\.?0+$/, "");

}


/* =========================================================
   UNIT LABEL
   ========================================================= */

function getUnitLabel(unit) {

    const value =
        String(unit || "")
            .toLowerCase()
            .trim();


    const units = {

        page: "page",
        pages: "page",

        minute: "min",
        minutes: "min",

        hour: "hr",
        hours: "hr",

        second: "sec",
        seconds: "sec",

        liter: "L",
        liters: "L"

    };


    return units[value] || value;

}


/* =========================================================
   GOAL PROGRESS
   ========================================================= */

function getGoalProgress(goal) {

    const target =
        Number(goal.target) || 0;


    const invested =
        Number(goal.invested) || 0;


    if (target <= 0) {
        return 0;
    }


    return Math.min(
        100,
        Math.max(
            0,
            Math.round(
                (invested / target) * 100
            )
        )
    );

}


/* =========================================================
   ICON FOR GOAL
   ========================================================= */

function getGoalIcon(goalName) {

    const name =
        String(goalName || "")
            .toLowerCase();


    if (
        name.includes("code") ||
        name.includes("program") ||
        name.includes("develop")
    ) {
        return "code";
    }


    if (
        name.includes("read") ||
        name.includes("book") ||
        name.includes("study")
    ) {
        return "menu_book";
    }


    if (
        name.includes("workout") ||
        name.includes("exercise") ||
        name.includes("gym") ||
        name.includes("fitness")
    ) {
        return "fitness_center";
    }


    if (
        name.includes("math")
    ) {
        return "calculate";
    }


    if (
        name.includes("write")
    ) {
        return "edit_note";
    }


    if (
        name.includes("project")
    ) {
        return "assignment";
    }


    return "flag";

}


/* =========================================================
   RENDER HOME GOALS
   ========================================================= */

function renderHomeGoals(goals) {

    const goalList =
        document.getElementById(
            "home-goal-list"
        );


    const emptyState =
        document.getElementById(
            "home-empty-goals"
        );


    if (!goalList || !emptyState) {
        return;
    }


    goalList.innerHTML = "";


    if (!goals.length) {

        emptyState.style.display = "block";

        return;

    }


    emptyState.style.display = "none";


    goals.slice(0, 4).forEach(function (goal) {

        const progress =
            getGoalProgress(goal);


        const icon =
            getGoalIcon(goal.name);


        const invested =
            formatGoalValue(
                goal.invested
            );


        const target =
            formatGoalValue(
                goal.target
            );


        const unit =
            getUnitLabel(
                goal.unit
            );


        const item =
            document.createElement("div");


        item.className =
            "goal-item";


        item.innerHTML = `

            <div class="goal-top">

                <div class="goal-name">

                    <div class="goal-icon">

                        <span class="material-symbols-outlined">
                            ${icon}
                        </span>

                    </div>

                    <span>
                        ${escapeHomeHtml(
                            goal.name || "Untitled Goal"
                        )}
                    </span>

                </div>

                <span class="goal-time">
                    ${invested} / ${target} ${unit}
                </span>

            </div>


            <div class="goal-progress-row">

                <div class="goal-progress">

                    <div
                        class="goal-progress-fill"
                        style="width: ${progress}%"
                    >
                    </div>

                </div>

                <span class="goal-percent">
                    ${progress}%
                </span>

            </div>

        `;


        goalList.appendChild(item);

    });

}


/* =========================================================
   OVERALL HOME PROGRESS
   =========================================================

   We average each goal's own percentage instead of
   adding pages + minutes + hours together.
   ========================================================= */

function calculateHomeProgress(goals) {

    if (!goals.length) {
        return 0;
    }


    let totalProgress = 0;


    goals.forEach(function (goal) {

        totalProgress +=
            getGoalProgress(goal);

    });


    return Math.round(
        totalProgress / goals.length
    );

}


/* =========================================================
   ANIMATE PROGRESS
   ========================================================= */

function animateHomeProgress(targetProgress) {

    const progressNumber =
        document.getElementById(
            "progress-number"
        );


    const progressCircle =
        document.getElementById(
            "progress-circle"
        );


    const radius = 43;

    const circumference =
        2 * Math.PI * radius;


    if (progressCircle) {

        progressCircle.style.strokeDasharray =
            circumference;

        progressCircle.style.strokeDashoffset =
            circumference;

    }


    if (!progressNumber) {
        return;
    }


    const duration = 900;

    const startTime =
        performance.now();


    function animate(currentTime) {

        const elapsed =
            currentTime - startTime;


        const progress =
            Math.min(
                elapsed / duration,
                1
            );


        const eased =
            1 - Math.pow(
                1 - progress,
                2
            );


        const currentValue =
            Math.round(
                eased * targetProgress
            );


        progressNumber.textContent =
            currentValue;


        if (progressCircle) {

            const offset =
                circumference -
                (
                    circumference *
                    (currentValue / 100)
                );


            progressCircle.style.strokeDashoffset =
                offset;

        }


        if (progress < 1) {

            requestAnimationFrame(
                animate
            );

        }

    }


    requestAnimationFrame(
        animate
    );

}


/* =========================================================
   UPDATE REAL STATISTICS
   ========================================================= */

function updateHomeStatistics(goals) {
    const total = document.getElementById("home-goal-count");
    const completed = document.getElementById("home-completed-count");
    if (total) total.textContent = String(goals.length);
    if (completed) {
        completed.textContent = String(
            goals.filter(goal => getGoalProgress(goal) >= 100).length
        );
    }
}


/* =========================================================
   REAL INSIGHT
   ========================================================= */

function updateHomeInsight(goals, progress) {

    const title =
        document.getElementById(
            "insight-title"
        );


    const description =
        document.getElementById(
            "insight-description"
        );


    if (!title || !description) {
        return;
    }


    if (!goals.length) {

        title.textContent =
            "Start with one goal.";


        description.textContent =
            "Your saved goals and their progress will appear here.";

        return;

    }


    if (progress >= 100) {

        title.textContent =
            "All goals completed.";


        description.textContent =
            `All ${goals.length} of your goals have reached their targets.`;

        return;

    }


    if (progress === 0) {

        title.textContent =
            "Your goals are ready.";


        description.textContent =
            `You have ${goals.length} ${goals.length === 1 ? "goal" : "goals"}. Update progress from the Goals page.`;

        return;

    }


    const remaining =
        100 - progress;


    title.textContent =
        "Keep the momentum going.";


    description.textContent =
        `Your goals are ${progress}% complete overall, with ${remaining}% remaining.`;

}


/* =========================================================
   HTML SAFETY
   ========================================================= */

function escapeHomeHtml(value) {

    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

}


/* =========================================================
   REFRESH HOME
   ========================================================= */

function refreshHome() {

    const goals =
        getHomeGoals();


    const progress =
        calculateHomeProgress(
            goals
        );


    renderHomeGoals(
        goals
    );


    animateHomeProgress(
        progress
    );


    updateHomeStatistics(goals);


    updateHomeInsight(
        goals,
        progress
    );

}


/* =========================================================
   START
   ========================================================= */

document.addEventListener(
    "DOMContentLoaded",
    function () {

        updateHomeGreeting();

        updateHomeDate();

        refreshHome();

    }
);


/* =========================================================
   REFRESH WHEN RETURNING TO HOME
   ========================================================= */

window.addEventListener(
    "storage",
    function (event) {

        if (
            event.key === HOME_GOALS_KEY
        ) {

            refreshHome();

        }

    }
);

window.addEventListener("focusflow:data-change", function (event) {
    if (event.detail && event.detail.key === HOME_GOALS_KEY) {
        refreshHome();
    }
});


/* =========================================================
   REFRESH WHEN TAB BECOMES ACTIVE
   ========================================================= */

document.addEventListener(
    "visibilitychange",
    function () {

        if (
            document.visibilityState === "visible"
        ) {

            refreshHome();

        }

    }
);
